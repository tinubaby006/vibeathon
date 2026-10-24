// lib/protection.ts
// Server-only client and scan-to-target binding validator for Checkpoint 2 Protection.
// Connects Next.js to the Controller API (127.0.0.1:8001) with CONTROLLER_TOKEN.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { getApplication, getScan, getScans } from "./store";
import { Application, Finding, ScanReport } from "./contracts";
import {
  Rule,
  ScanTargetBinding,
  ProtectionProposal,
  TestRun,
  Approval,
  RuntimeStatus,
  HistoryEntry,
} from "../services/protection/types";
import {
  DEMO_SCENARIO_ID,
  DEMO_ADVISORY_ID,
  DEMO_CVE_ID,
  DEMO_PACKAGE_NAME,
  DEMO_PACKAGE_VERSION,
  fetchTargetIdentity,
} from "../services/protection/scenario";

const CONTROLLER_URL = process.env.CONTROLLER_URL || "http://127.0.0.1:8001";
const CONTROLLER_TOKEN =
  process.env.CONTROLLER_TOKEN || "vrc_controller_dev_token_secret";
const DEMO_PORT = parseInt(process.env.DEMO_PORT || "8003", 10);

function getGeminiClient(): { client: GoogleGenAI; model: string } | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  if (!apiKey) return null;
  return { client: new GoogleGenAI({ apiKey }), model };
}

// ========================================================
// Scan-to-Target Binding Validator
// ========================================================

export interface BindingValidationResult {
  eligible: boolean;
  reason?: string;
  binding?: ScanTargetBinding;
  scan?: ScanReport;
  application?: Application;
  finding?: Finding;
}

export async function validateScanTargetBinding(
  applicationId: string,
  scanId?: string
): Promise<BindingValidationResult> {
  const app = await getApplication(applicationId);
  if (!app) {
    return {
      eligible: false,
      reason: `Application with ID '${applicationId}' was not found`,
    };
  }

  // Find scan
  let scan: ScanReport | null = null;
  if (scanId) {
    scan = await getScan(scanId);
  } else if (app.lastSuccessfulScanId) {
    scan = await getScan(app.lastSuccessfulScanId);
  } else {
    const scans = await getScans(applicationId);
    scan =
      scans.find((s) => s.status === "complete" || s.status === "partial") ||
      null;
  }

  if (!scan) {
    return {
      eligible: false,
      reason: "No completed scan exists for this application.",
    };
  }

  // 1. Verify that the repository is the configured demo target
  const isDemo =
    app.sourceType === "local_demo" ||
    app.projectPath.includes("preview-settings-demo") ||
    app.canonicalRepoUrl.includes("preview-settings-demo") ||
    app.canonicalRepoUrl.includes("vrc-demo");

  if (!isDemo) {
    return {
      eligible: false,
      reason:
        "Protection is available only for the configured 'Preview Settings Demo' scenario. Arbitrary applications are not eligible.",
    };
  }

  // Verify matching files on disk in examples/preview-settings-demo
  const demoDir = path.resolve(process.cwd(), "examples", "preview-settings-demo");
  const pkgLockPath = path.join(demoDir, "package-lock.json");
  const pkgJsonPath = path.join(demoDir, "package.json");

  if (!fs.existsSync(pkgLockPath) || !fs.existsSync(pkgJsonPath)) {
    return {
      eligible: false,
      reason: "Demo fixture manifest files (package.json, package-lock.json) not found on disk.",
    };
  }

  if (scan.lockfileHash) {
    const diskLockRaw = fs.readFileSync(pkgLockPath, "utf-8");
    const diskHash = crypto.createHash("sha256").update(diskLockRaw, "utf8").digest("hex");
    if (diskHash !== scan.lockfileHash) {
      return {
        eligible: false,
        reason: "Disk package-lock.json hash does not match scan lockfileHash.",
      };
    }
  }

  // 2. Verify exact vulnerable package and version in inventory
  const lodashDep = scan.inventory.find(
    (dep) =>
      dep.packageName === DEMO_PACKAGE_NAME &&
      dep.version === DEMO_PACKAGE_VERSION
  );
  if (!lodashDep) {
    return {
      eligible: false,
      reason: `Scan inventory does not contain exact dependency ${DEMO_PACKAGE_NAME}@${DEMO_PACKAGE_VERSION}.`,
    };
  }

  // 3. Verify targeted advisory exists in findings
  const targetFinding = scan.findings.find(
    (f) =>
      f.advisoryId === DEMO_ADVISORY_ID ||
      f.aliases.includes(DEMO_CVE_ID) ||
      f.aliases.includes(DEMO_ADVISORY_ID)
  );
  if (!targetFinding) {
    return {
      eligible: false,
      reason: `Scan findings do not contain advisory ${DEMO_ADVISORY_ID} / ${DEMO_CVE_ID}.`,
    };
  }

  // 4. Query local demo target identity
  let identity: {
    targetFingerprint: string;
    targetInstanceId: string;
    packageName: string;
    packageVersion: string;
    scenarioId: string;
  };
  try {
    identity = await fetchTargetIdentity(DEMO_PORT, 2500);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      eligible: false,
      reason: `Local demo target on 127.0.0.1:${DEMO_PORT} is unreachable: ${msg}. Start the demo server to enable protection.`,
    };
  }

  if (
    identity.packageName !== DEMO_PACKAGE_NAME ||
    identity.packageVersion !== DEMO_PACKAGE_VERSION
  ) {
    return {
      eligible: false,
      reason: `Target version mismatch: local demo running ${identity.packageName}@${identity.packageVersion}, expected ${DEMO_PACKAGE_VERSION}.`,
    };
  }

  // Compute lockfile hash if present, or deterministic SHA-256 of locked version string
  const lockfileHash =
    scan.lockfileHash ||
    crypto
      .createHash("sha256")
      .update(`${DEMO_PACKAGE_NAME}@${DEMO_PACKAGE_VERSION}`)
      .digest("hex");

  const binding: ScanTargetBinding = {
    applicationId: app.id,
    scanId: scan.id,
    commitSha: scan.resolvedCommitSha || app.declaredDeployedCommit || "local-head",
    projectPath: app.projectPath,
    lockfileHash,
    scenarioId: DEMO_SCENARIO_ID,
    advisoryId: DEMO_ADVISORY_ID,
    packageName: DEMO_PACKAGE_NAME,
    packageVersion: DEMO_PACKAGE_VERSION,
    targetFingerprint: identity.targetFingerprint,
    targetInstanceId: identity.targetInstanceId,
  };

  return {
    eligible: true,
    binding,
    scan,
    application: app,
    finding: targetFinding,
  };
}

// ========================================================
// Grounded AI Explanation with Deterministic Fallback
// ========================================================

const AiProposalSchema = z.object({
  explanation: z.string().max(800),
  functionalityCost: z.string().max(500),
  limitations: z.array(z.string().max(300)).max(5),
});

export async function generateProposalExplanation(params: {
  binding: ScanTargetBinding;
  finding?: Finding;
  rule: Rule;
}): Promise<{
  explanation: string;
  functionalityCost: string;
  limitations: string[];
  aiStatus: "enriched" | "deterministic_fallback" | "unavailable";
}> {
  const deterministicFallback = {
    explanation:
      "Temporary route containment proposes disabling /preview because lodash 4.17.11 is vulnerable to prototype pollution (GHSA-jf85-cpcp-j695 / CVE-2019-10744 via defaultsDeep).",
    functionalityCost:
      "All requests to POST /preview will return HTTP 503 ROUTE_TEMPORARILY_DISABLED until rollback. Unrelated routes (/health, /catalog) remain available.",
    limitations: [
      "Local loopback proxy containment only: protects requests traversing port 8002.",
      "Does not patch the underlying lodash package or fix vulnerability at source.",
      "Preview functionality is disabled for all users while active.",
      "Upgrading lodash to 4.17.12+ remains required for permanent resolution.",
    ],
    aiStatus: "deterministic_fallback" as const,
  };

  const aiConfig = getGeminiClient();
  if (!aiConfig) {
    return deterministicFallback;
  }

  const prompt = `You are a security analyst explaining a temporary route containment proposal.
Target: ${params.binding.packageName}@${params.binding.packageVersion}
Advisory: ${params.binding.advisoryId} (CVE-2019-10744)
Vulnerable Function: defaultsDeep
Proposed Rule: disable_route on path /preview
Scope: Local loopback proxy forwarding to Preview Settings Demo.

Explain concisely:
1. Why disabling /preview contains the prototype pollution risk.
2. The exact functionality cost to developers and users.
3. Key limitations (temporary containment only, upgrading to 4.17.12+ still required).

Analyze only the provided data. Return JSON adhering to:
{
  "explanation": "...",
  "functionalityCost": "...",
  "limitations": ["...", "..."]
}`;

  try {
    const response = await aiConfig.client.models.generateContent({
      model: aiConfig.model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text?.trim();
    if (!text) {
      return deterministicFallback;
    }

    const parsed = JSON.parse(text);
    const validated = AiProposalSchema.parse(parsed);

    return {
      explanation: validated.explanation,
      functionalityCost: validated.functionalityCost,
      limitations: validated.limitations,
      aiStatus: "enriched",
    };
  } catch {
    return {
      ...deterministicFallback,
      aiStatus: "unavailable",
    };
  }
}

// ========================================================
// Controller API Client Functions
// ========================================================

async function callController<T>(
  path: string,
  method: string,
  body?: unknown
): Promise<{ status: number; data: T }> {
  const url = `${CONTROLLER_URL}${path}`;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${CONTROLLER_TOKEN}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(35000), // Bounded timeout
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  let data: T;
  try {
    data = (await res.json()) as T;
  } catch {
    data = {} as T;
  }

  return { status: res.status, data };
}

export async function getControllerStatus(): Promise<RuntimeStatus | null> {
  try {
    const { status, data } = await callController<RuntimeStatus>("/status", "GET");
    if (status === 200) return data;
    return null;
  } catch {
    return null;
  }
}

export async function createProposalOnController(payload: {
  scenarioId: string;
  binding: ScanTargetBinding;
  rule: Rule;
  explanation: string;
  functionalityCost: string;
  limitations: string[];
  aiStatus: "enriched" | "deterministic_fallback" | "unavailable";
}): Promise<ProtectionProposal> {
  const { status, data } = await callController<ProtectionProposal>(
    "/proposals",
    "POST",
    payload
  );
  if (status !== 201) {
    throw new Error(`Controller proposal creation failed (HTTP ${status})`);
  }
  return data;
}

export async function runTestOnController(proposalId: string): Promise<TestRun> {
  const { status, data } = await callController<TestRun>("/tests", "POST", {
    proposalId,
  });
  if (status !== 200) {
    const err = (data as { message?: string }).message || `HTTP ${status}`;
    throw new Error(`Controller test execution failed: ${err}`);
  }
  return data;
}

export async function grantApprovalOnController(payload: {
  proposalHash: string;
  testRunId: string;
  acknowledgedFunctionalityLoss: boolean;
  operatorNote?: string;
}): Promise<Approval> {
  const { status, data } = await callController<Approval>(
    "/approvals",
    "POST",
    payload
  );
  if (status !== 201) {
    const err = (data as { message?: string }).message || `HTTP ${status}`;
    throw new Error(`Controller approval failed: ${err}`);
  }
  return data;
}

export async function activateRuleOnController(
  approvalId: string
): Promise<{
  success: boolean;
  ruleRevision: number;
  activatedAt: string;
  activeRule: Rule;
  lastVerification: { verified: boolean; timestamp: string | null; error: string | null };
}> {
  const { status, data } = await callController<{
    success: boolean;
    ruleRevision: number;
    activatedAt: string;
    activeRule: Rule;
    lastVerification: { verified: boolean; timestamp: string | null; error: string | null };
    message?: string;
  }>("/activate", "POST", { approvalId });

  if (status !== 200) {
    const err = data.message || `HTTP ${status}`;
    throw new Error(`Controller activation failed: ${err}`);
  }
  return data;
}

export async function rollbackRuleOnController(
  reason?: string
): Promise<{
  success: boolean;
  rolledBack: boolean;
  ruleRevision: number;
  lastVerification: { verified: boolean; timestamp: string | null; error: string | null };
}> {
  const { status, data } = await callController<{
    success: boolean;
    rolledBack: boolean;
    ruleRevision: number;
    lastVerification: { verified: boolean; timestamp: string | null; error: string | null };
    message?: string;
  }>("/rollback", "POST", { reason });

  if (status !== 200) {
    const err = data.message || `HTTP ${status}`;
    throw new Error(`Controller rollback failed: ${err}`);
  }
  return data;
}

export async function getProtectionHistoryFromController(): Promise<HistoryEntry[]> {
  try {
    const { status, data } = await callController<{ history: HistoryEntry[] }>(
      "/history",
      "GET"
    );
    if (status === 200 && data.history) {
      return data.history;
    }
    return [];
  } catch {
    return [];
  }
}
