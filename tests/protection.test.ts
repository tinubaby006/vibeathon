// tests/protection.test.ts
// Comprehensive automated integration tests for Checkpoint 2 Protection Controller & Proxy

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { spawn, execSync, ChildProcess } from "node:child_process";
import {
  validateAndCanonicalizePath,
} from "../services/protection/proxy";
import {
  ControllerService,
} from "../services/protection/server";
import {
  DEMO_SCENARIO_ID,
  DEMO_PACKAGE_VERSION,
  DEMO_MARKER_VALUE,
  VULNERABLE_TEST_PAYLOAD,
  BENIGN_TEST_PAYLOAD,
  runCandidateScenarioTest,
} from "../services/protection/scenario";
import {
  validateScanTargetBinding,
  generateProposalExplanation,
} from "../lib/protection";
import { mutateStore } from "../lib/store";
import { Application, ScanReport } from "../lib/contracts";

let tempDir: string;
let stateFilePath: string;
let protectionStateFilePath: string;

let demoPort: number;
let controllerPort: number;
let proxyPort: number;
let demoProc: ChildProcess;
let controllerService: ControllerService;

const CONTROLLER_TOKEN = "vrc_controller_dev_token_secret";

describe("Checkpoint 2 — Protection Controller & Proxy Suite", () => {
  before(async () => {
    // 1. Isolated temporary directory for user store and protection store
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vrc-test-protection-"));
    stateFilePath = path.join(tempDir, "state.json");
    protectionStateFilePath = path.join(tempDir, "protection-state.json");

    process.env.VRC_STATE_FILE_PATH = stateFilePath;
    process.env.VRC_PROTECTION_STATE_FILE_PATH = protectionStateFilePath;

    // Allocate random distinct loopback ports
    demoPort = 8403;
    controllerPort = 8401;
    proxyPort = 8402;

    process.env.DEMO_PORT = String(demoPort);
    process.env.CONTROLLER_PORT = String(controllerPort);
    process.env.PROXY_PORT = String(proxyPort);
    process.env.CONTROLLER_TOKEN = CONTROLLER_TOKEN;

    // Start Demo Server process
    const demoServerScript = path.resolve(
      process.cwd(),
      "examples",
      "preview-settings-demo",
      "server.js"
    );
    demoProc = spawn(process.execPath, [demoServerScript], {
      env: { ...process.env, DEMO_PORT: String(demoPort) },
      stdio: "pipe",
    });

    // Wait for demo server to be ready
    let ready = false;
    for (let i = 0; i < 25; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${demoPort}/health`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    assert.ok(ready, "Demo server must start cleanly");

    // Start Controller Service
    controllerService = new ControllerService({
      controllerPort,
      proxyPort,
      demoPort,
      stateFilePath: protectionStateFilePath,
    });
    await controllerService.start({ controllerPort, proxyPort });
  });

  after(async () => {
    if (controllerService) {
      await controllerService.stop();
    }
    if (demoProc) {
      demoProc.kill();
    }
    delete process.env.VRC_STATE_FILE_PATH;
    delete process.env.VRC_PROTECTION_STATE_FILE_PATH;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ==========================================
  // 1. Prototype Pollution Reproduction & Patched Comparison
  // ==========================================

  it("proves real prototype pollution on lodash 4.17.11 worker", async () => {
    const res = await fetch(`http://127.0.0.1:${demoPort}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VULNERABLE_TEST_PAYLOAD),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { prototypePolluted: boolean; markerValue: string };
    assert.equal(data.prototypePolluted, true);
    assert.equal(data.markerValue, DEMO_MARKER_VALUE);
  });

  it("demonstrates clean prototype on benign preview requests", async () => {
    const res = await fetch(`http://127.0.0.1:${demoPort}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(BENIGN_TEST_PAYLOAD),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { prototypePolluted: boolean };
    assert.equal(data.prototypePolluted, false);
  });

  it("verifies patched comparison with lodash 4.17.12 in isolated directory", () => {
    const patchedDir = path.join(tempDir, "patched-comparison");
    fs.mkdirSync(patchedDir, { recursive: true });
    execSync(
      `npm.cmd install lodash@4.17.12 --no-save --ignore-scripts`,
      { cwd: patchedDir, stdio: "ignore" }
    );
    const testScript = path.join(patchedDir, "check.js");
    fs.writeFileSync(
      testScript,
      `
      const defaultsDeep = require("./node_modules/lodash/defaultsDeep.js");
      const payload = JSON.parse('{"constructor": {"prototype": {"__test_marker__": "polluted"}}}');
      defaultsDeep({}, payload);
      const isPolluted = ({}).__test_marker__ === "polluted";
      console.log(JSON.stringify({ isPolluted }));
      `
    );
    const output = execSync(
      `"${process.execPath}" "${testScript}"`,
      { cwd: patchedDir, encoding: "utf8" }
    );
    const parsed = JSON.parse(output.trim());
    assert.equal(parsed.isPolluted, false, "Patched version must not pollute Object.prototype");
  });

  // ==========================================
  // 2. Strict Path Canonicalization & Security
  // ==========================================

  it("rejects backslashes, ambiguous encodings, and traversal in proxy", () => {
    assert.equal(validateAndCanonicalizePath("/preview\\evil").valid, false);
    assert.equal(validateAndCanonicalizePath("/preview%2fevil").valid, false);
    assert.equal(validateAndCanonicalizePath("/preview%5cevil").valid, false);
    assert.equal(validateAndCanonicalizePath("/preview/../other").valid, false);
    assert.equal(validateAndCanonicalizePath("http://evil.com/preview").valid, false);

    assert.equal(validateAndCanonicalizePath("/preview").valid, true);
    assert.equal(validateAndCanonicalizePath("/preview/").valid, true);
    assert.equal(validateAndCanonicalizePath("/preview?theme=dark").valid, true);
  });

  it("blocks internal control endpoints from public proxy forwarding", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/__demo/identity`);
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "FORBIDDEN_INTERNAL_PATH");
  });

  // ==========================================
  // 3. Isolated Candidate Testing on Ephemeral Proxy
  // ==========================================

  it("executes bounded 5-step test on ephemeral proxy without altering live proxy", async () => {
    // Live proxy should initially forward /catalog
    const preRes = await fetch(`http://127.0.0.1:${proxyPort}/catalog`);
    assert.equal(preRes.status, 200);

    const identityRes = await fetch(`http://127.0.0.1:${demoPort}/__demo/identity`);
    const identity = (await identityRes.json()) as {
      targetFingerprint: string;
      targetInstanceId: string;
      packageName: string;
      packageVersion: string;
    };

    const testRun = await runCandidateScenarioTest({
      upstreamPort: demoPort,
      candidateRule: { kind: "disable_route", path: "/preview" },
      binding: {
        applicationId: "test-app-id",
        scanId: "test-scan-id",
        commitSha: "c0ffee0000000000000000000000000000000000",
        projectPath: "examples/preview-settings-demo",
        lockfileHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        scenarioId: DEMO_SCENARIO_ID,
        advisoryId: "GHSA-jf85-cpcp-j695",
        packageName: "lodash",
        packageVersion: DEMO_PACKAGE_VERSION,
        targetFingerprint: identity.targetFingerprint,
        targetInstanceId: identity.targetInstanceId,
      },
      proposalId: "test-proposal-1",
      proposalHash: "6892e246d0a7a4b2c1d3e5f7a9b0c2d4e6f8a1b3c5d7e9f0a2b4c6d8e0f2a4b6",
      controllerInstanceId: "ctrl-instance-1",
    });

    assert.equal(testRun.status, "passed");
    assert.ok(testRun.observations.length >= 8);

    // Verify candidate blocked observation
    const blockedObs = testRun.observations.find((o) => o.name === "candidate_rule_blocks_vulnerable_request");
    assert.ok(blockedObs);
    assert.equal(blockedObs.actualStatus, 503);
    assert.equal(blockedObs.passed, true);

    // Verify zero upstream dispatch observation
    const zeroDispatch = testRun.observations.find((o) => o.name === "zero_upstream_dispatch_verification");
    assert.ok(zeroDispatch);
    assert.equal(zeroDispatch.actualStatus, 0); // delta = 0
    assert.equal(zeroDispatch.passed, true);

    // Verify live proxy rule remained completely null/untouched!
    assert.equal(controllerService.getProxy().getActiveRule(), null);
  });

  // ==========================================
  // 4. Controller API Lifecycle, Approval & Activation
  // ==========================================

  it("enforces authentication on all controller endpoints", async () => {
    const unauth = await fetch(`http://127.0.0.1:${controllerPort}/status`);
    assert.equal(unauth.status, 401);

    const badAuth = await fetch(`http://127.0.0.1:${controllerPort}/status`, {
      headers: { Authorization: "Bearer wrong_token" },
    });
    assert.equal(badAuth.status, 401);

    const validAuth = await fetch(`http://127.0.0.1:${controllerPort}/status`, {
      headers: { Authorization: `Bearer ${CONTROLLER_TOKEN}` },
    });
    assert.equal(validAuth.status, 200);
  });

  it("handles complete Proposal -> Test -> Approval -> Activation -> Rollback lifecycle", async () => {
    const authHeaders = {
      Authorization: `Bearer ${CONTROLLER_TOKEN}`,
      "Content-Type": "application/json",
    };

    const identityRes = await fetch(`http://127.0.0.1:${demoPort}/__demo/identity`);
    const identity = (await identityRes.json()) as {
      targetFingerprint: string;
      targetInstanceId: string;
    };

    // 1. Create Proposal
    const propRes = await fetch(`http://127.0.0.1:${controllerPort}/proposals`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        scenarioId: DEMO_SCENARIO_ID,
        binding: {
          applicationId: "app-lifecycle-1",
          scanId: "scan-lifecycle-1",
          commitSha: "1234567890abcdef1234567890abcdef12345678",
          projectPath: "examples/preview-settings-demo",
          lockfileHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          scenarioId: DEMO_SCENARIO_ID,
          advisoryId: "GHSA-jf85-cpcp-j695",
          packageName: "lodash",
          packageVersion: "4.17.11",
          targetFingerprint: identity.targetFingerprint,
          targetInstanceId: identity.targetInstanceId,
        },
        rule: { kind: "disable_route", path: "/preview" },
      }),
    });
    assert.equal(propRes.status, 201);
    const proposal = await propRes.json();
    assert.ok(proposal.proposalHash);

    // 2. Execute Test
    const testRes = await fetch(`http://127.0.0.1:${controllerPort}/tests`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ proposalId: proposal.id }),
    });
    assert.equal(testRes.status, 200);
    const testRun = await testRes.json();
    assert.equal(testRun.status, "passed");

    // 3. Approval requires acknowledgement
    const noAckRes = await fetch(`http://127.0.0.1:${controllerPort}/approvals`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        proposalHash: proposal.proposalHash,
        testRunId: testRun.id,
        acknowledgedFunctionalityLoss: false,
      }),
    });
    assert.equal(noAckRes.status, 400);

    // 4. Valid Approval
    const appRes = await fetch(`http://127.0.0.1:${controllerPort}/approvals`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        proposalHash: proposal.proposalHash,
        testRunId: testRun.id,
        acknowledgedFunctionalityLoss: true,
      }),
    });
    assert.equal(appRes.status, 201);
    const approval = await appRes.json();

    // 5. Activation
    const actRes = await fetch(`http://127.0.0.1:${controllerPort}/activate`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ approvalId: approval.id }),
    });
    assert.equal(actRes.status, 200);
    const actData = await actRes.json();
    assert.equal(actData.lastVerification.verified, true);

    // Verify Active Proxy blocks /preview with 503 and zero upstream dispatch
    const counterBefore = (await (await fetch(`http://127.0.0.1:${demoPort}/__demo/identity`)).json()).previewRequestCounter;
    const blockedRes = await fetch(`http://127.0.0.1:${proxyPort}/preview`, { method: "POST" });
    assert.equal(blockedRes.status, 503);
    const counterAfter = (await (await fetch(`http://127.0.0.1:${demoPort}/__demo/identity`)).json()).previewRequestCounter;
    assert.equal(counterAfter - counterBefore, 0, "Blocked request must not reach upstream");

    // Trailing slash and query parameters must also be blocked
    const trailingBlocked = await fetch(`http://127.0.0.1:${proxyPort}/preview/?query=1`, { method: "POST" });
    assert.equal(trailingBlocked.status, 503);

    // Unrelated routes still succeed with 200
    const catalogRes = await fetch(`http://127.0.0.1:${proxyPort}/catalog`);
    assert.equal(catalogRes.status, 200);

    // Idempotent reactivation
    const idempAct = await fetch(`http://127.0.0.1:${controllerPort}/activate`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ approvalId: approval.id }),
    });
    assert.equal(idempAct.status, 200);

    // 6. Rollback
    const rollRes = await fetch(`http://127.0.0.1:${controllerPort}/rollback`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ reason: "Testing complete" }),
    });
    assert.equal(rollRes.status, 200);

    // After rollback, /preview is available again
    const restoredPreview = await fetch(`http://127.0.0.1:${proxyPort}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(BENIGN_TEST_PAYLOAD),
    });
    assert.equal(restoredPreview.status, 200);
  });

  // ==========================================
  // 5. Scan-to-Target Binding Rejection
  // ==========================================

  it("rejects binding for unrelated repositories or mismatched packages", async () => {
    // 1. Non-existent application
    const nonExistent = await validateScanTargetBinding("non-existent-app-id");
    assert.equal(nonExistent.eligible, false);

    // 2. Unrelated application (e.g. nodejs-goof)
    await mutateStore(async (state) => {
      const unrelatedApp: Application = {
        id: "app-unrelated-goof",
        displayName: "Snyk Goof",
        owner: "snyk-labs",
        repo: "nodejs-goof",
        canonicalRepoUrl: "https://github.com/snyk-labs/nodejs-goof",
        projectPath: "",
        requestedRef: "main",
        deploymentUrl: null,
        deploymentClaim: "repository_snapshot",
        declaredDeployedCommit: null,
        createdAt: new Date().toISOString(),
        lastScanId: "scan-unrelated-1",
        lastSuccessfulScanId: "scan-unrelated-1",
      };
      const unrelatedScan: ScanReport = {
        id: "scan-unrelated-1",
        applicationId: "app-unrelated-goof",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        resolvedCommitSha: "aabbccddeeff00112233445566778899aabbccdd",
        lockfileHash: "hash123",
        status: "complete",
        scannedFiles: [],
        coverage: {
          inventoryEntryCount: 1,
          uniqueQueryablePairs: 1,
          queriedPairs: 1,
          failedPairs: 0,
          excludedEntries: 0,
          hydratedAdvisories: 1,
          unhydratedAdvisoryIds: [],
          warnings: [],
          exclusions: [],
        },
        inventory: [
          {
            ecosystem: "npm",
            packageName: "lodash",
            version: "4.17.11",
            paths: ["lodash"],
            direct: true,
            categories: ["production"],
            originStatus: "supported",
          },
        ],
        findings: [
          {
            findingKey: "lodash:4.17.11:GHSA-jf85-cpcp-j695",
            advisoryId: "GHSA-jf85-cpcp-j695",
            sourceIds: [],
            aliases: ["CVE-2019-10744"],
            title: "Prototype Pollution in lodash",
            description: "test",
            checkedAt: new Date().toISOString(),
            packageName: "lodash",
            version: "4.17.11",
            dependencyPaths: ["lodash"],
            categories: ["production"],
            severity: "high",
            applicability: "known_affected_version",
            affectedVersionEvidence: "< 4.17.12",
            patchStatus: "fix_listed",
            fixedVersionsListed: ["4.17.12"],
            references: [],
            recommendations: [],
          },
        ],
        providerFailures: [],
        aiStatus: "not_needed",
        deterministicSummary: "Summary",
        applicationSnapshot: {
          displayName: "Snyk Goof",
          canonicalRepoUrl: "https://github.com/snyk-labs/nodejs-goof",
          projectPath: "",
          requestedRef: "main",
          deploymentUrl: null,
          deploymentClaim: "repository_snapshot",
          declaredDeployedCommit: null,
        },
        assessmentBoundary: "Assessment boundary",
      };
      return {
        state: {
          ...state,
          applications: [unrelatedApp, ...state.applications],
          scans: [unrelatedScan, ...state.scans],
        },
        result: true,
      };
    });

    const unrelatedCheck = await validateScanTargetBinding("app-unrelated-goof", "scan-unrelated-1");
    assert.equal(unrelatedCheck.eligible, false);
    assert.ok(unrelatedCheck.reason?.includes("Preview Settings Demo"));
  });

  // ==========================================
  // 6. Deterministic AI Fallback Provenance
  // ==========================================

  it("produces truthful deterministic fallback when AI is unconfigured", async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const explanation = await generateProposalExplanation({
        binding: {
          applicationId: "app-1",
          scanId: "scan-1",
          commitSha: "sha1",
          projectPath: "examples/preview-settings-demo",
          lockfileHash: "hash1",
          scenarioId: DEMO_SCENARIO_ID,
          advisoryId: "GHSA-jf85-cpcp-j695",
          packageName: "lodash",
          packageVersion: "4.17.11",
          targetFingerprint: "fp1",
          targetInstanceId: "inst1",
        },
        rule: { kind: "disable_route", path: "/preview" },
      });

      assert.equal(explanation.aiStatus, "deterministic_fallback");
      assert.ok(explanation.explanation.includes("defaultsDeep"));
      assert.ok(explanation.functionalityCost.includes("HTTP 503"));
      assert.ok(explanation.limitations.length >= 3);
    } finally {
      if (savedKey) process.env.GEMINI_API_KEY = savedKey;
    }
  });

  // ==========================================
  // 7. Restart Restoration of Active Containment
  // ==========================================

  it("restores active rule from persisted state on controller restart", async () => {
    // 1. Manually write state with an active rule
    const restartStateFile = path.join(tempDir, "restart-protection-state.json");
    fs.writeFileSync(
      restartStateFile,
      JSON.stringify(
        {
          version: 1,
          controllerInstanceId: "prior-instance",
          activeRule: { kind: "disable_route", path: "/preview" },
          ruleRevision: 4,
          activatedAt: new Date().toISOString(),
          relatedApprovalId: "appr-1",
          relatedTestRunId: "test-1",
          proposals: [],
          testRuns: [],
          approvals: [],
          history: [],
        },
        null,
        2
      )
    );

    const restartedController = new ControllerService({
      controllerPort: 8411,
      proxyPort: 8412,
      demoPort,
      stateFilePath: restartStateFile,
    });

    await restartedController.start({ controllerPort: 8411, proxyPort: 8412 });

    try {
      // The proxy MUST have the active rule restored BEFORE processing traffic!
      assert.deepEqual(restartedController.getProxy().getActiveRule(), {
        kind: "disable_route",
        path: "/preview",
      });

      // Forwarding proxy must immediately enforce the restored rule
      const blocked = await fetch("http://127.0.0.1:8412/preview", { method: "POST" });
      assert.equal(blocked.status, 503);
    } finally {
      await restartedController.stop();
    }
  });
});
