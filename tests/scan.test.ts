import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { executeScan, ScannerError } from "../lib/scanner";
import { Application } from "../lib/contracts";
import { readStore, getNotifications, acquireScanLock, releaseScanLock } from "../lib/store";
import { renderReportMarkdown } from "../lib/report";
import { promises as fs } from "node:fs";
import path from "node:path";

const STATE_FILE_PATH = path.resolve(process.cwd(), "data", "state.json");

describe("Scanner Pipeline Integration", () => {
  beforeEach(async () => {
    try {
      await fs.writeFile(
        STATE_FILE_PATH,
        JSON.stringify({
          schemaVersion: 1,
          applications: [],
          scans: [],
          notifications: [],
          communityAssessments: [],
        }),
        "utf-8"
      );
    } catch {
      // directory might not exist yet
    }
  });

  const sampleApp: Application = {
    id: "app-test-scanner",
    displayName: "Mocked Test App",
    owner: "test-owner",
    repo: "test-repo",
    canonicalRepoUrl: "https://github.com/test-owner/test-repo",
    requestedRef: null,
    projectPath: "",
    deploymentUrl: "https://example.com",
    deploymentClaim: "repository_snapshot",
    declaredDeployedCommit: null,
    createdAt: new Date().toISOString(),
    lastScanId: null,
    lastSuccessfulScanId: null,
  };

  it("completes full scan pipeline with mocked GitHub and OSV responses", async () => {
    releaseScanLock(sampleApp.id);
    const mockCommitSha = "abcdef1234567890abcdef1234567890abcdef12";

    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();

      // GitHub repo metadata
      if (urlStr.includes("/repos/test-owner/test-repo/commits/main") || urlStr.endsWith("/repos/test-owner/test-repo")) {
        if (urlStr.includes("/commits/")) {
          return new Response(JSON.stringify({ sha: mockCommitSha }), { status: 200 });
        }
        return new Response(JSON.stringify({ default_branch: "main", private: false }), { status: 200 });
      }

      // GitHub package.json
      if (urlStr.includes("contents/package.json")) {
        return new Response(
          JSON.stringify({
            dependencies: { lodash: "^4.17.20" },
          }),
          { status: 200, headers: { "Content-Type": "application/vnd.github.raw+json" } }
        );
      }

      // GitHub package-lock.json
      if (urlStr.includes("contents/package-lock.json")) {
        return new Response(
          JSON.stringify({
            lockfileVersion: 3,
            packages: {
              "": {},
              "node_modules/lodash": { version: "4.17.20" },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/vnd.github.raw+json" } }
        );
      }

      // OSV Batch query
      if (urlStr.includes("api.osv.dev/v1/querybatch")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                vulns: [{ id: "GHSA-35jh-r3h4-6jhm", modified: "2021-02-15T00:00:00Z" }],
              },
            ],
          }),
          { status: 200 }
        );
      }

      // OSV vuln detail
      if (urlStr.includes("api.osv.dev/v1/vulns/GHSA-35jh-r3h4-6jhm")) {
        return new Response(
          JSON.stringify({
            id: "GHSA-35jh-r3h4-6jhm",
            summary: "Prototype Pollution in lodash",
            database_specific: { severity: "HIGH" },
            affected: [
              {
                package: { ecosystem: "npm", name: "lodash" },
                ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }],
              },
            ],
          }),
          { status: 200 }
        );
      }

      return new Response("Not found", { status: 404 });
    };

    const report = await executeScan(sampleApp, mockFetch as unknown as typeof fetch);

    assert.equal(report.status, "complete");
    assert.equal(report.resolvedCommitSha, mockCommitSha);
    assert.ok(report.lockfileHash);
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0].packageName, "lodash");
    assert.equal(report.findings[0].severity, "high");
    assert.equal(report.findings[0].patchStatus, "fix_listed");
    assert.deepEqual(report.findings[0].fixedVersionsListed, ["4.17.21"]);

    // Verify in-app notification was generated and persisted
    const notifications = await getNotifications();
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].applicationId, sampleApp.id);
    assert.equal(notifications[0].scanId, report.id);

    // Verify Markdown export contains facts
    const md = renderReportMarkdown(report);
    assert.ok(md.includes("Prototype Pollution in lodash"));
    assert.ok(md.includes("4.17.21"));
    assert.ok(md.includes(mockCommitSha));
  });

  it("rejects overlapping concurrent scans with 409 Conflict", async () => {
    releaseScanLock(sampleApp.id);
    acquireScanLock("another-app");

    await assert.rejects(
      async () => {
        await executeScan(sampleApp);
      },
      (err: unknown) => {
        return (
          err instanceof ScannerError &&
          err.statusCode === 409 &&
          err.code === "SCAN_IN_PROGRESS"
        );
      }
    );

    releaseScanLock("another-app");
  });

  it("handles repository failure gracefully and persists failed report with notification", async () => {
    releaseScanLock(sampleApp.id);
    const mockFetch = async () => {
      return new Response("Repository not found", { status: 404 });
    };

    const report = await executeScan(sampleApp, mockFetch as unknown as typeof fetch);
    assert.equal(report.status, "failed");
    assert.equal(report.findings.length, 0);
    assert.ok(report.providerFailures.length > 0);

    const store = await readStore();
    assert.equal(store.scans.length, 1);
    assert.equal(store.scans[0].status, "failed");
    assert.equal(store.notifications.length, 1);
    assert.equal(store.notifications[0].kind, "scan_failed");
  });

  it("preserves resolved commit SHA when manifest fetching fails at a later stage", async () => {
    releaseScanLock(sampleApp.id);
    const mockCommitSha = "abcdef1234567890abcdef1234567890abcdef12";

    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();

      if (urlStr.includes("/repos/test-owner/test-repo/commits/main") || urlStr.endsWith("/repos/test-owner/test-repo")) {
        if (urlStr.includes("/commits/")) {
          return new Response(JSON.stringify({ sha: mockCommitSha }), { status: 200 });
        }
        return new Response(JSON.stringify({ default_branch: "main", private: false }), { status: 200 });
      }

      if (urlStr.includes("contents/package.json")) {
        return new Response("Not found", { status: 404 });
      }

      return new Response("Not found", { status: 404 });
    };

    const report = await executeScan(sampleApp, mockFetch as unknown as typeof fetch);

    assert.equal(report.status, "failed");
    assert.equal(report.resolvedCommitSha, mockCommitSha);
    assert.equal(report.providerFailures[0].stage, "manifest_fetch");
    assert.equal(report.findings.length, 0);

    const store = await readStore();
    assert.equal(store.scans[0].status, "failed");
    assert.equal(store.scans[0].resolvedCommitSha, mockCommitSha);
  });

  it("marks scan as partial and prevents clean status when OSV lookups fail or are incomplete", async () => {
    releaseScanLock(sampleApp.id);
    const mockCommitSha = "abcdef1234567890abcdef1234567890abcdef12";

    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();

      if (urlStr.includes("/repos/test-owner/test-repo/commits/main") || urlStr.endsWith("/repos/test-owner/test-repo")) {
        if (urlStr.includes("/commits/")) {
          return new Response(JSON.stringify({ sha: mockCommitSha }), { status: 200 });
        }
        return new Response(JSON.stringify({ default_branch: "main", private: false }), { status: 200 });
      }

      if (urlStr.includes("contents/package.json")) {
        return new Response(
          JSON.stringify({ dependencies: { "safe-pkg": "1.0.0" } }),
          { status: 200, headers: { "Content-Type": "application/vnd.github.raw+json" } }
        );
      }

      if (urlStr.includes("contents/package-lock.json")) {
        return new Response(
          JSON.stringify({
            lockfileVersion: 3,
            packages: {
              "": {},
              "node_modules/safe-pkg": { version: "1.0.0" },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/vnd.github.raw+json" } }
        );
      }

      // OSV Batch query fails (e.g. 500 internal server error)
      if (urlStr.includes("api.osv.dev/v1/querybatch")) {
        return new Response("Internal Server Error", { status: 500 });
      }

      return new Response("Not found", { status: 404 });
    };

    const report = await executeScan(sampleApp, mockFetch as unknown as typeof fetch);

    // Incomplete lookup MUST NOT result in a clean "complete" scan
    assert.notEqual(report.status, "complete");
    assert.equal(report.status, "partial");
    assert.equal(report.findings.length, 0);
    assert.ok(report.coverage.failedPairs > 0);
    assert.ok(report.providerFailures.some((f) => f.stage === "osv_query"));

    const store = await readStore();
    assert.equal(store.scans[0].status, "partial");
    assert.equal(store.notifications[0].kind, "scan_partial");
  });
});

