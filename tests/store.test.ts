import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import {
  readStore,
  mutateStore,
  addApplication,
  getApplications,
  acquireScanLock,
  releaseScanLock,
} from "../lib/store";
import { Application } from "../lib/contracts";

let tempDir: string;
let stateFilePath: string;

describe("Store Persistence & Concurrency", () => {
  before(async () => {
    tempDir = path.join(os.tmpdir(), `vrc-test-store-${randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });
    stateFilePath = path.join(tempDir, "state.json");
    process.env.VRC_STATE_FILE_PATH = stateFilePath;
  });

  after(async () => {
    delete process.env.VRC_STATE_FILE_PATH;
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(async () => {
    // Reset isolated state file for clean testing
    try {
      await fs.writeFile(
        stateFilePath,
        JSON.stringify(
          {
            schemaVersion: 1,
            applications: [],
            scans: [],
            notifications: [],
            communityAssessments: [],
          },
          null,
          2
        )
      );
    } catch {
      // directory might not exist yet
    }
  });

  it("reads and initializes default store", async () => {
    const state = await readStore();
    assert.equal(state.schemaVersion, 1);
    assert.ok(Array.isArray(state.applications));
    assert.ok(Array.isArray(state.scans));
    assert.ok(Array.isArray(state.notifications));
  });

  it("preserves corrupt store file and does not silently overwrite", async () => {
    await fs.writeFile(stateFilePath, "{ corrupt json ...", "utf-8");
    await assert.rejects(async () => {
      await readStore();
    }, /Corrupt state\.json detected/);

    const raw = await fs.readFile(stateFilePath, "utf-8");
    assert.equal(raw, "{ corrupt json ...");
  });

  it("adds application and prevents duplicate records", async () => {
    const app: Application = {
      id: "app-1",
      displayName: "Demo App",
      owner: "facebook",
      repo: "react",
      canonicalRepoUrl: "https://github.com/facebook/react",
      requestedRef: null,
      projectPath: "",
      deploymentUrl: null,
      deploymentClaim: "repository_snapshot",
      declaredDeployedCommit: null,
      createdAt: new Date().toISOString(),
      lastScanId: null,
      lastSuccessfulScanId: null,
    };

    const added = await addApplication(app);
    assert.equal(added.id, "app-1");

    const apps = await getApplications();
    assert.equal(apps.length, 1);

    // Attempt duplicate
    const appDuplicate: Application = {
      ...app,
      id: "app-2",
    };
    const res = await addApplication(appDuplicate);
    assert.equal(res.id, "app-1"); // returns existing

    const appsAfter = await getApplications();
    assert.equal(appsAfter.length, 1);
  });

  it("manages scan locks and rejects concurrent overlaps", () => {
    releaseScanLock("app-test");
    const lock1 = acquireScanLock("app-test");
    assert.equal(lock1, true);

    const lock2 = acquireScanLock("app-other");
    assert.equal(lock2, false);

    releaseScanLock("app-test");
    const lock3 = acquireScanLock("app-other");
    assert.equal(lock3, true);
    releaseScanLock("app-other");
  });

  it("handles concurrent serialized mutations without losing updates", async () => {
    const promises = Array.from({ length: 5 }).map((_, i) =>
      mutateStore(async (state) => {
        const notif = {
          id: `notif-${i}`,
          applicationId: "app-1",
          kind: "scan_complete" as const,
          title: `Scan ${i}`,
          summary: `Summary ${i}`,
          createdAt: new Date().toISOString(),
          readAt: null,
        };
        return {
          state: {
            ...state,
            notifications: [...state.notifications, notif],
          },
          result: i,
        };
      })
    );

    await Promise.all(promises);

    const finalState = await readStore();
    assert.equal(finalState.notifications.length, 5);
  });
});
