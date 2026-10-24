'use client';

import { useState, useEffect } from "react";
import {
  Application,
  CommunityAssessment,
  Notification,
  ScanReport,
} from "@/lib/contracts";
import ReportView from "./report-view";
import CommunityReportForm from "./community-report-form";
import {
  Bell,
  ExternalLink,
  Layers,
  Plus,
  RefreshCw,
  Shield,
  X,
} from "lucide-react";

interface ConsoleProps {
  initialApplications: Application[];
  initialNotifications: Notification[];
  integrations: {
    githubTokenConfigured: boolean;
    geminiConfigured: boolean;
    emailConfigured: boolean;
  };
}

export default function Console({
  initialApplications,
  initialNotifications,
  integrations,
}: ConsoleProps) {
  const [applications, setApplications] = useState<Application[]>(initialApplications);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(
    initialApplications[0]?.id || null
  );
  const [activeReport, setActiveReport] = useState<ScanReport | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);
  const [communitySignals, setCommunitySignals] = useState<CommunityAssessment[]>([]);

  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [inboxOpen, setInboxOpen] = useState(false);
  const [registerModalOpen, setRegisterModalOpen] = useState(false);

  // Registration Form State
  const [repoUrl, setRepoUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [requestedRef, setRequestedRef] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [deploymentUrl, setDeploymentUrl] = useState("");
  const [deploymentClaim, setDeploymentClaim] = useState<"repository_snapshot" | "developer_declared_commit">("repository_snapshot");
  const [declaredDeployedCommit, setDeclaredDeployedCommit] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const selectedApp = applications.find((a) => a.id === selectedAppId);

  // Load latest report when selectedApp changes
  useEffect(() => {
    let cancelled = false;

    if (!selectedApp) {
      Promise.resolve().then(() => {
        if (!cancelled) {
          setActiveReport(null);
          setCommunitySignals([]);
        }
      });
      return;
    }

    if (selectedApp.lastScanId) {
      fetch(`/api/reports/${selectedApp.lastScanId}`)
        .then((res) => res.json())
        .then((json) => {
          if (!cancelled && json.ok) {
            setActiveReport(json.data);
          }
        })
        .catch(() => {});
    } else {
      Promise.resolve().then(() => {
        if (!cancelled) {
          setActiveReport(null);
        }
      });
    }

    // Load community signals
    fetch(`/api/community-reports?applicationId=${selectedApp.id}`)
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.ok) {
          setCommunitySignals(json.data);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [selectedAppId, selectedApp]);

  const handleRegisterApp = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError(null);
    setIsRegistering(true);

    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: repoUrl.trim(),
          displayName: displayName.trim() || undefined,
          requestedRef: requestedRef.trim() || null,
          projectPath: projectPath.trim() || null,
          deploymentUrl: deploymentUrl.trim() || null,
          deploymentClaim,
          declaredDeployedCommit: declaredDeployedCommit.trim() || null,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message || "Failed to register repository");
      }

      const newApp = json.data as Application;
      setApplications((prev) => [newApp, ...prev.filter((a) => a.id !== newApp.id)]);
      setSelectedAppId(newApp.id);
      setRegisterModalOpen(false);

      // Reset form
      setRepoUrl("");
      setDisplayName("");
      setRequestedRef("");
      setProjectPath("");
      setDeploymentUrl("");
      setDeclaredDeployedCommit("");
    } catch (err) {
      setRegisterError((err as Error).message || "An unexpected error occurred");
    } finally {
      setIsRegistering(false);
    }
  };

  const handleTriggerScan = async () => {
    if (!selectedApp) return;
    setIsScanning(true);
    setScanError(null);

    try {
      const res = await fetch(`/api/applications/${selectedApp.id}/scan`, {
        method: "POST",
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message || "Scan failed to complete");
      }

      const report = json.data as ScanReport;
      setActiveReport(report);

      // Update application lastScanId in state
      setApplications((prev) =>
        prev.map((a) => (a.id === selectedApp.id ? { ...a, lastScanId: report.id } : a))
      );

      // Refresh notifications
      const notifRes = await fetch("/api/notifications");
      const notifJson = await notifRes.json();
      if (notifJson.ok) {
        setNotifications(notifJson.data);
      }
    } catch (err) {
      setScanError((err as Error).message || "Scan encountered an error");
    } finally {
      setIsScanning(false);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      });
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: new Date().toISOString() }))
      );
    } catch {}
  };

  const handleNotificationClick = async (notif: Notification) => {
    if (!notif.readAt) {
      fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: notif.id, read: true }),
      }).catch(() => {});
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, readAt: new Date().toISOString() } : n))
      );
    }

    if (notif.scanId) {
      const res = await fetch(`/api/reports/${notif.scanId}`);
      const json = await res.json();
      if (json.ok) {
        setActiveReport(json.data);
        setSelectedAppId(notif.applicationId);
        setInboxOpen(false);
      }
    }
  };

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="min-h-screen bg-vc-background text-vc-text-primary font-sans pb-16">
      {/* Top Console Navigation Bar */}
      <header className="sticky top-0 z-40 w-full border-b border-vc-border bg-vc-sidebar/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-vc-primary text-vc-accent border border-vc-border flex items-center justify-center font-bold">
              <Shield size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-vc-text-primary">
                  Vulnerability Response Console
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-vc-card text-vc-text-secondary border border-vc-border uppercase tracking-wider">
                  Assessment Only
                </span>
              </div>
              <div className="text-[11px] text-vc-text-secondary/70 hidden sm:block">
                OSV-backed npm dependency security & early warning analysis
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Inbox Button */}
            <button
              onClick={() => setInboxOpen(!inboxOpen)}
              className="relative p-2 rounded-lg bg-vc-card border border-vc-border hover:bg-vc-input text-vc-text-secondary hover:text-vc-text-primary transition-colors"
              title="Notifications Inbox"
            >
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-vc-accent text-vc-sidebar text-[10px] font-bold flex items-center justify-center animate-pulse">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Register App Button */}
            <button
              onClick={() => setRegisterModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vc-primary hover:bg-vc-primary-hover text-vc-text-primary border border-vc-border text-xs font-semibold shadow-sm transition-colors"
            >
              <Plus size={14} />
              <span>Register Repo</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* Environment Integrations Status Banner */}
        <div className="p-3 bg-vc-card/60 border border-vc-border rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs text-vc-text-secondary">
          <div className="flex items-center gap-4">
            <span className="font-semibold text-vc-text-primary">Integrations:</span>
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${integrations.githubTokenConfigured ? "bg-vc-success" : "bg-vc-text-secondary/50"}`} />
              <span>GitHub API {integrations.githubTokenConfigured ? "(Authenticated Token)" : "(Public Rate Limit)"}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${integrations.geminiConfigured ? "bg-vc-success" : "bg-vc-warning"}`} />
              <span>Gemini AI {integrations.geminiConfigured ? "(Active)" : "(Unconfigured — Using Fallback)"}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${integrations.emailConfigured ? "bg-vc-success" : "bg-vc-text-secondary/50"}`} />
              <span>Email {integrations.emailConfigured ? "(Resend Enabled)" : "(In-App Only)"}</span>
            </span>
          </div>

          <div className="text-[11px] text-vc-text-secondary/70">
            Node.js Local Runtime • Strict Single-Process Mutex
          </div>
        </div>

        {/* Application Selector Bar */}
        <div className="bg-vc-card border border-vc-border rounded-xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="text-xs font-semibold text-vc-text-secondary">Selected Target:</div>
            {applications.length === 0 ? (
              <span className="text-xs text-vc-text-secondary/70 italic">No repositories registered yet.</span>
            ) : (
              <select
                value={selectedAppId || ""}
                onChange={(e) => setSelectedAppId(e.target.value)}
                className="bg-vc-input border border-vc-border text-vc-text-primary rounded-lg px-3 py-1.5 text-xs font-medium focus:outline-none focus:border-vc-accent"
              >
                {applications.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.displayName} ({app.owner}/{app.repo})
                  </option>
                ))}
              </select>
            )}

            {selectedApp && (
              <a
                href={selectedApp.canonicalRepoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-vc-text-secondary hover:text-vc-text-primary p-1"
                title="Open GitHub Repository"
              >
                <ExternalLink size={15} />
              </a>
            )}
          </div>

          {/* Primary Action Button */}
          {selectedApp && (
            <div className="flex items-center gap-3">
              <button
                onClick={handleTriggerScan}
                disabled={isScanning}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-vc-primary hover:bg-vc-primary-hover disabled:opacity-50 text-xs font-bold text-vc-text-primary border border-vc-border shadow-sm transition-colors"
              >
                <RefreshCw size={13} className={isScanning ? "animate-spin" : ""} />
                <span>{isScanning ? "Scanning OSV & Dependencies..." : "Scan Dependencies"}</span>
              </button>
            </div>
          )}
        </div>

        {/* Scan Error Banner */}
        {scanError && (
          <div className="p-4 rounded-xl bg-vc-danger/15 border border-vc-danger/40 text-xs text-vc-danger flex items-start justify-between gap-2">
            <div>
              <strong className="text-vc-danger font-bold">Scan Error: </strong>
              {scanError}
            </div>
            <button onClick={() => setScanError(null)} className="text-vc-danger/80 hover:text-vc-danger">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Main Content Area */}
        {applications.length === 0 ? (
          <div className="bg-vc-card border border-vc-border rounded-xl p-16 text-center space-y-4">
            <Layers size={40} className="mx-auto text-vc-text-secondary/50" />
            <h3 className="text-base font-bold text-vc-text-primary">No Target Repositories Registered</h3>
            <p className="text-xs text-vc-text-secondary max-w-md mx-auto leading-relaxed">
              Register a real GitHub repository containing a <code className="text-vc-text-primary">package.json</code> and <code className="text-vc-text-primary">package-lock.json</code> to perform an evidence-backed dependency vulnerability assessment.
            </p>
            <button
              onClick={() => setRegisterModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-vc-primary hover:bg-vc-primary-hover text-xs font-semibold text-vc-text-primary border border-vc-border transition-colors"
            >
              <Plus size={14} />
              <span>Register Your First Repository</span>
            </button>
          </div>
        ) : activeReport ? (
          <div className="space-y-8">
            <ReportView report={activeReport} onRefresh={handleTriggerScan} />
            <CommunityReportForm
              applicationId={selectedApp!.id}
              signals={communitySignals}
              onSignalAdded={(sig) => setCommunitySignals((prev) => [sig, ...prev])}
            />
          </div>
        ) : (
          <div className="bg-vc-card border border-vc-border rounded-xl p-16 text-center space-y-4">
            <Shield size={40} className="mx-auto text-vc-accent/60" />
            <h3 className="text-base font-bold text-vc-text-primary">Repository Ready for Scan</h3>
            <p className="text-xs text-vc-text-secondary max-w-md mx-auto leading-relaxed">
              Target repository <strong className="text-vc-text-primary">{selectedApp?.displayName}</strong> has not been scanned yet. Click &quot;Scan Dependencies&quot; above to fetch its commit-pinned lockfile and query OSV.
            </p>
            <button
              onClick={handleTriggerScan}
              disabled={isScanning}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-vc-primary hover:bg-vc-primary-hover disabled:opacity-50 text-xs font-bold text-vc-text-primary border border-vc-border transition-colors"
            >
              <RefreshCw size={14} className={isScanning ? "animate-spin" : ""} />
              <span>{isScanning ? "Running Scan..." : "Run First Scan"}</span>
            </button>
          </div>
        )}
      </main>

      {/* Notifications Drawer */}
      {inboxOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-vc-card border-l border-vc-border h-full p-6 text-vc-text-primary flex flex-col justify-between shadow-2xl">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-vc-border pb-3">
                <div className="flex items-center gap-2">
                  <Bell size={16} className="text-vc-accent" />
                  <h3 className="text-sm font-bold">Notifications Inbox</h3>
                  {unreadCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-vc-navigation-active text-vc-accent border border-vc-accent/30">
                      {unreadCount} unread
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      className="text-[11px] text-vc-text-secondary hover:text-vc-text-primary"
                    >
                      Mark all read
                    </button>
                  )}
                  <button
                    onClick={() => setInboxOpen(false)}
                    className="p-1 rounded text-vc-text-secondary hover:text-vc-text-primary"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <div className="space-y-2.5 overflow-y-auto max-h-[calc(100vh-140px)] pr-1">
                {notifications.length === 0 ? (
                  <p className="text-xs text-vc-text-secondary/70 italic text-center py-8">Inbox is empty.</p>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => handleNotificationClick(n)}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors text-xs space-y-1 ${
                        !n.readAt
                          ? "bg-vc-navigation-active/80 border-vc-accent/40 hover:bg-vc-navigation-active"
                          : "bg-vc-input/60 border-vc-border/80 text-vc-text-secondary hover:bg-vc-input"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`font-semibold ${!n.readAt ? "text-vc-text-primary" : "text-vc-text-secondary"}`}>
                          {n.title}
                        </span>
                        {!n.readAt && <span className="w-2 h-2 rounded-full bg-vc-accent" />}
                      </div>
                      <p className="text-[11px] text-vc-text-secondary leading-relaxed line-clamp-2">
                        {n.summary}
                      </p>
                      <div className="text-[10px] text-vc-text-secondary/70 pt-1">
                        {new Date(n.createdAt).toLocaleString()}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Register Application Modal */}
      {registerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-vc-card border border-vc-border rounded-2xl max-w-lg w-full p-6 text-vc-text-primary space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-vc-border pb-3">
              <h3 className="text-base font-bold">Register GitHub Repository</h3>
              <button
                onClick={() => setRegisterModalOpen(false)}
                className="p-1 rounded text-vc-text-secondary hover:text-vc-text-primary"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleRegisterApp} className="space-y-4 text-xs">
              {registerError && (
                <div className="p-3 rounded-lg bg-vc-danger/15 border border-vc-danger/40 text-vc-danger">
                  {registerError}
                </div>
              )}

              <div>
                <label className="block font-semibold text-vc-text-primary mb-1">
                  GitHub Repository URL <span className="text-vc-danger">*</span>
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://github.com/owner/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="w-full px-3 py-2 bg-vc-input border border-vc-border rounded-lg text-vc-text-primary placeholder:text-vc-text-secondary/60 focus:outline-none focus:border-vc-accent"
                />
              </div>

              <div>
                <label className="block font-semibold text-vc-text-primary mb-1">
                  Display Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Production Web App"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 bg-vc-input border border-vc-border rounded-lg text-vc-text-primary placeholder:text-vc-text-secondary/60 focus:outline-none focus:border-vc-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-vc-text-primary mb-1">
                    Branch / Tag / Ref (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="main or v1.0.0"
                    value={requestedRef}
                    onChange={(e) => setRequestedRef(e.target.value)}
                    className="w-full px-3 py-2 bg-vc-input border border-vc-border rounded-lg text-vc-text-primary placeholder:text-vc-text-secondary/60 focus:outline-none focus:border-vc-accent"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-vc-text-primary mb-1">
                    Project Path (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="apps/web or leave empty"
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    className="w-full px-3 py-2 bg-vc-input border border-vc-border rounded-lg text-vc-text-primary placeholder:text-vc-text-secondary/60 focus:outline-none focus:border-vc-accent"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-vc-text-primary mb-1">
                  Deployment URL Reference (Optional — Display only; never fetched)
                </label>
                <input
                  type="url"
                  placeholder="https://example.com"
                  value={deploymentUrl}
                  onChange={(e) => setDeploymentUrl(e.target.value)}
                  className="w-full px-3 py-2 bg-vc-input border border-vc-border rounded-lg text-vc-text-primary placeholder:text-vc-text-secondary/60 focus:outline-none focus:border-vc-accent"
                />
              </div>

              <div>
                <label className="block font-semibold text-vc-text-primary mb-1">
                  Deployment Claim Type
                </label>
                <select
                  value={deploymentClaim}
                  onChange={(e) => setDeploymentClaim(e.target.value as "repository_snapshot" | "developer_declared_commit")}
                  className="w-full px-3 py-2 bg-vc-input border border-vc-border rounded-lg text-vc-text-primary focus:outline-none focus:border-vc-accent"
                >
                  <option value="repository_snapshot">Repository Snapshot (Default branch or specified ref)</option>
                  <option value="developer_declared_commit">Developer-Declared Deployed Commit SHA</option>
                </select>
              </div>

              {deploymentClaim === "developer_declared_commit" && (
                <div>
                  <label className="block font-semibold text-vc-text-primary mb-1">
                    Declared Deployed Commit SHA (40-character hex) <span className="text-vc-danger">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    placeholder="40-character hex SHA"
                    value={declaredDeployedCommit}
                    onChange={(e) => setDeclaredDeployedCommit(e.target.value)}
                    className="w-full px-3 py-2 bg-vc-input border border-vc-border rounded-lg text-vc-text-primary font-mono placeholder:text-vc-text-secondary/60 focus:outline-none focus:border-vc-accent"
                  />
                  <p className="text-[10px] text-vc-warning mt-1">
                    Note: Declared commit is self-reported by developer and not independently verified against live deployment.
                  </p>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRegisterModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-vc-input hover:bg-vc-border text-vc-text-secondary hover:text-vc-text-primary border border-vc-border transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRegistering || !repoUrl.trim()}
                  className="px-4 py-1.5 rounded-lg bg-vc-primary hover:bg-vc-primary-hover disabled:opacity-50 text-vc-text-primary font-semibold border border-vc-border transition-colors"
                >
                  {isRegistering ? "Registering..." : "Register"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
