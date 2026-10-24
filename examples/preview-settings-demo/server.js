// examples/preview-settings-demo/server.js
// Preview Settings Demo HTTP Server
// Exposes /health, /catalog, POST /preview, and /__demo/identity

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const PORT = parseInt(process.env.DEMO_PORT || "8003", 10);
const HOST = "127.0.0.1";
const WORKER_SCRIPT = path.join(__dirname, "worker.js");
const TARGET_INSTANCE_ID = crypto.randomUUID();

let previewRequestCounter = 0;
let activeWorkers = 0;
const MAX_CONCURRENT_WORKERS = 2;
const MAX_BODY_BYTES = 8192; // 8 KiB
const MAX_OUTPUT_BYTES = 16384; // 16 KiB
const WORKER_TIMEOUT_MS = 2000; // 2 seconds

// Compute stable target fingerprint across demo manifest and code
function computeTargetFingerprint() {
  const hash = crypto.createHash("sha256");
  const filesToHash = [
    path.join(__dirname, "package.json"),
    path.join(__dirname, "package-lock.json"),
    path.join(__dirname, "server.js"),
    path.join(__dirname, "worker.js"),
  ];

  for (const f of filesToHash) {
    if (fs.existsSync(f)) {
      hash.update(path.basename(f));
      hash.update(fs.readFileSync(f));
    }
  }
  return hash.digest("hex");
}

const TARGET_FINGERPRINT = computeTargetFingerprint();

// Bounded JSON helper
function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function handleHealth(_req, res) {
  sendJson(res, 200, {
    status: "ok",
    service: "preview-settings-demo",
    uptime: process.uptime(),
    instanceId: TARGET_INSTANCE_ID,
  });
}

function handleCatalog(_req, res) {
  sendJson(res, 200, {
    service: "preview-settings-demo",
    catalog: [
      { id: "theme-light", name: "Standard Light Theme", density: "comfortable" },
      { id: "theme-dark", name: "Console Dark Theme", density: "compact" },
      { id: "theme-high-contrast", name: "High Contrast Theme", density: "spacious" },
    ],
  });
}

function handleIdentity(_req, res) {
  sendJson(res, 200, {
    service: "preview-settings-demo",
    scenarioId: "demo-scenario-lodash-4.17.11",
    packageName: "lodash",
    packageVersion: "4.17.11",
    advisoryId: "GHSA-jf85-cpcp-j695",
    cveId: "CVE-2019-10744",
    targetInstanceId: TARGET_INSTANCE_ID,
    targetFingerprint: TARGET_FINGERPRINT,
    previewRequestCounter: previewRequestCounter,
  });
}

function handlePreview(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method Not Allowed. Use POST." });
  }

  if (activeWorkers >= MAX_CONCURRENT_WORKERS) {
    return sendJson(res, 503, {
      error: "Service Busy",
      message: "Maximum concurrent preview workers active. Try again shortly.",
    });
  }

  let body = "";
  let bytesReceived = 0;

  req.on("data", (chunk) => {
    bytesReceived += chunk.length;
    if (bytesReceived > MAX_BODY_BYTES) {
      req.destroy(new Error("Payload Too Large"));
    } else {
      body += chunk;
    }
  });

  req.on("error", (err) => {
    sendJson(res, 413, { error: "Payload Too Large", message: err.message });
  });

  req.on("end", () => {
    // Increment counter indicating request reached upstream server
    previewRequestCounter++;

    // Validate JSON input
    if (body.trim()) {
      try {
        JSON.parse(body);
      } catch (err) {
        return sendJson(res, 400, { error: "Invalid JSON", message: err.message });
      }
    }

    activeWorkers++;
    let settled = false;

    // Minimal sanitized environment without console secrets
    const sanitizedEnv = {
      PATH: process.env.PATH || "",
      SYSTEMROOT: process.env.SYSTEMROOT || "",
      NODE_ENV: "production",
    };

    const worker = spawn(
      process.execPath,
      ["--max-old-space-size=64", WORKER_SCRIPT],
      {
        cwd: __dirname,
        env: sanitizedEnv,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    let stdoutData = "";
    let stdoutBytes = 0;
    let stderrData = "";

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        activeWorkers = Math.max(0, activeWorkers - 1);
        try {
          worker.kill("SIGKILL");
        } catch {}
        sendJson(res, 504, { error: "Worker Timeout", message: "Preview calculation timed out" });
      }
    }, WORKER_TIMEOUT_MS);

    worker.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        if (!settled) {
          settled = true;
          activeWorkers = Math.max(0, activeWorkers - 1);
          clearTimeout(timer);
          try {
            worker.kill("SIGKILL");
          } catch {}
          sendJson(res, 500, { error: "Worker Output Exceeded Limit" });
        }
      } else {
        stdoutData += chunk;
      }
    });

    worker.stderr.on("data", (chunk) => {
      stderrData += chunk;
    });

    worker.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeWorkers = Math.max(0, activeWorkers - 1);

      if (exitCode !== 0) {
        return sendJson(res, 500, {
          error: "Worker Error",
          message: stderrData || "Preview process failed",
        });
      }

      try {
        const result = JSON.parse(stdoutData);
        sendJson(res, 200, result);
      } catch (parseErr) {
        sendJson(res, 500, {
          error: "Invalid Worker Output",
          message: parseErr.message,
        });
      }
    });

    worker.on("error", (spawnErr) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeWorkers = Math.max(0, activeWorkers - 1);
      sendJson(res, 500, { error: "Worker Spawn Failed", message: spawnErr.message });
    });

    // Write input payload to worker stdin
    worker.stdin.write(body || "{}");
    worker.stdin.end();
  });
}

const server = http.createServer((req, res) => {
  const urlPath = req.url ? req.url.split("?")[0] : "/";

  if (urlPath === "/health" || urlPath === "/health/") {
    return handleHealth(req, res);
  }
  if (urlPath === "/catalog" || urlPath === "/catalog/") {
    return handleCatalog(req, res);
  }
  if (urlPath === "/preview" || urlPath === "/preview/") {
    return handlePreview(req, res);
  }
  if (urlPath === "/__demo/identity") {
    return handleIdentity(req, res);
  }

  sendJson(res, 404, { error: "Not Found", path: urlPath });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`[preview-settings-demo] listening on http://${HOST}:${PORT}`);
  });
}

module.exports = {
  server,
  PORT,
  HOST,
  computeTargetFingerprint,
};
