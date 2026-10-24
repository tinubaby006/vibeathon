import semver from "semver";
import {
  DependencyEntry,
  DependencyUsageCategory,
  Finding,
  FindingSeverity,
  Recommendation,
  ScanCoverage,
} from "./contracts";
import { OsvAdvisoryDetail, OsvLookupResult } from "./osv";

const SEVERITY_WEIGHT: Record<FindingSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  unknown: 1,
};

function parseSeverityString(raw?: string): FindingSeverity {
  if (!raw) return "unknown";
  const lower = raw.trim().toLowerCase();
  if (lower === "critical") return "critical";
  if (lower === "high") return "high";
  if (lower === "moderate" || lower === "medium") return "medium";
  if (lower === "low") return "low";
  return "unknown";
}

/**
 * Normalizes severity from OSV advisory data preserving source provenance
 */
function extractSeverity(detail?: OsvAdvisoryDetail): {
  severity: FindingSeverity;
  source: string;
} {
  if (!detail) {
    return { severity: "unknown", source: "Unresolved advisory" };
  }

  // 1. Check database_specific (e.g. GitHub Advisory severity)
  if (detail.database_specific?.severity) {
    const s = parseSeverityString(String(detail.database_specific.severity));
    if (s !== "unknown") {
      return { severity: s, source: "GitHub Advisory Database" };
    }
  }

  // 2. Check ecosystem_specific
  if (detail.ecosystem_specific?.severity) {
    const s = parseSeverityString(String(detail.ecosystem_specific.severity));
    if (s !== "unknown") {
      return { severity: s, source: "Ecosystem Advisory" };
    }
  }

  // 3. Check top-level severity array (type: CVSS_V3, etc.)
  if (Array.isArray(detail.severity) && detail.severity.length > 0) {
    for (const item of detail.severity) {
      if (item.score) {
        // CVSS vector is a string like "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"
        // We do NOT treat vector as a numeric score. Look for explicit qualitative rating if available.
        return { severity: "unknown", source: item.type || "CVSS Vector" };
      }
    }
  }

  return { severity: "unknown", source: "No published severity rating" };
}

/**
 * Extracts patch evidence and listed fixed versions strictly for the matching npm package
 */
function extractPatchEvidence(
  packageName: string,
  installedVersion: string,
  detail?: OsvAdvisoryDetail
): {
  patchStatus: "fix_listed" | "no_fix_listed" | "unknown";
  fixedVersionsListed: string[];
  affectedEvidence: string;
} {
  if (!detail || !detail.affected) {
    return {
      patchStatus: "unknown",
      fixedVersionsListed: [],
      affectedEvidence: "Advisory details unhydrated or missing affected entry",
    };
  }

  // Filter affected entries strictly for npm ecosystem and exact package name
  const matchingAffected = detail.affected.filter((aff) => {
    const eco = aff.package?.ecosystem?.toLowerCase();
    const name = aff.package?.name?.toLowerCase();
    return (eco === "npm" || !eco) && name === packageName.toLowerCase();
  });

  if (matchingAffected.length === 0) {
    return {
      patchStatus: "unknown",
      fixedVersionsListed: [],
      affectedEvidence: `Advisory lists no affected ranges matching npm package '${packageName}'`,
    };
  }

  const fixedVersions = new Set<string>();
  const rangeDescriptions: string[] = [];
  let foundAnyRange = false;

  for (const aff of matchingAffected) {
    if (aff.ranges) {
      for (const r of aff.ranges) {
        foundAnyRange = true;
        const events = r.events || [];
        const introducedEvents = events.filter((e) => e.introduced).map((e) => e.introduced);
        const fixedEvents = events.filter((e) => e.fixed).map((e) => e.fixed as string);

        if (introducedEvents.length > 0 || fixedEvents.length > 0) {
          rangeDescriptions.push(
            `introduced: ${introducedEvents.join(", ") || "0"}, fixed: ${fixedEvents.join(", ") || "none"}`
          );
        }

        for (const fixed of fixedEvents) {
          const cleanFixed = semver.clean(fixed) || semver.valid(fixed);
          if (cleanFixed) {
            fixedVersions.add(cleanFixed);
          } else {
            fixedVersions.add(fixed);
          }
        }
      }
    }
  }

  const sortedFixed = Array.from(fixedVersions).sort((a, b) => {
    if (semver.valid(a) && semver.valid(b)) {
      return semver.compare(a, b);
    }
    return a.localeCompare(b);
  });

  if (sortedFixed.length > 0) {
    return {
      patchStatus: "fix_listed",
      fixedVersionsListed: sortedFixed,
      affectedEvidence: rangeDescriptions.length > 0
        ? rangeDescriptions.join("; ")
        : `Fixed in ${sortedFixed.join(", ")}`,
    };
  }

  if (foundAnyRange) {
    return {
      patchStatus: "no_fix_listed",
      fixedVersionsListed: [],
      affectedEvidence: rangeDescriptions.join("; "),
    };
  }

  return {
    patchStatus: "unknown",
    fixedVersionsListed: [],
    affectedEvidence: "No structured range events listed for package",
  };
}

/**
 * Builds deterministic recommendations for a finding based on factual evidence
 */
export function buildDeterministicRecommendations(
  finding: Omit<Finding, "recommendations">
): Recommendation[] {
  const recs: Recommendation[] = [];

  if (finding.patchStatus === "fix_listed" && finding.fixedVersionsListed.length > 0) {
    recs.push({
      type: "review_upgrade",
      origin: "deterministic",
      action: `Review upgrade for ${finding.packageName} to candidate version ${finding.fixedVersionsListed[finding.fixedVersionsListed.length - 1]}`,
      rationale: `Advisory ${finding.advisoryId} documents candidate fixed version(s): ${finding.fixedVersionsListed.join(", ")}. Validate compatibility in a development branch.`,
      potentialImpact: "Dependency upgrades may introduce breaking API changes; test thoroughly before deployment.",
      evidenceIds: [finding.advisoryId, ...finding.sourceIds],
      limitations: "Upgrade candidates reflect advisory records; compatibility with other project dependencies is not guaranteed.",
    });
  } else if (finding.patchStatus === "no_fix_listed") {
    recs.push({
      type: "monitor_advisory",
      origin: "deterministic",
      action: `Monitor advisory ${finding.advisoryId} for upstream fix release`,
      rationale: "Matching advisory was retrieved from OSV but lists no fixed release for this package.",
      potentialImpact: "Application remains on affected version until upstream releases an update.",
      evidenceIds: [finding.advisoryId, ...finding.sourceIds],
      limitations: "No active protection or automated patch is applied in this assessment console.",
    });
  } else {
    recs.push({
      type: "investigate_applicability",
      origin: "deterministic",
      action: `Inspect linked advisory ${finding.advisoryId} for manual patch guidance`,
      rationale: "Patch evidence is unhydrated, incomplete, or ambiguous.",
      potentialImpact: "Manual investigation required to verify if a patch exists.",
      evidenceIds: [finding.advisoryId, ...finding.sourceIds],
    });
  }

  recs.push({
    type: "investigate_applicability",
    origin: "deterministic",
    action: `Audit application usage and reachability of ${finding.packageName}`,
    rationale: "Inventory matching confirms the vulnerable package is installed, but reachability and exploitability have not been tested.",
    potentialImpact: "If vulnerable code paths are never called by the application, risk may be mitigated.",
    evidenceIds: [finding.findingKey],
    limitations: "RuntimeReachability is not verified in this assessment.",
  });

  return recs;
}

/**
 * Normalizes OSV results into deduplicated findings with severity provenance and patch evidence
 */
export function normalizeAssessment(
  inventory: DependencyEntry[],
  lookup: OsvLookupResult,
  checkedAt: string = new Date().toISOString()
): {
  findings: Finding[];
  coverageUpdates: Partial<ScanCoverage>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const entryMap = new Map<string, DependencyEntry>();
  for (const entry of inventory) {
    entryMap.set(`${entry.packageName}@${entry.version}`, entry);
  }

  // Intermediate raw finding record
  interface RawFinding {
    canonicalId: string;
    sourceIds: Set<string>;
    aliases: Set<string>;
    title: string;
    description: string;
    publishedAt?: string;
    modifiedAt?: string;
    packageName: string;
    version: string;
    dependencyPaths: string[];
    categories: DependencyEntry["categories"];
    severity: FindingSeverity;
    severitySource: string;
    patchStatus: "fix_listed" | "no_fix_listed" | "unknown";
    fixedVersionsListed: string[];
    affectedEvidence: string;
    references: Set<string>;
  }

  const rawMap = new Map<string, RawFinding>();

  for (const match of lookup.matches) {
    const entryKey = `${match.packageName}@${match.version}`;
    const depEntry = entryMap.get(entryKey);
    const paths = depEntry ? depEntry.paths : [];
    const categories: DependencyUsageCategory[] = depEntry ? depEntry.categories : ["unknown"];

    for (const advId of match.advisoryIds) {
      const detail = lookup.advisories.get(advId);

      // Check if withdrawn
      if (detail?.withdrawn) {
        warnings.push(`Advisory ${advId} for ${match.packageName}@${match.version} was withdrawn upstream and excluded from active findings.`);
        continue;
      }

      const allAliases = new Set<string>(detail?.aliases || []);
      const allIds = new Set<string>([advId, ...allAliases]);

      // Determine canonical ID: prefer GHSA or first ID
      let canonicalId = advId;
      for (const id of allIds) {
        if (id.startsWith("GHSA-")) {
          canonicalId = id;
          break;
        }
      }

      const { severity, source: sevSource } = extractSeverity(detail);
      const { patchStatus, fixedVersionsListed, affectedEvidence } = extractPatchEvidence(
        match.packageName,
        match.version,
        detail
      );

      // Valid references
      const refs = new Set<string>();
      if (detail?.references) {
        for (const r of detail.references) {
          if (r.url && (r.url.startsWith("http://") || r.url.startsWith("https://"))) {
            refs.add(r.url);
          }
        }
      }

      // Group key for alias deduplication: canonical package + exact version + canonical advisory ID
      // To merge records sharing aliases, find existing entry sharing any alias/ID
      let existingKey: string | null = null;
      for (const [k, existing] of rawMap.entries()) {
        if (
          existing.packageName === match.packageName &&
          existing.version === match.version
        ) {
          const sharesId = Array.from(allIds).some((id) => existing.sourceIds.has(id));
          if (sharesId) {
            existingKey = k;
            break;
          }
        }
      }

      if (existingKey) {
        const existing = rawMap.get(existingKey)!;
        for (const id of allIds) existing.sourceIds.add(id);
        for (const al of allAliases) existing.aliases.add(al);
        for (const rf of refs) existing.references.add(rf);

        // Keep highest severity
        if (SEVERITY_WEIGHT[severity] > SEVERITY_WEIGHT[existing.severity]) {
          existing.severity = severity;
          existing.severitySource = sevSource;
        }

        // Merge fixed versions
        const mergedFixed = new Set([...existing.fixedVersionsListed, ...fixedVersionsListed]);
        existing.fixedVersionsListed = Array.from(mergedFixed).sort((a, b) => {
          if (semver.valid(a) && semver.valid(b)) return semver.compare(a, b);
          return a.localeCompare(b);
        });
        if (existing.patchStatus !== "fix_listed" && patchStatus === "fix_listed") {
          existing.patchStatus = "fix_listed";
        }
      } else {
        const key = `${match.packageName}@${match.version}:${canonicalId}`;
        rawMap.set(key, {
          canonicalId,
          sourceIds: allIds,
          aliases: allAliases,
          title: detail?.summary || detail?.details?.substring(0, 100) || `Security advisory ${canonicalId}`,
          description: detail?.details || detail?.summary || "No description provided upstream",
          publishedAt: detail?.published,
          modifiedAt: detail?.modified,
          packageName: match.packageName,
          version: match.version,
          dependencyPaths: paths,
          categories,
          severity,
          severitySource: sevSource,
          patchStatus,
          fixedVersionsListed,
          affectedEvidence,
          references: refs,
        });
      }
    }
  }

  // Convert raw findings into final Finding array with deterministic findingKey and recommendations
  const findings: Finding[] = Array.from(rawMap.values()).map((rf) => {
    const findingKey = `${rf.canonicalId}:npm:${rf.packageName}:${rf.version}`;
    const baseFinding: Omit<Finding, "recommendations"> = {
      findingKey,
      advisoryId: rf.canonicalId,
      sourceIds: Array.from(rf.sourceIds).sort(),
      aliases: Array.from(rf.aliases).sort(),
      title: rf.title,
      description: rf.description,
      publishedAt: rf.publishedAt,
      modifiedAt: rf.modifiedAt,
      checkedAt,
      packageName: rf.packageName,
      version: rf.version,
      dependencyPaths: rf.dependencyPaths,
      categories: rf.categories,
      severity: rf.severity,
      severitySource: rf.severitySource,
      applicability: "known_affected_version",
      affectedVersionEvidence: rf.affectedEvidence,
      patchStatus: rf.patchStatus,
      fixedVersionsListed: rf.fixedVersionsListed,
      references: Array.from(rf.references),
    };

    const recommendations = buildDeterministicRecommendations(baseFinding);

    return {
      ...baseFinding,
      recommendations,
    };
  });

  // Sort findings by severity weight descending, then package name, then version
  findings.sort((a, b) => {
    const diff = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
    if (diff !== 0) return diff;
    return a.packageName.localeCompare(b.packageName);
  });

  return {
    findings,
    coverageUpdates: {
      queriedPairs: lookup.queriedCount,
      failedPairs: lookup.failedQueries.length,
      hydratedAdvisories: lookup.advisories.size,
      unhydratedAdvisoryIds: lookup.unhydratedAdvisoryIds,
    },
    warnings,
  };
}

export function generateDeterministicSummary(
  findings: Finding[],
  coverage: ScanCoverage
): string {
  if (findings.length === 0) {
    if (coverage.failedPairs > 0 || coverage.unhydratedAdvisoryIds.length > 0) {
      return `Assessment partial: 0 known advisories matched, but ${coverage.failedPairs} query lookups or details could not be completed.`;
    }
    return `No known matching advisories returned by OSV for the ${coverage.queriedPairs} queried package versions.`;
  }

  const counts: Record<FindingSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0,
  };

  for (const f of findings) {
    counts[f.severity]++;
  }

  const parts: string[] = [];
  if (counts.critical > 0) parts.push(`${counts.critical} critical`);
  if (counts.high > 0) parts.push(`${counts.high} high`);
  if (counts.medium > 0) parts.push(`${counts.medium} medium`);
  if (counts.low > 0) parts.push(`${counts.low} low`);
  if (counts.unknown > 0) parts.push(`${counts.unknown} unknown severity`);

  return `Identified ${findings.length} known advisory matches across queried dependencies (${parts.join(", ")}).`;
}
