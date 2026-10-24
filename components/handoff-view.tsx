// components/handoff-view.tsx
// Dedicated Agent Handoff tab view.
// Provides grounded, non-mutating exportable instructions and structured JSON for coding agents.

"use client";

import { useState, useEffect } from "react";
import { Application, ScanReport } from "@/lib/contracts";
import { RemediationHandoff } from "@/lib/handoff";
import {
  Bot,
  Check,
  Copy,
  Download,
  FileCode,
  Info,
  Lock,
  RefreshCw,
} from "lucide-react";

interface HandoffViewProps {
  report: ScanReport;
  application: Application;
}

export default function HandoffView({ report, application }: HandoffViewProps) {
  const [handoff, setHandoff] = useState<RemediationHandoff | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/reports/${report.id}/handoff`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.ok && json.data) {
          setHandoff(json.data);
          setMarkdown(json.markdown || null);
          setError(null);
        } else {
          setError(json.error?.message || "Failed to generate remediation handoff");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load handoff");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [report.id]);

  const handleCopyMarkdown = async () => {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="space-y-5 text-xs text-vc-text-primary">
      {/* Header and Non-Mutating Explanatory Notice */}
      <div className="bg-vc-card border border-vc-border rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-vc-border pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Bot size={18} className="text-vc-accent" />
              <h2 className="text-sm font-bold text-vc-text-primary">
                Remediation Handoff for Coding Agent
              </h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-vc-navigation-active text-vc-accent border border-vc-accent/30">
                Grounded & Non-Mutating
              </span>
            </div>
            <p className="text-vc-text-secondary text-[11px] leading-relaxed">
              Export factual scan evidence and verified dependency guidance directly into prompt-ready Markdown or structured JSON for an autonomous coding agent.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleCopyMarkdown}
              disabled={!markdown || loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vc-accent text-vc-sidebar hover:bg-vc-accent/90 disabled:opacity-50 text-xs font-bold transition-colors shadow-xs"
              title="Copy complete markdown prompt to clipboard"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? "Copied Prompt!" : "Copy Agent Prompt"}</span>
            </button>

            <a
              href={`/api/reports/${report.id}/handoff?format=markdown`}
              download
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vc-input hover:bg-vc-border text-xs font-semibold text-vc-text-primary border border-vc-border transition-colors shadow-xs"
            >
              <Download size={13} />
              <span>Download .md</span>
            </a>

            <a
              href={`/api/reports/${report.id}/handoff?format=json`}
              download
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vc-input hover:bg-vc-border text-xs font-semibold text-vc-text-primary border border-vc-border transition-colors shadow-xs"
            >
              <Download size={13} />
              <span>Download .json</span>
            </a>
          </div>
        </div>

        {/* Clear non-mutating guarantee callout */}
        <div className="p-3 rounded-lg bg-vc-input/60 border border-vc-border text-[11px] text-vc-text-secondary flex items-start gap-2.5">
          <Info size={16} className="text-vc-accent shrink-0 mt-0.5" />
          <div className="space-y-0.5 leading-relaxed">
            <strong className="text-vc-text-primary font-semibold">Non-Mutating Operation Guarantee: </strong>
            Generating or downloading a handoff builds a grounded remediation plan directly from the immutable scan report. It does <em>not</em> modify repository source files, run dependency bumps, trigger fresh scans, or mark findings as fixed.
          </div>
        </div>

        {/* Grounded Summary Cards */}
        {handoff && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-[11px]">
            <div className="bg-vc-input/40 border border-vc-border/80 rounded-lg p-2.5">
              <span className="text-vc-text-secondary block">Scanned Target:</span>
              <span className="font-semibold text-vc-text-primary truncate block" title={handoff.target.canonicalRepoUrl}>
                {application.displayName}
              </span>
              <code className="text-vc-text-secondary/80 font-mono text-[10px]">
                {handoff.target.resolvedCommitSha?.slice(0, 7) || "HEAD"}
              </code>
            </div>

            <div className="bg-vc-input/40 border border-vc-border/80 rounded-lg p-2.5">
              <span className="text-vc-text-secondary block">Findings to Address:</span>
              <span className="font-bold text-vc-text-primary text-sm">
                {handoff.summary.totalFindings}
              </span>
              <span className="text-vc-text-secondary/80 block text-[10px]">
                {handoff.summary.critical} crit • {handoff.summary.high} high • {handoff.summary.medium} med
              </span>
            </div>

            <div className="bg-vc-input/40 border border-vc-border/80 rounded-lg p-2.5">
              <span className="text-vc-text-secondary block">Fix Availability:</span>
              <span className="font-semibold text-vc-success block">
                {handoff.summary.fixListedCount} fix listed
              </span>
              <span className="text-vc-warning block text-[10px]">
                {handoff.summary.noFixListedCount} unpatched (no fix)
              </span>
            </div>

            <div className="bg-vc-input/40 border border-vc-border/80 rounded-lg p-2.5">
              <span className="text-vc-text-secondary block">Dependency Guidance:</span>
              <span className="font-semibold text-vc-text-primary block">
                {handoff.summary.directCount} direct • {handoff.summary.transitiveCount} transitive
              </span>
              <span className="text-vc-text-secondary/80 block text-[10px]">
                Source-backed advice
              </span>
            </div>
          </div>
        )}

        {/* Protection evidence snapshot notice if demo active */}
        {handoff?.containmentEvidence.hasProtectionEvidence && (
          <div className="p-2.5 rounded-lg bg-vc-warning/10 border border-vc-warning/30 flex items-start gap-2 text-[11px]">
            <Lock size={14} className="text-vc-warning shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-bold text-vc-warning">Temporary Loopback Containment Snapshot Attached: </span>
              <p className="text-vc-text-secondary">
                {handoff.containmentEvidence.disclaimer}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Monospace Preview Section */}
      <div className="bg-vc-card border border-vc-border rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileCode size={15} className="text-vc-accent" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-vc-text-secondary">
              Coding Agent Instructions Preview
            </h3>
          </div>
          <span className="text-[10px] text-vc-text-secondary font-mono">
            Format: Markdown (.md)
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-vc-text-secondary flex items-center justify-center gap-2">
            <RefreshCw size={14} className="animate-spin text-vc-accent" />
            <span>Building grounded remediation handoff...</span>
          </div>
        ) : error ? (
          <div className="p-4 rounded-lg bg-vc-danger/15 border border-vc-danger/40 text-vc-danger">
            {error}
          </div>
        ) : markdown ? (
          <div className="relative">
            <pre className="bg-vc-input p-4 rounded-xl border border-vc-border font-mono text-[11px] text-vc-text-primary overflow-x-auto max-h-[520px] leading-relaxed whitespace-pre-wrap select-all">
              {markdown}
            </pre>
          </div>
        ) : (
          <div className="p-8 text-center text-vc-text-secondary italic">
            No handoff generated.
          </div>
        )}
      </div>
    </div>
  );
}
