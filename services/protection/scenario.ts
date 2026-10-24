// services/protection/scenario.ts
// Fixed demonstration scenario and bounded 5-step test runner for Checkpoint 2.
// Executes test runs on an ephemeral isolated proxy without altering the active proxy.

import crypto from "node:crypto";
import {
  Rule,
  ScanTargetBinding,
  TestObservation,
  TestRun,
  computeRuleHash,
} from "./types";
import { createEphemeralProxy } from "./proxy";

export const DEMO_SCENARIO_ID = "demo-scenario-lodash-4.17.11";
export const DEMO_ADVISORY_ID = "GHSA-jf85-cpcp-j695";
export const DEMO_CVE_ID = "CVE-2019-10744";
export const DEMO_PACKAGE_NAME = "lodash";
export const DEMO_PACKAGE_VERSION = "4.17.11";
export const DEMO_FIXTURE_VERSION = "vrc-cve-2019-10744-v1";
export const DEMO_MARKER_PROPERTY = "__vrc_demo_marker__";
export const DEMO_MARKER_VALUE = "vrc_verified_cve_2019_10744";

export const VULNERABLE_TEST_PAYLOAD = {
  constructor: {
    prototype: {
      [DEMO_MARKER_PROPERTY]: DEMO_MARKER_VALUE,
    },
  },
};

export const BENIGN_TEST_PAYLOAD = {
  theme: "dark",
  density: "compact",
  fontSize: 14,
};

export const HARMLESS_VERIFICATION_PAYLOAD = {
  theme: "dark",
};

interface TargetIdentityResponse {
  service: string;
  scenarioId: string;
  packageName: string;
  packageVersion: string;
  advisoryId: string;
  cveId: string;
  targetInstanceId: string;
  targetFingerprint: string;
  previewRequestCounter: number;
}

export async function fetchTargetIdentity(
  upstreamPort: number,
  timeoutMs = 3000
): Promise<TargetIdentityResponse> {
  const url = `http://127.0.0.1:${upstreamPort}/__demo/identity`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    throw new Error(`Target identity check failed: HTTP ${res.status}`);
  }
  return (await res.json()) as TargetIdentityResponse;
}

export async function checkTargetHealth(
  upstreamPort: number,
  timeoutMs = 3000
): Promise<{ healthy: boolean; status: number; targetInstanceId: string | null; error?: string }> {
  try {
    const url = `http://127.0.0.1:${upstreamPort}/health`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      const data = (await res.json()) as { instanceId?: string };
      return { healthy: true, status: res.status, targetInstanceId: data.instanceId || null };
    }
    return { healthy: false, status: res.status, targetInstanceId: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { healthy: false, status: 0, targetInstanceId: null, error: msg };
  }
}

async function requestJson(
  url: string,
  method: string,
  body?: unknown,
  timeoutMs = 4000
): Promise<{ status: number; data: unknown }> {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

export async function runCandidateScenarioTest(params: {
  upstreamPort: number;
  candidateRule: Rule;
  binding: ScanTargetBinding;
  proposalId: string;
  proposalHash: string;
  controllerInstanceId: string;
}): Promise<TestRun> {
  const startedAt = new Date().toISOString();
  const observations: TestObservation[] = [];
  let testStatus: "passed" | "failed" | "unavailable" = "passed";

  // Step 1: Pre-test target identity verification
  let identityBefore: TargetIdentityResponse;
  try {
    identityBefore = await fetchTargetIdentity(params.upstreamPort);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id: crypto.randomUUID(),
      proposalId: params.proposalId,
      proposalHash: params.proposalHash,
      ruleHash: computeRuleHash(params.candidateRule),
      scenarioId: DEMO_SCENARIO_ID,
      fixtureVersion: DEMO_FIXTURE_VERSION,
      binding: params.binding,
      controllerInstanceId: params.controllerInstanceId,
      startedAt,
      completedAt: new Date().toISOString(),
      observations: [
        {
          name: "target_identity_verification",
          endpoint: "/__demo/identity",
          method: "GET",
          expectedStatus: 200,
          actualStatus: 0,
          observedMarker: null,
          upstreamCounterDelta: 0,
          passed: false,
          error: `Upstream demo service unreachable: ${msg}`,
        },
      ],
      status: "unavailable",
      targetFingerprint: params.binding.targetFingerprint,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  // Verify binding integrity against target identity
  if (identityBefore.targetFingerprint !== params.binding.targetFingerprint) {
    observations.push({
      name: "fingerprint_match_check",
      endpoint: "/__demo/identity",
      method: "GET",
      expectedStatus: 200,
      actualStatus: 200,
      observedMarker: null,
      upstreamCounterDelta: 0,
      passed: false,
      error: `Fingerprint mismatch: expected ${params.binding.targetFingerprint}, observed ${identityBefore.targetFingerprint}`,
    });
    testStatus = "failed";
  }

  if (identityBefore.packageVersion !== DEMO_PACKAGE_VERSION) {
    observations.push({
      name: "package_version_check",
      endpoint: "/__demo/identity",
      method: "GET",
      expectedStatus: 200,
      actualStatus: 200,
      observedMarker: null,
      upstreamCounterDelta: 0,
      passed: false,
      error: `Package version mismatch: expected ${DEMO_PACKAGE_VERSION}, observed ${identityBefore.packageVersion}`,
    });
    testStatus = "failed";
  }

  // Step 2: Isolated test proxy with NO rule (baseline)
  let noRuleProxy: { port: number; close: () => Promise<void> } | null = null;
  let candidateProxy: { port: number; close: () => Promise<void> } | null = null;

  try {
    noRuleProxy = await createEphemeralProxy({
      upstreamPort: params.upstreamPort,
      candidateRule: null,
    });
    const noRuleBase = `http://127.0.0.1:${noRuleProxy.port}`;

    // 2a. GET /health on baseline
    const healthBaseline = await requestJson(`${noRuleBase}/health`, "GET");
    const healthPassed = healthBaseline.status === 200;
    if (!healthPassed) testStatus = "failed";
    observations.push({
      name: "baseline_health_check",
      endpoint: "/health",
      method: "GET",
      expectedStatus: 200,
      actualStatus: healthBaseline.status,
      observedMarker: null,
      upstreamCounterDelta: 0,
      passed: healthPassed,
      error: healthPassed ? null : "Baseline health endpoint did not return 200",
    });

    // 2b. GET /catalog on baseline
    const catalogBaseline = await requestJson(`${noRuleBase}/catalog`, "GET");
    const catalogPassed = catalogBaseline.status === 200;
    if (!catalogPassed) testStatus = "failed";
    observations.push({
      name: "baseline_catalog_check",
      endpoint: "/catalog",
      method: "GET",
      expectedStatus: 200,
      actualStatus: catalogBaseline.status,
      observedMarker: null,
      upstreamCounterDelta: 0,
      passed: catalogPassed,
      error: catalogPassed ? null : "Baseline catalog endpoint did not return 200",
    });

    // 2c. POST /preview with benign payload
    const benignBaseline = await requestJson(
      `${noRuleBase}/preview`,
      "POST",
      BENIGN_TEST_PAYLOAD
    );
    const benignData = benignBaseline.data as { prototypePolluted?: boolean } | null;
    const benignPassed =
      benignBaseline.status === 200 && benignData?.prototypePolluted === false;
    if (!benignPassed) testStatus = "failed";
    observations.push({
      name: "baseline_benign_preview_check",
      endpoint: "/preview",
      method: "POST",
      expectedStatus: 200,
      actualStatus: benignBaseline.status,
      observedMarker: null,
      upstreamCounterDelta: 1,
      passed: benignPassed,
      error: benignPassed
        ? null
        : `Benign preview failed or polluted prototype (status ${benignBaseline.status})`,
    });

    // 2d. POST /preview with vulnerable payload (demonstrates real prototype pollution)
    const vulnBaseline = await requestJson(
      `${noRuleBase}/preview`,
      "POST",
      VULNERABLE_TEST_PAYLOAD
    );
    const vulnData = vulnBaseline.data as {
      prototypePolluted?: boolean;
      markerValue?: string;
    } | null;
    const vulnPassed =
      vulnBaseline.status === 200 &&
      vulnData?.prototypePolluted === true &&
      vulnData?.markerValue === DEMO_MARKER_VALUE;
    if (!vulnPassed) testStatus = "failed";
    observations.push({
      name: "baseline_vulnerability_demonstration",
      endpoint: "/preview",
      method: "POST",
      expectedStatus: 200,
      actualStatus: vulnBaseline.status,
      observedMarker: vulnData?.markerValue || null,
      upstreamCounterDelta: 1,
      passed: vulnPassed,
      error: vulnPassed
        ? null
        : "Failed to demonstrate prototype pollution on unconstrained baseline",
    });

    // Close baseline ephemeral proxy
    await noRuleProxy.close();
    noRuleProxy = null;

    // Step 3: Isolated test proxy WITH CANDIDATE RULE
    candidateProxy = await createEphemeralProxy({
      upstreamPort: params.upstreamPort,
      candidateRule: params.candidateRule,
    });
    const candidateBase = `http://127.0.0.1:${candidateProxy.port}`;

    // Read upstream counter before candidate blocked requests
    const identityMid = await fetchTargetIdentity(params.upstreamPort);
    const counterBeforeBlocks = identityMid.previewRequestCounter;

    // 3a. POST /preview with vulnerable payload -> Expect 503 ROUTE_TEMPORARILY_DISABLED
    const vulnCandidate = await requestJson(
      `${candidateBase}/preview`,
      "POST",
      VULNERABLE_TEST_PAYLOAD
    );
    const vulnCandData = vulnCandidate.data as { error?: string } | null;
    const vulnCandPassed =
      vulnCandidate.status === 503 &&
      vulnCandData?.error === "ROUTE_TEMPORARILY_DISABLED";
    if (!vulnCandPassed) testStatus = "failed";
    observations.push({
      name: "candidate_rule_blocks_vulnerable_request",
      endpoint: "/preview",
      method: "POST",
      expectedStatus: 503,
      actualStatus: vulnCandidate.status,
      observedMarker: null,
      upstreamCounterDelta: 0,
      passed: vulnCandPassed,
      error: vulnCandPassed
        ? null
        : `Candidate rule did not block vulnerable route with 503 (got ${vulnCandidate.status})`,
    });

    // 3b. POST /preview with benign payload -> Expect 503 ROUTE_TEMPORARILY_DISABLED (legitimate preview loss acknowledged!)
    const benignCandidate = await requestJson(
      `${candidateBase}/preview`,
      "POST",
      BENIGN_TEST_PAYLOAD
    );
    const benignCandData = benignCandidate.data as { error?: string } | null;
    const benignCandPassed =
      benignCandidate.status === 503 &&
      benignCandData?.error === "ROUTE_TEMPORARILY_DISABLED";
    if (!benignCandPassed) testStatus = "failed";
    observations.push({
      name: "candidate_rule_records_functionality_loss",
      endpoint: "/preview",
      method: "POST",
      expectedStatus: 503,
      actualStatus: benignCandidate.status,
      observedMarker: null,
      upstreamCounterDelta: 0,
      passed: benignCandPassed,
      error: benignCandPassed
        ? null
        : `Candidate rule did not block benign preview with 503 (got ${benignCandidate.status})`,
    });

    // 3c. Verify upstream request counter DID NOT increment during blocked requests
    const identityAfterBlocks = await fetchTargetIdentity(params.upstreamPort);
    const counterAfterBlocks = identityAfterBlocks.previewRequestCounter;
    const counterDelta = counterAfterBlocks - counterBeforeBlocks;
    const zeroDispatchPassed = counterDelta === 0;
    if (!zeroDispatchPassed) testStatus = "failed";
    observations.push({
      name: "zero_upstream_dispatch_verification",
      endpoint: "/__demo/identity",
      method: "GET",
      expectedStatus: 0,
      actualStatus: counterDelta,
      observedMarker: null,
      upstreamCounterDelta: counterDelta,
      passed: zeroDispatchPassed,
      error: zeroDispatchPassed
        ? null
        : `Blocked requests were dispatched upstream! Counter delta was ${counterDelta}`,
    });

    // 3d. Unrelated route continuity: GET /health still 200
    const healthCandidate = await requestJson(`${candidateBase}/health`, "GET");
    const healthCandPassed = healthCandidate.status === 200;
    if (!healthCandPassed) testStatus = "failed";
    observations.push({
      name: "candidate_unrelated_route_health",
      endpoint: "/health",
      method: "GET",
      expectedStatus: 200,
      actualStatus: healthCandidate.status,
      observedMarker: null,
      upstreamCounterDelta: 0,
      passed: healthCandPassed,
      error: healthCandPassed ? null : "Health route failed while candidate rule was active",
    });

    // 3e. Unrelated route continuity: GET /catalog still 200
    const catalogCandidate = await requestJson(`${candidateBase}/catalog`, "GET");
    const catalogCandPassed = catalogCandidate.status === 200;
    if (!catalogCandPassed) testStatus = "failed";
    observations.push({
      name: "candidate_unrelated_route_catalog",
      endpoint: "/catalog",
      method: "GET",
      expectedStatus: 200,
      actualStatus: catalogCandidate.status,
      observedMarker: null,
      upstreamCounterDelta: 0,
      passed: catalogCandPassed,
      error: catalogCandPassed ? null : "Catalog route failed while candidate rule was active",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    testStatus = "failed";
    observations.push({
      name: "test_runner_error",
      endpoint: "N/A",
      method: "N/A",
      expectedStatus: 200,
      actualStatus: 500,
      observedMarker: null,
      upstreamCounterDelta: 0,
      passed: false,
      error: `Test execution failed with error: ${msg}`,
    });
  } finally {
    if (noRuleProxy) {
      await noRuleProxy.close().catch(() => {});
    }
    if (candidateProxy) {
      await candidateProxy.close().catch(() => {});
    }
  }

  const completedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minute expiry

  return {
    id: crypto.randomUUID(),
    proposalId: params.proposalId,
    proposalHash: params.proposalHash,
    ruleHash: computeRuleHash(params.candidateRule),
    scenarioId: DEMO_SCENARIO_ID,
    fixtureVersion: DEMO_FIXTURE_VERSION,
    binding: params.binding,
    controllerInstanceId: params.controllerInstanceId,
    startedAt,
    completedAt,
    observations,
    status: testStatus,
    targetFingerprint: params.binding.targetFingerprint,
    expiresAt,
  };
}
