// lib/local-demo.ts
// Server-side scanner and context manager for Checkpoint 2 Local Protection Demo.
// Scans exactly examples/preview-settings-demo with real lockfile parsing and real OSV lookup.
// Does NOT accept arbitrary filesystem paths, does NOT fabricate findings, and records honest provenance.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Application, ScanReport } from "./contracts";
import { parseNpmInventory } from "./inventory";
import { queryOsvBatch } from "./osv";
import {
  normalizeAssessment,
  generateDeterministicSummary,
} from "./assessment";
import { fetchTargetIdentity } from "../services/protection/scenario";
import { createScanNotification } from "./notifications";
import {
  getApplication,
  addApplication,
  saveFinalizedScan,
  getScan,
} from "./store";

export const LOCAL_DEMO_APP_ID = "app-local-demo-preview-settings";
export const LOCAL_DEMO_PROJECT_PATH = "examples/preview-settings-demo";
const DEMO_PORT = parseInt(process.env.DEMO_PORT || "8003", 10);

export function getLocalDemoDirectory(): string {
  return path.resolve(process.cwd(), LOCAL_DEMO_PROJECT_PATH);
}

/**
 * Ensures the local demo application record exists in the store.
 */
export async function getOrInitLocalDemo(): Promise<{
  application: Application;
  scan: ScanReport | null;
}> {
  let app = await getApplication(LOCAL_DEMO_APP_ID);

  if (!app) {
    const demoDir = getLocalDemoDirectory();
    if (!fs.existsSync(demoDir)) {
      throw new Error(`Local demo directory '${LOCAL_DEMO_PROJECT_PATH}' was not found.`);
    }

    app = {
      id: LOCAL_DEMO_APP_ID,
      displayName: "Preview Settings Demo (Local)",
      owner: "local",
      repo: "preview-settings-demo",
      canonicalRepoUrl: "local://examples/preview-settings-demo",
      requestedRef: null,
      projectPath: LOCAL_DEMO_PROJECT_PATH,
      sourceType: "local_demo",
      deploymentUrl: `http://127.0.0.1:${DEMO_PORT}`,
      deploymentClaim: "repository_snapshot",
      declaredDeployedCommit: null,
      createdAt: new Date().toISOString(),
      lastScanId: null,
      lastSuccessfulScanId: null,
    };

    await addApplication(app);
  }

  let scan: ScanReport | null = null;
  if (app.lastScanId) {
    scan = await getScan(app.lastScanId);
  }

  return { application: app, scan };
}

/**
 * Scans the actual local demo package.json and package-lock.json files,
 * queries OSV for real advisories, normalizes findings, and records honest provenance.
 */
export async function scanLocalDemo(): Promise<{
  application: Application;
  scan: ScanReport;
}> {
  await getOrInitLocalDemo();
  const startedAt = new Date().toISOString();
  const demoDir = getLocalDemoDirectory();

  const pkgJsonPath = path.join(demoDir, "package.json");
  const pkgLockPath = path.join(demoDir, "package-lock.json");

  if (!fs.existsSync(pkgJsonPath) || !fs.existsSync(pkgLockPath)) {
    throw new Error(
      `Required demo manifest files (package.json, package-lock.json) not found in '${LOCAL_DEMO_PROJECT_PATH}'.`
    );
  }

  const pkgJsonContent = fs.readFileSync(/*turbopackIgnore: true*/ pkgJsonPath, "utf-8");
  const pkgLockContent = fs.readFileSync(/*turbopackIgnore: true*/ pkgLockPath, "utf-8");

  // Compute honest cryptographic provenance
  const manifestHash = crypto.createHash("sha256").update(pkgJsonContent, "utf8").digest("hex");
  const lockfileHash = crypto.createHash("sha256").update(pkgLockContent, "utf8").digest("hex");
  const sourceFingerprint = crypto
    .createHash("sha256")
    .update(`${manifestHash}:${lockfileHash}`, "utf8")
    .digest("hex");

  // Parse inventory using existing npm lockfile parser
  const inventoryData = parseNpmInventory(pkgJsonContent, pkgLockContent);

  // Query OSV for real advisories for supported entries
  const osvLookup = await queryOsvBatch(inventoryData.uniqueQueryablePairs);

  // Normalize findings using existing assessment rules
  const assessment = normalizeAssessment(
    inventoryData.entries,
    osvLookup,
    startedAt
  );

  const coverage = {
    ...inventoryData.coverage,
    ...assessment.coverageUpdates,
    inventoryEntryCount: inventoryData.entries.length,
    uniqueQueryablePairs: inventoryData.uniqueQueryablePairs.length,
    queriedPairs: osvLookup.queriedCount,
    failedPairs: osvLookup.failedQueries.length,
    hydratedAdvisories: osvLookup.advisories.size,
    unhydratedAdvisoryIds: osvLookup.unhydratedAdvisoryIds,
  };

  const deterministicSummary = generateDeterministicSummary(
    assessment.findings,
    coverage
  );

  // Query local running target identity for honest runtime instance ID
  let runtimeInstanceId: string | null = null;
  try {
    const identity = await fetchTargetIdentity(DEMO_PORT, 2000);
    runtimeInstanceId = identity.targetInstanceId;
  } catch {}

  const scanId = `scan-demo-${Date.now().toString(36)}`;
  const scanReport: ScanReport = {
    id: scanId,
    applicationId: LOCAL_DEMO_APP_ID,
    startedAt,
    completedAt: new Date().toISOString(),
    resolvedCommitSha: null, // Honest: no git commit invented for local fixture
    lockfileHash,
    manifestHash,
    sourceFingerprint,
    runtimeInstanceId,
    sourceType: "local_demo",
    status: "complete",
    scannedFiles: [
      { path: "package.json", gitHubUrl: "" },
      { path: "package-lock.json", gitHubUrl: "" },
    ],
    coverage,
    inventory: inventoryData.entries,
    findings: assessment.findings,
    providerFailures: [],
    aiStatus: "completed",
    deterministicSummary,
    applicationSnapshot: {
      displayName: "Preview Settings Demo (Local)",
      canonicalRepoUrl: "local://examples/preview-settings-demo",
      projectPath: LOCAL_DEMO_PROJECT_PATH,
      requestedRef: null,
      deploymentUrl: `http://127.0.0.1:${DEMO_PORT}`,
      deploymentClaim: "repository_snapshot",
      declaredDeployedCommit: null,
      sourceType: "local_demo",
    },
    assessmentBoundary: `Bounded local assessment of fixture '${LOCAL_DEMO_PROJECT_PATH}'. Real package.json and package-lock.json parsed and verified against OSV.`,
  };

  const notification = createScanNotification(scanReport);
  await saveFinalizedScan(scanReport, notification);

  const updatedApp = (await getApplication(LOCAL_DEMO_APP_ID))!;
  return { application: updatedApp, scan: scanReport };
}
