// tests/handoff.test.ts
// Focused automated integration tests for Remediation Handoff for Coding Agent

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { buildRemediationHandoff, renderHandoffMarkdown } from "../lib/handoff";
import { ScanReport, Finding, DependencyEntry } from "../lib/contracts";

let tempDir: string;
let stateFilePath: string;
let protectionStateFilePath: string;

describe("Remediation Handoff for Coding Agent", () => {
  before(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vrc-test-handoff-"));
    stateFilePath = path.join(tempDir, "state.json");
    protectionStateFilePath = path.join(tempDir, "protection-state.json");

    process.env.VRC_STATE_FILE_PATH = stateFilePath;
    process.env.VRC_PROTECTION_STATE_FILE_PATH = protectionStateFilePath;
  });

  after(() => {
    delete process.env.VRC_STATE_FILE_PATH;
    delete process.env.VRC_PROTECTION_STATE_FILE_PATH;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function createMockScanReport(overrides?: Partial<ScanReport>): ScanReport {
    const defaultFindings: Finding[] = [
      {
        findingKey: "lodash:4.17.11:GHSA-jf85-cpcp-j695",
        advisoryId: "GHSA-jf85-cpcp-j695",
        sourceIds: ["GHSA-jf85-cpcp-j695"],
        aliases: ["CVE-2019-10744"],
        title: "Prototype Pollution in lodash",
        description: "Vulnerable to prototype pollution via defaultsDeep.",
        checkedAt: "2026-10-25T00:00:00.000Z",
        packageName: "lodash",
        version: "4.17.11",
        dependencyPaths: ["lodash"],
        categories: ["production"],
        severity: "high",
        severitySource: "GitHub Advisory Database",
        applicability: "known_affected_version",
        affectedVersionEvidence: "< 4.17.12",
        patchStatus: "fix_listed",
        fixedVersionsListed: ["4.17.12"],
        references: ["https://github.com/advisories/GHSA-jf85-cpcp-j695"],
        recommendations: [],
        aiExplanation: "Prototype pollution in defaultsDeep allows injecting properties on Object.prototype.",
      },
      {
        findingKey: "babel-core:6.26.3:GHSA-67hx-6x53-jw92",
        advisoryId: "GHSA-67hx-6x53-jw92",
        sourceIds: ["GHSA-67hx-6x53-jw92"],
        aliases: ["CVE-2023-45133"],
        title: "Arbitrary Code Execution in babel-core",
        description: "Babel 6 is unmaintained and contains an arbitrary code execution vulnerability.",
        checkedAt: "2026-10-25T00:00:00.000Z",
        packageName: "babel-core",
        version: "6.26.3",
        dependencyPaths: ["babel-cli -> babel-core"],
        categories: ["development"],
        severity: "critical",
        severitySource: "OSV",
        applicability: "known_affected_version",
        affectedVersionEvidence: "< 7.0.0",
        patchStatus: "no_fix_listed",
        fixedVersionsListed: [],
        references: ["https://github.com/advisories/GHSA-67hx-6x53-jw92"],
        recommendations: [],
      },
    ];

    const defaultInventory: DependencyEntry[] = [
      {
        ecosystem: "npm",
        packageName: "lodash",
        version: "4.17.11",
        paths: ["lodash"],
        direct: true,
        categories: ["production"],
        originStatus: "supported",
      },
      {
        ecosystem: "npm",
        packageName: "babel-core",
        version: "6.26.3",
        paths: ["babel-cli -> babel-core"],
        direct: false,
        categories: ["development"],
        originStatus: "supported",
      },
    ];

    return {
      id: "scan-mock-12345678",
      applicationId: "app-mock-87654321",
      startedAt: "2026-10-25T00:00:00.000Z",
      completedAt: "2026-10-25T00:01:00.000Z",
      resolvedCommitSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      lockfileHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      status: "complete",
      scannedFiles: [],
      coverage: {
        inventoryEntryCount: 2,
        uniqueQueryablePairs: 2,
        queriedPairs: 2,
        failedPairs: 0,
        excludedEntries: 0,
        hydratedAdvisories: 2,
        unhydratedAdvisoryIds: [],
        warnings: [],
        exclusions: [],
      },
      inventory: defaultInventory,
      findings: defaultFindings,
      providerFailures: [],
      aiStatus: "completed",
      deterministicSummary: "2 findings identified.",
      applicationSnapshot: {
        displayName: "Test Repo",
        canonicalRepoUrl: "https://github.com/test-org/test-repo",
        projectPath: "packages/core",
        requestedRef: "main",
        deploymentUrl: null,
        deploymentClaim: "repository_snapshot",
        declaredDeployedCommit: null,
      },
      assessmentBoundary: "Bounded assessment",
      ...overrides,
    };
  }

  it("builds handoff without requiring controller, running demo, or active protection", () => {
    const report = createMockScanReport();
    const handoff = buildRemediationHandoff(report);

    assert.equal(handoff.schemaVersion, 1);
    assert.equal(handoff.scanId, report.id);
    assert.equal(handoff.target.canonicalRepoUrl, "https://github.com/test-org/test-repo");
    assert.equal(handoff.target.resolvedCommitSha, "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
    assert.equal(handoff.target.lockfileHash, "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
    assert.equal(handoff.target.projectPath, "packages/core");

    // Findings count
    assert.equal(handoff.summary.totalFindings, 2);
    assert.equal(handoff.summary.critical, 1);
    assert.equal(handoff.summary.high, 1);
    assert.equal(handoff.summary.directCount, 1);
    assert.equal(handoff.summary.transitiveCount, 1);
    assert.equal(handoff.summary.fixListedCount, 1);
    assert.equal(handoff.summary.noFixListedCount, 1);

    // Protection evidence when no protection exists
    assert.equal(handoff.containmentEvidence.hasProtectionEvidence, false);
    assert.equal(handoff.containmentEvidence.targetType, "none");
    assert.ok(handoff.containmentEvidence.disclaimer.includes("No active containment"));
  });

  it("distinguishes direct vs transitive dependency guidance", () => {
    const report = createMockScanReport();
    const handoff = buildRemediationHandoff(report);

    const directItem = handoff.findings.find((f) => f.packageName === "lodash");
    assert.ok(directItem);
    assert.equal(directItem.isDirect, true);
    assert.ok(directItem.dependencyGuidance.includes("Direct dependency declared in root manifest"));

    const transitiveItem = handoff.findings.find((f) => f.packageName === "babel-core");
    assert.ok(transitiveItem);
    assert.equal(transitiveItem.isDirect, false);
    assert.ok(transitiveItem.dependencyGuidance.includes("Transitive dependency"));
    assert.ok(transitiveItem.dependencyGuidance.includes("babel-cli -> babel-core"));
  });

  it("handles unpatched dependencies truthfully without inventing versions", () => {
    const report = createMockScanReport();
    const handoff = buildRemediationHandoff(report);

    const unpatched = handoff.findings.find((f) => f.packageName === "babel-core");
    assert.ok(unpatched);
    assert.equal(unpatched.patchStatus, "no_fix_listed");
    assert.equal(unpatched.candidateFixedVersions.length, 0);
    assert.ok(unpatched.remediationRecommendation.includes("No official fixed version listed"));
    assert.ok(unpatched.caveats.includes("Do NOT invent a patched version") || unpatched.remediationRecommendation.includes("Do NOT invent"));
  });

  it("includes coding agent instructions with 'Not executed' verification status", () => {
    const report = createMockScanReport();
    const handoff = buildRemediationHandoff(report);

    const instructions = handoff.instructionsForCodingAgent;
    assert.equal(instructions.statusOfProposedChecks, "Not executed (Pending Coding Agent Run)");
    assert.ok(instructions.step1_inspect_and_verify.includes("VERIFY CHECKOUT INTEGRITY"));
    assert.ok(instructions.step1_inspect_and_verify.includes(report.resolvedCommitSha!));
    assert.ok(instructions.step2_confirm_usage.includes("CONFIRM AFFECTED PACKAGE USAGE"));
    assert.ok(instructions.step3_apply_remediation.includes("APPLY JUSTIFIED REMEDIATION"));
    assert.ok(instructions.step4_regression_verification.includes("Status: Not executed"));
    assert.ok(instructions.step4_regression_verification.includes("npm.cmd test"));
    assert.ok(instructions.step5_report_results.includes("REPORT ACTUAL OUTCOMES"));

    // Check guideline: Do not automatically commit or push
    const noAutoCommit = instructions.guidelines.some((g) => g.includes("commit") || g.includes("push"));
    assert.ok(noAutoCommit);
  });

  it("attaches timestamped protection snapshot only when application and scan match", () => {
    const report = createMockScanReport({
      applicationId: "app-demo-bound",
      id: "scan-demo-bound",
    });

    // Write a mock protection state file matching this scan
    fs.writeFileSync(
      protectionStateFilePath,
      JSON.stringify(
        {
          version: 1,
          controllerInstanceId: "ctrl-inst-1",
          activeRule: { kind: "disable_route", path: "/preview" },
          ruleRevision: 2,
          activatedAt: "2026-10-25T01:30:00.000Z",
          relatedApprovalId: "appr-1",
          relatedTestRunId: "test-1",
          proposals: [
            {
              id: "prop-1",
              createdAt: "2026-10-25T01:25:00.000Z",
              scenarioId: "demo-scenario-lodash-4.17.11",
              binding: {
                applicationId: "app-demo-bound",
                scanId: "scan-demo-bound",
                commitSha: "sha1",
                projectPath: "examples/preview-settings-demo",
                lockfileHash: "hash1",
                scenarioId: "demo-scenario-lodash-4.17.11",
                advisoryId: "GHSA-jf85-cpcp-j695",
                packageName: "lodash",
                packageVersion: "4.17.11",
                targetFingerprint: "fp1",
                targetInstanceId: "inst1",
              },
              rule: { kind: "disable_route", path: "/preview" },
              ruleHash: "a".repeat(64),
              proposalHash: "b".repeat(64),
              explanation: "Containment",
              evidenceReferences: [],
              functionalityCost: "Cost",
              limitations: [],
              aiStatus: "deterministic_fallback",
            },
          ],
          testRuns: [],
          approvals: [],
          history: [],
        },
        null,
        2
      )
    );

    const handoff = buildRemediationHandoff(report);
    assert.equal(handoff.containmentEvidence.hasProtectionEvidence, true);
    assert.equal(handoff.containmentEvidence.targetType, "isolated_demo");
    assert.equal(handoff.containmentEvidence.ruleKind, "disable_route");
    assert.equal(handoff.containmentEvidence.targetPath, "/preview");
    assert.equal(handoff.containmentEvidence.capturedAt, "2026-10-25T01:30:00.000Z");
    assert.ok(handoff.containmentEvidence.disclaimer.includes("ISOLATED DEMO EVIDENCE ONLY"));
    assert.ok(handoff.containmentEvidence.disclaimer.includes("NOT a permanent code patch"));
  });

  it("renders structured markdown ready for a coding agent", () => {
    const report = createMockScanReport();
    const handoff = buildRemediationHandoff(report);
    const markdown = renderHandoffMarkdown(handoff);

    assert.ok(markdown.startsWith("# Security Remediation Handoff for Coding Agent"));
    assert.ok(markdown.includes("## 1. Scanned Target Specification"));
    assert.ok(markdown.includes(report.applicationSnapshot?.displayName || "Test Repo"));
    assert.ok(markdown.includes(report.resolvedCommitSha!));
    assert.ok(markdown.includes("## 2. Findings Summary"));
    assert.ok(markdown.includes("## 3. Temporary Containment Evidence Snapshot"));
    assert.ok(markdown.includes("## 4. Instructions for Receiving Coding Agent"));
    assert.ok(markdown.includes("Not executed"));
    assert.ok(markdown.includes("## 5. Detailed Findings & Dependency Guidance"));
    assert.ok(markdown.includes("lodash @ 4.17.11"));
    assert.ok(markdown.includes("babel-core @ 6.26.3"));
  });
});
