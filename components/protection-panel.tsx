// components/protection-panel.tsx
// Compact Demo Protection Panel for Checkpoint 2
// Adheres strictly to the --color-vc-* dark palette and provides tested developer-approved containment.

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Play,
  CheckCircle2,
  XCircle,
  RotateCcw,
  RefreshCw,
  Clock,
  Sparkles,
  Lock,
} from "lucide-react";
import {
  ProtectionProposal,
  TestRun,
  RuntimeStatus,
  HistoryEntry,
} from "@/services/protection/types";

interface ProtectionPanelProps {
  applicationId: string;
  scanId?: string;
  onNotificationUpdate?: () => void;
  onStatusChange?: (status: {
    eligible: boolean;
    isRuleActive: boolean;
    controllerOnline: boolean;
  }) => void;
  onOpenLocalDemo?: () => void;
  isLocalDemo?: boolean;
  onTriggerScan?: () => void;
  isScanning?: boolean;
}

export default function ProtectionPanel({
  applicationId,
  scanId,
  onNotificationUpdate,
  onStatusChange,
  onOpenLocalDemo,
  isLocalDemo,
  onTriggerScan,
  isScanning,
}: ProtectionPanelProps) {
  const [loading, setLoading] = useState(true);
  const [eligible, setEligible] = useState<boolean>(false);
  const [ineligibleReason, setIneligibleReason] = useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Workflow state
  const [proposal, setProposal] = useState<ProtectionProposal | null>(null);
  const [testRun, setTestRun] = useState<TestRun | null>(null);
  const [acknowledged, setAcknowledged] = useState<boolean>(false);
  const [rollbackReason, setRollbackReason] = useState<string>("");

  // Operation loading & errors
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const url = `/api/protection/status?applicationId=${applicationId}${
        scanId ? `&scanId=${scanId}` : ""
      }`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setEligible(data.eligible);
      setIneligibleReason(data.reason || null);
      if (data.runtimeStatus) setRuntimeStatus(data.runtimeStatus);
      if (data.history) setHistory(data.history);

      if (onStatusChange) {
        onStatusChange({
          eligible: Boolean(data.eligible),
          isRuleActive: Boolean(data.runtimeStatus?.activeRule),
          controllerOnline: Boolean(data.runtimeStatus),
        });
      }
    } catch {
      // Ignore poll failures
    } finally {
      setLoading(false);
    }
  }, [applicationId, scanId, onStatusChange]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchStatus();
    }, 0);
    // Bounded poll every 5 seconds while mounted
    const interval = setInterval(fetchStatus, 5000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [fetchStatus]);

  const handlePropose = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setActionInProgress("proposing");
    try {
      const res = await fetch("/api/protection/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, scanId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to create proposal");
      }
      setProposal(data);
      setTestRun(null);
      setAcknowledged(false);
      setSuccessMessage("Containment proposal generated.");
      await fetchStatus();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRunTest = async () => {
    if (!proposal) return;
    setErrorMessage(null);
    setSuccessMessage(null);
    setActionInProgress("testing");
    try {
      const res = await fetch("/api/protection/tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId: proposal.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Isolated test failed");
      }
      setTestRun(data);
      if (data.status === "passed") {
        setSuccessMessage("Isolated candidate tests passed! Review evidence and acknowledge functionality loss.");
      } else {
        setErrorMessage(`Candidate test run ended with status '${data.status}'. Cannot approve.`);
      }
      await fetchStatus();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setActionInProgress(null);
    }
  };

  const handleApproveAndActivate = async () => {
    if (!proposal || !testRun) return;
    if (!acknowledged) {
      setErrorMessage("You must acknowledge preview functionality loss before activating.");
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    setActionInProgress("activating");

    try {
      // 1. Submit developer approval
      const appRes = await fetch("/api/protection/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalHash: proposal.proposalHash,
          testRunId: testRun.id,
          acknowledgedFunctionalityLoss: true,
          operatorNote: "Developer acknowledged preview functionality loss via console UI.",
        }),
      });
      const appData = await appRes.json();
      if (!appRes.ok) {
        throw new Error(appData.message || "Approval failed");
      }

      // 2. Activate rule on live proxy
      const actRes = await fetch("/api/protection/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId: appData.id }),
      });
      const actData = await actRes.json();
      if (!actRes.ok) {
        throw new Error(actData.message || "Activation failed");
      }

      setSuccessMessage("Temporary containment activated on forwarding proxy (127.0.0.1:8002)!");
      if (onNotificationUpdate) onNotificationUpdate();
      await fetchStatus();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRollback = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setActionInProgress("rolling_back");

    try {
      const res = await fetch("/api/protection/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rollbackReason.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Rollback failed");
      }
      setSuccessMessage("Containment rule rolled back. Preview route is now active again.");
      setRollbackReason("");
      if (onNotificationUpdate) onNotificationUpdate();
      await fetchStatus();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setActionInProgress(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-vc-card border border-vc-border rounded-xl p-4 text-xs text-vc-text-secondary flex items-center gap-2">
        <RefreshCw size={14} className="animate-spin text-vc-accent" />
        <span>Checking demo protection eligibility...</span>
      </div>
    );
  }

  // If application is not the demo scenario, render clear explanation, controller status, and setup guide
  if (!eligible) {
    const isControllerOnline = Boolean(runtimeStatus);
    const isTargetHealthy = runtimeStatus?.upstreamHealth?.healthy ?? false;

    return (
      <section className="bg-vc-card border border-vc-border rounded-xl p-5 space-y-5 shadow-sm text-xs">
        {/* Header and Scope Badge */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-vc-border pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldAlert size={18} className="text-vc-warning" />
              <h2 className="text-sm font-bold text-vc-text-primary">
                Demo Protection — Tested Route Containment
              </h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-vc-navigation-active text-vc-accent border border-vc-accent/30">
                Local demo — proxy traffic only
              </span>
            </div>
            <p className="text-vc-text-secondary text-[11px]">
              Temporary containment for demonstrated prototype pollution in <strong className="text-vc-text-primary">lodash@4.17.11</strong> via isolated proxy testing.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {onOpenLocalDemo && !isLocalDemo && (
              <button
                type="button"
                onClick={onOpenLocalDemo}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vc-accent hover:bg-vc-accent/80 text-white text-xs font-semibold shadow-xs transition-colors"
              >
                <Sparkles size={13} />
                <span>Open local protection demo</span>
              </button>
            )}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-vc-input text-vc-text-secondary border border-vc-border">
              <Shield size={12} className="text-vc-text-secondary/70" />
              <span>{isLocalDemo ? "Local Demo Needs Scan" : "Ineligible for This Repository"}</span>
            </span>
          </div>
        </div>

        {/* Ineligibility Reason Banner */}
        <div className="p-3.5 rounded-lg bg-vc-input/50 border border-vc-border space-y-2">
          <div className="flex items-center gap-2 font-semibold text-vc-text-primary">
            <AlertTriangle size={15} className="text-vc-warning shrink-0" />
            <span>
              {isLocalDemo
                ? "Scan Required to Bind Protection Demo"
                : "Target Repository Not Bound to Demo Scenario"}
            </span>
          </div>
          <p className="text-[11px] text-vc-text-secondary leading-relaxed pl-5">
            {isLocalDemo
              ? "The local demo context is open for 'examples/preview-settings-demo'. Run a factual scan of its actual package.json and package-lock.json to verify installed lodash@4.17.11 against OSV."
              : (ineligibleReason || "Protection is available only for the configured 'Preview Settings Demo' scenario (lodash@4.17.11 with GHSA-jf85-cpcp-j695). Arbitrary applications cannot bind protection rules.")}
          </p>
          {isLocalDemo && onTriggerScan && (
            <div className="pl-5 pt-1">
              <button
                type="button"
                onClick={onTriggerScan}
                disabled={isScanning}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-vc-primary hover:bg-vc-primary-hover text-xs font-bold text-vc-text-primary border border-vc-border shadow-xs transition-colors"
              >
                <RefreshCw size={13} className={isScanning ? "animate-spin text-vc-accent" : ""} />
                <span>{isScanning ? "Scanning Demo Dependencies..." : "Scan actual demo dependencies"}</span>
              </button>
            </div>
          )}
          {!isLocalDemo && onOpenLocalDemo && (
            <div className="pl-5 pt-1">
              <button
                type="button"
                onClick={onOpenLocalDemo}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vc-accent/20 hover:bg-vc-accent/30 text-vc-accent border border-vc-accent/40 text-xs font-semibold transition-colors"
              >
                <Sparkles size={13} />
                <span>Open local protection demo to evaluate runtime containment</span>
              </button>
            </div>
          )}
        </div>

        {/* Service Connections Status */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
          <div className="bg-vc-input/40 border border-vc-border rounded-lg p-3 space-y-1">
            <span className="text-vc-text-secondary block">Protection Controller (Port 8001):</span>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isControllerOnline ? "bg-vc-success" : "bg-vc-danger"}`} />
              <span className={`font-semibold ${isControllerOnline ? "text-vc-success" : "text-vc-danger"}`}>
                {isControllerOnline ? "Controller Online & Listening" : "Controller Offline"}
              </span>
            </div>
            <p className="text-[10px] text-vc-text-secondary/80">
              {isControllerOnline
                ? `Instance: ${runtimeStatus?.controllerInstanceId?.slice(0, 8)} • Revision #${runtimeStatus?.ruleRevision ?? 0}`
                : "Run 'npm run controller' in terminal to start controller."}
            </p>
          </div>

          <div className="bg-vc-input/40 border border-vc-border rounded-lg p-3 space-y-1">
            <span className="text-vc-text-secondary block">Upstream Demo Server (Port 8003):</span>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isTargetHealthy ? "bg-vc-success" : "bg-vc-text-secondary/50"}`} />
              <span className={`font-semibold ${isTargetHealthy ? "text-vc-success" : "text-vc-text-secondary"}`}>
                {isTargetHealthy ? "Demo Server Online" : "Demo Server Unreachable / Idle"}
              </span>
            </div>
            <p className="text-[10px] text-vc-text-secondary/80">
              {isTargetHealthy
                ? `Target Instance: ${runtimeStatus?.upstreamHealth?.targetInstanceId?.slice(0, 8) || "N/A"}`
                : "Run 'npm run demo' in terminal to launch isolated worker server."}
            </p>
          </div>
        </div>

        {/* Runbook: How to run the Demo Scenario */}
        <div className="bg-vc-input/30 border border-vc-border rounded-lg p-3.5 space-y-2 text-[11px]">
          <span className="font-semibold text-vc-text-primary block">
            How to Experience Checkpoint 2 Protection:
          </span>
          <ol className="list-decimal list-inside space-y-1 text-vc-text-secondary leading-relaxed">
            <li>
              Start the upstream vulnerable server: <code className="text-vc-text-primary font-mono bg-vc-input px-1.5 py-0.5 rounded">npm run demo</code> (listens on 8003).
            </li>
            <li>
              Start the protection controller and proxy: <code className="text-vc-text-primary font-mono bg-vc-input px-1.5 py-0.5 rounded">npm run controller</code> (proxy on 8002, API on 8001).
            </li>
            <li>
              Register or select the repository with project path <code className="text-vc-text-primary font-mono bg-vc-input px-1.5 py-0.5 rounded">examples/preview-settings-demo</code>.
            </li>
            <li>
              Return to this Protection tab to run ephemeral 5-step test verification, grant developer approval, activate route containment, and test rollback.
            </li>
          </ol>
        </div>

        {/* Audit History (if any exists in controller state) */}
        {history.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-vc-border/70">
            <span className="text-[11px] font-semibold text-vc-text-secondary block">
              Recent Controller Activity History:
            </span>
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {history.slice(0, 5).map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between p-2 rounded bg-vc-card/60 border border-vc-border text-[10px]"
                >
                  <div className="flex items-center gap-2 font-mono">
                    <span className="text-vc-accent font-semibold">{entry.type}</span>
                    <span className="text-vc-text-secondary truncate max-w-xs">
                      {JSON.stringify(entry.details)}
                    </span>
                  </div>
                  <span className="text-vc-text-secondary/70 shrink-0">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  const isRuleActive = Boolean(runtimeStatus?.activeRule);
  const isTargetHealthy = runtimeStatus?.upstreamHealth?.healthy ?? false;
  const isVerified = runtimeStatus?.lastVerification?.verified ?? false;

  return (
    <section className="bg-vc-card border border-vc-border rounded-xl p-5 space-y-5 shadow-sm text-xs">
      {/* Header and Scope Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-vc-border pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldAlert size={18} className="text-vc-warning" />
            <h2 className="text-sm font-bold text-vc-text-primary">
              Demo Protection — Tested Route Containment
            </h2>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-vc-navigation-active text-vc-accent border border-vc-accent/30">
              Local demo — proxy traffic only
            </span>
          </div>
          <p className="text-vc-text-secondary text-[11px]">
            Temporary containment for demonstrated prototype pollution in <strong className="text-vc-text-primary">lodash@4.17.11</strong> via isolated proxy testing.
          </p>
        </div>

        {/* Runtime State Pill */}
        <div className="flex items-center gap-2">
          {isRuleActive ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-vc-warning/15 text-vc-warning border border-vc-warning/40">
              <Lock size={12} />
              <span>Temporary Containment Active</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-vc-card border border-vc-border text-vc-text-secondary">
              <ShieldCheck size={12} className="text-vc-success" />
              <span>No Active Containment</span>
            </span>
          )}

          {isVerified && (
            <span className="px-2 py-1 rounded-md text-[10px] font-semibold bg-vc-success/15 text-vc-success border border-vc-success/30">
              Proxy Verified
            </span>
          )}
        </div>
      </div>

      {/* Target & Scanned Association Card */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-vc-card/60 border border-vc-border rounded-lg p-3 text-[11px]">
        <div>
          <span className="text-vc-text-secondary block">Advisory & CVE:</span>
          <span className="font-semibold text-vc-text-primary">GHSA-jf85-cpcp-j695</span>
          <span className="text-vc-text-secondary/70 block">CVE-2019-10744</span>
        </div>
        <div>
          <span className="text-vc-text-secondary block">Installed Package:</span>
          <span className="font-semibold text-vc-text-primary">lodash@4.17.11</span>
          <span className="text-vc-text-secondary/70 block">defaultsDeep</span>
        </div>
        <div>
          <span className="text-vc-text-secondary block">Demo Server (8003):</span>
          <span className={`font-semibold flex items-center gap-1 ${isTargetHealthy ? "text-vc-success" : "text-vc-danger"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isTargetHealthy ? "bg-vc-success" : "bg-vc-danger"}`} />
            {isTargetHealthy ? "Online" : "Unreachable"}
          </span>
          <span className="text-vc-text-secondary/70 block">
            ID: {runtimeStatus?.upstreamHealth?.targetInstanceId?.slice(0, 8) || "N/A"}
          </span>
        </div>
        <div>
          <span className="text-vc-text-secondary block">Forwarding Proxy (8002):</span>
          <span className="font-semibold text-vc-text-primary">
            {runtimeStatus?.blockedCount ?? 0} blocked requests
          </span>
          <span className="text-vc-text-secondary/70 block">
            Rev #{runtimeStatus?.ruleRevision ?? 0}
          </span>
        </div>
      </div>

      {/* Prominent Functionality Cost & Warning */}
      <div className="p-3 rounded-lg bg-vc-warning/10 border border-vc-warning/30 flex items-start gap-2.5">
        <AlertTriangle size={16} className="text-vc-warning shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-vc-warning text-xs">
            Notice of Functionality Loss:
          </div>
          <p className="text-[11px] text-vc-text-secondary leading-relaxed">
            Activating this containment rule disables <code className="text-vc-text-primary bg-vc-card px-1 py-0.5 rounded">POST /preview</code> with HTTP 503. All legitimate preview requests will fail until rollback. Unrelated routes (<code className="text-vc-text-primary bg-vc-card px-1 py-0.5 rounded">/health</code>, <code className="text-vc-text-primary bg-vc-card px-1 py-0.5 rounded">/catalog</code>) remain unaffected.
          </p>
        </div>
      </div>

      {/* Error and Success Banners */}
      {errorMessage && (
        <div className="p-3 rounded-lg bg-vc-danger/15 border border-vc-danger/40 text-vc-danger text-xs flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="underline text-[10px]">Dismiss</button>
        </div>
      )}
      {successMessage && (
        <div className="p-3 rounded-lg bg-vc-success/15 border border-vc-success/40 text-vc-success text-xs flex items-center justify-between">
          <span>{successMessage}</span>
          <button onClick={() => setSuccessMessage(null)} className="underline text-[10px]">Dismiss</button>
        </div>
      )}

      {/* Main Workflow Section */}
      {!isRuleActive ? (
        <div className="space-y-4 border border-vc-border rounded-lg p-4 bg-vc-card/40">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-vc-text-primary">Containment Rule Workflow</div>
              <p className="text-[11px] text-vc-text-secondary">
                Generate proposal → Execute isolated tests on ephemeral proxy → Acknowledge impact & Activate
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handlePropose}
                disabled={actionInProgress !== null || !isTargetHealthy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vc-card border border-vc-border hover:bg-vc-input text-vc-text-primary font-semibold text-xs disabled:opacity-50 transition-colors"
              >
                {actionInProgress === "proposing" ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <Sparkles size={13} className="text-vc-accent" />
                )}
                <span>Generate Proposal</span>
              </button>

              {proposal && (
                <button
                  onClick={handleRunTest}
                  disabled={actionInProgress !== null || !isTargetHealthy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vc-primary hover:bg-vc-primary-hover border border-vc-border text-vc-text-primary font-bold text-xs disabled:opacity-50 transition-colors shadow-sm"
                >
                  {actionInProgress === "testing" ? (
                    <RefreshCw size={13} className="animate-spin" />
                  ) : (
                    <Play size={13} />
                  )}
                  <span>Run Isolated Tests</span>
                </button>
              )}
            </div>
          </div>

          {/* Proposal Summary */}
          {proposal && (
            <div className="p-3 rounded-lg bg-vc-card border border-vc-border space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-vc-text-primary">Proposed Containment:</span>
                <span className="text-[10px] text-vc-text-secondary font-mono">
                  Hash: {proposal.proposalHash.slice(0, 12)}...
                </span>
              </div>
              <p className="text-vc-text-secondary text-[11px] leading-relaxed">
                {proposal.explanation}
              </p>
              <div className="flex items-center gap-2 text-[10px] text-vc-text-secondary">
                <span>Provenance:</span>
                <span className="px-1.5 py-0.5 rounded bg-vc-input border border-vc-border font-medium">
                  {proposal.aiStatus === "enriched" ? "Gemini Enriched" : "Deterministic Fallback"}
                </span>
              </div>
            </div>
          )}

          {/* Test Evidence Table */}
          {testRun && (
            <div className="space-y-2 border border-vc-border rounded-lg p-3 bg-vc-card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-vc-text-primary">Test Observations:</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    testRun.status === "passed"
                      ? "bg-vc-success/15 text-vc-success border border-vc-success/40"
                      : "bg-vc-danger/15 text-vc-danger border border-vc-danger/40"
                  }`}>
                    {testRun.status === "passed" ? "ALL CHECKS PASSED (9/9)" : `STATUS: ${testRun.status.toUpperCase()}`}
                  </span>
                </div>
                <span className="text-[10px] text-vc-text-secondary flex items-center gap-1">
                  <Clock size={11} />
                  <span>Valid for 15 minutes</span>
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead>
                    <tr className="border-b border-vc-border text-vc-text-secondary">
                      <th className="py-1.5 pr-2">Observation Stage</th>
                      <th className="py-1.5 px-2">Endpoint</th>
                      <th className="py-1.5 px-2">Expected</th>
                      <th className="py-1.5 px-2">Actual</th>
                      <th className="py-1.5 px-2">Marker / Delta</th>
                      <th className="py-1.5 pl-2 text-right">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-vc-border/50">
                    {testRun.observations.map((obs, idx) => (
                      <tr key={idx} className="hover:bg-vc-card/60">
                        <td className="py-1.5 pr-2 font-mono text-[10px] text-vc-text-primary">{obs.name}</td>
                        <td className="py-1.5 px-2 font-mono text-[10px]">{obs.method} {obs.endpoint}</td>
                        <td className="py-1.5 px-2 font-mono text-[10px]">{obs.expectedStatus}</td>
                        <td className="py-1.5 px-2 font-mono text-[10px]">{obs.actualStatus}</td>
                        <td className="py-1.5 px-2 font-mono text-[10px] text-vc-text-secondary">
                          {obs.observedMarker ? `marker=${obs.observedMarker.slice(0, 10)}...` : `delta=${obs.upstreamCounterDelta}`}
                        </td>
                        <td className="py-1.5 pl-2 text-right">
                          {obs.passed ? (
                            <span className="text-vc-success font-bold flex items-center justify-end gap-1">
                              <CheckCircle2 size={12} /> Pass
                            </span>
                          ) : (
                            <span className="text-vc-danger font-bold flex items-center justify-end gap-1">
                              <XCircle size={12} /> Fail
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Developer Approval & Activation Checkbox */}
              {testRun.status === "passed" && (
                <div className="pt-3 border-t border-vc-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                      className="rounded border-vc-border text-vc-accent focus:ring-0"
                    />
                    <span className="text-[11px] text-vc-text-primary font-medium">
                      I understand that preview requests will be unavailable until rollback.
                    </span>
                  </label>

                  <button
                    onClick={handleApproveAndActivate}
                    disabled={!acknowledged || actionInProgress !== null}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-vc-warning hover:bg-vc-warning-hover disabled:opacity-50 text-vc-sidebar font-bold text-xs transition-colors shadow-sm"
                  >
                    {actionInProgress === "activating" ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Lock size={14} />
                    )}
                    <span>Approve & Activate Protection</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Rollback Section when Rule is Active */
        <div className="space-y-4 border border-vc-warning/30 rounded-lg p-4 bg-vc-warning/5">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="font-bold text-vc-warning text-xs">Active Containment: /preview is Disabled</span>
              <p className="text-[11px] text-vc-text-secondary">
                Traffic through port 8002 to /preview is returning HTTP 503. Other endpoints are unaffected.
              </p>
            </div>
            <span className="text-[10px] text-vc-text-secondary font-mono">
              Activated at: {runtimeStatus?.activatedAt ? new Date(runtimeStatus.activatedAt).toLocaleTimeString() : "N/A"}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2">
            <input
              type="text"
              placeholder="Rollback reason (e.g. upstream library patched)"
              value={rollbackReason}
              onChange={(e) => setRollbackReason(e.target.value)}
              className="flex-1 bg-vc-input border border-vc-border rounded-lg px-3 py-1.5 text-xs text-vc-text-primary focus:outline-none focus:border-vc-accent"
            />
            <button
              onClick={handleRollback}
              disabled={actionInProgress !== null}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg bg-vc-card border border-vc-border hover:bg-vc-input text-vc-text-primary font-bold text-xs disabled:opacity-50 transition-colors shadow-sm"
            >
              {actionInProgress === "rolling_back" ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <RotateCcw size={13} className="text-vc-warning" />
              )}
              <span>Rollback Route Containment</span>
            </button>
          </div>
          <p className="text-[10px] text-vc-text-secondary/70 italic">
            * Note: Rollback restores normal preview functionality. The underlying vulnerable lodash dependency remains until updated.
          </p>
        </div>
      )}

      {/* Audit History (Collapsible or Bounded) */}
      {history.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-vc-border/70">
          <span className="text-[11px] font-semibold text-vc-text-secondary block">
            Recent Controller Activity History:
          </span>
          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
            {history.slice(0, 5).map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between p-2 rounded bg-vc-card/60 border border-vc-border text-[10px]"
              >
                <div className="flex items-center gap-2 font-mono">
                  <span className="text-vc-accent font-semibold">{entry.type}</span>
                  <span className="text-vc-text-secondary truncate max-w-xs">
                    {JSON.stringify(entry.details)}
                  </span>
                </div>
                <span className="text-vc-text-secondary/70 shrink-0">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
