# Antigravity — Checkpoint 2: Tested, Developer-Approved Route Containment

## Execution instruction

Read this entire document and the existing repository instructions before editing. Implement phases 0–8 sequentially. Continue automatically through normal implementation and verification; do not stop after a plan or ask for approval for routine local edits. Keep an accurate progress entry after each phase.

This is a bounded extension of the existing Vulnerability Response Console. Preserve working Checkpoint 1 functionality and the current UI theme.

The user's coding-agent choice is called “Gemini 3.8 Flash” with Turbo mode. This is an IDE preference, not a verified application API model identifier. Do not change GEMINI_MODEL or provider configuration to match this label. Use the application's existing configurable model and fallback. Turbo mode never permits skipping checks, inventing results, activating protection without the in-app approval step, or expanding scope.

Deliver working code, focused tests, a short runbook, and truthful verification results. Do not merely generate an implementation plan.

## 1. Product contract and scope

Checkpoint 1 already provides GitHub repository registration, immutable commit resolution, package.json/package-lock.json fetching, npm inventory, OSV findings, AI explanation with deterministic fallback, persistence, notifications, and reports. These are reported baseline capabilities; inspect the source before relying on details.

Checkpoint 2 adds exactly one demonstrable protection workflow:
1. Scan a controlled demo application's dependencies.
2. Identify one supported advisory.
3. Associate it with an explicitly configured demo route.
4. Propose a predefined temporary route-disable rule.
5. Exercise the real vulnerable behaviour and test the rule in isolation.
6. Show evidence and functionality cost.
7. Obtain developer approval for the exact tested rule.
8. Activate through a real proxy, verify, and allow rollback.

This is temporary containment. It does not patch the library or prove the entire application safe.

Do not implement:
- Community text analysis repairs, GitHub issue crawling, Reddit fetching, scheduled monitoring, or undisclosed-vulnerability discovery.
- Arbitrary exploit generation, AI-authored executable code, shell commands from model output, or user-supplied test payload execution.
- Arbitrary deployment targets, automatic repository execution, a generic WAF, configurable regular expressions, rate-limit products, or TLS hosting.
- Automatic upgrades, PR creation, full-app shutdown, code-path discovery, or production deployment.
- New database, queue, container platform, auth platform, or unnecessary package upgrades.

If the unused Manual Early-Warning Signal Analysis UI remains visible, hide its entry point without deleting saved records or refactoring its backend. Do not spend time fixing that feature.

## 2. Fixed demonstration scenario

Use a separate local demo application named “Preview Settings Demo”.

Selected scenario:
- npm package: lodash, exact installed version 4.17.11.
- Function: defaultsDeep.
- Advisory: GHSA-jf85-cpcp-j695 / CVE-2019-10744.
- Primary reference: https://github.com/advisories/GHSA-jf85-cpcp-j695
- The advisory lists lodash versions before 4.17.12 as affected and 4.17.12 as patched for this specific issue.

Recheck the advisory and verify the installed package behaviour before building the workflow. Do not call 4.17.12 universally safe: it is the historical fix for this specific advisory. Do not change the production console's dependency versions.

The demo exposes:
- GET /health: bounded health response.
- GET /catalog: small static list demonstrating unrelated functionality.
- POST /preview: accepts a small JSON settings object, calls the real vulnerable defaultsDeep implementation, and returns a preview plus an observed prototype-marker result.
- GET /__demo/identity: local demo metadata for controller verification, excluded from public proxy forwarding.

Use a predefined harmless constructor/prototype input that only adds a uniquely named demonstration marker. Verify pollution by checking a fresh unrelated object's inherited marker and that it is not an own property. A normal merged output containing that property is not sufficient evidence.

Keep the exact fixed fixture in source under the local test runner. Never accept arbitrary payloads or destinations through the console.

Run the vulnerable merge in a fresh child process for every preview request:
- The HTTP server, controller, proxy, and Next.js process must never import or execute vulnerable lodash themselves.
- Spawn the fixed worker with Node using arguments/IPC, not a shell.
- Give it a minimal environment without console secrets.
- Bound input to 8 KiB, output to 16 KiB, execution to 2 seconds, and memory using an appropriate Node limit.
- Terminate and clean up on timeout, disconnect, or malformed worker output.
- Limit simultaneous preview workers to two.
- Each request starts with a clean prototype; the worker exits after one result.
- Treat child isolation as local demonstration containment, not a production sandbox against arbitrary code.

Create a one-off local comparison using lodash 4.17.12 in an isolated temporary directory. The same fixture should demonstrate the marker on 4.17.11 and no marker on 4.17.12. Remove temporary comparison dependencies afterwards; do not modify the demo's pinned version.

If the real fixture does not reproduce, diagnose it before proceeding. Do not fake the marker, substitute a hardcoded vulnerable response, silently choose a different advisory, or treat a crash as successful reproduction.

## 3. Architecture and process ownership

Reuse existing source organisation and libraries. Recommended structure, adapted only where the repository already has an equivalent:

- Existing Next.js console: port 3000, server-side API orchestration and UI.
- One new local Node service: controller API on 127.0.0.1:8001 and forwarding proxy on 127.0.0.1:8002.
- Separate demo HTTP process: 127.0.0.1:8003.
- An ephemeral test proxy on a dynamically assigned loopback port using the same rule evaluator and forwarding code as the active proxy.

Port defaults may be configured server-side, but targets are fixed at startup. Do not accept target URLs in browser requests. Fail visibly on occupied ports; do not kill unrelated processes.

Requests for the demonstration travel:
Browser or test runner → proxy → demo HTTP server → disposable merge worker.

The console is a control interface, not the traffic path. All three services bind to loopback. This does not prevent someone on the same machine from directly reaching port 8003. State that only traffic through port 8002 is contained. No production or network-wide protection claim.

Keep the demo in a standalone nested package, for example examples/preview-settings-demo:
- Own package.json and committed npm lockfile v3.
- Exact lodash version; no caret or tilde.
- Use built-in Node HTTP where practical.
- Do not convert the main project into an npm workspace.
- A scanner project path can select this subdirectory in GitHub.

Suggested new modules, consolidate where sensible:
- services/protection/server.ts: controller routes and startup.
- services/protection/proxy.ts: shared forwarding and route-rule evaluator.
- services/protection/scenario.ts: fixed scenario and bounded test runner.
- services/protection/store.ts: isolated controller persistence.
- lib/protection.ts: Next.js server-only controller client and validation.
- components/protection-panel.tsx.
- Small API route handlers under app/api/protection/.
- Demo server, worker, manifests, focused tests, and one runbook.

Do not create a large generic framework. Reuse the existing TS runner and validation utilities when available; add a dependency only if the installed stack cannot perform the required task.

## 4. Scan-to-target binding: prevent unrelated protection claims

Do not attach protection to the Renovate tutorial, Octokit, Goof, or any arbitrary application just because it contains lodash.

Bind the supported scenario to one specific saved application and scan. Require:
- The selected application's repository URL and project path.
- Immutable scanned commit SHA and lockfile SHA-256.
- A successful inventory containing the exact demo package/version.
- The selected advisory matched using its OSV ID or aliases, not display-title text.
- A local demo identity with matching manifests/lockfile and source fingerprint.

Record the binding:
applicationId, scanId, commitSha, projectPath, lockfileHash,
scenarioId, advisoryId, packageName, packageVersion,
targetFingerprint, targetInstanceId.

Compute targetFingerprint from the actual demo source files and manifests using stable file ordering. Report the installed lodash package version and compare installed package files against a startup digest before tests/activation. targetInstanceId changes on every demo start. This is integrity evidence for our controlled local demo, not remote production attestation.

If the local checkout is not demonstrably the scanned revision, display “Scan/target mismatch” and disable scan-linked approval. Do not use a developer-entered SHA alone as proof. A read-only local Git check and file-content comparison can establish the controlled local checkout association.

GitHub publication constraint:
The existing scanner fetches GitHub, so newly created demo files are not remotely scannable until committed and pushed to a repository the user controls.
- Prepare all files and local verification first.
- Do not invent a repository URL or claim unpushed files were scanned.
- Do not push, publish, or create a public repository without explicit authorization.
- Continue independent implementation using clearly labelled local fixture integration tests.
- At handoff, provide the exact relative project path and commands needed to publish/scan, if this remains outstanding.
- Mark live GitHub-to-protection verification incomplete until a real pinned scan exists.
- Local fixtures may exercise bindings in tests; they must never masquerade as real saved OSV scans in the normal UI.

## 5. Rule, test evidence, and approval contracts

Support one rule kind only: disable_route.
- Path: /preview.
- Scope: that path and trailing-slash equivalent; all HTTP methods.
- Query strings do not bypass matching.
- Effect: respond with HTTP 503 and stable code ROUTE_TEMPORARILY_DISABLED.
- Explanation: preview functionality is temporarily disabled; other routes remain available.
- No custom code, regex, arbitrary path list, headers, host, target URL, or outbound destination accepted from AI.

Use one strict shared path parsing policy in proxy and demo. Avoid alternate decode/normalisation behaviour. Reject ambiguous encoded separators, backslashes, malformed encodings, and unsupported absolute-form request targets rather than forwarding them. Test equivalents explicitly. Block before dispatching any body upstream. Do not expose controller or identity paths through the forwarding port.

Represent these concepts in typed, server-validated schemas:

ProtectionProposal:
- id, createdAt, scenarioId, full scan/target binding.
- rule (validated closed schema).
- ruleHash, proposalHash.
- explanation, evidence references, functionalityCost, limitations.
- aiStatus and deterministic fallback provenance.

TestRun:
- id, proposalId/proposalHash, ruleHash, scenario/fixture version.
- scan/target binding, controllerInstanceId, start/end timestamps.
- Individual observations: expected result, actual HTTP status,
  observed marker, upstream request-counter delta, pass/fail, bounded error.
- overall status: passed, failed, or unavailable.
- candidate configuration hash and target fingerprint.

Approval:
- id, proposalHash, passed testRunId, binding, createdAt.
- local operator approval provenance; do not invent a named authenticated identity.
- consumed/invalidated state.

RuntimeStatus:
- controllerInstanceId, rule revision, active rule or null,
  activation timestamp, related approval/test IDs,
  upstream health observation, blocked count, last verification.
- Keep “rule active” separate from “last verification passed”.

Use canonical serialization and SHA-256 for hashes. Hash enforcement fields and evidence binding, not volatile presentation text. Store immutable proposal revisions; edits create a new revision requiring tests and approval.

A test expires after 15 minutes or immediately when rule, fixture, scan binding, source fingerprint, target instance, or controller instance changes. Validate these conditions server-side again at activation.

State progression:
proposed → testing → tested_passed or tested_failed →
approved → active → rolled_back.
Represent failed/unavailable verification independently; never advance on timeout or an exception. Expired or changed proposals require retesting.

Only one active rule is supported. Serialize tests and activation/rollback with a controller-wide operation lock; conflicting operations return 409. Ensure the lock is released on failure. Do not hold the existing scan lock for the lifetime of protection.

## 6. Test-before-approval workflow

Testing must never temporarily enable a candidate rule on the active proxy.

Run bounded, serial tests:
1. Verify target identity, version, fingerprint, and clean startup.
2. Use a fresh isolated proxy with no rule:
   - /health and /catalog succeed.
   - Benign /preview succeeds with no marker.
   - The fixed demonstration input to /preview produces the inherited marker.
3. Enable the candidate only on that isolated test proxy:
   - The demonstration input receives 503 and the expected block code.
   - Benign /preview also receives 503: explicitly record functionality loss.
   - /health and /catalog still succeed.
   - Confirm blocked requests did not reach upstream using an actual
     internal request counter or equivalent server observation.
4. Close the test listener and any owned child processes in finally blocks.
5. Save immutable observations; do not calculate “passed” from AI text.

Use per-request timeouts, a maximum 30-second test duration, fixed request count, and no retries that repeatedly exercise the vulnerable route. Never treat upstream unavailability, a generic 500, timeout, or connection refusal as successful blocking.

The UI shows the results and a checkbox:
“I understand that preview requests will be unavailable until rollback.”

Approval must be an explicit user action after reviewing the passed test. Provide “Approve” followed by “Activate protection”, or a clearly labelled combined “Approve and activate” action with the same server-side ordering. No automatic approval from scan results, AI output, a test pass, or preselected checkboxes.

Activation:
- Revalidate exact binding, hashes, test freshness, acknowledgement, and current runtime.
- Atomically install the rule in the controller's shared runtime state.
- Repeated identical requests must not create duplicate activations.
- Run a bounded post-activation check through the active proxy.
- Use a harmless preview request to verify route containment plus /catalog health;
  do not send a fresh vulnerability probe through an uncertain active rule.
- Display active-but-verification-failed honestly if the rule is installed but checks fail.
- Preserve containment on verification failure; do not silently roll back.

Rollback:
- Explicit developer action removes only this active rule.
- Record the reason if supplied, timestamp, prior revision, and result.
- Verify benign /preview and /catalog work again.
- Do not automatically send a vulnerability fixture after rollback.
- Clearly state that the underlying vulnerable dependency remains.

## 7. Controller API, persistence, and credentials

Expose a small control API with equivalent operations:
GET status; POST proposals; POST tests; POST approvals;
POST activate; POST rollback; GET history.

Next.js API routes are the browser-facing layer. The Next.js server calls the controller with CONTROLLER_TOKEN. The browser never receives that token, and it is never forwarded upstream or logged.

Use existing application auth if present. For a local demo without existing login, explicitly label approval as local operator confirmation, not authenticated enterprise approval. Protect browser mutations with same-origin validation and JSON-only requests; do not enable permissive CORS. Reject cross-site mutation requests.

Controller rules:
- Require a configured strong token on all controller API requests.
- Bind only to loopback and reject unauthorized requests before work.
- Validate strict bounded schemas; return consistent error codes.
- Never accept a browser-supplied shell command, source file, payload, target URL,
  service address, redirect destination, or arbitrary file path.
- Use fixed internal paths and do not follow upstream redirects in control requests.
- Strip authorization/cookie/control headers when forwarding demo traffic as appropriate;
  do not leak controller credentials into the data plane.

Use existing CONTROLLER_URL/CONTROLLER_TOKEN placeholders if available. Document defaults in .env.example with no real credentials. Do not change GEMINI_API_KEY/GEMINI_MODEL or introduce TYPESAFE/JEV configuration.

Controller alone owns its protection state file, for example data/protection-state.json.
- Never have controller and Next.js both read-modify-write the same state file.
- Use serialized atomic updates and schema validation.
- Preserve existing data/state.json and migration compatibility.
- Persist proposal, test, approval, activation/rollback history.
- Do not persist raw request bodies, tokens, or unbounded logs.
- Bound stored history and disclose retention.
- Counters may remain in memory and reset on restart; label their session scope.

Restart behaviour:
- Do not silently resume forwarding with a previously active rule forgotten.
- If persisted state records active containment, restore its validated restrictive
  rule before opening the proxy listener.
- On corrupt or unreadable control state, do not open the forwarding listener.
- Mark verification stale after restart. Recheck target health/identity and show status.
- Old pending approvals/tests cannot authorize a new activation across restarts.
- Existing restored containment remains until explicitly rolled back; it is not
  a fresh automatic approval.

## 8. AI role

AI receives only grounded finding data, the fixed demo mapping, observed test evidence when available, and the supported rule template.

It can produce:
- Plain-English reason for containment.
- Affected feature and functionality cost.
- Why upgrading the dependency remains necessary.
- Limitations and next steps.

It cannot choose arbitrary endpoints, infer source reachability for unrelated repos, modify the rule engine, execute code, initiate tests, approve, activate, or rollback.

Validate structured output and evidence IDs. Discard unsupported claims. If the API is absent, unavailable, rate-limited, or malformed, use deterministic text and set aiStatus accurately. Protection must remain usable without live AI.

Do not expose a fake AI badge for deterministic text. Do not repeatedly call Gemini while rendering or polling.

## 9. UI implementation

Keep the current colour palette, typography, layout conventions, and report UI. Add one compact “Demo Protection” section for the bound demo application only.

It contains:
- Connection/target identity and scan association.
- Selected advisory and package version.
- Scope: “Local demo — proxy traffic only.”
- Proposed action and prominent functionality cost.
- Generate proposal, Test proposal, Approve/Activate, Rollback controls.
- Test evidence rows with actual observed statuses.
- Active rule, current verification, unrelated-route health, blocked count.
- Recent activity history and useful error messages.

For other repositories, show a short “Protection is available only for the configured demo scenario” message or omit the controls. Never offer protection based solely on an arbitrary finding.

Disable actions while the relevant operation runs. Handle 409, expired tests, missing application/scan, mismatched target, offline controller, and AI fallback. Preserve form state on recoverable errors. Poll status only while the panel is visible, e.g. every 5 seconds, and clean up timers. Refresh notifications after relevant events without full-page reloads.

Use precise labels:
- “Temporary containment active” rather than “Application secure”.
- “Known issue demonstrated in isolated demo” rather than “Production exploited”.
- “Preview unavailable” rather than “No impact”.
- “Scan-linked verification pending” where GitHub publication is incomplete.

## 10. Ordered implementation phases

### Phase 0 — Inspect and baseline

Read AGENTS.md, existing checkpoint docs, package scripts, source tree, store implementation, tests, and git status. Preserve user edits. Confirm actual versions and source paths; do not assume paths from this document exist.

Check that tests use temporary storage before running them. Fix only demonstrated test-isolation problems; never reset real records. Run the existing baseline tests/lint and record pre-existing failures.

Create a concise file plan in the existing progress document. Do not overwrite older checkpoint history. Continue.

### Phase 1 — Prove the local scenario

Create the standalone demo, fixed worker and fixture. Verify the real vulnerable behaviour and patched comparison. Record primary advisory URL, versions, observed result, and exact local commands in the runbook.

Gate: the fixture causes the actual inherited marker only on the vulnerable comparison. If not, debug before proceeding; report a blocker if it cannot be established.

### Phase 2 — Build shared proxy and controller core

Implement fixed-target forwarding, canonical path matching, bounded requests, token checks, shared rule evaluator, operation locking, and isolated persistence.

Gate: no-rule forwarding works; disabled route is blocked before upstream dispatch; unrelated routes remain available; controller paths cannot be reached through the proxy.

### Phase 3 — Proposal, test evidence, and approval lifecycle

Implement schemas, binding/hashes, isolated test proxy, observations, expiry, approval, activation, rollback, restart rules, and audit history.

Gate: mismatched/stale/failed evidence never activates; live rules are untouched during candidate testing.

### Phase 4 — Connect existing scanner and explanation layer

Integrate selected scan/advisory lookup and demo identity binding. Add the grounded AI explanation with deterministic fallback. Do not alter core OSV normalisation or fabricate scan records.

Gate: unrelated application IDs/advisories/target identities are rejected. Local fixture tests are clearly separated from live scan linkage.

### Phase 5 — Add the UI

Build the compact panel, actual status, testing/approval/activation/rollback controls and notifications. Hide the deferred community section if still exposed.

Gate: interface reflects backend state; no client-only activation or fake success.

### Phase 6 — Focused automated verification

Use the existing test framework. Run tests in isolated directories with allocated loopback ports and deterministic mocked provider responses.

Cover:
- True vulnerable fixture and clean child per request.
- Patched comparison behaviour.
- Benign and demonstration requests before/after route disable.
- Unrelated endpoint continuity.
- Query strings, trailing slash, method coverage, ambiguous encodings.
- Zero upstream dispatch for blocked traffic.
- Failed or expired tests, changed rule hashes, source/target restart mismatch.
- Wrong application, scan, advisory, package version, and lockfile hash.
- Approval required; acknowledgement required; unauthorized requests rejected.
- Concurrent operation conflict and lock cleanup.
- Timeout/offline target cannot count as mitigation success.
- Activation idempotency, rollback, restart restoration.
- AI unavailable/invalid output fallback.
- Existing store data unaffected.

Avoid snapshots or tests that merely assert implementation constants. Verify observable outcomes.

### Phase 7 — End-to-end verification and GitHub linkage

Run npm.cmd test, npm.cmd run lint, npm.cmd run build using the actual scripts.
Add minimal Windows-compatible scripts to start the controller and demo; use
npm.cmd/npx.cmd rather than changing PowerShell policy.

Prefer separate terminals over introducing a process-manager dependency.
Provide exact commands in the runbook and clean up only processes you started.

If browser tools are available, exercise proposal → test → review → approval →
activation → normal endpoint → rollback. Automated approval clicks are allowed
only against explicitly isolated disposable test state, never an existing operator session.

If the real GitHub demo commit is available, register the repository/project path,
scan the pinned SHA with the existing pipeline, and verify the live binding.
Otherwise finish all independent checks and report only this publication/linkage
step as pending. Do not claim complete end-to-end GitHub verification.

### Phase 8 — Handoff and stop

Append a factual summary to the existing progress document. Add one runbook,
for example docs/CHECKPOINT_TWO_DEMO.md, containing:
- Architecture and local URLs.
- Install/start/stop commands.
- Server-only configuration names.
- Exact demo scan repository/path/ref once actually known.
- How to propose, test, approve, activate, observe, and rollback.
- Explicit functionality loss and bypass limitations.
- Actual verification results and unresolved blockers.
- A short two-minute demo sequence.

Report changed files grouped by purpose, tests/lint/build outcomes, browser and
live API checks actually performed, and any incomplete GitHub publication step.

Do not automatically commit, push, deploy, or proceed to another checkpoint.

## 11. Final acceptance checklist

Complete means all applicable evidence exists, not merely that code compiles:

- [ ] Checkpoint 1 repository fetching, inventory, OSV findings, exports remain working.
- [ ] Real selected vulnerability observed in a disposable local worker.
- [ ] Patched comparison does not show that marker.
- [ ] Demo manifests use an exact dependency and supported lockfile.
- [ ] GitHub scan binds to the actual local demo identity; otherwise explicitly pending.
- [ ] One real proxy forwards to one fixed local target.
- [ ] Candidate tests are isolated from active enforcement.
- [ ] Blocked tests prove both correct response and no upstream dispatch.
- [ ] Legitimate preview loss is shown and acknowledged.
- [ ] Other functionality passes before and after activation.
- [ ] Backend requires exact, fresh, approved test/rule binding.
- [ ] Activation, verification, rollback, and restart behaviour are real.
- [ ] AI failure does not break deterministic protection.
- [ ] No secrets enter browser bundles, upstream requests, logs, or exports.
- [ ] Tests do not modify user application state.
- [ ] Actual results are distinguished from assumptions and mocked tests.

Do not report the checkpoint fully complete while a required live binding or
verification remains pending. Report the implemented capability and the exact
remaining step instead.

