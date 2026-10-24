// services/protection/server.ts
// Checkpoint 2 Protection Controller HTTP Service and Proxy Host
// Runs on 127.0.0.1:8001 (Controller API) and 127.0.0.1:8002 (Forwarding Proxy).

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Load .env.local if present
try {
  const envLocalPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envLocalPath)) {
    const envContent = fs.readFileSync(envLocalPath, "utf-8");
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch {}

import { ProtectionStore } from "./store";
import { ActiveForwardingProxy } from "./proxy";
import {
  RuleSchema,
  ProtectionProposalSchema,
  ScanTargetBindingSchema,
  computeRuleHash,
  computeProposalHash,
} from "./types";
import {
  DEMO_SCENARIO_ID,
  fetchTargetIdentity,
  checkTargetHealth,
  runCandidateScenarioTest,
  BENIGN_TEST_PAYLOAD,
} from "./scenario";

const CONTROLLER_PORT = parseInt(process.env.CONTROLLER_PORT || "8001", 10);
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "8002", 10);
const DEMO_PORT = parseInt(process.env.DEMO_PORT || "8003", 10);
const CONTROLLER_TOKEN =
  process.env.CONTROLLER_TOKEN || "vrc_controller_dev_token_secret";

const CONTROLLER_INSTANCE_ID = crypto.randomUUID();

export class ControllerService {
  private store: ProtectionStore;
  private proxy: ActiveForwardingProxy;
  private controllerServer: http.Server | null = null;
  private isOperationLocked = false;
  private controllerPort: number;
  private proxyPort: number;
  private demoPort: number;
  private lastVerification: {
    verified: boolean;
    timestamp: string | null;
    error: string | null;
  } = { verified: false, timestamp: null, error: null };

  constructor(options?: {
    controllerPort?: number;
    proxyPort?: number;
    demoPort?: number;
    stateFilePath?: string;
  }) {
    this.controllerPort = options?.controllerPort || CONTROLLER_PORT;
    this.proxyPort = options?.proxyPort || PROXY_PORT;
    this.demoPort = options?.demoPort || DEMO_PORT;

    this.store = new ProtectionStore(CONTROLLER_INSTANCE_ID, options?.stateFilePath);
    // Initialize / read state
    const restoredState = this.store.init();

    // Instantiate active proxy with restored active rule (if any)
    this.proxy = new ActiveForwardingProxy({
      proxyPort: this.proxyPort,
      upstreamPort: this.demoPort,
      initialRule: restoredState.activeRule,
    });
  }

  public getProxy(): ActiveForwardingProxy {
    return this.proxy;
  }

  public getStore(): ProtectionStore {
    return this.store;
  }

  private sendJson(
    res: http.ServerResponse,
    statusCode: number,
    data: unknown
  ): void {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
    });
    res.end(body);
  }

  private checkAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const authHeader = req.headers["authorization"] || "";
    const expectedToken = process.env.CONTROLLER_TOKEN || CONTROLLER_TOKEN;
    const expected = `Bearer ${expectedToken}`;
    if (authHeader !== expected) {
      this.sendJson(res, 401, {
        error: "UNAUTHORIZED",
        message: "Invalid or missing controller authorization token",
      });
      return false;
    }
    return true;
  }

  private async parseJsonBody<T>(req: http.IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let body = "";
      let bytes = 0;
      req.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 65536) {
          req.destroy(new Error("Payload too large"));
        } else {
          body += chunk;
        }
      });
      req.on("end", () => {
        try {
          resolve(body.trim() ? (JSON.parse(body) as T) : ({} as T));
        } catch {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", reject);
    });
  }

  private async acquireOperationLock(): Promise<boolean> {
    if (this.isOperationLocked) {
      return false;
    }
    this.isOperationLocked = true;
    return true;
  }

  private releaseOperationLock(): void {
    this.isOperationLocked = false;
  }

  public async start(options?: {
    controllerPort?: number;
    proxyPort?: number;
  }): Promise<{ controllerPort: number; proxyPort: number }> {
    const cPort = options?.controllerPort || this.controllerPort;

    // 1. Start Forwarding Proxy first (with restored rule already configured)
    await this.proxy.start();

    // 2. Start Controller HTTP API
    return new Promise((resolve, reject) => {
      this.controllerServer = http.createServer((req, res) => {
        this.handleControllerRequest(req, res).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (!res.headersSent) {
            this.sendJson(res, 500, { error: "INTERNAL_ERROR", message: msg });
          }
        });
      });

      this.controllerServer.on("error", reject);
      this.controllerServer.listen(cPort, "127.0.0.1", () => {
        resolve({ controllerPort: cPort, proxyPort: this.proxyPort });
      });
    });
  }

  public async stop(): Promise<void> {
    await this.proxy.stop();
    return new Promise((resolve) => {
      if (this.controllerServer) {
        this.controllerServer.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private async handleControllerRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const parsedUrl = new URL(req.url || "/", "http://127.0.0.1");
    const method = req.method || "GET";
    const path = parsedUrl.pathname;

    // Reject non-loopback or cross-origin requests
    if (req.headers.origin) {
      // Validate that origin is loopback if present
      const originUrl = new URL(req.headers.origin);
      if (
        originUrl.hostname !== "127.0.0.1" &&
        originUrl.hostname !== "localhost"
      ) {
        return this.sendJson(res, 403, {
          error: "FORBIDDEN",
          message: "Cross-origin requests are forbidden",
        });
      }
    }

    // Require token authentication
    if (!this.checkAuth(req, res)) {
      return;
    }

    // ROUTE: GET /status
    if (method === "GET" && path === "/status") {
      const state = this.store.getStateSync();
      const health = await checkTargetHealth(this.demoPort);

      return this.sendJson(res, 200, {
        controllerInstanceId: CONTROLLER_INSTANCE_ID,
        ruleRevision: state.ruleRevision,
        activeRule: this.proxy.getActiveRule(),
        activatedAt: state.activatedAt,
        relatedApprovalId: state.relatedApprovalId,
        relatedTestRunId: state.relatedTestRunId,
        upstreamHealth: {
          healthy: health.healthy,
          status: health.status || null,
          error: health.error || null,
          targetInstanceId: health.targetInstanceId || null,
          lastChecked: new Date().toISOString(),
        },
        blockedCount: this.proxy.getBlockedCount(),
        lastVerification: this.lastVerification,
      });
    }

    // ROUTE: POST /proposals
    if (method === "POST" && path === "/proposals") {
      try {
        const body = await this.parseJsonBody<{
          scenarioId: string;
          binding: unknown;
          rule: unknown;
          explanation?: string;
          evidenceReferences?: string[];
          functionalityCost?: string;
          limitations?: string[];
          aiStatus?: "enriched" | "deterministic_fallback" | "unavailable";
        }>(req);

        if (body.scenarioId !== DEMO_SCENARIO_ID) {
          return this.sendJson(res, 400, {
            error: "UNSUPPORTED_SCENARIO",
            message: `Only scenario '${DEMO_SCENARIO_ID}' is supported`,
          });
        }

        const validBinding = ScanTargetBindingSchema.parse(body.binding);
        const validRule = RuleSchema.parse(body.rule);

        const ruleHash = computeRuleHash(validRule);
        const proposalHash = computeProposalHash(
          validRule,
          validBinding,
          body.scenarioId
        );

        const proposal = {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          scenarioId: body.scenarioId,
          binding: validBinding,
          rule: validRule,
          ruleHash,
          proposalHash,
          explanation:
            body.explanation ||
            "Temporary containment rule proposing to disable route /preview due to unpatched prototype pollution in lodash 4.17.11 (GHSA-jf85-cpcp-j695).",
          evidenceReferences: body.evidenceReferences || [
            "GHSA-jf85-cpcp-j695",
            "CVE-2019-10744",
          ],
          functionalityCost:
            body.functionalityCost ||
            "Preview functionality will return HTTP 503 until rollback. Unrelated routes (/health, /catalog) remain operational.",
          limitations: body.limitations || [
            "Local proxy containment only; does not patch the underlying lodash package.",
            "Only traffic routed through proxy port 8002 is contained.",
            "Does not replace upgrading lodash to 4.17.12+.",
          ],
          aiStatus: body.aiStatus || "deterministic_fallback",
        };

        const validatedProposal = ProtectionProposalSchema.parse(proposal);
        await this.store.addProposal(validatedProposal);

        return this.sendJson(res, 201, validatedProposal);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return this.sendJson(res, 400, {
          error: "INVALID_PROPOSAL_PAYLOAD",
          message: msg,
        });
      }
    }

    // ROUTE: POST /tests
    if (method === "POST" && path === "/tests") {
      const lockAcquired = await this.acquireOperationLock();
      if (!lockAcquired) {
        return this.sendJson(res, 409, {
          error: "OPERATION_IN_PROGRESS",
          message: "Another protection operation is currently in progress.",
        });
      }

      try {
        const body = await this.parseJsonBody<{ proposalId: string }>(req);
        if (!body.proposalId) {
          return this.sendJson(res, 400, {
            error: "MISSING_PROPOSAL_ID",
            message: "proposalId is required",
          });
        }

        const proposal = this.store.getProposalSync(body.proposalId);
        if (!proposal) {
          return this.sendJson(res, 404, {
            error: "PROPOSAL_NOT_FOUND",
            message: `Proposal ${body.proposalId} was not found`,
          });
        }

        const testRun = await runCandidateScenarioTest({
          upstreamPort: this.demoPort,
          candidateRule: proposal.rule,
          binding: proposal.binding,
          proposalId: proposal.id,
          proposalHash: proposal.proposalHash,
          controllerInstanceId: CONTROLLER_INSTANCE_ID,
        });

        await this.store.addTestRun(testRun);
        return this.sendJson(res, 200, testRun);
      } finally {
        this.releaseOperationLock();
      }
    }

    // ROUTE: POST /approvals
    if (method === "POST" && path === "/approvals") {
      try {
        const body = await this.parseJsonBody<{
          proposalHash: string;
          testRunId: string;
          acknowledgedFunctionalityLoss: boolean;
          operatorNote?: string;
        }>(req);

        if (!body.acknowledgedFunctionalityLoss) {
          return this.sendJson(res, 400, {
            error: "ACKNOWLEDGEMENT_REQUIRED",
            message:
              "Developer must acknowledge preview functionality loss before approval can be granted.",
          });
        }

        const testRun = this.store.getTestRunSync(body.testRunId);
        if (!testRun) {
          return this.sendJson(res, 404, {
            error: "TEST_RUN_NOT_FOUND",
            message: `Test run ${body.testRunId} was not found`,
          });
        }

        if (testRun.status !== "passed") {
          return this.sendJson(res, 400, {
            error: "TEST_NOT_PASSED",
            message: `Test run ${body.testRunId} did not pass (status: ${testRun.status})`,
          });
        }

        if (new Date(testRun.expiresAt).getTime() < Date.now()) {
          return this.sendJson(res, 400, {
            error: "TEST_RUN_EXPIRED",
            message: "Test run has expired (older than 15 minutes). Retest required.",
          });
        }

        if (testRun.proposalHash !== body.proposalHash) {
          return this.sendJson(res, 400, {
            error: "PROPOSAL_HASH_MISMATCH",
            message: "Test run was not performed on this proposal hash",
          });
        }

        const approval = {
          id: crypto.randomUUID(),
          proposalHash: body.proposalHash,
          testRunId: body.testRunId,
          binding: testRun.binding,
          createdAt: new Date().toISOString(),
          operatorNote:
            body.operatorNote || "Local operator confirmed preview functionality loss acknowledgement",
          acknowledgedFunctionalityLoss: true,
          consumed: false,
        };

        await this.store.addApproval(approval);
        return this.sendJson(res, 201, approval);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return this.sendJson(res, 400, {
          error: "INVALID_APPROVAL_REQUEST",
          message: msg,
        });
      }
    }

    // ROUTE: POST /activate
    if (method === "POST" && path === "/activate") {
      const lockAcquired = await this.acquireOperationLock();
      if (!lockAcquired) {
        return this.sendJson(res, 409, {
          error: "OPERATION_IN_PROGRESS",
          message: "Another protection operation is currently in progress.",
        });
      }

      try {
        const body = await this.parseJsonBody<{ approvalId: string }>(req);
        if (!body.approvalId) {
          return this.sendJson(res, 400, {
            error: "MISSING_APPROVAL_ID",
            message: "approvalId is required",
          });
        }

        const approval = this.store.getApprovalSync(body.approvalId);
        if (!approval) {
          return this.sendJson(res, 404, {
            error: "APPROVAL_NOT_FOUND",
            message: `Approval ${body.approvalId} was not found`,
          });
        }

        const testRun = this.store.getTestRunSync(approval.testRunId);
        if (!testRun) {
          return this.sendJson(res, 404, {
            error: "TEST_RUN_NOT_FOUND",
            message: `Associated test run ${approval.testRunId} was not found`,
          });
        }

        if (new Date(testRun.expiresAt).getTime() < Date.now()) {
          return this.sendJson(res, 400, {
            error: "TEST_RUN_EXPIRED",
            message: "Test evidence expired (> 15 min). Candidate must be retested.",
          });
        }

        // Target integrity re-check
        let currentTarget: { targetFingerprint: string; targetInstanceId: string; packageVersion: string };
        try {
          currentTarget = await fetchTargetIdentity(this.demoPort);
        } catch {
          return this.sendJson(res, 502, {
            error: "TARGET_UNAVAILABLE",
            message: "Cannot activate rule: demo service on port 8003 is unreachable.",
          });
        }

        if (currentTarget.targetFingerprint !== testRun.binding.targetFingerprint) {
          return this.sendJson(res, 400, {
            error: "TARGET_FINGERPRINT_MISMATCH",
            message: "Demo source fingerprint changed since test run. Retest required.",
          });
        }

        const proposal = this.store.getProposalSync(testRun.proposalId);
        if (!proposal) {
          return this.sendJson(res, 404, {
            error: "PROPOSAL_NOT_FOUND",
            message: "Proposal not found",
          });
        }

        // Idempotency: If this exact rule is already active, return success
        const currentActive = this.proxy.getActiveRule();
        if (
          currentActive &&
          currentActive.kind === proposal.rule.kind &&
          currentActive.path === proposal.rule.path
        ) {
          return this.sendJson(res, 200, {
            success: true,
            rule: currentActive,
            message: "Rule already active",
            lastVerification: this.lastVerification,
          });
        }

        // Atomically install rule on active proxy
        this.proxy.setActiveRule(proposal.rule);

        // Update controller store
        const { ruleRevision, activatedAt } = await this.store.activateRule({
          rule: proposal.rule,
          approvalId: approval.id,
          testRunId: testRun.id,
        });

        // Bounded post-activation verification check on active proxy
        // Uses benign request to confirm 503 on /preview and 200 on /catalog
        try {
          const previewCheck = await fetch(`http://127.0.0.1:${this.proxyPort}/preview`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(BENIGN_TEST_PAYLOAD),
            signal: AbortSignal.timeout(3000),
          });
          const catalogCheck = await fetch(`http://127.0.0.1:${this.proxyPort}/catalog`, {
            signal: AbortSignal.timeout(3000),
          });

          if (previewCheck.status === 503 && catalogCheck.status === 200) {
            this.lastVerification = {
              verified: true,
              timestamp: new Date().toISOString(),
              error: null,
            };
          } else {
            this.lastVerification = {
              verified: false,
              timestamp: new Date().toISOString(),
              error: `Post-activation check unexpected status: /preview=${previewCheck.status}, /catalog=${catalogCheck.status}`,
            };
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.lastVerification = {
            verified: false,
            timestamp: new Date().toISOString(),
            error: `Post-activation probe failed: ${msg}`,
          };
        }

        return this.sendJson(res, 200, {
          success: true,
          ruleRevision,
          activatedAt,
          activeRule: proposal.rule,
          lastVerification: this.lastVerification,
        });
      } finally {
        this.releaseOperationLock();
      }
    }

    // ROUTE: POST /rollback
    if (method === "POST" && path === "/rollback") {
      const lockAcquired = await this.acquireOperationLock();
      if (!lockAcquired) {
        return this.sendJson(res, 409, {
          error: "OPERATION_IN_PROGRESS",
          message: "Another protection operation is currently in progress.",
        });
      }

      try {
        const body = await this.parseJsonBody<{ reason?: string }>(req);

        // Remove rule from active proxy
        this.proxy.setActiveRule(null);

        const { ruleRevision } = await this.store.rollbackRule({
          reason: body.reason,
        });

        // Post-rollback verification check
        try {
          const catalogCheck = await fetch(`http://127.0.0.1:${this.proxyPort}/catalog`, {
            signal: AbortSignal.timeout(3000),
          });
          const previewCheck = await fetch(`http://127.0.0.1:${this.proxyPort}/preview`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(BENIGN_TEST_PAYLOAD),
            signal: AbortSignal.timeout(3000),
          });

          if (catalogCheck.status === 200 && previewCheck.status === 200) {
            this.lastVerification = {
              verified: true,
              timestamp: new Date().toISOString(),
              error: null,
            };
          } else {
            this.lastVerification = {
              verified: false,
              timestamp: new Date().toISOString(),
              error: `Post-rollback check failed: /preview=${previewCheck.status}, /catalog=${catalogCheck.status}`,
            };
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.lastVerification = {
            verified: false,
            timestamp: new Date().toISOString(),
            error: `Post-rollback probe failed: ${msg}`,
          };
        }

        return this.sendJson(res, 200, {
          success: true,
          rolledBack: true,
          ruleRevision,
          activeRule: null,
          lastVerification: this.lastVerification,
        });
      } finally {
        this.releaseOperationLock();
      }
    }

    // ROUTE: GET /history
    if (method === "GET" && path === "/history") {
      const history = this.store.getHistorySync(30);
      return this.sendJson(res, 200, { history });
    }

    return this.sendJson(res, 404, {
      error: "NOT_FOUND",
      message: `Endpoint ${method} ${path} not found on controller`,
    });
  }
}

// Standalone execution entry point
if (require.main === module) {
  const service = new ControllerService();
  service
    .start()
    .then(({ controllerPort, proxyPort }) => {
      console.log(
        `[VRC Protection Controller] Listening on 127.0.0.1:${controllerPort}`
      );
      console.log(
        `[VRC Forwarding Proxy] Listening on 127.0.0.1:${proxyPort} -> Upstream 127.0.0.1:${DEMO_PORT}`
      );
    })
    .catch((err) => {
      console.error("[VRC Protection Controller] Startup failed:", err);
      process.exit(1);
    });

  const handleShutdown = async () => {
    console.log("\n[VRC Protection Controller] Shutting down...");
    await service.stop();
    process.exit(0);
  };

  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);
}
