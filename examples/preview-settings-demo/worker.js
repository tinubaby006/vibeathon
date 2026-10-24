// examples/preview-settings-demo/worker.js
// Disposable child process worker executing lodash.defaultsDeep in isolation.
// Exits immediately after processing one request.

const path = require("node:path");
const _ = require("lodash");

const DEMO_MARKER_KEY = "__vrc_demo_marker__";
const MAX_INPUT_BYTES = 8192; // 8 KiB limit

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    let byteLength = 0;

    process.stdin.setEncoding("utf-8");

    process.stdin.on("data", (chunk) => {
      byteLength += Buffer.byteLength(chunk);
      if (byteLength > MAX_INPUT_BYTES) {
        process.stdin.pause();
        return reject(new Error(`Input exceeded maximum size limit of ${MAX_INPUT_BYTES} bytes`));
      }
      data += chunk;
    });

    process.stdin.on("end", () => {
      resolve(data);
    });

    process.stdin.on("error", (err) => {
      reject(err);
    });
  });
}

async function run() {
  try {
    const rawInput = await readStdin();
    let parsedInput = {};
    if (rawInput && rawInput.trim()) {
      parsedInput = JSON.parse(rawInput);
    }

    // Baseline object before merge
    const probeBefore = {};
    const pollutedBefore = DEMO_MARKER_KEY in probeBefore;

    // Default template settings for preview
    const defaultSettings = {
      theme: "dark",
      compactView: false,
      pageSize: 25,
      previewHeader: "Preview Settings Demo"
    };

    // Execute vulnerable defaultsDeep merge
    // In lodash 4.17.11, defaultsDeep with payload targeting constructor.prototype
    // pollutes Object.prototype directly.
    const mergedResult = _.defaultsDeep({}, parsedInput, defaultSettings);

    // Verify pollution on a fresh, unrelated object
    const freshProbe = {};
    const hasInheritedMarker = (DEMO_MARKER_KEY in freshProbe) &&
      !Object.prototype.hasOwnProperty.call(freshProbe, DEMO_MARKER_KEY);
    const markerValue = hasInheritedMarker ? freshProbe[DEMO_MARKER_KEY] : null;

    const response = {
      ok: true,
      preview: mergedResult,
      prototypePolluted: hasInheritedMarker,
      markerValue: markerValue,
      pollutedBefore: pollutedBefore
    };

    const outputJson = JSON.stringify(response);
    process.stdout.write(outputJson);
    process.exit(0);
  } catch (err) {
    const errorResponse = {
      ok: false,
      error: err.message || "Worker execution failed"
    };
    process.stdout.write(JSON.stringify(errorResponse));
    process.exit(1);
  }
}

run();
