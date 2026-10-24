'use client';

import { useState } from "react";
import { CommunityAssessment } from "@/lib/contracts";
import { AlertCircle, Sparkles } from "lucide-react";

interface CommunityReportFormProps {
  applicationId: string;
  signals: CommunityAssessment[];
  onSignalAdded: (signal: CommunityAssessment) => void;
}

export default function CommunityReportForm({
  applicationId,
  signals,
  onSignalAdded,
}: CommunityReportFormProps) {
  const [pastedText, setPastedText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (pastedText.trim().length < 10) {
      setError("Please paste report text (minimum 10 characters).");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/community-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId,
          pastedText: pastedText.trim(),
          sourceUrl: sourceUrl.trim() || null,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message || "Failed to analyze community report");
      }

      onSignalAdded(json.data);
      setPastedText("");
      setSourceUrl("");
    } catch (err) {
      setError((err as Error).message || "An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-vc-card border border-vc-border rounded-xl p-6 text-vc-text-primary space-y-6">
      <div className="flex items-start justify-between gap-4 border-b border-vc-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-vc-text-primary">Manual Early-Warning Signal Analysis</h3>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-vc-warning/15 text-vc-warning border border-vc-warning/40 uppercase tracking-wider">
              Unverified Signal
            </span>
          </div>
          <p className="text-xs text-vc-text-secondary mt-1">
            Paste informal security disclosures or community bug reports to evaluate potential relevance against your scanned inventory.
          </p>
        </div>
      </div>

      {/* Mandatory Disclaimer */}
      <div className="p-3 rounded-lg bg-vc-warning/15 border border-vc-warning/40 text-xs text-vc-warning flex items-start gap-2">
        <AlertCircle size={15} className="shrink-0 mt-0.5 text-vc-warning" />
        <div className="text-vc-text-primary">
          <span className="font-semibold text-vc-warning">Attribution Notice: </span>
          Source text is supplied by the developer; source is not independently verified or fetched. The URL is recorded as citation attribution only.
        </div>
      </div>

      {/* Submission Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-vc-danger/15 border border-vc-danger/40 text-xs text-vc-danger">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-vc-text-primary mb-1">
            Report Text / Community Excerpt <span className="text-vc-danger">*</span>
          </label>
          <textarea
            rows={4}
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            maxLength={12000}
            placeholder="Paste discussion, issue report, or advisory text here (max 12,000 characters)..."
            className="w-full p-3 bg-vc-input border border-vc-border rounded-lg text-xs text-vc-text-primary placeholder:text-vc-text-secondary/60 focus:outline-none focus:border-vc-accent font-mono"
            required
          />
          <div className="text-[10px] text-vc-text-secondary/70 text-right mt-0.5">
            {pastedText.length} / 12,000 characters
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-vc-text-primary mb-1">
            Source Link / Discussion URL (Optional Attribution)
          </label>
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://github.com/.../issues/123 or https://reddit.com/..."
            className="w-full px-3 py-2 bg-vc-input border border-vc-border rounded-lg text-xs text-vc-text-primary placeholder:text-vc-text-secondary/60 focus:outline-none focus:border-vc-accent"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !pastedText.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-vc-primary hover:bg-vc-primary-hover disabled:opacity-50 text-xs font-semibold text-vc-text-primary border border-vc-border shadow-sm transition-colors"
        >
          {isSubmitting ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-vc-text-primary/30 border-t-vc-text-primary rounded-full animate-spin" />
              <span>Analyzing Signal...</span>
            </>
          ) : (
            <>
              <Sparkles size={14} />
              <span>Analyze Signal</span>
            </>
          )}
        </button>
      </form>

      {/* Existing Signals List */}
      <div className="pt-4 border-t border-vc-border space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-vc-text-secondary">
          Recorded Signals ({signals.length})
        </h4>

        {signals.length === 0 ? (
          <p className="text-xs text-vc-text-secondary/70 italic">No community signals recorded yet for this application.</p>
        ) : (
          <div className="space-y-3">
            {signals.map((sig) => (
              <div
                key={sig.id}
                className="p-4 rounded-xl bg-vc-input border border-vc-border text-xs space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2 border-b border-vc-border pb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        sig.possibleMatch
                          ? "bg-vc-warning/15 text-vc-warning border border-vc-warning/40"
                          : "bg-vc-card text-vc-text-secondary border border-vc-border"
                      }`}
                    >
                      {sig.possibleMatch ? "Potential Inventory Match" : "No Match in Scanned Inventory"}
                    </span>
                    <span className="text-[11px] text-vc-text-secondary font-mono">
                      {new Date(sig.createdAt).toLocaleString()}
                    </span>
                  </div>

                  <span className="text-[10px] text-vc-text-secondary/70 uppercase font-mono">
                    AI: {sig.aiStatus}
                  </span>
                </div>

                {sig.claimedPackage && (
                  <div className="text-xs">
                    <span className="text-vc-text-secondary">Claimed Package: </span>
                    <code className="text-vc-text-primary font-bold">{sig.claimedPackage}</code>
                    {sig.claimedAffectedRange && (
                      <span className="text-vc-text-secondary"> (Range: <code className="text-vc-warning">{sig.claimedAffectedRange}</code>)</span>
                    )}
                  </div>
                )}

                {sig.matchedInstalledEntries.length > 0 && (
                  <div className="p-2.5 rounded-lg bg-vc-sidebar border border-vc-warning/30 text-[11px] space-y-1">
                    <div className="font-semibold text-vc-warning">Installed Instances Found:</div>
                    <ul className="list-disc list-inside space-y-0.5 text-vc-text-primary font-mono text-[10px]">
                      {sig.matchedInstalledEntries.map((m, idx) => (
                        <li key={idx}>
                          {m.name}@{m.version} ({m.direct ? "direct" : "transitive"})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="text-vc-text-primary text-xs leading-relaxed">
                  <strong className="text-vc-text-secondary">Analysis:</strong> {sig.explanation}
                </div>

                {sig.missingEvidence && (
                  <div className="text-[11px] text-vc-text-secondary">
                    <strong className="text-vc-text-secondary/80">Missing Evidence:</strong> {sig.missingEvidence}
                  </div>
                )}

                {sig.sourceUrl && (
                  <div className="text-[11px] pt-1">
                    <span className="text-vc-text-secondary/70">Source Attribution: </span>
                    <a
                      href={sig.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-vc-accent hover:underline"
                    >
                      {sig.sourceUrl}
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
