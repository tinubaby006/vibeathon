// components/report-view.tsx
// Refactored Findings View: compact summary, expandable scan details, search/filters, findings table, and inspection drawer.

'use client';

import { useState, useMemo } from "react";
import {
  Finding,
  FindingSeverity,
  ScanReport,
  sanitizeFailureMessage,
} from "@/lib/contracts";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileCode,
  Filter,
  Info,
  Search,
  Sparkles,
  X,
} from "lucide-react";

interface ReportViewProps {
  report: ScanReport;
  onRefresh?: () => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  severityFilter?: string;
  onSeverityFilterChange?: (filter: string) => void;
  selectedFinding?: Finding | null;
  onSelectFinding?: (f: Finding | null) => void;
}

export default function ReportView({
  report,
  searchQuery: externalSearchQuery,
  onSearchChange,
  severityFilter: externalSeverityFilter,
  onSeverityFilterChange,
  selectedFinding: externalSelectedFinding,
  onSelectFinding,
}: ReportViewProps) {
  // Support both controlled (from Console parent) and uncontrolled (standalone page) state
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const [internalSeverityFilter, setInternalSeverityFilter] = useState("all");
  const [internalSelectedFinding, setInternalSelectedFinding] = useState<Finding | null>(null);

  const searchQuery = externalSearchQuery !== undefined ? externalSearchQuery : internalSearchQuery;
  const setSearchQuery = onSearchChange || setInternalSearchQuery;

  const severityFilter = externalSeverityFilter !== undefined ? externalSeverityFilter : internalSeverityFilter;
  const setSeverityFilter = onSeverityFilterChange || setInternalSeverityFilter;

  const selectedFinding = externalSelectedFinding !== undefined ? externalSelectedFinding : internalSelectedFinding;
  const setSelectedFinding = onSelectFinding || setInternalSelectedFinding;

  const filteredFindings = useMemo(() => {
    return report.findings.filter((f) => {
      if (severityFilter !== "all" && f.severity !== severityFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchesPkg = f.packageName.toLowerCase().includes(query);
        const matchesAdv = f.advisoryId.toLowerCase().includes(query);
        const matchesAliases = f.aliases.some((a) => a.toLowerCase().includes(query));
        if (!matchesPkg && !matchesAdv && !matchesAliases) {
          return false;
        }
      }
      return true;
    });
  }, [report.findings, severityFilter, searchQuery]);

  const severityCounts = useMemo(() => {
    const counts: Record<FindingSeverity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    };
    for (const f of report.findings) {
      counts[f.severity]++;
    }
    return counts;
  }, [report.findings]);

  const uniquePackages = useMemo(() => {
    return new Set(report.findings.map((f) => f.packageName)).size;
  }, [report.findings]);

  const directCount = useMemo(() => {
    return report.findings.filter((f) => {
      const dep = report.inventory.find(
        (i) => i.packageName === f.packageName && i.version === f.version
      );
      return dep ? dep.direct : false;
    }).length;
  }, [report.findings, report.inventory]);

  const transitiveCount = report.findings.length - directCount;

  const enrichedCount =
    report.aiCoverage?.enrichedFindings ??
    report.findings.filter((f) => Boolean(f.aiExplanation)).length;
  const totalFindings = report.aiCoverage?.totalFindings ?? report.findings.length;
  const coveragePercent =
    totalFindings > 0 ? Math.round((enrichedCount / totalFindings) * 100) : 0;

  return (
    <div className="space-y-4 text-xs text-vc-text-primary">
      {/* 1. Compact Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Total Findings & Unique Affected Packages */}
        <div className="bg-vc-card border border-vc-border rounded-xl p-3.5 space-y-1">
          <div className="text-vc-text-secondary font-medium">Findings</div>
          <div className="text-2xl font-bold text-vc-text-primary">
            {report.findings.length}
          </div>
          <div className="text-[11px] text-vc-text-secondary">
            across {uniquePackages} {uniquePackages === 1 ? "package" : "packages"}
          </div>
        </div>

        {/* Severity Breakdown & Direct vs Transitive */}
        <div className="bg-vc-card border border-vc-border rounded-xl p-3.5 space-y-1">
          <div className="text-vc-text-secondary font-medium">Severities</div>
          <div className="flex items-center gap-1.5 text-xs font-semibold mt-1 flex-wrap">
            {severityCounts.critical > 0 && (
              <span className="text-vc-danger">{severityCounts.critical} crit</span>
            )}
            {severityCounts.high > 0 && (
              <span className="text-vc-warning">{severityCounts.high} high</span>
            )}
            {severityCounts.medium > 0 && (
              <span className="text-amber-400">{severityCounts.medium} med</span>
            )}
            {severityCounts.low > 0 && (
              <span className="text-vc-text-secondary">{severityCounts.low} low</span>
            )}
            {report.findings.length === 0 && (
              <span className="text-vc-success">0 vulnerabilities</span>
            )}
          </div>
          <div className="text-[11px] text-vc-text-secondary">
            {directCount} direct • {transitiveCount} transitive
          </div>
        </div>

        {/* Dependency Coverage */}
        <div className="bg-vc-card border border-vc-border rounded-xl p-3.5 space-y-1">
          <div className="text-vc-text-secondary font-medium">Dependency Coverage</div>
          <div className="text-2xl font-bold text-vc-text-primary">
            {report.coverage.queriedPairs}
          </div>
          <div className="text-[11px] text-vc-text-secondary truncate">
            of {report.coverage.uniqueQueryablePairs} npm pairs queried
            {report.coverage.excludedEntries > 0 && ` (${report.coverage.excludedEntries} excl)`}
          </div>
        </div>

        {/* AI Coverage */}
        <div className="bg-vc-card border border-vc-border rounded-xl p-3.5 space-y-1">
          <div className="text-vc-text-secondary font-medium flex items-center justify-between">
            <span>AI Coverage</span>
            <Sparkles size={13} className="text-vc-accent" />
          </div>
          <div className="text-2xl font-bold text-vc-text-primary">
            {enrichedCount} / {totalFindings}
          </div>
          <div className="text-[11px] text-vc-text-secondary capitalize">
            {report.aiStatus} status ({coveragePercent}% enriched)
          </div>
        </div>
      </div>

      {/* 2. Concise Scope Notice */}
      <div className="p-2.5 rounded-lg bg-vc-input/50 border border-vc-border text-[11px] text-vc-text-secondary flex items-center gap-2">
        <Info size={14} className="text-vc-accent shrink-0" />
        <span>
          <strong className="text-vc-text-primary font-semibold">Scope: </strong>
          Assessment is strictly bounded to npm lockfile declarations and matching OSV advisories. Does not execute application code or inspect runtime reachability.
        </span>
      </div>

      {/* 3. Expandable Technical Scan Details */}
      <details className="group border border-vc-border rounded-xl bg-vc-card/60 p-3 text-xs transition-colors">
        <summary className="flex items-center justify-between cursor-pointer font-semibold text-vc-text-secondary hover:text-vc-text-primary select-none">
          <span className="flex items-center gap-2">
            <FileCode size={14} className="text-vc-accent" />
            <span>Scan Technical Details & Metadata</span>
          </span>
          <ChevronDown size={14} className="transition-transform group-open:rotate-180 text-vc-text-secondary" />
        </summary>
        <div className="mt-3 pt-3 border-t border-vc-border/70 grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
          <div>
            <span className="text-vc-text-secondary block">Target Commit SHA:</span>
            <code className="font-mono text-vc-text-primary font-medium">{report.resolvedCommitSha || "N/A"}</code>
          </div>
          <div>
            <span className="text-vc-text-secondary block">Lockfile Hash (SHA-256):</span>
            <code className="font-mono text-vc-text-primary font-medium truncate block" title={report.lockfileHash || undefined}>
              {report.lockfileHash || "N/A"}
            </code>
          </div>
          <div>
            <span className="text-vc-text-secondary block">Project Path & Ref:</span>
            <span className="text-vc-text-primary">
              Path: &apos;{report.applicationSnapshot.projectPath || "."}&apos; • Ref: {report.applicationSnapshot.requestedRef || "default branch"}
            </span>
          </div>
          <div>
            <span className="text-vc-text-secondary block">Scanned Manifests:</span>
            <div className="flex flex-wrap gap-2 mt-0.5">
              {report.scannedFiles.map((f, i) => (
                <a
                  key={i}
                  href={f.gitHubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-vc-accent hover:underline"
                >
                  <span>{f.path}</span>
                  <ExternalLink size={11} />
                </a>
              ))}
            </div>
          </div>
          {report.providerFailures.length > 0 && (
            <div className="sm:col-span-2 p-2.5 rounded-lg bg-vc-danger/10 border border-vc-danger/30 text-vc-danger space-y-1">
              <span className="font-bold">Provider Issues Recorded:</span>
              {report.providerFailures.map((pf, i) => (
                <div key={i} className="text-[11px]">
                  • [{formatStageName(pf.stage)}] {sanitizeFailureMessage(pf.message)}
                </div>
              ))}
            </div>
          )}
        </div>
      </details>

      {/* 4. Scan Failure Diagnostics Banner (if failed) */}
      {report.status === "failed" && (
        <div className="p-4 rounded-xl bg-vc-danger/15 border border-vc-danger/40 text-xs text-vc-danger space-y-3">
          <div className="flex items-center justify-between gap-2 border-b border-vc-danger/30 pb-2.5">
            <div className="flex items-center gap-2">
              <AlertOctagon size={18} className="text-vc-danger shrink-0" />
              <span className="text-sm font-bold text-vc-text-primary tracking-wide">
                Scan Failed: Assessment Incomplete
              </span>
            </div>
            {report.providerFailures[0]?.code && (
              <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-vc-danger/20 border border-vc-danger/40 text-vc-danger">
                {report.providerFailures[0].code}
              </span>
            )}
          </div>

          {report.providerFailures.map((failure, idx) => (
            <div key={idx} className="space-y-2">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-vc-danger font-semibold uppercase tracking-wider text-[10px]">
                  Failed Stage:
                </span>
                <code className="font-mono text-vc-text-primary bg-vc-danger/25 px-2 py-0.5 rounded border border-vc-danger/50 font-semibold">
                  {formatStageName(failure.stage)}
                </code>
                {failure.retryable && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-vc-warning/15 text-vc-warning border border-vc-warning/40 ml-auto font-medium">
                    Retryable
                  </span>
                )}
              </div>

              <div className="text-xs text-vc-text-primary leading-relaxed bg-vc-input/80 p-3 rounded-lg border border-vc-danger/30">
                <strong className="text-vc-danger font-semibold">Sanitized Reason: </strong>
                {sanitizeFailureMessage(failure.message)}
              </div>

              {getActionableGuidance(failure.code, failure.message)}
            </div>
          ))}
        </div>
      )}

      {/* 5. Partial Warning Banner (if partial) */}
      {report.status === "partial" && report.providerFailures.length > 0 && (
        <div className="p-3 rounded-lg bg-vc-warning/15 border border-vc-warning/40 text-xs text-vc-warning space-y-2">
          <div className="flex items-center gap-2 font-semibold text-vc-warning">
            <AlertTriangle size={15} />
            <span>Partial Coverage Notice: Some upstream lookups were incomplete</span>
          </div>
          {report.providerFailures.map((failure, idx) => (
            <div key={idx} className="text-[11px] text-vc-text-primary pl-5">
              • <strong className="text-vc-warning">{formatStageName(failure.stage)}:</strong> {sanitizeFailureMessage(failure.message)}
            </div>
          ))}
        </div>
      )}

      {/* 6. Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-vc-card border border-vc-border p-3 rounded-xl">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-2.5 text-vc-text-secondary" />
          <input
            type="text"
            placeholder="Search by package name, advisory ID (e.g. GHSA-xxx, CVE-xxx)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-vc-input border border-vc-border rounded-lg text-xs text-vc-text-primary placeholder:text-vc-text-secondary/60 focus:outline-none focus:border-vc-accent"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter size={14} className="text-vc-text-secondary" />
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="bg-vc-input border border-vc-border rounded-lg px-2.5 py-1.5 text-xs text-vc-text-primary focus:outline-none focus:border-vc-accent"
          >
            <option value="all">All Severities ({report.findings.length})</option>
            <option value="critical">Critical ({severityCounts.critical})</option>
            <option value="high">High ({severityCounts.high})</option>
            <option value="medium">Medium ({severityCounts.medium})</option>
            <option value="low">Low ({severityCounts.low})</option>
            <option value="unknown">Unknown ({severityCounts.unknown})</option>
          </select>
        </div>
      </div>

      {/* 7. Findings Table */}
      <div className="bg-vc-card border border-vc-border rounded-xl overflow-hidden">
        {filteredFindings.length === 0 ? (
          <div className="p-12 text-center">
            {report.status === "failed" ? (
              <div className="space-y-2.5 max-w-md mx-auto">
                <AlertOctagon size={36} className="mx-auto text-vc-danger" />
                <h3 className="text-base font-semibold text-vc-text-primary">Scan Terminated Early</h3>
                <p className="text-xs text-vc-text-secondary leading-relaxed">
                  Dependency evaluation was aborted due to upstream failure at stage{" "}
                  <code className="font-mono text-vc-danger bg-vc-input px-1.5 py-0.5 rounded font-semibold">
                    {formatStageName(report.providerFailures[0]?.stage || "unknown")}
                  </code>
                  . Check the diagnostic details above for resolution steps.
                </p>
              </div>
            ) : report.findings.length === 0 ? (
              <div className="space-y-2">
                <CheckCircle2 size={36} className="mx-auto text-vc-accent" />
                <h3 className="text-base font-semibold text-vc-text-primary">No Known Advisories Matched</h3>
                <p className="text-xs text-vc-text-secondary max-w-md mx-auto">
                  {report.status === "partial"
                    ? "Zero matches were found in queried dependencies, but some entries could not be queried or hydrated. Assessment remains partial."
                    : `OSV returned zero matching security advisories for the ${report.coverage.queriedPairs} queried npm packages at the time of scan. This does not prove the application is completely secure.`}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Info size={32} className="mx-auto text-vc-text-secondary" />
                <h3 className="text-sm font-semibold text-vc-text-primary">No Findings Match Filter</h3>
                <p className="text-xs text-vc-text-secondary">
                  Try adjusting your search query or severity filter.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-vc-sidebar text-vc-text-secondary font-semibold uppercase tracking-wider text-[10px] border-b border-vc-border">
                <tr>
                  <th className="py-3 px-4">Package</th>
                  <th className="py-3 px-4">Installed Version</th>
                  <th className="py-3 px-4">Severity</th>
                  <th className="py-3 px-4">Advisory</th>
                  <th className="py-3 px-4">Patch Status</th>
                  <th className="py-3 px-4">Candidate Fix (Advisory)</th>
                  <th className="py-3 px-4 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vc-border text-vc-text-secondary">
                {filteredFindings.map((finding) => (
                  <tr
                    key={finding.findingKey}
                    onClick={() => setSelectedFinding(finding)}
                    className="hover:bg-vc-input/70 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 font-mono font-medium text-vc-text-primary">
                      {finding.packageName}
                    </td>
                    <td className="py-3 px-4 font-mono text-vc-text-primary">
                      {finding.version}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
                          finding.severity === "critical"
                            ? "bg-vc-danger/15 text-vc-danger border border-vc-danger/40"
                            : finding.severity === "high"
                            ? "bg-vc-warning/15 text-vc-warning border border-vc-warning/40"
                            : finding.severity === "medium"
                            ? "bg-vc-info/15 text-vc-info border border-vc-info/40"
                            : "bg-vc-input text-vc-text-secondary border border-vc-border"
                        }`}
                      >
                        {finding.severity}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-vc-accent">
                      {finding.advisoryId}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          finding.patchStatus === "fix_listed"
                            ? "text-vc-accent bg-vc-navigation-active border border-vc-accent/30"
                            : finding.patchStatus === "no_fix_listed"
                            ? "text-vc-danger bg-vc-danger/15 border border-vc-danger/40"
                            : "text-vc-text-secondary bg-vc-input border border-vc-border"
                        }`}
                      >
                        {finding.patchStatus.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-vc-text-secondary">
                      {finding.fixedVersionsListed.length > 0
                        ? finding.fixedVersionsListed.join(", ")
                        : "None"}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button className="text-xs text-vc-accent hover:text-vc-success font-medium">
                        Inspect →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 8. Finding Detail Modal Drawer */}
      {selectedFinding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-vc-card border border-vc-border rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl p-6 text-vc-text-primary space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-vc-border pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-vc-text-primary">
                    {selectedFinding.packageName}@{selectedFinding.version}
                  </h3>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${
                      selectedFinding.severity === "critical"
                        ? "bg-vc-danger/15 text-vc-danger border border-vc-danger/40"
                        : selectedFinding.severity === "high"
                        ? "bg-vc-warning/15 text-vc-warning border border-vc-warning/40"
                        : selectedFinding.severity === "medium"
                        ? "bg-vc-info/15 text-vc-info border border-vc-info/40"
                        : "bg-vc-input text-vc-text-secondary border border-vc-border"
                    }`}
                  >
                    {selectedFinding.severity}
                  </span>
                </div>
                <div className="text-xs text-vc-text-secondary mt-1">
                  Canonical ID: <code className="text-vc-accent">{selectedFinding.advisoryId}</code> • Source: {selectedFinding.severitySource || "OSV"}
                </div>
              </div>
              <button
                onClick={() => setSelectedFinding(null)}
                className="p-1 rounded-lg text-vc-text-secondary hover:text-vc-text-primary hover:bg-vc-input transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Title & Description */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-vc-text-primary">{selectedFinding.title}</h4>
              <p className="text-xs text-vc-text-primary leading-relaxed whitespace-pre-wrap bg-vc-input p-3 rounded-lg border border-vc-border">
                {selectedFinding.description}
              </p>
            </div>

            {/* Evidence & Candidate Fixes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="bg-vc-input p-3 rounded-lg border border-vc-border">
                <div className="text-vc-text-secondary text-[11px] font-medium">Affected Version Range</div>
                <div className="font-mono text-vc-text-primary mt-1">
                  {selectedFinding.affectedVersionEvidence}
                </div>
              </div>

              <div className="bg-vc-input p-3 rounded-lg border border-vc-border">
                <div className="text-vc-text-secondary text-[11px] font-medium">Candidate Fixes (Advisory-Specific)</div>
                <div className="font-mono text-vc-accent mt-1">
                  {selectedFinding.fixedVersionsListed.length > 0
                    ? selectedFinding.fixedVersionsListed.join(", ")
                    : "No fix listed"}
                </div>
                <p className="text-[10px] text-vc-text-secondary/70 mt-1">
                  Candidate versions listed in advisory; not verified as universally safe or compatible across other dependencies.
                </p>
              </div>
            </div>

            {/* Installed Locations */}
            <div className="text-xs space-y-1">
              <div className="text-vc-text-secondary font-medium">Installed Locations:</div>
              <div className="space-y-1">
                {selectedFinding.dependencyPaths.map((p, idx) => (
                  <div key={idx} className="font-mono text-[11px] bg-vc-sidebar px-2 py-1 rounded text-vc-text-primary border border-vc-border">
                    {p}
                  </div>
                ))}
              </div>
            </div>

            {/* AI Explanation if available */}
            {selectedFinding.aiExplanation && (
              <div className="p-3.5 rounded-xl bg-vc-input border border-vc-accent/30 text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-vc-accent">
                  <Sparkles size={14} />
                  <span>AI Investigation & Explanation</span>
                </div>
                <p className="text-vc-text-primary leading-relaxed italic">
                  &ldquo;{selectedFinding.aiExplanation}&rdquo;
                </p>
              </div>
            )}

            {/* Proposed Recommendations */}
            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-vc-text-secondary uppercase tracking-wider text-[11px]">
                Proposed Recommendations (Assessment Only)
              </div>
              <div className="space-y-2">
                {selectedFinding.recommendations.map((rec, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-xl bg-vc-input border border-vc-border text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-vc-text-primary">{rec.action}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-vc-card text-vc-text-secondary font-mono uppercase border border-vc-border">
                        {rec.origin}
                      </span>
                    </div>
                    <p className="text-vc-text-primary text-[11px] leading-relaxed">
                      <strong className="text-vc-text-secondary">Rationale:</strong> {rec.rationale}
                    </p>
                    <p className="text-vc-text-secondary text-[11px]">
                      <strong className="text-vc-text-secondary">Potential Impact:</strong> {rec.potentialImpact}
                    </p>
                    {rec.limitations && (
                      <p className="text-vc-warning text-[10px]">
                        <strong>Limitations:</strong> {rec.limitations}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* References */}
            {selectedFinding.references.length > 0 && (
              <div className="text-xs space-y-1.5 pt-2 border-t border-vc-border">
                <div className="text-vc-text-secondary font-medium">Official References:</div>
                <div className="space-y-1">
                  {selectedFinding.references.map((url, idx) => (
                    <a
                      key={idx}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-vc-accent hover:text-vc-success text-[11px] break-all mr-4"
                    >
                      <span>{url}</span>
                      <ExternalLink size={11} />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatStageName(stage: string): string {
  switch (stage) {
    case "commit_resolution":
    case "scan_initialization":
      return "Commit & Branch Resolution";
    case "manifest_fetch":
      return "Manifest Retrieval (package.json / package-lock.json)";
    case "lockfile_parse":
      return "Lockfile Inventory Parsing";
    case "osv_query":
      return "OSV Vulnerability Batch Query";
    case "osv_hydration":
      return "OSV Advisory Hydration";
    case "gemini_enrichment":
      return "Gemini AI Enrichment";
    default:
      return stage.replace(/_/g, " ");
  }
}

function getActionableGuidance(code?: string, message?: string): React.ReactNode {
  const isRateLimit = code === "RATE_LIMITED" || message?.toLowerCase().includes("rate limit");
  if (isRateLimit) {
    return (
      <div className="text-[11px] text-vc-warning bg-vc-warning/15 border border-vc-warning/40 p-3 rounded-lg space-y-1">
        <strong className="text-vc-warning font-semibold">Actionable Resolution:</strong>
        <ul className="list-disc list-inside space-y-0.5 text-vc-text-primary">
          <li>
            Add a personal access token <code className="bg-vc-sidebar px-1 py-0.5 rounded font-mono text-vc-warning border border-vc-border">GITHUB_TOKEN=ghp_...</code> to <code className="bg-vc-sidebar px-1 py-0.5 rounded font-mono text-vc-warning border border-vc-border">.env.local</code> to increase your API limit from 60 to 5,000 requests/hour.
          </li>
          <li>
            Restart the application after configuring <code className="bg-vc-sidebar px-1 py-0.5 rounded font-mono text-vc-warning border border-vc-border">.env.local</code>.
          </li>
          <li>
            Alternatively, wait for the unauthenticated hourly rate limit window to reset.
          </li>
        </ul>
      </div>
    );
  }

  if (code === "FILE_NOT_FOUND" || message?.toLowerCase().includes("required file")) {
    return (
      <div className="text-[11px] text-vc-warning bg-vc-warning/15 border border-vc-warning/40 p-3 rounded-lg space-y-1">
        <strong className="text-vc-warning font-semibold">Actionable Resolution:</strong>
        <p className="text-vc-text-primary">
          Verify that <code className="bg-vc-sidebar px-1 py-0.5 rounded font-mono text-vc-warning border border-vc-border">package.json</code> and <code className="bg-vc-sidebar px-1 py-0.5 rounded font-mono text-vc-warning border border-vc-border">package-lock.json</code> exist at the project path. If this project lives in a subdirectory or monorepo workspace, set the relative project path in application settings.
        </p>
      </div>
    );
  }

  if (code === "UNSUPPORTED_LOCKFILE_VERSION") {
    return (
      <div className="text-[11px] text-vc-warning bg-vc-warning/15 border border-vc-warning/40 p-3 rounded-lg space-y-1">
        <strong className="text-vc-warning font-semibold">Actionable Resolution:</strong>
        <p className="text-vc-text-primary">
          Only npm <code className="bg-vc-sidebar px-1 py-0.5 rounded font-mono text-vc-warning border border-vc-border">package-lock.json</code> version 2 and 3 are supported. Run <code className="bg-vc-sidebar px-1 py-0.5 rounded font-mono text-vc-warning border border-vc-border">npm install</code> with npm 7+ to generate an updated lockfile.
        </p>
      </div>
    );
  }

  return null;
}
