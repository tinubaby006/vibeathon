import { randomUUID } from "node:crypto";
import {
  Application,
  ScanCoverage,
  ScanReport,
  sanitizeFailureMessage,
} from "./contracts";
import {
  fetchProjectManifests,
  resolveRepositoryCommit,
  GitHubError,
} from "./github";
import { parseNpmInventory, InventoryError } from "./inventory";
import { queryOsvBatch } from "./osv";
import {
  normalizeAssessment,
  generateDeterministicSummary,
} from "./assessment";
import { enrichFindingsWithAi } from "./ai";
import {
  createScanNotification,
  dispatchOptionalEmail,
} from "./notifications";
import {
  acquireScanLock,
  releaseScanLock,
  saveFinalizedScan,
} from "./store";

const ASSESSMENT_BOUNDARY =
  "Dependency matching only; runtime reachability, exploitability, deployment identity, and protection were not verified.";

export class ScannerError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = "ScannerError";
  }
}

/**
 * Orchestrates a complete factual scan lifecycle for an application
 */
export async function executeScan(
  application: Application,
  fetchFn: typeof fetch = fetch
): Promise<ScanReport> {
  const scanId = randomUUID();
  const startedAt = new Date().toISOString();

  // 1. Enforce single global scan lock
  const locked = acquireScanLock(application.id);
  if (!locked) {
    throw new ScannerError(
      "A scan is already in progress for this or another application. Please wait for it to complete.",
      "SCAN_IN_PROGRESS",
      409,
      true
    );
  }

  try {
    let resolvedCommitSha: string | null = null;
    let lockfileHash: string | null = null;
    const providerFailures: ScanReport["providerFailures"] = [];

    // 2. Resolve commit SHA
    try {
      if (application.declaredDeployedCommit) {
        resolvedCommitSha = application.declaredDeployedCommit;
      } else {
        const repoRef = await resolveRepositoryCommit(
          application.owner,
          application.repo,
          application.requestedRef,
          fetchFn
        );
        resolvedCommitSha = repoRef.resolvedCommitSha;
      }
    } catch (err) {
      const ghErr = err as GitHubError;
      const failedReport = buildFailedReport({
        scanId,
        application,
        startedAt,
        resolvedCommitSha: null,
        lockfileHash: null,
        stage: "commit_resolution",
        failureMessage: sanitizeFailureMessage(ghErr.message || "Failed to resolve repository commit"),
        failureCode: ghErr.code || "UPSTREAM_UNAVAILABLE",
        retryable: ghErr.retryable,
      });

      const notification = createScanNotification(failedReport);
      await saveFinalizedScan(failedReport, notification);
      return failedReport;
    }

    // 3. Fetch package manifests pinned to resolvedCommitSha
    let manifests;
    try {
      manifests = await fetchProjectManifests(
        application.owner,
        application.repo,
        application.projectPath,
        resolvedCommitSha,
        fetchFn
      );
    } catch (err) {
      const ghErr = err as GitHubError;
      const failedReport = buildFailedReport({
        scanId,
        application,
        startedAt,
        resolvedCommitSha,
        lockfileHash: null,
        stage: "manifest_fetch",
        failureMessage: sanitizeFailureMessage(ghErr.message || "Failed to fetch repository manifests"),
        failureCode: ghErr.code || "MANIFEST_FETCH_FAILED",
        retryable: ghErr.retryable,
      });

      const notification = createScanNotification(failedReport);
      await saveFinalizedScan(failedReport, notification);
      return failedReport;
    }

    // 4. Parse npm inventory
    let inventoryData;
    try {
      inventoryData = parseNpmInventory(
        manifests.packageJsonRaw,
        manifests.packageLockRaw
      );
      lockfileHash = inventoryData.lockfileHash;
    } catch (err) {
      const invErr = err as InventoryError;
      const failedReport = buildFailedReport({
        scanId,
        application,
        startedAt,
        resolvedCommitSha,
        lockfileHash,
        stage: "lockfile_parse",
        failureMessage: sanitizeFailureMessage(invErr.message || "Failed to parse npm lockfile"),
        failureCode: invErr.code || "LOCKFILE_PARSE_FAILED",
      });

      const notification = createScanNotification(failedReport);
      await saveFinalizedScan(failedReport, notification);
      return failedReport;
    }

    // 5. Query OSV API with deadline
    const osvLookup = await queryOsvBatch(inventoryData.uniqueQueryablePairs, {
      fetchFn,
      deadlineMs: 80000,
    });

    if (osvLookup.failedQueries.length > 0) {
      providerFailures.push({
        stage: "osv_query",
        message: `${osvLookup.failedQueries.length} dependency queries failed during OSV lookup`,
        retryable: true,
      });
    }

    if (osvLookup.unhydratedAdvisoryIds.length > 0) {
      providerFailures.push({
        stage: "osv_hydration",
        message: `${osvLookup.unhydratedAdvisoryIds.length} advisories could not be hydrated from OSV details endpoint`,
        retryable: true,
      });
    }

    // 6. Normalize assessment and generate deterministic recommendations
    const assessment = normalizeAssessment(
      inventoryData.entries,
      osvLookup,
      new Date().toISOString()
    );

    const mergedCoverage: ScanCoverage = {
      ...inventoryData.coverage,
      queriedPairs: osvLookup.queriedCount,
      failedPairs: osvLookup.failedQueries.length,
      hydratedAdvisories: osvLookup.advisories.size,
      unhydratedAdvisoryIds: osvLookup.unhydratedAdvisoryIds,
      warnings: [...inventoryData.coverage.warnings, ...assessment.warnings],
    };

    // 7. Enrich findings with Gemini AI
    const aiResult = await enrichFindingsWithAi(
      assessment.findings,
      application.displayName,
      25000
    );

    if (aiResult.error) {
      providerFailures.push({
        stage: "gemini_enrichment",
        message: aiResult.error,
      });
    }

    // 8. Determine final scan coverage status
    let status: ScanReport["status"] = "complete";
    if (
      osvLookup.failedQueries.length > 0 ||
      osvLookup.unhydratedAdvisoryIds.length > 0 ||
      mergedCoverage.excludedEntries > 0
    ) {
      status = "partial";
    }

    const completedAt = new Date().toISOString();
    const deterministicSummary = generateDeterministicSummary(
      aiResult.enrichedFindings,
      mergedCoverage
    );

    const scannedFiles = [
      {
        path: manifests.packageJsonPath,
        gitHubUrl: `https://github.com/${application.owner}/${application.repo}/blob/${resolvedCommitSha}/${manifests.packageJsonPath}`,
      },
      {
        path: manifests.packageLockPath,
        gitHubUrl: `https://github.com/${application.owner}/${application.repo}/blob/${resolvedCommitSha}/${manifests.packageLockPath}`,
      },
    ];

    const report: ScanReport = {
      id: scanId,
      applicationId: application.id,
      startedAt,
      completedAt,
      resolvedCommitSha,
      lockfileHash,
      status,
      scannedFiles,
      coverage: mergedCoverage,
      inventory: inventoryData.entries,
      findings: aiResult.enrichedFindings,
      providerFailures,
      aiStatus: aiResult.aiStatus,
      aiSummary: aiResult.aiSummary,
      aiCoverage: aiResult.aiCoverage,
      deterministicSummary,
      applicationSnapshot: {
        displayName: application.displayName,
        canonicalRepoUrl: application.canonicalRepoUrl,
        projectPath: application.projectPath,
        requestedRef: application.requestedRef,
        deploymentUrl: application.deploymentUrl,
        deploymentClaim: application.deploymentClaim,
        declaredDeployedCommit: application.declaredDeployedCommit,
      },
      assessmentBoundary: ASSESSMENT_BOUNDARY,
    };

    // 9. Create notification
    const notification = createScanNotification(report);

    // 10. Optional email dispatch
    const emailResult = await dispatchOptionalEmail(report, fetchFn);
    if (emailResult.status !== "not_configured") {
      notification.emailDelivery = emailResult;
    }

    // 11. Persist in atomic transaction
    await saveFinalizedScan(report, notification);

    return report;
  } finally {
    releaseScanLock(application.id);
  }
}

function buildFailedReport(params: {
  scanId: string;
  application: Application;
  startedAt: string;
  resolvedCommitSha: string | null;
  lockfileHash: string | null;
  stage: string;
  failureMessage: string;
  failureCode: string;
  retryable?: boolean;
}): ScanReport {
  const sanitizedMessage = sanitizeFailureMessage(params.failureMessage);
  return {
    id: params.scanId,
    applicationId: params.application.id,
    startedAt: params.startedAt,
    completedAt: new Date().toISOString(),
    resolvedCommitSha: params.resolvedCommitSha,
    lockfileHash: params.lockfileHash,
    status: "failed",
    scannedFiles: [],
    coverage: {
      inventoryEntryCount: 0,
      uniqueQueryablePairs: 0,
      queriedPairs: 0,
      failedPairs: 0,
      excludedEntries: 0,
      hydratedAdvisories: 0,
      unhydratedAdvisoryIds: [],
      warnings: [],
      exclusions: [],
    },
    inventory: [],
    findings: [],
    providerFailures: [
      {
        stage: params.stage,
        message: sanitizedMessage,
        code: params.failureCode,
        retryable: params.retryable,
      },
    ],
    aiStatus: "not_needed",
    aiCoverage: { enrichedFindings: 0, totalFindings: 0 },
    deterministicSummary: `Scan failed at stage '${params.stage}': ${sanitizedMessage}`,
    applicationSnapshot: {
      displayName: params.application.displayName,
      canonicalRepoUrl: params.application.canonicalRepoUrl,
      projectPath: params.application.projectPath,
      requestedRef: params.application.requestedRef,
      deploymentUrl: params.application.deploymentUrl,
      deploymentClaim: params.application.deploymentClaim,
      declaredDeployedCommit: params.application.declaredDeployedCommit,
    },
    assessmentBoundary: ASSESSMENT_BOUNDARY,
  };
}
