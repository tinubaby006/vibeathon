import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  Application,
  CommunityAssessment,
  Notification,
  RootStore,
  ScanReport,
} from "./contracts";

export const DATA_DIR = process.env.VERCEL
  ? path.join("/tmp", "vibeathon-data")
  : process.env.VRC_DATA_DIR?.trim()
  ? path.resolve(process.env.VRC_DATA_DIR.trim())
  : path.join(process.cwd(), "data");

export function getStateFilePath(): string {
  if (process.env.VRC_STATE_FILE_PATH?.trim()) {
    return path.resolve(process.env.VRC_STATE_FILE_PATH.trim());
  }
  return path.join(DATA_DIR, "state.json");
}

export function getDataDir(): string {
  if (process.env.VRC_STATE_FILE_PATH?.trim()) {
    return path.dirname(path.resolve(process.env.VRC_STATE_FILE_PATH.trim()));
  }
  return DATA_DIR;
}

const DEFAULT_STATE: RootStore = {
  schemaVersion: 1,
  applications: [],
  scans: [],
  notifications: [],
  communityAssessments: [],
};

// Global singleton for process-wide serialization across Next.js dev reloads
declare global {
  var __vrcStoreMutex: Promise<unknown> | undefined;
  var __vrcActiveScanAppId: string | null | undefined;
}

globalThis.__vrcStoreMutex ??= Promise.resolve();
globalThis.__vrcActiveScanAppId ??= null;

/**
 * Scan lock management for single-scan concurrency enforcement
 */
export function acquireScanLock(applicationId: string): boolean {
  if (globalThis.__vrcActiveScanAppId !== null) {
    return false;
  }
  globalThis.__vrcActiveScanAppId = applicationId;
  return true;
}

export function releaseScanLock(applicationId: string): void {
  if (globalThis.__vrcActiveScanAppId === applicationId) {
    globalThis.__vrcActiveScanAppId = null;
  }
}

export function getActiveScanLock(): string | null {
  return globalThis.__vrcActiveScanAppId ?? null;
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(getDataDir(), { recursive: true });
}

/**
 * Read the current store. If absent, initializes with default state.
 * If JSON is corrupt, throws an error and preserves the file.
 */
export async function readStore(): Promise<RootStore> {
  await ensureDataDir();
  const filePath = getStateFilePath();
  try {
    const raw = await fs.readFile(/*turbopackIgnore: true*/ filePath, "utf-8");
    try {
      const parsed = JSON.parse(raw) as RootStore;
      if (!parsed || parsed.schemaVersion !== 1) {
        throw new Error("Invalid schemaVersion or root store format in data/state.json");
      }
      return parsed;
    } catch (parseErr) {
      throw new Error(`Corrupt state.json detected: ${(parseErr as Error).message}`);
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Check if read-only bundled seed exists (separate from writable runtime path)
      const bundledSeedPath = path.join(process.cwd(), "data", "state.json");
      let seedToUse = DEFAULT_STATE;
      if (filePath !== bundledSeedPath) {
        try {
          const seedRaw = await fs.readFile(/*turbopackIgnore: true*/ bundledSeedPath, "utf-8");
          const parsedSeed = JSON.parse(seedRaw) as RootStore;
          if (parsedSeed && parsedSeed.schemaVersion === 1) {
            seedToUse = parsedSeed;
          }
        } catch {
          // Bundled seed not present or unreadable, fall back to valid empty-state schema
        }
      }
      // Initialize only genuinely missing file in writable runtime data dir
      await writeStoreDirect(seedToUse);
      return seedToUse;
    }
    throw err;
  }
}

/**
 * Atomic write using temporary file and atomic rename
 */
async function writeStoreDirect(state: RootStore): Promise<void> {
  await ensureDataDir();
  const dir = getDataDir();
  const filePath = getStateFilePath();
  const tempPath = path.resolve(dir, `state.tmp.${randomUUID()}.json`);
  const content = JSON.stringify(state, null, 2);
  await fs.writeFile(tempPath, content, "utf-8");
  await fs.rename(tempPath, filePath);
}

/**
 * Serialized read-modify-write mutation queue
 */
export async function mutateStore<T>(
  mutator: (state: RootStore) => Promise<{ state: RootStore; result: T }>
): Promise<T> {
  let release: () => void = () => {};
  const currentMutex = globalThis.__vrcStoreMutex ?? Promise.resolve();

  const nextMutex = new Promise<void>((resolve) => {
    release = resolve;
  });

  globalThis.__vrcStoreMutex = currentMutex.then(() => nextMutex);

  try {
    await currentMutex;
    const currentState = await readStore();
    const { state: updatedState, result } = await mutator(currentState);
    await writeStoreDirect(updatedState);
    return result;
  } finally {
    release();
  }
}

// Higher-level store functions

export async function getApplications(): Promise<Application[]> {
  const store = await readStore();
  return store.applications;
}

export async function getApplication(id: string): Promise<Application | null> {
  const store = await readStore();
  return store.applications.find((a) => a.id === id) ?? null;
}

export async function addApplication(app: Application): Promise<Application> {
  return mutateStore(async (state) => {
    const existing = state.applications.find(
      (a) =>
        a.canonicalRepoUrl.toLowerCase() === app.canonicalRepoUrl.toLowerCase() &&
        a.projectPath.toLowerCase() === app.projectPath.toLowerCase() &&
        a.requestedRef === app.requestedRef &&
        a.deploymentClaim === app.deploymentClaim &&
        a.declaredDeployedCommit === app.declaredDeployedCommit
    );
    if (existing) {
      return { state, result: existing };
    }
    const updated = {
      ...state,
      applications: [app, ...state.applications],
    };
    return { state: updated, result: app };
  });
}

export async function getScans(applicationId?: string): Promise<ScanReport[]> {
  const store = await readStore();
  if (applicationId) {
    return store.scans.filter((s) => s.applicationId === applicationId);
  }
  return store.scans;
}

export async function getScan(scanId: string): Promise<ScanReport | null> {
  const store = await readStore();
  return store.scans.find((s) => s.id === scanId) ?? null;
}

export async function saveFinalizedScan(
  report: ScanReport,
  notification: Notification
): Promise<ScanReport> {
  return mutateStore(async (state) => {
    // Replace if exists (e.g. updating scan) or append
    const scanIndex = state.scans.findIndex((s) => s.id === report.id);
    let updatedScans: ScanReport[];
    if (scanIndex >= 0) {
      updatedScans = [...state.scans];
      updatedScans[scanIndex] = report;
    } else {
      updatedScans = [report, ...state.scans];
    }

    // Update application lastScanId and lastSuccessfulScanId
    const appIndex = state.applications.findIndex((a) => a.id === report.applicationId);
    let updatedApps = state.applications;
    if (appIndex >= 0) {
      const currentApp = state.applications[appIndex];
      const isSuccess = report.status === "complete" || report.status === "partial";
      const updatedApp: Application = {
        ...currentApp,
        lastScanId: report.id,
        lastSuccessfulScanId: isSuccess ? report.id : currentApp.lastSuccessfulScanId,
      };
      updatedApps = [...state.applications];
      updatedApps[appIndex] = updatedApp;
    }

    // Append notification if not already recorded with same id
    const notifIndex = state.notifications.findIndex((n) => n.id === notification.id);
    let updatedNotifs = state.notifications;
    if (notifIndex >= 0) {
      updatedNotifs = [...state.notifications];
      updatedNotifs[notifIndex] = notification;
    } else {
      updatedNotifs = [notification, ...state.notifications];
    }

    const nextState: RootStore = {
      ...state,
      applications: updatedApps,
      scans: updatedScans,
      notifications: updatedNotifs,
    };

    return { state: nextState, result: report };
  });
}

export async function getNotifications(): Promise<Notification[]> {
  const store = await readStore();
  return store.notifications;
}

export async function markNotificationRead(id: string, read: boolean): Promise<boolean> {
  return mutateStore(async (state) => {
    let changed = false;
    const updatedNotifs = state.notifications.map((n) => {
      if (n.id === id) {
        changed = true;
        return {
          ...n,
          readAt: read ? new Date().toISOString() : null,
        };
      }
      return n;
    });
    return {
      state: { ...state, notifications: updatedNotifs },
      result: changed,
    };
  });
}

export async function markAllNotificationsRead(): Promise<number> {
  return mutateStore(async (state) => {
    const now = new Date().toISOString();
    let count = 0;
    const updatedNotifs = state.notifications.map((n) => {
      if (!n.readAt) {
        count++;
        return { ...n, readAt: now };
      }
      return n;
    });
    return {
      state: { ...state, notifications: updatedNotifs },
      result: count,
    };
  });
}

export async function getCommunityAssessments(applicationId: string): Promise<CommunityAssessment[]> {
  const store = await readStore();
  return store.communityAssessments.filter((c) => c.applicationId === applicationId);
}

export async function saveCommunityAssessment(
  assessment: CommunityAssessment,
  notification: Notification
): Promise<CommunityAssessment> {
  return mutateStore(async (state) => {
    const updatedAssessments = [assessment, ...state.communityAssessments];
    const notifIndex = state.notifications.findIndex((n) => n.id === notification.id);
    let updatedNotifs = state.notifications;
    if (notifIndex >= 0) {
      updatedNotifs = [...state.notifications];
      updatedNotifs[notifIndex] = notification;
    } else {
      updatedNotifs = [notification, ...state.notifications];
    }

    return {
      state: {
        ...state,
        communityAssessments: updatedAssessments,
        notifications: updatedNotifs,
      },
      result: assessment,
    };
  });
}
