// components/console.tsx
// Refactored Vulnerability Response Console layout:
// - Compact repository toolbar (selector, scan status, last scan time, scan button, export menu)
// - Accessible tabs: Findings (with count), Protection (with active containment indicator), Agent handoff
// - Connections popover in top bar distinguishing configured credentials from runtime operations
// - Full state preservation across tab switches (no network calls, rescans, or cancelled work)

'use client';

import { useState, useEffect, useCallback } from "react";
import {
  Application,
  Finding,
  Notification,
  ScanReport,
} from "@/lib/contracts";
import ReportView from "./report-view";
import ProtectionPanel from "./protection-panel";
import HandoffView from "./handoff-view";
import {
  Activity,
  Bell,
  Bot,
  ChevronDown,
  Download,
  ExternalLink,
  FileCode,
  FileText,
  Layers,
  Plus,
  RefreshCw,
  Shield,
  Sparkles,
  X,
} from "lucide-react";

type ConsoleTab = "findings" | "protection" | "handoff";

interface ConsoleProps {
  initialApplications: Application[];
  initialNotifications: Notification[];
  initialReport?: ScanReport | null;
  integrations: {
    githubTokenConfigured: boolean;
    geminiConfigured: boolean;
    emailConfigured: boolean;
  };
  isHostedDemo?: boolean;
}

export default function Console({
  initialApplications,
  initialNotifications,
  initialReport,
  integrations,
  isHostedDemo = false,
}: ConsoleProps) {
  const [applications, setApplications] = useState<Application[]>(initialApplications);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(
    initialApplications[0]?.id || null
  );
  const [activeReport, setActiveReport] = useState<ScanReport | null>(
    initialReport || null
  );
  const [notifications, setNotifications] = useState<Notification[]>(initialNotifications);

  const [activeTab, setActiveTab] = useState<ConsoleTab>("findings");
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Modals and Popovers
  const [inboxOpen, setInboxOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // Filter & Finding state (preserved across tab switches)
  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);

  // Protection Runtime & Eligibility State
  const [protectionStatus, setProtectionStatus] = useState<{
    eligible: boolean;
    isRuleActive: boolean;
    controllerOnline: boolean;
  }>({
    eligible: false,
    isRuleActive: false,
    controllerOnline: false,
  });

  // Registration Form State
  const [repoUrl, setRepoUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [requestedRef, setRequestedRef] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [deploymentUrl, setDeploymentUrl] = useState("");
  const deploymentClaim = "repository_snapshot" as const;
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

    return () => {
      cancelled = true;
    };
  }, [selectedAppId, selectedApp]);

  // Initial protection check for active containment banner and tab badge
  useEffect(() => {
    if (!selectedAppId) return;
    let cancelled = false;

    fetch(`/api/protection/status?applicationId=${selectedAppId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setProtectionStatus({
            eligible: Boolean(data.eligible),
            isRuleActive: Boolean(data.runtimeStatus?.activeRule),
            controllerOnline: Boolean(data.runtimeStatus),
          });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [selectedAppId, activeReport?.id]);

  const [previousAppId, setPreviousAppId] = useState<string | null>(null);

  const handleSelectApp = (appId: string) => {
    setSelectedAppId(appId);
    setSelectedFinding(null); // Clear active finding to avoid showing stale detail from another repo
  };

  const handleOpenLocalDemo = async () => {
    try {
      setIsScanning(true);
      const res = await fetch("/api/protection/demo/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoScan: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error?.message || "Failed to initialize local demo context");
      }

      const { application: demoApp, scan: demoScan } = json.data;

      if (selectedAppId && selectedAppId !== demoApp.id) {
        setPreviousAppId(selectedAppId);
      }

      setApplications((prev) => {
        const filtered = prev.filter((a) => a.id !== demoApp.id);
        return [demoApp, ...filtered];
      });

      setSelectedAppId(demoApp.id);
      setActiveReport(demoScan);
      setSelectedFinding(null);
      setActiveTab("protection");
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const handleReturnFromDemo = () => {
    if (previousAppId) {
      setSelectedAppId(previousAppId);
      setSelectedFinding(null);
    } else {
      const nonDemo = applications.find((a) => a.sourceType !== "local_demo");
      if (nonDemo) {
        setSelectedAppId(nonDemo.id);
        setSelectedFinding(null);
      }
    }
  };

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
      setSelectedFinding(null);
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
        setSelectedFinding(null);
        setInboxOpen(false);
      }
    }
  };

  const refreshNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      const json = await res.json();
      if (json.ok && Array.isArray(json.data)) {
        setNotifications(json.data);
      }
    } catch {}
  }, []);

  // Keyboard navigation for accessible tabs
  const tabList: ConsoleTab[] = ["findings", "protection", "handoff"];
  const handleTabKeyDown = (e: React.KeyboardEvent, currentTab: ConsoleTab) => {
    const currentIndex = tabList.indexOf(currentTab);
    let nextIndex = -1;
    if (e.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabList.length;
    } else if (e.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabList.length) % tabList.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = tabList.length - 1;
    }
    if (nextIndex !== -1) {
      e.preventDefault();
      const nextTab = tabList[nextIndex];
      setActiveTab(nextTab);
      const el = document.getElementById(`tab-${nextTab}`);
      el?.focus();
    }
  };

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="min-h-screen bg-vc-background text-vc-text-primary font-sans pb-16">
      {/* Top Console Navigation Bar */}
      <header className="sticky top-0 z-40 w-full border-b border-vc-border bg-vc-sidebar/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-vc-primary text-vc-accent border border-vc-border flex items-center justify-center font-bold shrink-0">
              <Shield size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight text-vc-text-primary">
                  Vulnerability Response Console
                </span>
                {/* Contextual Scope Label */}
                {protectionStatus.isRuleActive ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-vc-warning/20 text-vc-warning border border-vc-warning/40">
                    <span className="w-1.5 h-1.5 rounded-full bg-vc-warning animate-pulse" />
                    <span>Containment Active</span>
                  </span>
                ) : protectionStatus.eligible ? (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-vc-navigation-active text-vc-accent border border-vc-accent/30">
                    <Shield size={11} />
                    <span>Containment Available</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-vc-card text-vc-text-secondary border border-vc-border">
                    Dependency Security
                  </span>
                )}
              </div>
              <div className="text-[11px] text-vc-text-secondary/70 hidden sm:block">
                OSV-backed npm dependency security & early warning analysis
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Connections Popover Button */}
            <button
              onClick={() => setConnectionsOpen(!connectionsOpen)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-vc-card border border-vc-border hover:bg-vc-input text-vc-text-secondary hover:text-vc-text-primary text-xs font-medium transition-colors"
              title="View Service Connections"
            >
              <Activity
                size={14}
                className={
                  integrations.githubTokenConfigured
                    ? "text-vc-success"
                    : "text-vc-warning"
                }
              />
              <span className="hidden sm:inline">Connections</span>
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  integrations.githubTokenConfigured
                    ? "bg-vc-success"
                    : "bg-vc-warning"
                }`}
              />
            </button>

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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vc-primary hover:bg-vc-primary-hover text-vc-text-primary border border-vc-border text-xs font-semibold shadow-xs transition-colors"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">Register Repo</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 space-y-5">
        {/* Hosted Demo Storage Notice */}
        {isHostedDemo && (
          <div className="px-3.5 py-2 rounded-lg bg-vc-input/60 border border-vc-border text-[11px] text-vc-text-secondary flex items-center justify-between gap-2 shadow-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-vc-accent/80 shrink-0" />
              <span>
                <strong className="text-vc-text-primary">Hosted Demo Storage Notice:</strong> Runtime state is stored in ephemeral instance storage (/tmp). Data may reset or differ across serverless instances and redeployments.
              </span>
            </div>
            <span className="text-[10px] uppercase tracking-wider font-semibold text-vc-accent/90 shrink-0 hidden sm:inline">
              Ephemeral Storage
            </span>
          </div>
        )}

        {/* Compact Repository Toolbar */}
        <div className="bg-vc-card border border-vc-border rounded-xl p-3 sm:p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-xs">
          {/* Left: Repository Selector, External Link, Scan Status, Target SHA, Last Scan Time */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Repository Selector */}
            <div className="flex items-center gap-1.5">
              {applications.length === 0 ? (
                <span className="text-xs text-vc-text-secondary italic">
                  No repositories registered.
                </span>
              ) : (
                <select
                  value={selectedAppId || ""}
                  onChange={(e) => handleSelectApp(e.target.value)}
                  className="bg-vc-input border border-vc-border text-vc-text-primary rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-vc-accent cursor-pointer max-w-[240px] truncate"
                  aria-label="Select Target Repository"
                >
                  {applications.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.displayName}
                    </option>
                  ))}
                </select>
              )}

              {selectedApp && selectedApp.sourceType !== "local_demo" && (
                <a
                  href={selectedApp.canonicalRepoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-vc-text-secondary hover:text-vc-text-primary p-1 rounded hover:bg-vc-input transition-colors"
                  title="Open repository on GitHub"
                >
                  <ExternalLink size={14} />
                </a>
              )}
            </div>

            {/* Local Demo Indicator or Commit SHA */}
            {selectedApp?.sourceType === "local_demo" ? (
              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-vc-accent bg-vc-accent/10 px-2 py-0.5 rounded border border-vc-accent/30 font-semibold">
                Local Demo Fixture
              </span>
            ) : activeReport?.resolvedCommitSha ? (
              <span className="hidden sm:inline-flex items-center font-mono text-[11px] text-vc-text-secondary bg-vc-input/60 px-2 py-0.5 rounded border border-vc-border">
                sha: {activeReport.resolvedCommitSha.slice(0, 7)}
              </span>
            ) : null}

            {/* Return from Demo Quick Link */}
            {selectedApp?.sourceType === "local_demo" && previousAppId && (
              <button
                type="button"
                onClick={handleReturnFromDemo}
                className="text-[11px] text-vc-accent hover:underline font-medium flex items-center gap-1 ml-1"
                title="Return to previous repository"
              >
                <span>← Return to</span>
                <span className="font-semibold">{applications.find((a) => a.id === previousAppId)?.displayName || "Repository"}</span>
              </button>
            )}

            {/* Scan Status Badge */}
            {activeReport ? (
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                  activeReport.status === "complete"
                    ? "bg-vc-navigation-active text-vc-success border border-vc-accent/30"
                    : activeReport.status === "partial"
                    ? "bg-vc-warning/15 text-vc-warning border border-vc-warning/40"
                    : "bg-vc-danger/15 text-vc-danger border border-vc-danger/40"
                }`}
              >
                Scan {activeReport.status}
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-vc-input text-vc-text-secondary border border-vc-border">
                Not scanned yet
              </span>
            )}

            {/* Last Scan Time */}
            {activeReport ? (
              <span className="text-[11px] text-vc-text-secondary hidden lg:inline">
                Checked {new Date(activeReport.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : null}

            {/* AI Status Indicator */}
            {activeReport && (
              <span className="hidden xl:inline-flex items-center gap-1 text-[11px] text-vc-text-secondary">
                <Sparkles size={11} className="text-vc-accent" />
                <span className="capitalize">{activeReport.aiStatus}</span>
              </span>
            )}
          </div>

          {/* Right: Scan Dependencies Button + Export Assessment Dropdown */}
          {selectedApp && (
            <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
              {/* Export Assessment Menu */}
              {activeReport && (
                <div className="relative">
                  <button
                    onClick={() => setExportMenuOpen(!exportMenuOpen)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-vc-input hover:bg-vc-border text-xs font-medium text-vc-text-secondary hover:text-vc-text-primary border border-vc-border transition-colors"
                    aria-expanded={exportMenuOpen}
                    aria-haspopup="true"
                    title="Export assessment report"
                  >
                    <Download size={13} />
                    <span>Export</span>
                    <ChevronDown size={11} className={exportMenuOpen ? "rotate-180 transition-transform" : "transition-transform"} />
                  </button>

                  {exportMenuOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setExportMenuOpen(false)}
                      />
                      <div className="absolute right-0 mt-1 z-50 w-48 bg-vc-card border border-vc-border rounded-xl shadow-xl p-1 text-xs space-y-0.5">
                        <a
                          href={`/api/reports/${activeReport.id}?format=markdown`}
                          download
                          onClick={() => setExportMenuOpen(false)}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg text-vc-text-secondary hover:text-vc-text-primary hover:bg-vc-input transition-colors"
                        >
                          <FileText size={13} className="text-vc-accent" />
                          <span>Report Markdown (.md)</span>
                        </a>
                        <a
                          href={`/api/reports/${activeReport.id}?format=json`}
                          download
                          onClick={() => setExportMenuOpen(false)}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg text-vc-text-secondary hover:text-vc-text-primary hover:bg-vc-input transition-colors"
                        >
                          <FileCode size={13} className="text-vc-accent" />
                          <span>Report JSON (.json)</span>
                        </a>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Scan Dependencies Button */}
              <button
                onClick={handleTriggerScan}
                disabled={isScanning}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-vc-primary hover:bg-vc-primary-hover disabled:opacity-50 text-xs font-bold text-vc-text-primary border border-vc-border shadow-xs transition-colors"
              >
                <RefreshCw size={13} className={isScanning ? "animate-spin text-vc-accent" : ""} />
                <span>{isScanning ? "Scanning..." : "Scan dependencies"}</span>
              </button>
            </div>
          )}
        </div>

        {/* Scan Error Banner */}
        {scanError && (
          <div className="p-3.5 rounded-xl bg-vc-danger/15 border border-vc-danger/40 text-xs text-vc-danger flex items-start justify-between gap-2">
            <div>
              <strong className="text-vc-danger font-bold">Scan Error: </strong>
              {scanError}
            </div>
            <button onClick={() => setScanError(null)} className="text-vc-danger/80 hover:text-vc-danger">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Accessible Navigation Tabs */}
        {selectedApp && (
          <div
            role="tablist"
            aria-label="Console Views"
            className="flex items-center gap-1 border-b border-vc-border pb-1 text-xs"
          >
            <button
              role="tab"
              id="tab-findings"
              aria-controls="tabpanel-findings"
              aria-selected={activeTab === "findings"}
              tabIndex={activeTab === "findings" ? 0 : -1}
              onClick={() => setActiveTab("findings")}
              onKeyDown={(e) => handleTabKeyDown(e, "findings")}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg font-semibold transition-colors ${
                activeTab === "findings"
                  ? "bg-vc-primary text-vc-text-primary border border-vc-border shadow-xs"
                  : "text-vc-text-secondary hover:text-vc-text-primary hover:bg-vc-input/60"
              }`}
            >
              <Layers size={14} />
              <span>Findings</span>
              {activeReport && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-vc-input text-vc-text-primary border border-vc-border">
                  {activeReport.findings.length}
                </span>
              )}
            </button>

            <button
              role="tab"
              id="tab-protection"
              aria-controls="tabpanel-protection"
              aria-selected={activeTab === "protection"}
              tabIndex={activeTab === "protection" ? 0 : -1}
              onClick={() => setActiveTab("protection")}
              onKeyDown={(e) => handleTabKeyDown(e, "protection")}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg font-semibold transition-colors ${
                activeTab === "protection"
                  ? "bg-vc-primary text-vc-text-primary border border-vc-border shadow-xs"
                  : "text-vc-text-secondary hover:text-vc-text-primary hover:bg-vc-input/60"
              }`}
            >
              <Shield size={14} className={protectionStatus.isRuleActive ? "text-vc-warning" : ""} />
              <span>Protection</span>
              {protectionStatus.isRuleActive ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-vc-warning/20 text-vc-warning border border-vc-warning/40">
                  <span className="w-1.5 h-1.5 rounded-full bg-vc-warning animate-pulse" />
                  <span>Active</span>
                </span>
              ) : protectionStatus.eligible ? (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-vc-input text-vc-text-secondary border border-vc-border">
                  Ready
                </span>
              ) : null}
            </button>

            <button
              role="tab"
              id="tab-handoff"
              aria-controls="tabpanel-handoff"
              aria-selected={activeTab === "handoff"}
              tabIndex={activeTab === "handoff" ? 0 : -1}
              onClick={() => setActiveTab("handoff")}
              onKeyDown={(e) => handleTabKeyDown(e, "handoff")}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg font-semibold transition-colors ${
                activeTab === "handoff"
                  ? "bg-vc-primary text-vc-text-primary border border-vc-border shadow-xs"
                  : "text-vc-text-secondary hover:text-vc-text-primary hover:bg-vc-input/60"
              }`}
            >
              <Bot size={14} className="text-vc-accent" />
              <span>Agent handoff</span>
            </button>
          </div>
        )}

        {/* Tab Panels */}
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
        ) : (
          <div className="pt-1">
            {/* Tab 1: Findings */}
            <div
              role="tabpanel"
              id="tabpanel-findings"
              aria-labelledby="tab-findings"
              className={activeTab === "findings" ? "block space-y-6" : "hidden"}
            >
              {activeReport ? (
                <ReportView
                  report={activeReport}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  severityFilter={severityFilter}
                  onSeverityFilterChange={setSeverityFilter}
                  selectedFinding={selectedFinding}
                  onSelectFinding={setSelectedFinding}
                />
              ) : (
                <div className="bg-vc-card border border-vc-border rounded-xl p-16 text-center space-y-4">
                  <Shield size={40} className="mx-auto text-vc-accent/60" />
                  <h3 className="text-base font-bold text-vc-text-primary">Repository Ready for Scan</h3>
                  <p className="text-xs text-vc-text-secondary max-w-md mx-auto leading-relaxed">
                    Target repository <strong className="text-vc-text-primary">{selectedApp?.displayName}</strong> has not been scanned yet. Click &quot;Scan dependencies&quot; above to fetch its commit-pinned lockfile and query OSV.
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
            </div>

            {/* Tab 2: Protection */}
            <div
              role="tabpanel"
              id="tabpanel-protection"
              aria-labelledby="tab-protection"
              className={activeTab === "protection" ? "block space-y-6" : "hidden"}
            >
              {selectedApp && (
                <ProtectionPanel
                  applicationId={selectedApp.id}
                  scanId={activeReport?.id}
                  onNotificationUpdate={refreshNotifications}
                  onStatusChange={setProtectionStatus}
                  onOpenLocalDemo={handleOpenLocalDemo}
                  isLocalDemo={selectedApp.sourceType === "local_demo"}
                  onTriggerScan={handleTriggerScan}
                  isScanning={isScanning}
                />
              )}
            </div>

            {/* Tab 3: Agent Handoff */}
            <div
              role="tabpanel"
              id="tabpanel-handoff"
              aria-labelledby="tab-handoff"
              className={activeTab === "handoff" ? "block space-y-6" : "hidden"}
            >
              {activeReport && selectedApp ? (
                <HandoffView report={activeReport} application={selectedApp} />
              ) : (
                <div className="bg-vc-card border border-vc-border rounded-xl p-12 text-center text-xs text-vc-text-secondary space-y-2">
                  <Bot size={32} className="mx-auto text-vc-text-secondary/50" />
                  <h3 className="font-bold text-vc-text-primary text-sm">No Scan Report Available</h3>
                  <p>Run a scan on this repository to generate a grounded remediation handoff for a coding agent.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Connections Popover Modal */}
      {connectionsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-vc-card border border-vc-border rounded-2xl max-w-lg w-full shadow-2xl p-6 text-vc-text-primary space-y-4">
            <div className="flex items-center justify-between border-b border-vc-border pb-3">
              <div className="flex items-center gap-2">
                <Activity size={18} className="text-vc-accent" />
                <h3 className="text-sm font-bold">Service & Integration Connections</h3>
              </div>
              <button
                onClick={() => setConnectionsOpen(false)}
                className="p-1 rounded-lg text-vc-text-secondary hover:text-vc-text-primary hover:bg-vc-input transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* GitHub API */}
              <div className="p-3 rounded-lg bg-vc-input/50 border border-vc-border flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <span className="font-bold text-vc-text-primary block">GitHub API</span>
                  <span className="text-[11px] text-vc-text-secondary leading-relaxed">
                    {integrations.githubTokenConfigured
                      ? "GITHUB_TOKEN configured (Authenticated: 5,000 requests/hour)"
                      : "Unauthenticated public rate limit (60 requests/hour limit)"}
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                    integrations.githubTokenConfigured
                      ? "bg-vc-success/15 text-vc-success border border-vc-success/30"
                      : "bg-vc-warning/15 text-vc-warning border border-vc-warning/30"
                  }`}
                >
                  {integrations.githubTokenConfigured ? "Token Active" : "Public Limit"}
                </span>
              </div>

              {/* OSV Database */}
              <div className="p-3 rounded-lg bg-vc-input/50 border border-vc-border flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <span className="font-bold text-vc-text-primary block">OSV Vulnerability Database</span>
                  <span className="text-[11px] text-vc-text-secondary leading-relaxed">
                    api.osv.dev batch query and advisory hydration operational
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-vc-success/15 text-vc-success border border-vc-success/30 shrink-0">
                  Live
                </span>
              </div>

              {/* Gemini AI */}
              <div className="p-3 rounded-lg bg-vc-input/50 border border-vc-border flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <span className="font-bold text-vc-text-primary block">Gemini AI Synthesis</span>
                  <span className="text-[11px] text-vc-text-secondary leading-relaxed">
                    {integrations.geminiConfigured
                      ? "GEMINI_API_KEY configured (Grounded schema analysis active)"
                      : "Unconfigured: Truthful deterministic fallbacks active"}
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                    integrations.geminiConfigured
                      ? "bg-vc-success/15 text-vc-success border border-vc-success/30"
                      : "bg-vc-input text-vc-text-secondary border border-vc-border"
                  }`}
                >
                  {integrations.geminiConfigured ? "Configured" : "Fallback Mode"}
                </span>
              </div>

              {/* Protection Controller */}
              <div className="p-3 rounded-lg bg-vc-input/50 border border-vc-border flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <span className="font-bold text-vc-text-primary block">Protection Controller (Port 8001)</span>
                  <span className="text-[11px] text-vc-text-secondary leading-relaxed">
                    {protectionStatus.controllerOnline
                      ? "Loopback controller running on 127.0.0.1:8001 (Proxy on 8002)"
                      : isHostedDemo
                      ? "Unavailable in hosted demo: requires local loopback controller (npm run controller)"
                      : "Offline: Run 'npm run controller' in terminal to start"}
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                    protectionStatus.controllerOnline
                      ? "bg-vc-success/15 text-vc-success border border-vc-success/30"
                      : "bg-vc-input text-vc-text-secondary border border-vc-border"
                  }`}
                >
                  {protectionStatus.controllerOnline ? "Connected" : isHostedDemo ? "Unavailable" : "Offline"}
                </span>
              </div>

              {/* Email & Notifications */}
              <div className="p-3 rounded-lg bg-vc-input/50 border border-vc-border flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <span className="font-bold text-vc-text-primary block">Alert Notifications</span>
                  <span className="text-[11px] text-vc-text-secondary leading-relaxed">
                    In-app inbox active • Email: {integrations.emailConfigured ? "Resend dispatch active" : "In-app alerts only"}
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-vc-success/15 text-vc-success border border-vc-success/30 shrink-0">
                  Inbox Active
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-vc-border text-[11px] text-vc-text-secondary/70 text-center">
              {isHostedDemo
                ? "Hosted serverless environment with temporary instance storage (/tmp)."
                : "Local Node.js environment with isolated atomic filesystem persistence."}
            </div>
          </div>
        </div>
      )}

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
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-vc-text-primary">{n.title}</span>
                        <span className="text-[10px] text-vc-text-secondary">
                          {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed line-clamp-2">{n.summary}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-vc-border text-[11px] text-vc-text-secondary/70 text-center">
              Click any notification to navigate directly to its scan assessment.
            </div>
          </div>
        </div>
      )}

      {/* Register Repository Modal */}
      {registerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-vc-card border border-vc-border rounded-xl max-w-lg w-full p-6 text-vc-text-primary space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-vc-border pb-3">
              <h3 className="text-sm font-bold">Register Target Repository</h3>
              <button
                onClick={() => setRegisterModalOpen(false)}
                className="p-1 rounded text-vc-text-secondary hover:text-vc-text-primary"
              >
                <X size={16} />
              </button>
            </div>

            {registerError && (
              <div className="p-3 rounded-lg bg-vc-danger/15 border border-vc-danger/40 text-vc-danger text-xs">
                {registerError}
              </div>
            )}

            <form onSubmit={handleRegisterApp} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-vc-text-secondary font-medium mb-1">
                  GitHub Repository URL <span className="text-vc-danger">*</span>
                </label>
                <input
                  type="text"
                  placeholder="https://github.com/org/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  required
                  className="w-full px-3 py-1.5 bg-vc-input border border-vc-border rounded-lg text-vc-text-primary focus:outline-none focus:border-vc-accent"
                />
              </div>

              <div>
                <label className="block text-vc-text-secondary font-medium mb-1">
                  Display Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="My Node Service"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-vc-input border border-vc-border rounded-lg text-vc-text-primary focus:outline-none focus:border-vc-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-vc-text-secondary font-medium mb-1">
                    Requested Branch / Tag
                  </label>
                  <input
                    type="text"
                    placeholder="main or v1.0.0"
                    value={requestedRef}
                    onChange={(e) => setRequestedRef(e.target.value)}
                    className="w-full px-3 py-1.5 bg-vc-input border border-vc-border rounded-lg text-vc-text-primary focus:outline-none focus:border-vc-accent"
                  />
                </div>

                <div>
                  <label className="block text-vc-text-secondary font-medium mb-1">
                    Project Path (Subdirectory)
                  </label>
                  <input
                    type="text"
                    placeholder="packages/api or ."
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    className="w-full px-3 py-1.5 bg-vc-input border border-vc-border rounded-lg text-vc-text-primary focus:outline-none focus:border-vc-accent"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRegisterModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-vc-input hover:bg-vc-border text-vc-text-secondary hover:text-vc-text-primary text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRegistering}
                  className="px-4 py-1.5 rounded-lg bg-vc-primary hover:bg-vc-primary-hover text-vc-text-primary font-bold text-xs border border-vc-border transition-colors disabled:opacity-50"
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
