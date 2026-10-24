import { randomUUID } from "node:crypto";
import { Notification, ScanReport } from "./contracts";

export interface EmailDispatchResult {
  status: "not_configured" | "pending" | "sent" | "failed";
  providerId?: string;
  error?: string;
}

/**
 * Creates a standardized in-app notification for a completed, partial, or failed scan
 */
export function createScanNotification(report: ScanReport): Notification {
  let kind: Notification["kind"] = "scan_complete";
  let title = `Scan Complete: ${report.applicationSnapshot.displayName}`;
  let summary = report.deterministicSummary;

  if (report.status === "failed") {
    kind = "scan_failed";
    title = `Scan Failed: ${report.applicationSnapshot.displayName}`;
    const firstFailure = report.providerFailures[0]?.message || "Could not retrieve dependency inventory";
    summary = `Scan failed: ${firstFailure}`;
  } else if (report.status === "partial") {
    kind = "scan_partial";
    title = `Scan Incomplete: ${report.applicationSnapshot.displayName}`;
    summary = `Partial coverage: ${report.coverage.failedPairs} query lookups incomplete. ${report.findings.length} advisory matches identified.`;
  }

  return {
    id: randomUUID(),
    applicationId: report.applicationId,
    scanId: report.id,
    kind,
    title,
    summary,
    createdAt: new Date().toISOString(),
    readAt: null,
    emailDelivery: {
      status: "not_configured",
    },
  };
}

/**
 * Optionally dispatches an email via Resend if enabled and configured
 */
export async function dispatchOptionalEmail(
  report: ScanReport,
  fetchFn: typeof fetch = fetch
): Promise<EmailDispatchResult> {
  const isEnabled = process.env.ENABLE_EMAIL_NOTIFICATIONS === "true";
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim();
  const to = process.env.DEVELOPER_EMAIL?.trim();

  if (!isEnabled || !apiKey || !from || !to) {
    return { status: "not_configured" };
  }

  const payload = {
    from,
    to: [to],
    subject: `[Vulnerability Response Console] ${report.applicationSnapshot.displayName}: ${report.status.toUpperCase()}`,
    text: `Vulnerability Assessment Report
Application: ${report.applicationSnapshot.displayName}
Repository: ${report.applicationSnapshot.canonicalRepoUrl}
Status: ${report.status}
Checked at: ${report.completedAt}

Summary:
${report.deterministicSummary}

Total Findings: ${report.findings.length}
Resolved Commit: ${report.resolvedCommitSha || "N/A"}
Report ID: ${report.id}

(Note: Assessment only. No active protection or deployment changes were made.)
`,
  };

  try {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `scan-${report.id}`,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = (await res.json()) as { id?: string };
      return {
        status: "sent",
        providerId: data.id,
      };
    } else {
      const errText = await res.text();
      return {
        status: "failed",
        error: `Resend HTTP ${res.status}: ${errText.substring(0, 100)}`,
      };
    }
  } catch (err) {
    return {
      status: "failed",
      error: (err as Error).message || "Failed to reach Resend API",
    };
  }
}
