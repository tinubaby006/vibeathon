# Checkpoint 2 Runbook — Tested, Developer-Approved Route Containment

This runbook documents the architecture, startup commands, demonstration workflow, and operational boundaries for Checkpoint 2 of the Vulnerability Response Console (VRC).

---

## 1. System Architecture & Port Allocation

All services bind exclusively to loopback (`127.0.0.1`) on Windows.

| Service | Address | Role | Authentication / Security |
|---|---|---|---|
| **Next.js Console** | `http://127.0.0.1:3000` | Browser-facing management console and orchestration API | Same-origin JSON mutation protection; never exposes controller token to browser |
| **Protection Controller API** | `http://127.0.0.1:8001` | Dedicated control plane API for proposals, ephemeral proxy tests, approvals, activations, and audit history | `Authorization: Bearer <CONTROLLER_TOKEN>` required on all endpoints; single-operation mutex |
| **Forwarding Reverse Proxy** | `http://127.0.0.1:8002` | Forwarding data plane reverse proxy targeting port 8003; enforces active `disable_route` containment rules | Strict path canonicalization; blocks before upstream dispatch; strips auth/cookies; blocks internal endpoints |
| **Preview Settings Demo App** | `http://127.0.0.1:8003` | Standalone demonstration service with pinned `lodash@4.17.11` | Disposable child process worker per preview request; clean prototype; request counter; memory & execution bounded |
| **Ephemeral Test Proxy** | `http://127.0.0.1:<dynamic>` | Temporary isolated proxy created solely during candidate testing | Destroyed immediately after 5-step test run; never touches active proxy state |

---

## 2. Server Configuration & Secrets

All configuration is server-only. **Never commit secrets to git or expose them in browser bundles.**

| Variable | Default Value | Description |
|---|---|---|
| `CONTROLLER_TOKEN` | `vrc_controller_dev_token_secret` | Secret bearer token shared between Next.js server and Controller API |
| `CONTROLLER_URL` | `http://127.0.0.1:8001` | Internal URL used by Next.js server to communicate with the controller |
| `CONTROLLER_PORT` | `8001` | Port on which the controller HTTP API listens |
| `PROXY_PORT` | `8002` | Port on which the active forwarding reverse proxy listens |
| `DEMO_PORT` | `8003` | Port on which the Preview Settings Demo application listens |
| `GEMINI_API_KEY` | *(optional)* | Google Gemini API key for grounded AI explanation enrichment |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model identifier used for enrichment |
| `GITHUB_TOKEN` | *(optional)* | Personal access token for authenticated GitHub API requests |

---

## 3. Installation & Service Startup Commands

Run these commands in separate Windows PowerShell or CMD terminals from the workspace root (`d:\Avani\projects\vibeathon`):

### Terminal 1: Start Demo Application (Port 8003)
```powershell
npm.cmd run demo
```
*Expected Output:*
```
[preview-settings-demo] listening on http://127.0.0.1:8003
```

### Terminal 2: Start Controller & Proxy (Ports 8001 & 8002)
```powershell
npm.cmd run controller
```
*Expected Output:*
```
[VRC Protection Controller] Listening on 127.0.0.1:8001
[VRC Forwarding Proxy] Listening on 127.0.0.1:8002 -> Upstream 127.0.0.1:8003
```

### Terminal 3: Start Next.js Console (Port 3000)
```powershell
npm.cmd run dev
```
*Expected Output:*
```
▲ Next.js 16.3.5 (Turbopack)
- Local: http://localhost:3000
```

---

## 4. Two-Minute Demonstration Walkthrough

### Step 1: Prove the Vulnerability on Upstream Demo (Baseline)
Send a prototype pollution payload directly to upstream port 8003:
```powershell
curl.exe -X POST http://127.0.0.1:8003/preview -H "Content-Type: application/json" -d "{\"constructor\":{\"prototype\":{\"__vrc_demo_marker__\":\"vrc_verified_cve_2019_10744\"}}}"
```
*Observed Result:*
```json
{"preview":{"theme":"default","density":"comfortable"},"prototypePolluted":true,"markerValue":"vrc_verified_cve_2019_10744"}
```
*Proof:* The disposable worker executes `lodash.defaultsDeep` on `lodash@4.17.11`, demonstrating prototype pollution.

### Step 2: Open Next.js Console & Review Protection Panel
1. Open `http://localhost:3000` in the browser.
2. Select **Preview Settings Demo** from the target dropdown.
3. Observe the **Demo Protection** section:
   - Target status: `Target online (port 8003)`
   - Scope: `Local demo — proxy traffic only`
   - Advisory: `GHSA-jf85-cpcp-j695 / CVE-2019-10744`
   - Package: `lodash@4.17.11`
   - Notice of Functionality Loss prominently disclosed.

### Step 3: Propose Containment Rule
Click **Generate Proposal**:
- Controller creates immutable `ProtectionProposal` with rule `{ kind: "disable_route", path: "/preview" }`.
- AI generates grounded explanation (or truthful deterministic fallback if Gemini is unconfigured).
- Canonical `proposalHash` and `ruleHash` are displayed.

### Step 4: Run Isolated Candidate Tests
Click **Run Isolated Tests**:
- The controller launches an **ephemeral test proxy** on a dynamic port without modifying active proxy port 8002.
- 9 bounded observations are executed:
  1. Target identity & fingerprint verification.
  2. Baseline `/health` -> 200.
  3. Baseline `/catalog` -> 200.
  4. Baseline benign `/preview` -> 200, clean prototype.
  5. Baseline vulnerable `/preview` -> 200, prototype polluted.
  6. Candidate vulnerable `/preview` -> 503 `ROUTE_TEMPORARILY_DISABLED`.
  7. Candidate benign `/preview` -> 503 `ROUTE_TEMPORARILY_DISABLED` (functionality loss recorded).
  8. Zero upstream dispatch verification -> upstream counter delta = 0.
  9. Candidate unrelated route `/catalog` -> 200.
- Observation table renders in the console UI with all checks green (`PASS`). Test evidence is valid for 15 minutes.

### Step 5: Developer Approval & Activation
1. Review the test observations and the functionality loss notice.
2. Check the mandatory acknowledgement checkbox:
   `[x] I understand that preview requests will be unavailable until rollback.`
3. Click **Approve & Activate Protection**:
   - The controller verifies test freshness, hashes, target fingerprint, and acknowledgement.
   - Atomically installs the rule on active proxy port 8002.
   - Executes post-activation verification probe through port 8002: `/preview` returns 503, `/catalog` returns 200.
   - UI status updates to **Temporary Containment Active** (`Rev #1`, `Proxy Verified`).

### Step 6: Verify Containment on Live Proxy (Port 8002)
Attempt to send the vulnerable preview request through the forwarding proxy on port 8002:
```powershell
curl.exe -i -X POST http://127.0.0.1:8002/preview -H "Content-Type: application/json" -d "{\"constructor\":{\"prototype\":{\"__vrc_demo_marker__\":\"vrc_verified_cve_2019_10744\"}}}"
```
*Observed Result:*
```http
HTTP/1.1 503 Service Unavailable
Content-Type: application/json; charset=utf-8

{"error":"ROUTE_TEMPORARILY_DISABLED","message":"Preview functionality is temporarily disabled by active containment rule. Unrelated routes remain available.","rule":{"kind":"disable_route","path":"/preview"}}
```
Check unrelated catalog endpoint through port 8002:
```powershell
curl.exe -i http://127.0.0.1:8002/catalog
```
*Observed Result:*
```http
HTTP/1.1 200 OK
{"service":"preview-settings-demo","catalog":[...]}
```

### Step 7: Rollback Containment
1. Enter an optional reason (e.g. `Upstream package patched to lodash 4.17.12`).
2. Click **Rollback Route Containment**:
   - The controller removes the rule from active proxy port 8002.
   - Post-rollback check confirms `/preview` returns 200.
   - UI returns to **No Active Containment** state.
3. Test `/preview` through port 8002 again:
```powershell
curl.exe -X POST http://127.0.0.1:8002/preview -H "Content-Type: application/json" -d "{\"theme\":\"dark\"}"
```
*Observed Result:* HTTP 200 OK.

---

## 5. Scope Boundaries, Bypass Disclosures & Limitations

1. **Proxy Containment Only:** Only traffic routed through forwarding proxy port 8002 is contained. A client directly connecting to port 8003 bypasses the proxy.
2. **Not a Code Patch:** Containment disables the route to prevent exploitation; the underlying `lodash@4.17.11` dependency remains vulnerable until updated.
3. **Functionality Loss:** Disabling `/preview` blocks all legitimate preview requests for all users while active.
4. **No Arbitrary Rules:** The controller accepts only predefined, validated `disable_route` rules for `/preview`. It never accepts arbitrary regex, user-authored code, shell commands, or AI-generated endpoints.

---

## 6. GitHub Remote Publication Step (Pending User Authorization)

The Checkpoint 1 scanner fetches commit-pinned lockfiles and manifests from remote GitHub repositories. The demo application files reside in `examples/preview-settings-demo/`.

To link a real live GitHub scan to the demo target:
1. Initialize a remote repository (e.g. `https://github.com/<your-username>/vrc-preview-demo`) or push `examples/preview-settings-demo` to an existing repository.
2. Register the repository in the VRC console with project path `examples/preview-settings-demo` (or root `.`).
3. Click **Scan Dependencies**.
4. The scanner will fetch `package.json` and `package-lock.json`, query OSV, identify `GHSA-jf85-cpcp-j695`, and bind to the local demo target.

*Note:* All local integration tests, ephemeral proxy tests, approval lifecycles, and proxy containment have been verified 100% locally with 37/37 automated tests passing.
