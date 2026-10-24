// services/protection/types.ts
// Zod schemas and TypeScript types for Checkpoint 2 Protection Controller & Proxy

import { z } from "zod";
import crypto from "node:crypto";

// ==========================================
// Canonical Hashing Helpers
// ==========================================

export function canonicalJsonString(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJsonString).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) => JSON.stringify(k) + ":" + canonicalJsonString((obj as Record<string, unknown>)[k])
  );
  return "{" + pairs.join(",") + "}";
}

export function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

// ==========================================
// Rules
// ==========================================

export const DisableRouteRuleSchema = z.object({
  kind: z.literal("disable_route"),
  path: z.literal("/preview"),
});

export type DisableRouteRule = z.infer<typeof DisableRouteRuleSchema>;

export const RuleSchema = DisableRouteRuleSchema;
export type Rule = z.infer<typeof RuleSchema>;

export function computeRuleHash(rule: Rule): string {
  return sha256Hex(canonicalJsonString(rule));
}

// ==========================================
// Scan-to-Target Binding
// ==========================================

export const ScanTargetBindingSchema = z.object({
  applicationId: z.string().min(1),
  scanId: z.string().min(1),
  commitSha: z.string().min(1),
  projectPath: z.string(),
  lockfileHash: z.string().min(1),
  scenarioId: z.string().min(1),
  advisoryId: z.string().min(1),
  packageName: z.string().min(1),
  packageVersion: z.string().min(1),
  targetFingerprint: z.string().min(1),
  targetInstanceId: z.string().min(1),
});

export type ScanTargetBinding = z.infer<typeof ScanTargetBindingSchema>;

// ==========================
// Protection Proposal
// ==========================

export const ProtectionProposalSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime(),
  scenarioId: z.string().min(1),
  binding: ScanTargetBindingSchema,
  rule: RuleSchema,
  ruleHash: z.string().length(64),
  proposalHash: z.string().length(64),
  explanation: z.string(),
  evidenceReferences: z.array(z.string()),
  functionalityCost: z.string(),
  limitations: z.array(z.string()),
  aiStatus: z.enum(["enriched", "deterministic_fallback", "unavailable"]),
});

export type ProtectionProposal = z.infer<typeof ProtectionProposalSchema>;

export function computeProposalHash(
  rule: Rule,
  binding: ScanTargetBinding,
  scenarioId: string
): string {
  const content = {
    binding,
    rule,
    scenarioId,
  };
  return sha256Hex(canonicalJsonString(content));
}

// ==========================
// Test Run & Observations
// ==========================

export const TestObservationSchema = z.object({
  name: z.string(),
  endpoint: z.string(),
  method: z.string(),
  expectedStatus: z.number(),
  actualStatus: z.number(),
  observedMarker: z.string().nullable(),
  upstreamCounterDelta: z.number(),
  passed: z.boolean(),
  error: z.string().nullable(),
});

export type TestObservation = z.infer<typeof TestObservationSchema>;

export const TestRunSchema = z.object({
  id: z.string().min(1),
  proposalId: z.string().min(1),
  proposalHash: z.string().length(64),
  ruleHash: z.string().length(64),
  scenarioId: z.string().min(1),
  fixtureVersion: z.string().min(1),
  binding: ScanTargetBindingSchema,
  controllerInstanceId: z.string().min(1),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  observations: z.array(TestObservationSchema),
  status: z.enum(["passed", "failed", "unavailable"]),
  targetFingerprint: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export type TestRun = z.infer<typeof TestRunSchema>;

// ==========================
// Developer Approval
// ==========================

export const ApprovalSchema = z.object({
  id: z.string().min(1),
  proposalHash: z.string().length(64),
  testRunId: z.string().min(1),
  binding: ScanTargetBindingSchema,
  createdAt: z.string().datetime(),
  operatorNote: z.string(),
  acknowledgedFunctionalityLoss: z.boolean(),
  consumed: z.boolean(),
});

export type Approval = z.infer<typeof ApprovalSchema>;

// ==========================
// Runtime Status
// ==========================

export const RuntimeStatusSchema = z.object({
  controllerInstanceId: z.string().min(1),
  ruleRevision: z.number().nonnegative(),
  activeRule: RuleSchema.nullable(),
  activatedAt: z.string().datetime().nullable(),
  relatedApprovalId: z.string().nullable(),
  relatedTestRunId: z.string().nullable(),
  upstreamHealth: z.object({
    healthy: z.boolean(),
    status: z.number().nullable(),
    error: z.string().nullable(),
    targetInstanceId: z.string().nullable(),
    lastChecked: z.string().datetime(),
  }),
  blockedCount: z.number().nonnegative(),
  lastVerification: z.object({
    verified: z.boolean(),
    timestamp: z.string().datetime().nullable(),
    error: z.string().nullable(),
  }),
});

export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;

// ==========================
// Audit History
// ==========================

export const HistoryEntrySchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().datetime(),
  type: z.enum([
    "proposal_created",
    "test_run",
    "approval_granted",
    "rule_activated",
    "rule_rolled_back",
    "verification_failed",
    "controller_started",
  ]),
  details: z.record(z.string(), z.unknown()),
});

export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

// ==========================
// Controller State Store Schema
// ==========================

export const ControllerStateSchema = z.object({
  version: z.literal(1),
  controllerInstanceId: z.string().min(1),
  activeRule: RuleSchema.nullable(),
  ruleRevision: z.number().nonnegative(),
  activatedAt: z.string().datetime().nullable(),
  relatedApprovalId: z.string().nullable(),
  relatedTestRunId: z.string().nullable(),
  proposals: z.array(ProtectionProposalSchema),
  testRuns: z.array(TestRunSchema),
  approvals: z.array(ApprovalSchema),
  history: z.array(HistoryEntrySchema),
});

export type ControllerState = z.infer<typeof ControllerStateSchema>;
