import { z } from "zod";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

export type DependencyUsageCategory =
  | "production"
  | "development"
  | "optional"
  | "unknown";

export type FindingSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "unknown";

export type RecommendationType =
  | "review_upgrade"
  | "review_temporary_restriction"
  | "investigate_applicability"
  | "monitor_advisory";

export interface Recommendation {
  type: RecommendationType;
  origin: "deterministic" | "ai";
  action: string;
  rationale: string;
  potentialImpact: string;
  evidenceIds: string[];
  limitations?: string;
}

export interface Finding {
  findingKey: string;
  advisoryId: string;
  sourceIds: string[];
  aliases: string[];
  title: string;
  description: string;
  publishedAt?: string;
  modifiedAt?: string;
  checkedAt: string;
  packageName: string;
  version: string;
  dependencyPaths: string[];
  categories: DependencyUsageCategory[];
  severity: FindingSeverity;
  severitySource?: string;
  applicability: "known_affected_version";
  affectedVersionEvidence: string;
  patchStatus: "fix_listed" | "no_fix_listed" | "unknown";
  fixedVersionsListed: string[];
  references: string[];
  recommendations: Recommendation[];
  aiExplanation?: string;
}

export interface DependencyEntry {
  ecosystem: "npm";
  packageName: string;
  version: string;
  paths: string[];
  direct: boolean;
  categories: DependencyUsageCategory[];
  originStatus: "supported" | "excluded";
  exclusionReason?: string;
}

export interface ScanCoverage {
  inventoryEntryCount: number;
  uniqueQueryablePairs: number;
  queriedPairs: number;
  failedPairs: number;
  excludedEntries: number;
  hydratedAdvisories: number;
  unhydratedAdvisoryIds: string[];
  warnings: string[];
  exclusions: Array<{ name: string; versionSpec: string; reason: string }>;
}

export interface ApplicationSnapshot {
  displayName: string;
  canonicalRepoUrl: string;
  projectPath: string;
  requestedRef: string | null;
  deploymentUrl: string | null;
  deploymentClaim: "repository_snapshot" | "developer_declared_commit";
  declaredDeployedCommit: string | null;
  sourceType?: "github" | "local_demo";
}

export interface AiCoverage {
  enrichedFindings: number;
  totalFindings: number;
}

export interface ScanReport {
  id: string;
  applicationId: string;
  startedAt: string;
  completedAt: string;
  resolvedCommitSha: string | null;
  lockfileHash: string | null;
  manifestHash?: string | null;
  sourceFingerprint?: string | null;
  runtimeInstanceId?: string | null;
  sourceType?: "github" | "local_demo";
  status: "complete" | "partial" | "failed";
  scannedFiles: Array<{ path: string; gitHubUrl: string }>;
  coverage: ScanCoverage;
  inventory: DependencyEntry[];
  findings: Finding[];
  providerFailures: Array<{
    stage: string;
    message: string;
    code?: string;
    retryable?: boolean;
  }>;
  aiStatus: "completed" | "partial" | "unavailable" | "failed" | "not_needed";
  aiSummary?: string;
  aiCoverage?: AiCoverage;
  deterministicSummary: string;
  applicationSnapshot: ApplicationSnapshot;
  assessmentBoundary: string;
}

export interface Application {
  id: string;
  displayName: string;
  owner: string;
  repo: string;
  canonicalRepoUrl: string;
  requestedRef: string | null;
  projectPath: string;
  deploymentUrl: string | null;
  deploymentClaim: "repository_snapshot" | "developer_declared_commit";
  declaredDeployedCommit: string | null;
  createdAt: string;
  lastScanId: string | null;
  lastSuccessfulScanId: string | null;
  sourceType?: "github" | "local_demo";
}

export interface Notification {
  id: string;
  applicationId: string;
  scanId?: string;
  communityReportId?: string;
  kind: "scan_complete" | "scan_partial" | "scan_failed" | "community_signal";
  title: string;
  summary: string;
  createdAt: string;
  readAt: string | null;
  emailDelivery?: {
    status: "not_configured" | "pending" | "sent" | "failed";
    providerId?: string;
    error?: string;
  };
}

export interface CommunityAssessment {
  id: string;
  applicationId: string;
  sourceUrl?: string;
  pastedText: string;
  createdAt: string;
  basedOnScanId?: string;
  status: "unverified_signal";
  aiStatus: "completed" | "unavailable" | "failed";
  claimedPackage?: string;
  claimedAffectedRange?: string;
  possibleMatch: boolean;
  matchedInstalledEntries: Array<{ name: string; version: string; direct: boolean }>;
  explanation: string;
  missingEvidence: string;
  proposedNextSteps: string[];
}

export interface RootStore {
  schemaVersion: 1;
  applications: Application[];
  scans: ScanReport[];
  notifications: Notification[];
  communityAssessments: CommunityAssessment[];
}

// Zod Schemas for API Input Validation

const GITHUB_REPO_REGEX = /^[a-zA-Z0-9_.-]+$/;

export const RegisterApplicationSchema = z.object({
  displayName: z.string().trim().max(100).optional(),
  repoUrl: z.string().trim().url().refine((val) => {
    try {
      const u = new URL(val);
      if (u.hostname !== "github.com") return false;
      if (u.protocol !== "https:") return false;
      if (u.username || u.password || u.port || u.search || u.hash) return false;
      const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
      if (parts.length !== 2) return false;
      const owner = parts[0];
      const repo = parts[1].replace(/\.git$/i, "");
      return GITHUB_REPO_REGEX.test(owner) && GITHUB_REPO_REGEX.test(repo);
    } catch {
      return false;
    }
  }, {
    message: "Must be a valid GitHub HTTPS URL format: https://github.com/owner/repo",
  }),
  requestedRef: z.string().trim().max(100).optional().nullable(),
  projectPath: z.string().trim().max(200).optional().nullable(),
  deploymentUrl: z.string().trim().url().max(200).optional().nullable().refine((val) => {
    if (!val) return true;
    try {
      const u = new URL(val);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, { message: "Deployment URL must be an HTTP(S) URL" }),
  deploymentClaim: z.enum(["repository_snapshot", "developer_declared_commit"]).default("repository_snapshot"),
  declaredDeployedCommit: z.string().trim().regex(/^[0-9a-fA-F]{40}$/, {
    message: "Declared commit must be a 40-character SHA-1 hex string",
  }).optional().nullable(),
}).refine((data) => {
  if (data.deploymentClaim === "developer_declared_commit") {
    if (!data.declaredDeployedCommit) return false;
    if (data.requestedRef && data.requestedRef !== data.declaredDeployedCommit) {
      return false;
    }
  }
  return true;
}, {
  message: "When declaredDeployedCommit is provided, requestedRef must not conflict with it",
});

export type RegisterApplicationInput = z.infer<typeof RegisterApplicationSchema>;

export const CommunityReportInputSchema = z.object({
  applicationId: z.string().uuid(),
  sourceUrl: z.string().trim().url().max(500).optional().nullable().refine((val) => {
    if (!val) return true;
    try {
      const u = new URL(val);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, { message: "Source URL must be an HTTP(S) URL" }),
  pastedText: z.string().min(10, "Text must be at least 10 characters").max(12000, "Text must not exceed 12,000 characters"),
});

export type CommunityReportInput = z.infer<typeof CommunityReportInputSchema>;

export const PatchNotificationSchema = z.object({
  read: z.boolean(),
});

/**
 * Sanitizes failure messages by removing any tokens, credentials, or authorization headers
 */
export function sanitizeFailureMessage(message: string): string {
  if (!message) return "";
  return message
    .replace(/(?:bearer|basic|token)\s+[a-zA-Z0-9_\-\.\:\=\+\/]+/gi, "[REDACTED_AUTH]")
    .replace(/gh[pousr]_[A-Za-z0-9_]{20,}/g, "[REDACTED_TOKEN]")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED_TOKEN]")
    .replace(/(?:authorization|access_token|api_key|token)[=:\s]+[^\s&,]+/gi, "$1=[REDACTED]")
    .replace(/https?:\/\/[^:]+:[^@]+@/gi, "https://[REDACTED]@");
}

