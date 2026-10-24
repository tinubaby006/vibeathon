import { ScanReport, sanitizeFailureMessage } from "./contracts";

/**
 * Renders a standardized, factual Markdown export from a persisted ScanReport
 */
export function renderReportMarkdown(report: ScanReport): string {
  const lines: string[] = [];
  const snap = report.applicationSnapshot;

  lines.push(`# Vulnerability Assessment Report — ${snap.displayName}`);
  lines.push("");
  lines.push(`**Status:** ${report.status.toUpperCase()}`);
  lines.push(`**Generated At:** ${report.completedAt}`);
  lines.push(`**Report ID:** \`${report.id}\``);
  lines.push("");

  // 1. Snapshot and Target Context
  lines.push("## 1. Application Context");
  lines.push("");
  lines.push(`- **Repository:** ${snap.canonicalRepoUrl}`);
  lines.push(`- **Project Path:** \`${snap.projectPath || "/"}\``);
  lines.push(`- **Requested Ref:** \`${snap.requestedRef || "default branch"}\``);
  lines.push(`- **Resolved Commit SHA:** \`${report.resolvedCommitSha || "N/A"}\``);
  lines.push(`- **Lockfile Hash (SHA-256):** \`${report.lockfileHash || "N/A"}\``);
  lines.push(`- **Deployment Claim:** ${snap.deploymentClaim === "developer_declared_commit" ? "Developer-declared commit (Not independently verified)" : "Repository snapshot"}`);
  if (snap.deploymentUrl) {
    lines.push(`- **Deployment Reference URL:** ${snap.deploymentUrl} *(Display only; not scanned or verified)*`);
  }
  lines.push("");

  // 2. Scan Coverage & Limitations
  lines.push("## 2. Scan Coverage & Pipeline Status");
  lines.push("");
  lines.push(`- **Total Inventory Entries:** ${report.coverage.inventoryEntryCount}`);
  lines.push(`- **Unique Queryable (Package, Version) Pairs:** ${report.coverage.uniqueQueryablePairs}`);
  lines.push(`- **Queried Pairs:** ${report.coverage.queriedPairs}`);
  lines.push(`- **Failed Pairs:** ${report.coverage.failedPairs}`);
  lines.push(`- **Excluded Entries:** ${report.coverage.excludedEntries}`);
  lines.push(`- **Hydrated Advisories:** ${report.coverage.hydratedAdvisories}`);
  lines.push(`- **Unhydrated Advisory IDs:** ${report.coverage.unhydratedAdvisoryIds.length > 0 ? report.coverage.unhydratedAdvisoryIds.join(", ") : "None"}`);
  const enrichedCount =
    report.aiCoverage?.enrichedFindings ??
    report.findings.filter((f) => Boolean(f.aiExplanation)).length;
  const totalFindings = report.aiCoverage?.totalFindings ?? report.findings.length;

  lines.push(`- **AI Coverage:** ${enrichedCount} / ${totalFindings} findings enriched (${report.aiStatus})`);
  lines.push("");

  if (report.coverage.exclusions.length > 0) {
    lines.push("### Inventory Exclusions");
    lines.push("");
    for (const ex of report.coverage.exclusions) {
      lines.push(`- **${ex.name}@${ex.versionSpec}**: ${ex.reason}`);
    }
    lines.push("");
  }

  if (report.providerFailures.length > 0) {
    lines.push("### Provider Failures / Warnings");
    lines.push("");
    for (const fail of report.providerFailures) {
      lines.push(`- **[${fail.stage}]** ${sanitizeFailureMessage(fail.message)}`);
    }
    lines.push("");
  }

  // 3. Summary
  lines.push("## 3. Executive Summary");
  lines.push("");
  lines.push(`### Factual Overall Summary (${report.findings.length} Total Findings)`);
  lines.push("");
  lines.push(report.deterministicSummary);
  if (report.aiSummary) {
    lines.push("");
    lines.push(`### AI Summary (Subset: ${enrichedCount} of ${totalFindings} findings covered)`);
    lines.push("");
    lines.push(`> *${report.aiSummary}*`);
  }
  lines.push("");

  // 4. Findings Table
  lines.push("## 4. Known Vulnerability Findings");
  lines.push("");

  if (report.findings.length === 0) {
    if (report.status === "partial") {
      lines.push("> **Assessment incomplete:** 0 known advisory matches returned, but some dependencies could not be queried or hydrated. This does not establish that the application is secure.");
    } else if (report.status === "complete") {
      lines.push(`> No known matching advisories returned by OSV for the queried package versions at ${report.completedAt}. This does not establish that the application is secure.`);
    } else {
      lines.push("> Scan failed before dependency inventory could be queried against OSV.");
    }
    lines.push("");
  } else {
    lines.push("| Package | Version | Severity | Advisory ID | Patch Status | Fix Candidate |");
    lines.push("|---|---|---|---|---|---|");
    for (const f of report.findings) {
      const fixCandidate = f.fixedVersionsListed.length > 0 ? f.fixedVersionsListed.join(", ") : "None listed";
      lines.push(`| \`${f.packageName}\` | \`${f.version}\` | **${f.severity.toUpperCase()}** (${f.severitySource || "published"}) | [${f.advisoryId}](#${f.findingKey.toLowerCase()}) | \`${f.patchStatus}\` | \`${fixCandidate}\` |`);
    }
    lines.push("");

    // 5. Detailed Finding Evidence & Recommendations
    lines.push("## 5. Detailed Evidence & Recommendations");
    lines.push("");

    for (const f of report.findings) {
      lines.push(`### ${f.advisoryId} — \`${f.packageName}@${f.version}\``);
      lines.push("");
      lines.push(`- **Title:** ${f.title}`);
      lines.push(`- **Published Severity:** **${f.severity.toUpperCase()}** *(Source: ${f.severitySource || "OSV Provider"})*`);
      lines.push(`- **Aliases / Source IDs:** ${f.sourceIds.join(", ") || "None"}`);
      lines.push(`- **Affected Evidence:** ${f.affectedVersionEvidence}`);
      lines.push(`- **Installed Paths:** ${f.dependencyPaths.map((p) => `\`${p}\``).join(", ")}`);
      lines.push(`- **Category:** ${f.categories.join(", ")}`);
      lines.push("");
      lines.push(`**Description:**`);
      lines.push(`> ${f.description.replace(/\n/g, "\n> ")}`);
      lines.push("");

      if (f.aiExplanation) {
        lines.push(`**AI Explanation:**`);
        lines.push(`*${f.aiExplanation}*`);
        lines.push("");
      }

      lines.push(`**Proposed Recommendations:**`);
      lines.push("");
      for (const rec of f.recommendations) {
        lines.push(`- **[${rec.origin.toUpperCase()}] ${rec.action}**`);
        lines.push(`  - *Rationale:* ${rec.rationale}`);
        lines.push(`  - *Potential Impact:* ${rec.potentialImpact}`);
        if (rec.limitations) {
          lines.push(`  - *Limitations:* ${rec.limitations}`);
        }
      }
      lines.push("");

      if (f.references.length > 0) {
        lines.push(`**References:**`);
        for (const ref of f.references) {
          lines.push(`- [${ref}](${ref})`);
        }
        lines.push("");
      }
    }
  }

  // 6. Assessment Boundary Statement
  lines.push("## 6. Assessment Boundary");
  lines.push("");
  lines.push(`> ${report.assessmentBoundary}`);
  lines.push("");

  return lines.join("\n");
}
