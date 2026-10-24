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
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans pb-16">
      {/* Top Console Navigation Bar */}
      <header className="sticky top-0 z-40 w-full border-b border-gray-800 bg-gray-950/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-bold">
              <Shield size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-white">
                  Vulnerability Response Console
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-gray-800 text-gray-300 border border-gray-700 uppercase tracking-wider">
                  Assessment Only
                </span>
              </div>
              <div className="text-[11px] text-gray-500 hidden sm:block">
                OSV-backed npm dependency security & early warning analysis
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Inbox Button */}
            <button
              onClick={() => setInboxOpen(!inboxOpen)}
              className="relative p-2 rounded-lg bg-gray-900 border border-gray-800 hover:bg-gray-800 text-gray-300 transition-colors"
              title="Notifications Inbox"
            >
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center animate-pulse">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Register App Button */}
            <button
              onClick={() => setRegisterModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition-colors"
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
        <div className="p-3 bg-gray-900/60 border border-gray-800/80 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs text-gray-400">
          <div className="flex items-center gap-4">
            <span className="font-semibold text-gray-300">Integrations:</span>
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${integrations.githubTokenConfigured ? "bg-emerald-400" : "bg-gray-600"}`} />
              <span>GitHub API {integrations.githubTokenConfigured ? "(Authenticated Token)" : "(Public Rate Limit)"}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${integrations.geminiConfigured ? "bg-emerald-400" : "bg-amber-500"}`} />
              <span>Gemini AI {integrations.geminiConfigured ? "(Active)" : "(Unconfigured — Using Fallback)"}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${integrations.emailConfigured ? "bg-emerald-400" : "bg-gray-600"}`} />
              <span>Email {integrations.emailConfigured ? "(Resend Enabled)" : "(In-App Only)"}</span>
            </span>
          </div>

          <div className="text-[11px] text-gray-500">
            Node.js Local Runtime • Strict Single-Process Mutex
          </div>
        </div>

        {/* Application Selector Bar */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="text-xs font-semibold text-gray-400">Selected Target:</div>
            {applications.length === 0 ? (
              <span className="text-xs text-gray-500 italic">No repositories registered yet.</span>
            ) : (
              <select
                value={selectedAppId || ""}
                onChange={(e) => setSelectedAppId(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-xs font-medium focus:outline-none focus:border-blue-500"
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
                className="text-gray-400 hover:text-white p-1"
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
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-bold text-white shadow-sm transition-colors"
              >
                <RefreshCw size={13} className={isScanning ? "animate-spin" : ""} />
                <span>{isScanning ? "Scanning OSV & Dependencies..." : "Scan Dependencies"}</span>
              </button>
            </div>
          )}
        </div>

        {/* Scan Error Banner */}
        {scanError && (
          <div className="p-4 rounded-xl bg-red-950/60 border border-red-900 text-xs text-red-300 flex items-start justify-between gap-2">
            <div>
              <strong className="text-red-200">Scan Error: </strong>
              {scanError}
            </div>
            <button onClick={() => setScanError(null)} className="text-red-400 hover:text-red-200">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Main Content Area */}
        {applications.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-16 text-center space-y-4">
            <Layers size={40} className="mx-auto text-gray-500" />
            <h3 className="text-base font-bold text-white">No Target Repositories Registered</h3>
            <p className="text-xs text-gray-400 max-w-md mx-auto leading-relaxed">
              Register a real GitHub repository containing a <code className="text-gray-300">package.json</code> and <code className="text-gray-300">package-lock.json</code> to perform an evidence-backed dependency vulnerability assessment.
            </p>
            <button
              onClick={() => setRegisterModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors"
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
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-16 text-center space-y-4">
            <Shield size={40} className="mx-auto text-blue-500/60" />
            <h3 className="text-base font-bold text-white">Repository Ready for Scan</h3>
            <p className="text-xs text-gray-400 max-w-md mx-auto leading-relaxed">
              Target repository <strong className="text-gray-200">{selectedApp?.displayName}</strong> has not been scanned yet. Click &quot;Scan Dependencies&quot; above to fetch its commit-pinned lockfile and query OSV.
            </p>
            <button
              onClick={handleTriggerScan}
              disabled={isScanning}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-bold text-white transition-colors"
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
          <div className="w-full max-w-md bg-gray-900 border-l border-gray-800 h-full p-6 text-white flex flex-col justify-between shadow-2xl">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-gray-800 pb-3">
                <div className="flex items-center gap-2">
                  <Bell size={16} className="text-blue-400" />
                  <h3 className="text-sm font-bold">Notifications Inbox</h3>
                  {unreadCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-900/60 text-blue-300 border border-blue-800">
                      {unreadCount} unread
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      className="text-[11px] text-gray-400 hover:text-white"
                    >
                      Mark all read
                    </button>
                  )}
                  <button
                    onClick={() => setInboxOpen(false)}
                    className="p-1 rounded text-gray-400 hover:text-white"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <div className="space-y-2.5 overflow-y-auto max-h-[calc(100vh-140px)] pr-1">
                {notifications.length === 0 ? (
                  <p className="text-xs text-gray-500 italic text-center py-8">Inbox is empty.</p>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => handleNotificationClick(n)}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors text-xs space-y-1 ${
                        !n.readAt
                          ? "bg-gray-800/80 border-blue-500/40 hover:bg-gray-800"
                          : "bg-gray-950/60 border-gray-800/80 text-gray-400 hover:bg-gray-900"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`font-semibold ${!n.readAt ? "text-white" : "text-gray-300"}`}>
                          {n.title}
                        </span>
                        {!n.readAt && <span className="w-2 h-2 rounded-full bg-blue-500" />}
                      </div>
                      <p className="text-[11px] text-gray-300 leading-relaxed line-clamp-2">
                        {n.summary}
                      </p>
                      <div className="text-[10px] text-gray-500 pt-1">
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
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-lg w-full p-6 text-white space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h3 className="text-base font-bold">Register GitHub Repository</h3>
              <button
                onClick={() => setRegisterModalOpen(false)}
                className="p-1 rounded text-gray-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleRegisterApp} className="space-y-4 text-xs">
              {registerError && (
                <div className="p-3 rounded-lg bg-red-950/50 border border-red-900 text-red-300">
                  {registerError}
                </div>
              )}

              <div>
                <label className="block font-semibold text-gray-300 mb-1">
                  GitHub Repository URL <span className="text-red-400">*</span>
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://github.com/owner/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-950 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-300 mb-1">
                  Display Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Production Web App"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-950 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-300 mb-1">
                    Branch / Tag / Ref (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="main or v1.0.0"
                    value={requestedRef}
                    onChange={(e) => setRequestedRef(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-950 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-gray-300 mb-1">
                    Project Path (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="apps/web or leave empty"
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-950 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-gray-300 mb-1">
                  Deployment URL Reference (Optional — Display only; never fetched)
                </label>
                <input
                  type="url"
                  placeholder="https://example.com"
                  value={deploymentUrl}
                  onChange={(e) => setDeploymentUrl(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-950 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-gray-300 mb-1">
                  Deployment Claim Type
                </label>
                <select
                  value={deploymentClaim}
                  onChange={(e) => setDeploymentClaim(e.target.value as "repository_snapshot" | "developer_declared_commit")}
                  className="w-full px-3 py-2 bg-gray-950 border border-gray-800 rounded-lg text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="repository_snapshot">Repository Snapshot (Default branch or specified ref)</option>
                  <option value="developer_declared_commit">Developer-Declared Deployed Commit SHA</option>
                </select>
              </div>

              {deploymentClaim === "developer_declared_commit" && (
                <div>
                  <label className="block font-semibold text-gray-300 mb-1">
                    Declared Deployed Commit SHA (40-character hex) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    placeholder="40-character hex SHA"
                    value={declaredDeployedCommit}
                    onChange={(e) => setDeclaredDeployedCommit(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-950 border border-gray-800 rounded-lg text-white font-mono placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                  <p className="text-[10px] text-amber-400 mt-1">
                    Note: Declared commit is self-reported by developer and not independently verified against live deployment.
                  </p>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRegisterModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRegistering || !repoUrl.trim()}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold transition-colors"
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
