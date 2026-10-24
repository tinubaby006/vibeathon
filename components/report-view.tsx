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
  Download,
  ExternalLink,
  Filter,
  Info,
  Search,
  Sparkles,
  X,
} from "lucide-react";

interface ReportViewProps {
  report: ScanReport;
  onRefresh?: () => void;
}

export default function ReportView({ report }: ReportViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);

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

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-white">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-800 pb-4 mb-6">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold tracking-tight">
                {report.applicationSnapshot.displayName}
              </h2>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                  report.status === "complete"
                    ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                    : report.status === "partial"
                    ? "bg-amber-950 text-amber-400 border border-amber-800"
                    : "bg-red-950 text-red-400 border border-red-800"
                }`}
              >
                Scan {report.status}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Checked at {new Date(report.completedAt).toLocaleString()} • Target SHA:{" "}
              {report.resolvedCommitSha ? (
                <code className="text-gray-200 font-mono font-medium">
                  {report.resolvedCommitSha.substring(0, 7)}
                </code>
              ) : report.status === "failed" ? (
                <span className="text-amber-400/90 font-mono text-[11px]">
                  N/A (Resolution Failed)
                </span>
              ) : (
                <code className="text-gray-400 font-mono">N/A</code>
              )}
            </p>
          </div>

          {/* Action Download Buttons */}
          <div className="flex items-center gap-2">
            <a
              href={`/api/reports/${report.id}?format=markdown`}
              download
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs font-medium text-gray-200 border border-gray-700 transition-colors"
            >
              <Download size={13} />
              <span>Markdown</span>
            </a>
            <a
              href={`/api/reports/${report.id}?format=json`}
              download
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs font-medium text-gray-200 border border-gray-700 transition-colors"
            >
              <Download size={13} />
              <span>JSON</span>
            </a>
          </div>
        </div>

        {/* Coverage and Stats Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-gray-800/60 rounded-lg p-3 border border-gray-700/50">
            <div className="text-xs text-gray-400">Total Findings</div>
            <div className="text-2xl font-bold text-white mt-1">
              {report.findings.length}
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              {severityCounts.critical} critical • {severityCounts.high} high
            </div>
          </div>

          <div className="bg-gray-800/60 rounded-lg p-3 border border-gray-700/50">
            <div className="text-xs text-gray-400">Dependencies Queried</div>
            <div className="text-2xl font-bold text-white mt-1">
              {report.coverage.queriedPairs}
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              {report.coverage.uniqueQueryablePairs} unique npm pairs
            </div>
          </div>

          <div className="bg-gray-800/60 rounded-lg p-3 border border-gray-700/50">
            <div className="text-xs text-gray-400">Exclusions / Failed</div>
            <div className="text-2xl font-bold text-amber-400 mt-1">
              {report.coverage.excludedEntries + report.coverage.failedPairs}
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              {report.coverage.excludedEntries} excluded • {report.coverage.failedPairs} failed
            </div>
          </div>

          <div className="bg-gray-800/60 rounded-lg p-3 border border-gray-700/50">
            <div className="text-xs text-gray-400">AI Status</div>
            <div className="text-lg font-bold text-white mt-1 capitalize flex items-center gap-1.5">
              <Sparkles size={16} className="text-blue-400" />
              <span>{report.aiStatus}</span>
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              {report.aiSummary ? "Enriched explanations" : "Deterministic fallback"}
            </div>
          </div>
        </div>

        {/* Scan Failure Details Banner */}
        {report.status === "failed" && (
          <div className="mt-4 p-4 rounded-xl bg-red-950/40 border border-red-800/80 text-xs text-red-200 space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-red-900/60 pb-2.5">
              <div className="flex items-center gap-2">
                <AlertOctagon size={18} className="text-red-400 shrink-0" />
                <span className="text-sm font-bold text-white tracking-wide">
                  Scan Failed: Assessment Incomplete
                </span>
              </div>
              {report.providerFailures[0]?.code && (
                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-red-900/60 border border-red-700/80 text-red-300">
                  {report.providerFailures[0].code}
                </span>
              )}
            </div>

            {report.providerFailures.map((failure, idx) => (
              <div key={idx} className="space-y-2">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-red-400 font-semibold uppercase tracking-wider text-[10px]">
                    Failed Stage:
                  </span>
                  <code className="font-mono text-white bg-red-900/60 px-2 py-0.5 rounded border border-red-700/60 font-semibold">
                    {formatStageName(failure.stage)}
                  </code>
                  {failure.retryable && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800 ml-auto font-medium">
                      Retryable
                    </span>
                  )}
                </div>

                <div className="text-xs text-red-100 leading-relaxed bg-red-950/60 p-3 rounded-lg border border-red-900/40">
                  <strong className="text-red-300">Sanitized Reason: </strong>
                  {sanitizeFailureMessage(failure.message)}
                </div>

                {getActionableGuidance(failure.code, failure.message)}
              </div>
            ))}
          </div>
        )}

        {/* Partial Warning Banner */}
        {report.status === "partial" && report.providerFailures.length > 0 && (
          <div className="mt-4 p-3 rounded-lg bg-amber-950/40 border border-amber-900/60 text-xs text-amber-200 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-amber-300">
              <AlertTriangle size={15} />
              <span>Partial Coverage Notice: Some upstream lookups were incomplete</span>
            </div>
            {report.providerFailures.map((failure, idx) => (
              <div key={idx} className="text-[11px] text-amber-100/90 pl-5">
                • <strong>{formatStageName(failure.stage)}:</strong> {sanitizeFailureMessage(failure.message)}
              </div>
            ))}
          </div>
        )}

        {/* Assessment Boundary Warning */}
        <div className="mt-4 p-3 rounded-lg bg-blue-950/40 border border-blue-900/60 text-xs text-blue-300 flex items-start gap-2">
          <Info size={16} className="text-blue-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-blue-200">Assessment Scope: </span>
            {report.assessmentBoundary}
          </div>
        </div>

        {/* AI Summary Banner if present */}
        {report.aiSummary && (
          <div className="mt-3 p-3 rounded-lg bg-gray-800/80 border border-gray-700 text-xs text-gray-300 flex items-start gap-2">
            <Sparkles size={16} className="text-blue-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-white">AI Assessment Summary: </span>
              {report.aiSummary}
            </div>
          </div>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-gray-900/60 border border-gray-800 p-3 rounded-xl">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by package name, advisory ID (e.g. GHSA-xxx, CVE-xxx)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter size={14} className="text-gray-400" />
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
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

      {/* Findings Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {filteredFindings.length === 0 ? (
          <div className="p-12 text-center">
            {report.status === "failed" ? (
              <div className="space-y-2.5 max-w-md mx-auto">
                <AlertOctagon size={36} className="mx-auto text-red-400" />
                <h3 className="text-base font-semibold text-white">Scan Terminated Early</h3>
                <p className="text-xs text-gray-300 leading-relaxed">
                  Dependency evaluation was aborted due to upstream failure at stage{" "}
                  <code className="font-mono text-red-300 bg-gray-800 px-1.5 py-0.5 rounded font-semibold">
                    {formatStageName(report.providerFailures[0]?.stage || "unknown")}
                  </code>
                  . Check the diagnostic panel above for sanitized error details and resolution steps.
                </p>
              </div>
            ) : report.findings.length === 0 ? (
              <div className="space-y-2">
                <CheckCircle2 size={36} className="mx-auto text-emerald-400" />
                <h3 className="text-base font-semibold text-white">No Known Advisories Matched</h3>
                <p className="text-xs text-gray-400 max-w-md mx-auto">
                  {report.status === "partial"
                    ? "Zero matches were found in queried dependencies, but some entries could not be queried or hydrated. Assessment remains partial."
                    : `OSV returned zero matching security advisories for the ${report.coverage.queriedPairs} queried npm packages at the time of scan. This does not prove the application is completely secure.`}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Info size={32} className="mx-auto text-gray-400" />
                <h3 className="text-sm font-semibold text-white">No Findings Match Filter</h3>
                <p className="text-xs text-gray-400">
                  Try adjusting your search query or severity filter.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-800/80 text-gray-400 font-semibold uppercase tracking-wider text-[10px] border-b border-gray-800">
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
              <tbody className="divide-y divide-gray-800/60 text-gray-300">
                {filteredFindings.map((finding) => (
                  <tr
                    key={finding.findingKey}
                    onClick={() => setSelectedFinding(finding)}
                    className="hover:bg-gray-800/50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 font-mono font-medium text-white">
                      {finding.packageName}
                    </td>
                    <td className="py-3 px-4 font-mono text-gray-300">
                      {finding.version}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
                          finding.severity === "critical"
                            ? "bg-red-950 text-red-400 border border-red-800"
                            : finding.severity === "high"
                            ? "bg-orange-950 text-orange-400 border border-orange-800"
                            : finding.severity === "medium"
                            ? "bg-amber-950 text-amber-400 border border-amber-800"
                            : finding.severity === "low"
                            ? "bg-blue-950 text-blue-400 border border-blue-800"
                            : "bg-gray-800 text-gray-400 border border-gray-700"
                        }`}
                      >
                        {finding.severity}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-blue-400">
                      {finding.advisoryId}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          finding.patchStatus === "fix_listed"
                            ? "text-emerald-400 bg-emerald-950/60 border border-emerald-900"
                            : finding.patchStatus === "no_fix_listed"
                            ? "text-rose-400 bg-rose-950/60 border border-rose-900"
                            : "text-gray-400 bg-gray-800"
                        }`}
                      >
                        {finding.patchStatus.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-gray-400">
                      {finding.fixedVersionsListed.length > 0
                        ? finding.fixedVersionsListed.join(", ")
                        : "None"}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button className="text-xs text-blue-400 hover:text-blue-300 font-medium">
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

      {/* Finding Detail Modal */}
      {selectedFinding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl p-6 text-white space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-gray-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold">
                    {selectedFinding.packageName}@{selectedFinding.version}
                  </h3>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${
                      selectedFinding.severity === "critical"
                        ? "bg-red-950 text-red-400 border border-red-800"
                        : selectedFinding.severity === "high"
                        ? "bg-orange-950 text-orange-400 border border-orange-800"
                        : selectedFinding.severity === "medium"
                        ? "bg-amber-950 text-amber-400 border border-amber-800"
                        : "bg-blue-950 text-blue-400 border border-blue-800"
                    }`}
                  >
                    {selectedFinding.severity}
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  Canonical ID: <code className="text-blue-400">{selectedFinding.advisoryId}</code> • Source: {selectedFinding.severitySource || "OSV"}
                </div>
              </div>
              <button
                onClick={() => setSelectedFinding(null)}
                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Title & Description */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-gray-200">{selectedFinding.title}</h4>
              <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap bg-gray-950 p-3 rounded-lg border border-gray-800">
                {selectedFinding.description}
              </p>
            </div>

            {/* Evidence & Paths */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700/60">
                <div className="text-gray-400 text-[11px] font-medium">Affected Version Range</div>
                <div className="font-mono text-gray-200 mt-1">
                  {selectedFinding.affectedVersionEvidence}
                </div>
              </div>

              <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700/60">
                <div className="text-gray-400 text-[11px] font-medium">Candidate Fixes (Advisory-Specific)</div>
                <div className="font-mono text-emerald-400 mt-1">
                  {selectedFinding.fixedVersionsListed.length > 0
                    ? selectedFinding.fixedVersionsListed.join(", ")
                    : "No fix listed"}
                </div>
                <p className="text-[10px] text-gray-500 mt-1">
                  Candidate versions listed in advisory; not verified as universally safe or compatible across other dependencies.
                </p>
              </div>
            </div>

            {/* Installed Paths */}
            <div className="text-xs space-y-1">
              <div className="text-gray-400 font-medium">Installed Locations:</div>
              <div className="space-y-1">
                {selectedFinding.dependencyPaths.map((p, idx) => (
                  <div key={idx} className="font-mono text-[11px] bg-gray-950 px-2 py-1 rounded text-gray-300 border border-gray-800">
                    {p}
                  </div>
                ))}
              </div>
            </div>

            {/* AI Explanation if available */}
            {selectedFinding.aiExplanation && (
              <div className="p-3.5 rounded-xl bg-blue-950/30 border border-blue-900/60 text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-blue-300">
                  <Sparkles size={14} />
                  <span>AI Investigation & Explanation</span>
                </div>
                <p className="text-blue-100/90 leading-relaxed italic">
                  &ldquo;{selectedFinding.aiExplanation}&rdquo;
                </p>
              </div>
            )}

            {/* Proposed Recommendations */}
            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-gray-300 uppercase tracking-wider text-[11px]">
                Proposed Recommendations (Assessment Only)
              </div>
              <div className="space-y-2">
                {selectedFinding.recommendations.map((rec, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-xl bg-gray-800/70 border border-gray-700 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">{rec.action}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-300 font-mono uppercase">
                        {rec.origin}
                      </span>
                    </div>
                    <p className="text-gray-300 text-[11px] leading-relaxed">
                      <strong className="text-gray-400">Rationale:</strong> {rec.rationale}
                    </p>
                    <p className="text-gray-400 text-[11px]">
                      <strong className="text-gray-400">Potential Impact:</strong> {rec.potentialImpact}
                    </p>
                    {rec.limitations && (
                      <p className="text-amber-400/90 text-[10px]">
                        <strong>Limitations:</strong> {rec.limitations}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* References */}
            {selectedFinding.references.length > 0 && (
              <div className="text-xs space-y-1.5 pt-2 border-t border-gray-800">
                <div className="text-gray-400 font-medium">Official References:</div>
                <div className="space-y-1">
                  {selectedFinding.references.map((url, idx) => (
                    <a
                      key={idx}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 text-[11px] break-all mr-4"
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
      <div className="text-[11px] text-amber-200/90 bg-amber-950/40 border border-amber-900/60 p-3 rounded-lg space-y-1">
        <strong className="text-amber-300">Actionable Resolution:</strong>
        <ul className="list-disc list-inside space-y-0.5 text-amber-100/80">
          <li>
            Add a personal access token <code className="bg-black/50 px-1 py-0.5 rounded font-mono text-amber-200">GITHUB_TOKEN=ghp_...</code> to <code className="bg-black/50 px-1 py-0.5 rounded font-mono text-amber-200">.env.local</code> to increase your API limit from 60 to 5,000 requests/hour.
          </li>
          <li>
            Restart the application after configuring <code className="bg-black/50 px-1 py-0.5 rounded font-mono text-amber-200">.env.local</code>.
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
      <div className="text-[11px] text-amber-200/90 bg-amber-950/40 border border-amber-900/60 p-3 rounded-lg space-y-1">
        <strong className="text-amber-300">Actionable Resolution:</strong>
        <p className="text-amber-100/80">
          Verify that <code className="bg-black/50 px-1 py-0.5 rounded font-mono text-amber-200">package.json</code> and <code className="bg-black/50 px-1 py-0.5 rounded font-mono text-amber-200">package-lock.json</code> exist at the project path. If this project lives in a subdirectory or monorepo workspace, set the relative project path in application settings.
        </p>
      </div>
    );
  }

  if (code === "UNSUPPORTED_LOCKFILE_VERSION") {
    return (
      <div className="text-[11px] text-amber-200/90 bg-amber-950/40 border border-amber-900/60 p-3 rounded-lg space-y-1">
        <strong className="text-amber-300">Actionable Resolution:</strong>
        <p className="text-amber-100/80">
          Only npm <code className="bg-black/50 px-1 py-0.5 rounded font-mono text-amber-200">package-lock.json</code> version 2 and 3 are supported. Run <code className="bg-black/50 px-1 py-0.5 rounded font-mono text-amber-200">npm install</code> with npm 7+ to generate an updated lockfile.
        </p>
      </div>
    );
  }

  return null;
}

