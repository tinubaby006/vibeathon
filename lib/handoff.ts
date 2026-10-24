// lib/handoff.ts
// Remediation Handoff for Coding Agent
// Builds an exportable, grounded remediation plan from an immutable scan report.
// Does NOT trigger fresh scans, AI calls, or test runs.

import fs from "node:fs";
import crypto from "node:crypto";
import { ScanReport, Finding, DependencyEntry } from "./contracts";
import { ControllerStateSchema } from "../services/protection/types";
import { getProtectionStateFilePath } from "../services/protection/store";

export interface RemediationFindingItem {
  findingKey: string;
  packageName: string;
  installedVersion: string;
  isDirect: boolean;
  dependencyPaths: string[];
  categories: string[];
  severity: string;
  severitySource: string;
  advisoryId: string;
  cveAliases: string[];
  primaryReference: string | null;
  patchStatus: "fix_listed" | "no_fix_listed" | "unknown";
  candidateFixedVersions: string[];
  dependencyGuidance: string;
  remediationRecommendation: string;
  caveats: string;
  aiExplanation?: string;
}

export interface ContainmentEvidenceSnapshot {
  hasProtectionEvidence: boolean;
  targetType: "isolated_demo" | "none";
  capturedAt: string | null;
  ruleKind: string | null;
  targetPath: string | null;
  verificationStatus: string;
  disclaimer: string;
}

export interface CodingAgentInstructions {
  objective: string;
  statusOfProposedChecks: string;
  guidelines: string[];
  step1_inspect_and_verify: string;
  step2_confirm_usage: string;
  step3_apply_remediation: string;
  step4_regression_verification: string;
  step5_report_results: string;
}

export interface RemediationHandoff {
  schemaVersion: 1;
  handoffId: string;
  scanId: string;
  generatedAt: string;
  target: {
    displayName: string;
    canonicalRepoUrl: string;
    projectPath: string;
    resolvedCommitSha: string | null;
    lockfileHash: string | null;
  };
  summary: {
    totalFindings: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    fixListedCount: number;
    noFixListedCount: number;
    directCount: number;
    transitiveCount: number;
  };
  findings: RemediationFindingItem[];
  containmentEvidence: ContainmentEvidenceSnapshot;
  instructionsForCodingAgent: CodingAgentInstructions;
}

/**
 * Safely inspects controller storage for matching protection evidence.
 * Does not require controller process to be running.
 */
function findMatchingProtectionEvidence(
  applicationId: string,
  scanId: string
): ContainmentEvidenceSnapshot {
  try {
    const stateFile = getProtectionStateFilePath();
    if (!fs.existsSync(stateFile)) {
      return {
        hasProtectionEvidence: false,
        targetType: "none",
        capturedAt: null,
        ruleKind: null,
        targetPath: null,
        verificationStatus: "No protection recorded",
        disclaimer: "No active containment or isolated demo evidence attached to this scan.",
      };
    }

    const raw = fs.readFileSync(/*turbopackIgnore: true*/ stateFile, "utf8");
    const parsed = JSON.parse(raw);
    const validated = ControllerStateSchema.safeParse(parsed);
    if (!validated.success) {
      return {
        hasProtectionEvidence: false,
        targetType: "none",
        capturedAt: null,
        ruleKind: null,
        targetPath: null,
        verificationStatus: "Unreadable protection state",
        disclaimer: "No active containment or isolated demo evidence attached to this scan.",
      };
    }

    const state = validated.data;
    // Check if any proposal, test run, or active rule matches this scan/application
    const matchingProposal = state.proposals.find(
      (p) => p.binding.applicationId === applicationId && p.binding.scanId === scanId
    );
    const matchingTestRun = state.testRuns.find(
      (t) => t.binding.applicationId === applicationId && t.binding.scanId === scanId
    );

    if (!matchingProposal && !matchingTestRun && !state.activeRule) {
      return {
        hasProtectionEvidence: false,
        targetType: "none",
        capturedAt: null,
        ruleKind: null,
        targetPath: null,
        verificationStatus: "No matching containment",
        disclaimer: "No active containment or isolated demo evidence attached to this scan.",
      };
    }

    const activeRule = state.activeRule;
    const isCurrentlyActive = Boolean(activeRule);
    const capturedAt = state.activatedAt || matchingTestRun?.completedAt || matchingProposal?.createdAt || new Date().toISOString();

    return {
      hasProtectionEvidence: true,
      targetType: "isolated_demo",
      capturedAt,
      ruleKind: activeRule?.kind || matchingProposal?.rule.kind || "disable_route",
      targetPath: activeRule?.path || matchingProposal?.rule.path || "/preview",
      verificationStatus: isCurrentlyActive
        ? "Active loopback containment (/preview returning HTTP 503)"
        : matchingTestRun?.status === "passed"
        ? "Tested passed in ephemeral proxy (not currently activated)"
        : "Proposed containment",
      disclaimer:
        "ISOLATED DEMO EVIDENCE ONLY: This temporary containment blocks /preview via loopback proxy port 8002. It is a temporary mitigating control, NOT a permanent code patch, and does NOT prove the underlying library safe.",
    };
  } catch {
    return {
      hasProtectionEvidence: false,
      targetType: "none",
      capturedAt: null,
      ruleKind: null,
      targetPath: null,
      verificationStatus: "Unavailable",
      disclaimer: "No active containment or isolated demo evidence attached to this scan.",
    };
  }
}

/**
 * Builds the complete RemediationHandoff from an immutable ScanReport.
 */
export function buildRemediationHandoff(report: ScanReport): RemediationHandoff {
  const generatedAt = new Date().toISOString();
  const handoffId = `handoff-${report.id.substring(0, 8)}-${crypto.randomUUID().substring(0, 8)}`;

  // Dependency lookup map: packageName@version -> DependencyEntry
  const inventoryMap = new Map<string, DependencyEntry>();
  for (const dep of report.inventory) {
    inventoryMap.set(`${dep.packageName}@${dep.version}`, dep);
  }

  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  let fixListedCount = 0;
  let noFixListedCount = 0;
  let directCount = 0;
  let transitiveCount = 0;

  const findingItems: RemediationFindingItem[] = report.findings.map((f: Finding) => {
    // Severity tally
    if (f.severity === "critical") critical++;
    else if (f.severity === "high") high++;
    else if (f.severity === "medium") medium++;
    else low++;

    // Inventory match to determine direct vs transitive
    const matchedDep = inventoryMap.get(`${f.packageName}@${f.version}`);
    const isDirect = matchedDep ? matchedDep.direct : false;
    if (isDirect) directCount++;
    else transitiveCount++;

    // Patch status tally
    const hasFix = f.patchStatus === "fix_listed" && f.fixedVersionsListed.length > 0;
    if (hasFix) fixListedCount++;
    else noFixListedCount++;

    // Guidance on direct vs transitive
    let dependencyGuidance: string;
    if (isDirect) {
      dependencyGuidance = `Direct dependency declared in root manifest. Update the version specifier in package.json to a fixed release and regenerate package-lock.json.`;
    } else {
      const paths = f.dependencyPaths && f.dependencyPaths.length > 0 ? f.dependencyPaths[0] : f.packageName;
      dependencyGuidance = `Transitive dependency brought in via: ${paths}. Prefer upgrading the top-level direct parent dependency in package.json. If the upstream parent has not released a patch, evaluate package manager overrides/resolutions with caution.`;
    }

    // Recommendation guidance based on fix availability
    let remediationRecommendation: string;
    let caveats: string;
    if (hasFix) {
      const candidates = f.fixedVersionsListed.join(", ");
      remediationRecommendation = `Upgrade ${f.packageName} to fixed version (candidate fixed releases: ${candidates}).`;
      caveats = `Candidate fixed versions are advisory-specific from OSV (${f.affectedVersionEvidence || "affected range"}). Review release notes and verify compatibility before applying.`;
    } else {
      remediationRecommendation = `No official fixed version listed in advisory. Do NOT invent a patched version.`;
      caveats = `Upstream has not published a fix for this advisory or the version line is unmaintained. Evaluate input sanitization, feature gating, or replacing ${f.packageName} with an actively maintained alternative.`;
    }

    const primaryReference = f.references && f.references.length > 0 ? f.references[0] : null;

    return {
      findingKey: f.findingKey,
      packageName: f.packageName,
      installedVersion: f.version,
      isDirect,
      dependencyPaths: f.dependencyPaths || [f.packageName],
      categories: f.categories || ["production"],
      severity: f.severity,
      severitySource: f.severitySource || "OSV Database",
      advisoryId: f.advisoryId,
      cveAliases: f.aliases || [],
      primaryReference,
      patchStatus: f.patchStatus,
      candidateFixedVersions: f.fixedVersionsListed || [],
      dependencyGuidance,
      remediationRecommendation,
      caveats,
      aiExplanation: f.aiExplanation,
    };
  });

  const containmentEvidence = findMatchingProtectionEvidence(
    report.applicationId,
    report.id
  );

  const instructionsForCodingAgent: CodingAgentInstructions = {
    objective: `Remediate ${report.findings.length} identified vulnerability finding(s) in repository '${report.applicationSnapshot.displayName}' at commit ${report.resolvedCommitSha?.substring(0, 7) || "HEAD"} without introducing regressions.`,
    statusOfProposedChecks: "Not executed (Pending Coding Agent Run)",
    guidelines: [
      "Inspect the checkout and compare with the scanned revision before making edits.",
      "Preserve existing user edits and unstaged working tree changes.",
      "Confirm affected package usage and verify if vulnerable functions are reachable.",
      "Apply minimal justified upgrades or configuration changes based strictly on source evidence.",
      "Do NOT invent patched versions when OSV lists 'no_fix_listed'.",
      "Run relevant security and normal-functionality regression checks.",
      "Report actual changes, results, unresolved issues, and limitations.",
      "Do NOT automatically commit, push, deploy, or disable active containment.",
    ],
    step1_inspect_and_verify:
      `1. VERIFY CHECKOUT INTEGRITY:\n` +
      `   - Verify that your local repository checkout matches scanned commit SHA: ${report.resolvedCommitSha || "N/A"}.\n` +
      `   - Inspect git status to preserve any uncommitted user work.\n` +
      `   - Project path: '${report.applicationSnapshot.projectPath || "."}'.`,
    step2_confirm_usage:
      `2. CONFIRM AFFECTED PACKAGE USAGE:\n` +
      `   - For each finding below, inspect source code imports and call sites.\n` +
      `   - Distinguish whether affected functions are actively called or if the package is merely installed.\n` +
      `   - Confirm direct vs transitive relationships in package.json and package-lock.json.`,
    step3_apply_remediation:
      `3. APPLY JUSTIFIED REMEDIATION:\n` +
      `   - For direct dependencies with fixes: Bump to the closest safe fixed release in package.json and update package-lock.json.\n` +
      `   - For transitive dependencies: Update the declaring direct parent package, or use npm overrides if parent is unpatched.\n` +
      `   - For dependencies with no listed fix: Implement application-level input validation, feature restrictions, or library replacement. Do not fabricate version numbers.`,
    step4_regression_verification:
      `4. VERIFICATION & REGRESSION TESTING [Status: Not executed]:\n` +
      `   - Run existing test suite: npm.cmd test\n` +
      `   - Run linter: npm.cmd run lint\n` +
      `   - Run build check: npm.cmd run build\n` +
      `   - Execute targeted tests proving the vulnerability is addressed and normal features remain operational.`,
    step5_report_results:
      `5. REPORT ACTUAL OUTCOMES:\n` +
      `   - Report all modified files and provide clean git diffs.\n` +
      `   - Record actual command outputs and test pass/fail results.\n` +
      `   - Disclose any unfixable dependencies, breaking changes, or limitations.`,
  };

  return {
    schemaVersion: 1,
    handoffId,
    scanId: report.id,
    generatedAt,
    target: {
      displayName: report.applicationSnapshot.displayName,
      canonicalRepoUrl: report.applicationSnapshot.canonicalRepoUrl,
      projectPath: report.applicationSnapshot.projectPath,
      resolvedCommitSha: report.resolvedCommitSha,
      lockfileHash: report.lockfileHash,
    },
    summary: {
      totalFindings: report.findings.length,
      critical,
      high,
      medium,
      low,
      fixListedCount,
      noFixListedCount,
      directCount,
      transitiveCount,
    },
    findings: findingItems,
    containmentEvidence,
    instructionsForCodingAgent,
  };
}

/**
 * Renders the handoff as a structured Markdown document ready to feed to a coding agent.
 */
export function renderHandoffMarkdown(handoff: RemediationHandoff): string {
  const lines: string[] = [];

  lines.push(`# Security Remediation Handoff for Coding Agent`);
  lines.push(``);
  lines.push(`> **Notice for Coding Agent:** This document contains factual evidence from an immutable vulnerability scan.`);
  lines.push(`> Follow the step-by-step instructions below. Do not invent patched versions or package paths.`);
  lines.push(`> Proposed verification checks are labelled **Not executed** until you actually run them.`);
  lines.push(``);

  // Target Information
  lines.push(`## 1. Scanned Target Specification`);
  lines.push(``);
  lines.push(`- **Application:** ${handoff.target.displayName}`);
  lines.push(`- **Repository:** ${handoff.target.canonicalRepoUrl}`);
  lines.push(`- **Project Path:** \`${handoff.target.projectPath || "."}\``);
  lines.push(`- **Scanned Commit SHA:** \`${handoff.target.resolvedCommitSha || "N/A"}\``);
  lines.push(`- **Lockfile SHA-256:** \`${handoff.target.lockfileHash || "N/A"}\``);
  lines.push(`- **Handoff Generated At:** ${handoff.generatedAt}`);
  lines.push(`- **Scan ID:** \`${handoff.scanId}\``);
  lines.push(``);

  // Findings Overview
  lines.push(`## 2. Findings Summary`);
  lines.push(``);
  lines.push(`| Metric | Count | Details |`);
  lines.push(`|---|---|---|`);
  lines.push(`| Total Findings | **${handoff.summary.totalFindings}** | ${handoff.summary.critical} critical, ${handoff.summary.high} high, ${handoff.summary.medium} medium, ${handoff.summary.low} low |`);
  lines.push(`| Fix Availability | **${handoff.summary.fixListedCount} fixable** | ${handoff.summary.noFixListedCount} with no official fix listed |`);
  lines.push(`| Dependency Type | **${handoff.summary.directCount} direct** | ${handoff.summary.transitiveCount} transitive |`);
  lines.push(``);

  // Containment Evidence Snapshot
  lines.push(`## 3. Temporary Containment Evidence Snapshot`);
  lines.push(``);
  if (handoff.containmentEvidence.hasProtectionEvidence) {
    lines.push(`- **Status:** ${handoff.containmentEvidence.verificationStatus}`);
    lines.push(`- **Rule Kind:** \`${handoff.containmentEvidence.ruleKind}\` on path \`${handoff.containmentEvidence.targetPath}\``);
    lines.push(`- **Captured At:** ${handoff.containmentEvidence.capturedAt}`);
    lines.push(`- **Important Disclaimer:** *${handoff.containmentEvidence.disclaimer}*`);
  } else {
    lines.push(`- **Status:** No active containment or isolated demo evidence attached to this scan.`);
    lines.push(`- **Note:** Proceed with standard source code and dependency remediation.`);
  }
  lines.push(``);

  // Remediation Instructions for Coding Agent
  lines.push(`## 4. Instructions for Receiving Coding Agent`);
  lines.push(``);
  lines.push(`### Mandatory Operational Guidelines:`);
  for (const g of handoff.instructionsForCodingAgent.guidelines) {
    lines.push(`- ${g}`);
  }
  lines.push(``);

  lines.push(`### Execution Steps:`);
  lines.push(``);
  lines.push(handoff.instructionsForCodingAgent.step1_inspect_and_verify);
  lines.push(``);
  lines.push(handoff.instructionsForCodingAgent.step2_confirm_usage);
  lines.push(``);
  lines.push(handoff.instructionsForCodingAgent.step3_apply_remediation);
  lines.push(``);
  lines.push(handoff.instructionsForCodingAgent.step4_regression_verification);
  lines.push(``);
  lines.push(handoff.instructionsForCodingAgent.step5_report_results);
  lines.push(``);

  // Detailed Findings Table & Itemized Guidance
  lines.push(`## 5. Detailed Findings & Dependency Guidance`);
  lines.push(``);

  if (handoff.findings.length === 0) {
    lines.push(`No vulnerability findings recorded for this scan.`);
  } else {
    for (let i = 0; i < handoff.findings.length; i++) {
      const f = handoff.findings[i];
      const fixText = f.candidateFixedVersions.length > 0
        ? f.candidateFixedVersions.map((v) => `\`${v}\``).join(", ")
        : "*None listed in official advisory*";

      lines.push(`### 5.${i + 1} ${f.packageName} @ ${f.installedVersion} — ${f.advisoryId}`);
      lines.push(``);
      lines.push(`- **Severity:** **${f.severity.toUpperCase()}** (Source: ${f.severitySource})`);
      lines.push(`- **Aliases / CVEs:** ${f.cveAliases.length > 0 ? f.cveAliases.join(", ") : "None"}`);
      lines.push(`- **Dependency Type:** ${f.isDirect ? "**Direct dependency**" : "**Transitive dependency**"}`);
      lines.push(`- **Dependency Chain:** \`${f.dependencyPaths.join(" -> ")}\``);
      if (f.primaryReference) {
        lines.push(`- **Primary Advisory Reference:** [${f.advisoryId}](${f.primaryReference})`);
      }
      lines.push(`- **Patch Status:** \`${f.patchStatus}\``);
      lines.push(`- **Candidate Fixed Releases:** ${fixText}`);
      lines.push(`- **Dependency Guidance:** ${f.dependencyGuidance}`);
      lines.push(`- **Actionable Remediation:** ${f.remediationRecommendation}`);
      lines.push(`- **Caveats & Compatibility:** ${f.caveats}`);
      if (f.aiExplanation) {
        lines.push(`- **Analysis Context:** ${f.aiExplanation}`);
      }
      lines.push(``);
    }
  }

  lines.push(`---`);
  lines.push(`*Generated by Vulnerability Response Console. Handoff ID: \`${handoff.handoffId}\`*`);
  return lines.join("\n");
}
