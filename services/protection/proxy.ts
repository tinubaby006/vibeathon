// services/protection/proxy.ts
// Shared loopback reverse proxy and rule evaluator for Checkpoint 2.
// Evaluates disable_route, blocks before upstream dispatch, and normalizes paths strictly.

import http from "node:http";
import { Rule } from "./types";

export interface ProxyOptions {
  upstreamPort: number;
  upstreamHost?: string;
  initialRule?: Rule | null;
  onBlocked?: (rule: Rule, req: http.IncomingMessage) => void;
}

export function validateAndCanonicalizePath(rawUrl: string): {
  valid: boolean;
  pathname?: string;
  search?: string;
  error?: string;
} {
  // Reject backslashes
  if (rawUrl.includes("\\")) {
    return { valid: false, error: "Backslash path separators are forbidden" };
  }

  // Reject ambiguous encoded separators (%2f, %2F, %5c, %5C)
  if (/(%2f|%5c)/i.test(rawUrl)) {
    return { valid: false, error: "Ambiguous encoded path separators are forbidden" };
  }

  // Reject unsupported absolute-form request targets (e.g. http://...)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawUrl)) {
    return { valid: false, error: "Absolute-form request URIs are forbidden" };
  }

  // Reject directory traversal sequences in raw URL
  const rawSegments = rawUrl.split(/[/?#]/);
  for (const seg of rawSegments) {
    if (seg === ".." || seg === ".") {
      return { valid: false, error: "Directory traversal sequences are forbidden" };
    }
  }

  try {
    const parsed = new URL(rawUrl, "http://127.0.0.1");

    // Check for directory traversal in pathname segments
    const segments = parsed.pathname.split("/");
    for (const segment of segments) {
      if (segment === ".." || segment === ".") {
        return { valid: false, error: "Directory traversal sequences are forbidden" };
      }
    }

    return {
      valid: true,
      pathname: parsed.pathname,
      search: parsed.search,
    };
  } catch {
    return { valid: false, error: "Malformed request URI" };
  }
}

export function evaluateRule(
  rule: Rule | null,
  canonicalPath: string
): { block: boolean; rule?: Rule } {
  if (!rule) return { block: false };

  if (rule.kind === "disable_route") {
    // Normalize path by removing trailing slash (unless it is root '/')
    let normalized = canonicalPath;
    if (normalized.length > 1 && normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }

    if (normalized === rule.path) {
      return { block: true, rule };
    }
  }

  return { block: false };
}

export function createProxyHandler(options: {
  upstreamPort: number;
  upstreamHost?: string;
  getRule: () => Rule | null;
  onBlocked?: (rule: Rule, req: http.IncomingMessage) => void;
  allowDemoIdentity?: boolean; // Ephemeral proxy or tests may or may not expose internal identity
}): http.RequestListener {
  const upstreamHost = options.upstreamHost || "127.0.0.1";
  const upstreamPort = options.upstreamPort;

  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    const rawUrl = req.url || "/";

    // 1. Strict Canonical Path Validation
    const pathCheck = validateAndCanonicalizePath(rawUrl);
    if (!pathCheck.valid || !pathCheck.pathname) {
      const errBody = JSON.stringify({
        error: "INVALID_REQUEST_PATH",
        message: pathCheck.error || "Invalid request path",
      });
      res.writeHead(400, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(errBody),
        "Cache-Control": "no-store",
      });
      return res.end(errBody);
    }

    const pathname = pathCheck.pathname;

    // 2. Protect Internal / Demo Identity Endpoints from Public Proxy Forwarding
    if (!options.allowDemoIdentity && pathname.startsWith("/__demo")) {
      const forbiddenBody = JSON.stringify({
        error: "FORBIDDEN_INTERNAL_PATH",
        message: "Internal control endpoints cannot be accessed through the forwarding proxy.",
      });
      res.writeHead(403, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(forbiddenBody),
        "Cache-Control": "no-store",
      });
      return res.end(forbiddenBody);
    }

    // 3. Shared Rule Evaluation
    const currentRule = options.getRule();
    const evaluation = evaluateRule(currentRule, pathname);

    if (evaluation.block && evaluation.rule) {
      if (options.onBlocked) {
        options.onBlocked(evaluation.rule, req);
      }

      const blockedBody = JSON.stringify({
        error: "ROUTE_TEMPORARILY_DISABLED",
        message:
          "Preview functionality is temporarily disabled by active containment rule. Unrelated routes remain available.",
        rule: evaluation.rule,
      });

      res.writeHead(503, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(blockedBody),
        "Cache-Control": "no-store",
      });
      // CRITICAL: Immediately terminate response. ZERO upstream dispatch!
      return res.end(blockedBody);
    }

    // 4. Safe Forwarding to Upstream
    // Sanitize headers: remove auth/cookie/controller credentials
    const headers = { ...req.headers };
    delete headers["authorization"];
    delete headers["cookie"];
    delete headers["x-controller-token"];
    headers["host"] = `${upstreamHost}:${upstreamPort}`;
    headers["x-forwarded-for"] = req.socket.remoteAddress || "127.0.0.1";
    headers["x-forwarded-proto"] = "http";

    const proxyReq = http.request(
      {
        host: upstreamHost,
        port: upstreamPort,
        method: req.method,
        path: req.url,
        headers,
        timeout: 10000,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on("error", (err: unknown) => {
      if (!res.headersSent) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const errBody = JSON.stringify({
          error: "UPSTREAM_UNAVAILABLE",
          message: "Failed to communicate with upstream service",
          details: errorMsg,
        });
        res.writeHead(502, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": Buffer.byteLength(errBody),
          "Cache-Control": "no-store",
        });
        res.end(errBody);
      }
    });

    proxyReq.on("timeout", () => {
      proxyReq.destroy(new Error("Upstream timeout"));
    });

    req.pipe(proxyReq);
  };
}

export class ActiveForwardingProxy {
  private server: http.Server | null = null;
  private activeRule: Rule | null = null;
  private blockedCount = 0;
  private upstreamPort: number;
  private proxyPort: number;

  constructor(options: { upstreamPort: number; proxyPort: number; initialRule?: Rule | null }) {
    this.upstreamPort = options.upstreamPort;
    this.proxyPort = options.proxyPort;
    this.activeRule = options.initialRule || null;
  }

  public setActiveRule(rule: Rule | null): void {
    this.activeRule = rule;
  }

  public getActiveRule(): Rule | null {
    return this.activeRule;
  }

  public getBlockedCount(): number {
    return this.blockedCount;
  }

  public resetBlockedCount(): void {
    this.blockedCount = 0;
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const handler = createProxyHandler({
        upstreamPort: this.upstreamPort,
        getRule: () => this.activeRule,
        onBlocked: () => {
          this.blockedCount += 1;
        },
        allowDemoIdentity: false,
      });

      this.server = http.createServer(handler);
      this.server.on("error", reject);

      this.server.listen(this.proxyPort, "127.0.0.1", () => {
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

// Factory for ephemeral isolated test proxy on dynamically assigned loopback port
export function createEphemeralProxy(options: {
  upstreamPort: number;
  candidateRule: Rule | null;
}): Promise<{
  port: number;
  server: http.Server;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    let closed = false;
    const handler = createProxyHandler({
      upstreamPort: options.upstreamPort,
      getRule: () => options.candidateRule,
      allowDemoIdentity: false,
    });

    const server = http.createServer(handler);
    server.on("error", reject);

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;

      const close = () =>
        new Promise<void>((resClose) => {
          if (closed) return resClose();
          closed = true;
          server.close(() => resClose());
        });

      resolve({ port, server, close });
    });
  });
}
