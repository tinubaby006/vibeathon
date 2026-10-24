# Implementation Progress — Vulnerability Response Console

Status: **Checkpoint One Complete & Audited** (Assessment and Recommendations Only). Fully implemented and verified. No later-checkpoint active protection, proxies, or exploit execution have been created.

---

## 1. Checkpoint Status Overview

| Phase | Description | Status | Deliverables & Exit Condition |
|---|---|---|---|
| **Phase 0** | Inspect and freeze | Complete | Inspected package.json, lockfile, Node runtime, tools. Installed only permitted dependencies (`zod`, `semver`, `@google/genai`, dev: `@types/semver`, `tsx`). |
| **Phase 1** | Contracts, storage, GitHub inventory | Complete | Domain contracts, Zod schemas, atomic filesystem persistence (`data/state.json`), GitHub commit-pinned manifest fetch, npm v2/v3 lockfile parser. Verified with unit tests. |
| **Phase 2** | OSV and factual report pipeline | Complete | OSV batch querying (`/v1/querybatch`), per-query pagination, advisory hydration (`/v1/vulns/{id}`), normalization, severity provenance, patch evidence extraction, deterministic recommendations fallback. |
| **Phase 3** | AI explanations and manual early signals | Complete | Gemini enrichment via official `@google/genai` SDK with strict grounding and output validation, timeout protection, manual community early-warning signal analysis (URL citation only, never fetched). |
| **Phase 4** | Complete console, reports, inbox | Complete | Interactive console shell, repository registration form, scan triggers with indeterminate loading state, findings table with filters and detail panel, in-app notifications inbox with read/unread tracking, downloadable Markdown and JSON exports. |
| **Phase 5** | Verify and finish | Complete | All automated tests pass (23/23), ESLint passes (0 errors, 0 warnings), Next.js Turbopack production build succeeds, and live GitHub/OSV smoke test verified. |
| **Audit** | Checkpoint One Comprehensive Audit | Complete | Real live scan completed through API, verified against locked package and OSV advisory, real Gemini 3.6 enrichment verified, server restart persistence proven, failure coverage test added. |
| **Diagnostics** | snyk-labs/nodejs-goof Failure Diagnosis | Complete | Diagnosed rate limiting error, fixed implementation defects (UI failure diagnostics card, explicit stage attribution, SHA preservation on later failures, token sanitization, and Smart HTTP/raw fallback for unauthenticated public scans). |
| **Refinement** | Checkpoint-One Scope & Truthfulness Corrections | Complete | Fixed direct vs hoisted transitive dependency detection in `lib/inventory.ts`, made AI coverage explicit (`enrichedFindings / totalFindings`), clearly scoped AI summary subset while keeping deterministic overall totals visible, and made no-fix recommendations truthful for unmaintained versions (Babel 6). |

---

## 2. Verified Project Configuration

### Runtime & System Environment
- **Operating System:** Windows 11 (PowerShell environment)
- **Node.js Runtime:** `v24.21.0`
- **npm:** `11.19.0` (invoked via `npm.cmd` / `npx.cmd` to bypass PowerShell `.ps1` execution policy)
- **Framework & Libraries:**
  - Next.js `16.3.5` (App Router, Turbopack)
  - React `19.2.8` & React DOM `19.2.8`
  - Tailwind CSS `^4` (with `@tailwindcss/postcss` `^4`)
  - Lucide React `^1.47.0`, Framer Motion `^13.4.0`
  - Added dependencies: `zod` (`^4`), `semver` (`^7.7.4`), `@google/genai` (`^2.31.0`), dev: `@types/semver` (`^7.7.1`), `tsx` (`^4.23.15`)

### Source File Ceiling & Allocation (25 files created)
1. `lib/contracts.ts`: Domain types, Zod schemas, sanitizeFailureMessage helper, AiCoverage interface, API contracts
2. `lib/store.ts`: Atomic JSON persistence (`data/state.json`), in-memory mutex, scan locking
3. `lib/github.ts`: URL parsing, commit pinning, Smart HTTP git fallback, raw manifest fetching
4. `lib/inventory.ts`: npm v2/v3 package-lock parser, root manifest direct dependency detection, semver deduplication, exclusions
5. `lib/osv.ts`: Live OSV querybatch, pagination, advisory hydration
6. `lib/assessment.ts`: Normalization, severity provenance, patch ranges, truthful deterministic recommendations
7. `lib/ai.ts`: Gemini integration, structured output schema, grounding checks, explicit coverage reporting, community signal analyzer
8. `lib/scanner.ts`: Single-scan orchestrator, stage attribution, SHA preservation, report finalization
9. `lib/report.ts`: Downloadable Markdown and JSON report rendering with explicit AI coverage and scoped AI summary
10. `lib/notifications.ts`: In-app notification creation, optional Resend email dispatch
11. `app/api/applications/route.ts`: List and register target repositories
12. `app/api/applications/[id]/scan/route.ts`: Execute and await scan
13. `app/api/reports/[scanId]/route.ts`: Fetch report, Markdown/JSON download
14. `app/api/notifications/route.ts`: Notification inbox, mark read / mark all read
15. `app/api/community-reports/route.ts`: List and analyze community early signals
16. `components/console.tsx`: Primary interactive developer console
17. `components/report-view.tsx`: Findings table, failure diagnostics card, explicit AI coverage stat, executive summary (overall factual totals + scoped AI summary), severity filters, detail panel, downloads
18. `components/community-report-form.tsx`: Early-warning signal submission and history
19. `app/page.tsx`: Main server-backed page
20. `app/reports/[scanId]/page.tsx`: Standalone report view
21. `tests/inventory.test.ts`: Parser unit tests + regression tests for hoisted deps and multi-version direct packages
22. `tests/github.test.ts`: GitHub URL and path unit tests
23. `tests/store.test.ts`: Storage persistence and concurrency tests
24. `tests/assessment.test.ts`: Normalization, severity, patch extraction, and Babel 6 no-fix recommendation truthfulness tests
25. `tests/scan.test.ts`: Scan pipeline integration tests (includes failure coverage, SHA preservation, and AI coverage tests)

---

## 3. Checks Performed and Actual Results

| Check | Command Executed | Actual Result | Status |
|---|---|---|---|
| Automated Test Suite | `npm.cmd test` (`tsx --test tests/**/*.test.ts`) | **26 tests passed across 5 test suites (0 failed)**: Inventory (7), GitHub (4), Store (5), Assessment (5), Scanner Pipeline (5). | Passed |
| Linter Verification | `npm.cmd run lint` | ESLint 9 executed with **0 errors and 0 warnings**. | Passed |
| Production Build | `npm.cmd run build` | Next.js 16.3.5 (Turbopack) production build completed; TypeScript type checking passed; all 8 static and dynamic routes generated cleanly. | Passed |
| Hoisted Transitive Dependency Test | `tests/inventory.test.ts` | Test `does not classify hoisted transitive dependencies as direct` passed; verifies hoisted packages (e.g. `accepts`) have `direct: false`. | Passed |
| Multi-Version Direct Package Test | `tests/inventory.test.ts` | Test `does not mark every version of a directly declared package as direct` passed; verifies nested versions (e.g. `lodash` v3) have `direct: false`. | Passed |
| Babel 6 No-Fix Truthfulness Test | `tests/assessment.test.ts` | Test `verifies deterministic no-fix recommendation does not promise a future upstream patch (Babel 6 case)` passed; verifies recommendations advise migration/replacement and do not promise upstream fixes. | Passed |
| Commit SHA Preservation Test | `tests/scan.test.ts` | Test `preserves resolved commit SHA when manifest fetching fails at a later stage` verified that `resolvedCommitSha` is retained and `stage: "manifest_fetch"` is attributed. | Passed |
| Incomplete OSV Lookup Protection Test | `tests/scan.test.ts` | Test `marks scan as partial and prevents clean status when OSV lookups fail or are incomplete` passed; verifies report status is strictly `partial`. | Passed |
| Live Scan: `snyk-labs/nodejs-goof` (Verified Report) | `executeScan` pipeline | Scanned `snyk-labs/nodejs-goof` in 57.4s; parsed 980 inventory packages (35 direct, 945 transitive); discovered 314 factual findings; AI coverage: **5 enriched / 314 total (partial)**; deterministic summary displayed along with scoped AI summary. | Passed |
| Live Scan: `octokit/octokit.js` | `POST /api/applications/:id/scan` | Scanned `octokit/octokit.js` (lockfileVersion 3) in 60.8s; resolved commit `bc34deaf357486594c41f167c05921d16e6aabe9`; parsed 180 dependencies; identified 16 findings. | Passed |
| Live Gemini AI Enrichment | `gemini-3.6-flash` via `@google/genai` | Live Gemini returned grounded `aiExplanation`, `aiSummary`, and structured recommendations with factual evidence IDs; UI distinguishes `[ai]` from `[deterministic]`. | Passed |
| Notification Read/Unread State | `GET /api/notifications` + `PATCH /api/notifications` | Verified `scan_complete` notification created with `readAt: null`; PATCH marked `readAt` timestamp. | Passed |
| Persistence Across Server Restart | Process kill + restart `next start -p 3005` | Re-queried report and notification; state remained 100% intact in `data/state.json`. | Passed |
| Secret Leak Prevention | Scan of Git diff and repository | No API keys or tokens present in source control, client code, logs, or state files. | Passed |

---

## 4. Diagnosis & Remediation of Failed Scan (`snyk-labs/nodejs-goof`)

### Root Cause Diagnosis
1. **Initial Failure Cause:** The scan for `https://github.com/snyk-labs/nodejs-goof` previously failed during commit resolution with `HTTP 403 Forbidden` (`code: RATE_LIMITED`, message: `"GitHub API rate limit exceeded. Set GITHUB_TOKEN in .env.local to increase limit."`).
2. **False Assumptions from `Target SHA: N/A`:** Because commit resolution failed at the very beginning of the pipeline, `resolvedCommitSha` was `null`, causing the UI to display `Target SHA: N/A`. The scan aborted before manifests were ever fetched or parsed; the failure was an upstream GitHub API rate limit, **not** an npm lockfile incompatibility.
3. **Lockfile Facts:** `snyk-labs/nodejs-goof` contains a valid `package-lock.json` with `lockfileVersion: 2`, 1,274 total entries, and 980 unique queryable packages (within the 1,000 package limit).
4. **UI Defect Identified:** When a scan failed, `components/report-view.tsx` displayed a green checkmark (`CheckCircle2`) with `"No Known Advisories Matched"` because `report.findings.length === 0`. The actual failed stage and sanitized failure reason were never rendered in the report view.
5. **Scanner Pipeline Defect Identified:** `buildFailedReport` in `lib/scanner.ts` previously hardcoded `stage: "scan_initialization"` for all failures, obscuring whether failures occurred at `commit_resolution`, `manifest_fetch`, or `lockfile_parse`.

### Implementation Fixes Applied
1. **Report UI Failure Diagnostic Banner:**
   - Added a dedicated failure card in `components/report-view.tsx` displaying the **Failed Stage**, **Sanitized Failure Reason**, **Error Code Badge**, and **Retryable Indicator**.
   - Added actionable guidance cards explaining exact remediation steps for rate limiting, missing files, and lockfile format issues.
   - Replaced the green checkmark with an alert octagon and `"Scan Terminated Early"` state when `report.status === "failed"`.
   - Updated Target SHA to render `"N/A (Resolution Failed)"` when commit resolution failed, preventing confusion with inventory compatibility.
2. **Commit SHA Preservation on Later Failures:**
   - When commit resolution succeeds, `resolvedCommitSha` is explicitly passed through and retained in `buildFailedReport` if subsequent stages (`manifest_fetch` or `lockfile_parse`) fail. Verified via unit test.
3. **Accurate Stage Attribution:**
   - Updated `buildFailedReport` to accept an explicit `stage` parameter (`commit_resolution`, `manifest_fetch`, `lockfile_parse`).
4. **Token & Credential Sanitization:**
   - Created `sanitizeFailureMessage` in `lib/contracts.ts` using regular expressions to strip Bearer tokens, GitHub PATs (`ghp_...`, `github_pat_...`), authorization headers, and embedded credentials before messages are persisted or rendered in UI/exports.
5. **Unauthenticated Public Git Smart HTTP Fallback:**
   - Enhanced `lib/github.ts` to fall back to standard Git Smart HTTP (`/info/refs?service=git-upload-pack`) for commit resolution and `raw.githubusercontent.com` for manifest retrieval on public repositories when unauthenticated REST API rate limits are hit without a configured `GITHUB_TOKEN`.
   - Live scan of `snyk-labs/nodejs-goof` completed successfully through the pipeline, discovering 314 factual advisories across 980 dependencies.

---

## 5. Checkpoint-One Scope & Truthfulness Hardening

### Item 1: Direct vs Hoisted Transitive Dependencies (`lib/inventory.ts`)
- **Defect:** `lib/inventory.ts` previously checked `directDepNames.has(packageName) || pkgPath === "node_modules/${packageName}"`. This had two bugs: (a) it classified hoisted transitive dependencies as direct because their installed path was `node_modules/${pkg}`, and (b) it marked every nested version of a directly declared package as direct because `directDepNames.has(packageName)` matched across versions.
- **Correction:** Direct dependencies are now determined by requiring BOTH:
  1. Root manifest declaration: package is declared in `manifest` (`dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`) or `lock.packages[""]`.
  2. Top-level resolved instance: `pkgPath === "node_modules/${packageName}"`.
- **Regression Tests:** Added two automated tests to `tests/inventory.test.ts`:
  - `does not classify hoisted transitive dependencies as direct`: proves hoisted dependency `accepts` has `direct: false` when only `express` is declared in `package.json`.
  - `does not mark every version of a directly declared package as direct`: proves `lodash@4.17.21` at `node_modules/lodash` has `direct: true`, while legacy `lodash@3.10.1` nested under a transitive dependency has `direct: false`.
- **Live Scan Verification:** In `snyk-labs/nodejs-goof` (980 packages), exactly 35 direct dependencies were identified (matching `package.json` direct declarations), and 945 were classified as transitive (`ms` correctly flagged `direct: false`).

### Item 2: Explicit AI Coverage (`enrichedFindings / totalFindings`)
- **Defect:** Previous code marked `aiStatus` as `"completed"` if the top batch was enriched, even if hundreds of findings were un-enriched, without exposing the coverage ratio.
- **Correction:** Added `aiCoverage: { enrichedFindings: number, totalFindings: number }` to domain contracts (`ScanReport`, `AiEnrichmentResult`). `aiStatus` is strictly `"completed"` only when `enrichedCount >= totalFindings`, and `"partial"` when `enrichedCount < totalFindings`.
- **Budget & API Policy:** Kept focused at 1 API call for prioritized high-severity findings (`MAX_ENRICHED_FINDINGS = 5`). No unnecessary API calls are made merely to enrich every finding.
- **UI & Exports:** Stats box in `components/report-view.tsx` explicitly shows `5 / 314 (partial status • 2% enriched)`. Markdown export explicitly reports `- **AI Coverage:** 5 / 314 findings enriched (partial)`.

### Item 3: Scoped AI Summary vs Overall Deterministic Totals
- **Defect:** Previous UI and exports rendered the AI summary from a single 5-finding batch as the entire scan's summary, while omitting or obscuring the overall deterministic totals.
- **Correction:**
  - Prompt explicitly instructs Gemini: `"summary": "Technical summary specifically covering these ${batch.length} prioritized findings (do not claim to summarize unanalyzed findings across the repository; max 600 chars)"`.
  - UI executive summary block now prominently displays the **Overall Factual Assessment (314 total findings)** with deterministic totals (`Identified 314 known advisory matches across queried dependencies (46 critical, 137 high, 105 medium, 26 low)`).
  - AI summary is clearly labeled with its exact scope: `AI Summary (Subset: 5 of 314 findings covered • Prioritized subset): ...`.
  - Markdown export renders distinct sections for `### Factual Overall Summary (314 Total Findings)` and `### AI Summary (Subset: 5 of 314 findings covered)`.

### Item 4: Truthful No-Fix Recommendation (Babel 6 Case)
- **Defect:** `buildDeterministicRecommendations` in `lib/assessment.ts` previously advised `"Monitor advisory for upstream fix release"` and stated `"Application remains on affected version until upstream releases an update"` for all `no_fix_listed` advisories. For unmaintained, deprecated, or superseded major versions like Babel 6 (`babel-traverse`, `babel-core`), upstream will never release a fix; promising an update was untruthful.
- **Correction:**
  - `action`: `"Investigate mitigation, replacement, or migration for ${packageName}; no fix listed in advisory ${advisoryId}"`.
  - `rationale`: `"Advisory lists no fixed release for package. Upstream may not backport a patch, especially if this version or major release is unmaintained, deprecated, or superseded."`.
  - `potentialImpact`: `"An upstream patch is not guaranteed and may never be released for this version. Consider dependency replacement, major version migration, architectural isolation, or input restrictions."`.
  - Second action: `"Monitor advisory for published workarounds or ecosystem status updates"` with warning `"Do not rely on an upstream patch being released for legacy, superseded, or unmaintained versions."`.
- **Regression Test:** Added test in `tests/assessment.test.ts` (`verifies deterministic no-fix recommendation does not promise a future upstream patch (Babel 6 case)`).
- **Live Scan Verification:** In `snyk-labs/nodejs-goof`, `GHSA-67hx-6x53-jw92` (`babel-traverse` 6.26.0) verified that deterministic recommendations recommend migration/replacement and explicitly caution that an upstream patch is not guaranteed and may never be released.

---

## 6. Acceptance Checklist (Checkpoint One)

- [x] App starts with existing documented commands (`npm.cmd run dev`, `npm.cmd run build`, `npm.cmd start`).
- [x] Real public GitHub inventory is fetched; private access supported when `GITHUB_TOKEN` is supplied.
- [x] Snapshot SHA, lockfile hash, dependency count, exclusions, and deployment limitations are visible.
- [x] Real OSV calls happen and checked-at timestamp is stored.
- [x] Matching advisory facts, severity provenance, source links, and patch evidence render correctly.
- [x] A scan creates a saved report and a real in-app notification.
- [x] Notifications work for no-fix, zero-match, partial, and failure outcomes.
- [x] Configured Gemini produces validated explanations, or the report truthfully records its unavailability and uses deterministic fallback.
- [x] Proposed recommendations contain no executed changes or unsupported patch claims.
- [x] Manual community input is visibly unverified and never counted as a confirmed exploit.
- [x] Reports and notification read status persist after restarting the local server (`data/state.json`).
- [x] Markdown and JSON downloads work with correct content and safe filenames.
- [x] Missing lockfile, inaccessible repo, rate limit, provider outage, AI outage, and overlapping scans produce truthful states.
- [x] Tests (**26/26**), lint (**0 errors, 0 warnings**), and production build pass.
- [x] Direct dependencies accurately distinguished from hoisted transitive dependencies.
- [x] AI coverage is explicit (`enrichedFindings / totalFindings`).
- [x] Deterministic overall totals remain visible; AI summary subset is clearly labeled.
- [x] No-fix recommendations do not promise an upstream patch (truthful for Babel 6).
- [x] No tokens in Git diff, browser bundle, logs, persisted JSON, or exported reports.
- [x] No proxy, exploit test runner, attack payload, auto-upgrade, shutdown, or protection activation code exists.

---

## 7. Known Limitations & Operating Boundaries

1. **Scope:** Checkpoint One is strictly **Assessment & Recommendations Only**. No vulnerability reproduction, exploit execution, reverse proxying, WAF configuration, automated code fixes, or deployment modifications exist.
2. **Supported Inventory:** npm projects with `package.json` and `package-lock.json` lockfileVersion 2 or 3. One project directory per scan (root or explicit relative path). Yarn, pnpm, Python, and monorepo workspace links are excluded.
3. **Deployment Identity:** Recorded deployment URLs and developer-declared commit SHAs are self-reported for display and not independently verified against live network deployments.
4. **Persistence:** Single local Node.js process using serialized atomic file writes (`data/state.json`).

---

## 8. Checkpoint-One Dark Theme Recolouring (Phases A–F)

- **Palette Definition:** Configured Tailwind CSS v4 `@theme` block in `app/globals.css` with 14 semantic tokens: `--color-vc-background` (`#06131B`), `--color-vc-sidebar` (`#020B10`), `--color-vc-card` (`#0A1B25`), `--color-vc-input` (`#10232E`), `--color-vc-primary` (`#17352D`), `--color-vc-primary-hover` (`#21483A`), `--color-vc-navigation-active` (`#0B2A23`), `--color-vc-accent` / `--color-vc-success` (`#69C99A`), `--color-vc-text-primary` (`#F5E6C8`), `--color-vc-text-secondary` (`#9CB2C3`), `--color-vc-border` (`#1C3440`), `--color-vc-warning` (`#E9C77B`), `--color-vc-danger` (`#E47777`), `--color-vc-info` (`#79BDE8`). Added `color-scheme: dark`.
- **Files Modified (6 styling files + PROGRESS.md):**
  1. `app/globals.css`: Defined `@theme` tokens and set default `:root` variables.
  2. `app/layout.tsx`: Applied `bg-vc-background text-vc-text-primary` to document body.
  3. `components/console.tsx`: Applied dark surfaces, primary buttons, input styling, and modal/drawer colors.
  4. `components/report-view.tsx`: Recoloured report headers, stats cards, failure diagnostics, findings table, severity badges, and detail modal.
  5. `components/community-report-form.tsx`: Recoloured early warning form, input surfaces, attribution disclaimer, and recorded signal items.
  6. `app/reports/[scanId]/page.tsx`: Recoloured standalone report page background, header, and back navigation.
- **Verification Outcomes:**
  - `npm.cmd run lint`: 0 errors, 0 warnings.
  - `npm.cmd test`: 26/26 tests passing across 5 test suites.
  - `npm.cmd run build`: Compiled Next.js 16.3.5 Turbopack production build successfully.
- **Scope & Constraints Check:** Zero logic, layout, or contract changes; zero new files created; Checkpoint-One scope preserved; Checkpoint Two not started.

---

## 9. Checkpoint Two — Tested, Developer-Approved Route Containment

### Phase 0: Inspect and Baseline
- **Verified Baseline:** Inspected repository instructions (`AGENTS.md`), existing checkpoint notes, `package.json`, and current git status.
- **Test Storage Isolation Fixed:** Identified that `tests/store.test.ts` and `tests/scan.test.ts` directly reset the primary store file at `data/state.json`. Added dynamic storage path resolution via `process.env.VRC_STATE_FILE_PATH` in `lib/store.ts` and isolated test runs in temporary directories (`os.tmpdir()`), ensuring automated test runs never overwrite or reset real user data.
- **Baseline Verification:**
  - `npm.cmd test`: 26/26 tests passing across 5 suites.
  - `npm.cmd run lint`: 0 errors, 0 warnings.

### Phase 1: Prove the Local Scenario
- **Demo Application Created:** Created standalone package `examples/preview-settings-demo/` with:
  - `package.json`: exact `lodash: "4.17.11"`.
  - `package-lock.json`: lockfileVersion 3.
  - `worker.js`: disposable child process worker executing `lodash.defaultsDeep` in isolation with 8 KiB input cap, 16 KiB output cap, 2s execution timeout, and clean prototype check.
  - `server.js`: Node HTTP server on `127.0.0.1:8003` with `/health`, `/catalog`, `POST /preview` (max 2 concurrent workers, increments `previewRequestCounter`), and `/__demo/identity`.
- **Gate 1 Verification:**
  - Benign `/preview` request -> `prototypePolluted: false`.
  - Exploitation payload `{"constructor": {"prototype": {"__vrc_demo_marker__": "vrc_verified_cve_2019_10744"}}}` on `lodash@4.17.11` -> `prototypePolluted: true`, `markerValue: "vrc_verified_cve_2019_10744"`.
  - Patched comparison on `lodash@4.17.12` in an isolated temp directory -> `isPolluted: false`.

### Phase 2: Build Shared Proxy and Controller Core
- **Modules Created:**
  - `services/protection/types.ts`: Zod schemas and TypeScript types for `ProtectionProposal`, `TestRun`, `Approval`, `RuntimeStatus`, `Rule` (`disable_route`), and controller API requests/responses. Canonical hashing via sorted JSON and SHA-256.
  - `services/protection/store.ts`: Controller store managing `data/protection-state.json` with serialized atomic operations, mutex, bounded history, and restart restoration.
  - `services/protection/proxy.ts`: Loopback HTTP reverse proxy forwarding to 8003, with strict canonical path normalization (rejects backslashes, ambiguous `%2f`/`%5c`, and directory traversal `..`), rule evaluator for `disable_route` returning 503 `ROUTE_TEMPORARILY_DISABLED` with zero upstream dispatch, internal control path isolation (blocks `/__demo/identity`), and ephemeral test proxy factory.
  - `services/protection/server.ts`: Controller HTTP API on `127.0.0.1:8001` requiring `Bearer <CONTROLLER_TOKEN>`, controller-wide single-operation lock, and clean shutdown.
- **Gate 2 Verification:** No-rule forwarding verified; disabled route blocked with 503 before upstream dispatch (counter delta = 0); unrelated routes (`/catalog`) remained available; internal control endpoints blocked with 403.

### Phase 3: Proposal, Test Evidence, and Approval Lifecycle
- **Test Runner & Scenario:** Implemented `services/protection/scenario.ts` defining fixed scenario `demo-scenario-lodash-4.17.11` and running bounded 5-step test on an ephemeral isolated proxy on dynamic port `0`.
- **Approval & Activation Enforcement:** Approval requires `acknowledgedFunctionalityLoss: true` and passing, non-expired test evidence (15-minute window). Activation validates target fingerprint, installs rule on active proxy atomically, and executes post-activation verification. Rollback removes rule and verifies route restoration.
- **Gate 3 Verification:** Live proxy remained untouched during isolated testing; approval rejected without acknowledgement; valid approval activated and verified on active proxy; rollback restored `/preview`.

### Phase 4: Connect Existing Scanner and Explanation Layer
- **Binding Validator & Client:** Created `lib/protection.ts` with `validateScanTargetBinding` checking application project path, exact `lodash@4.17.11` dependency, advisory `GHSA-jf85-cpcp-j695`, and live target demo identity.
- **AI Explanation with Deterministic Fallback:** Grounded Gemini prompt generates plain-English explanation, functionality cost, and limitations; falls back cleanly to deterministic explanation with `aiStatus: "deterministic_fallback"` when Gemini is unconfigured or unavailable.
- **API Routes:** Implemented Next.js routes under `app/api/protection/`:
  - `GET /api/protection/status`
  - `POST /api/protection/proposals`
  - `POST /api/protection/tests`
  - `POST /api/protection/approvals`
  - `POST /api/protection/activate`
  - `POST /api/protection/rollback`
- **Gate 4 Verification:** Unrelated applications (such as `snyk-labs/nodejs-goof`) are rejected with explicit ineligibility reason.

### Phase 5: Add the UI
- **Demo Protection Panel:** Created `components/protection-panel.tsx` adhering to the dark `--color-vc-*` palette. Displays scope badge, target identity, advisory, notice of functionality loss, proposal generation, isolated test observation table (9 checks), mandatory acknowledgement checkbox, approve & activate button, active containment rollback, and recent audit history.
- **Console Integration:** Mounted `ProtectionPanel` in `components/console.tsx` under `ReportView`.
- **Hidden Entry Point:** Hid the unused `CommunityReportForm` UI entry point as requested, without deleting records or modifying backend APIs.
- **Gate 5 Verification:** Interface reflects real backend controller state with 5-second bounded polling; actions disabled during active operations; no client-only bypass.

### Phase 6: Focused Automated Verification
- **Test Suite:** Created `tests/protection.test.ts` covering all required scenarios:
  1. Real prototype pollution reproduction on `lodash@4.17.11` worker.
  2. Clean prototype on benign preview requests.
  3. Patched comparison with `lodash@4.17.12` in isolated directory.
  4. Path canonicalization, ambiguous separator rejection, and directory traversal blocking.
  5. Internal control endpoint isolation (`/__demo/identity` blocked with 403).
  6. Ephemeral isolated proxy testing with zero live proxy modification.
  7. Zero upstream dispatch for blocked traffic (request counter delta = 0).
  8. Controller token authentication enforcement.
  9. Full lifecycle: Proposal -> Test -> Approval -> Activation -> Rollback.
  10. Scan-to-target binding rejection for arbitrary/unrelated repositories.
  11. Truthful deterministic AI fallback provenance.
  12. Restoration of active containment from persisted state on controller restart.
- **Test Outcomes:**
  - `npm.cmd test`: **37 tests passed across 6 test suites (0 failed)**.
    - Assessment Normalization & Rules (5)
    - GitHub URL and Path Validation (4)
    - npm Inventory Parser (7)
    - Checkpoint 2 Protection Controller & Proxy Suite (11)
    - Scanner Pipeline Integration (5)
    - Store Persistence & Concurrency (5)

### Phase 7: End-to-End Verification
- **Package Scripts:** Added `"controller": "tsx services/protection/server.ts"` and `"demo": "node examples/preview-settings-demo/server.js"` to `package.json`.
- **Linter:** `npm.cmd run lint` passed with **0 errors and 0 warnings**.
- **Tests:** `npm.cmd test` passed with **37/37 passing**.
- **Production Build:** `npm.cmd run build` passed with exit code 0; Turbopack production build completed; all 14 routes generated cleanly.
- **GitHub Publication Boundary:** Documented that remote GitHub repository publication of `examples/preview-settings-demo` is pending user authorization. Local fixture bindings and ephemeral proxy tests are completely verified.

### Phase 8: Handoff and Runbook
- Created `docs/CHECKPOINT_TWO_DEMO.md` with complete 2-minute demo runbook, architecture diagrams, command references, and bypass disclosures.
- All Checkpoint 1 capabilities preserved; dark theme styling preserved; store isolation verified.

---

## 10. Remediation Handoff for Coding Agent

### Feature Overview & Architectural Guarantees
- **Decoupled & Offline-Ready:** "Generate remediation handoff" operates on any saved scan report without requiring the Protection Controller, a running demo server, or active proxy containment.
- **Immutable Scan Grounding:** Handoff packages target facts directly from the immutable scan record: repository URL, project path, resolved commit SHA, lockfile SHA-256 hash, and finding inventory.
- **Truthful Fix & Severity Provenance:** Fixed versions are sourced strictly from OSV advisory data. If an advisory lists `no_fix_listed` (e.g. unmaintained dependencies like Babel 6), the handoff explicitly states that no upstream patch is listed and directs the coding agent NOT to fabricate version numbers.
- **Direct vs Transitive Guidance:**
  - *Direct Dependencies:* Instructs the coding agent to bump the version specifier in `package.json` and regenerate `package-lock.json`.
  - *Transitive Dependencies:* Surfaces the exact dependency path, advising the agent to upgrade the top-level parent dependency or evaluate package manager overrides/resolutions with caution.
- **Instruction Grounding & "Not Executed" Status:** All receiving coding agent instructions require verifying checkout integrity, checking working tree status to preserve uncommitted work, and confirming reachability. Proposed verification checks are explicitly labelled `Not executed (Pending Coding Agent Run)` so receiving models do not assume checks have passed. Agents are instructed never to auto-commit, push, deploy, or disable containment.
- **Protection Evidence Boundaries:** If protection state exists in `data/protection-state.json`, it is attached only if the application ID and scan ID strictly match. Demo protection evidence is explicitly tagged with `targetType: "isolated_demo"` and a prominent disclaimer stating that loopback containment is an isolated temporary mitigation, NOT a permanent code patch, and does NOT prove the library safe.
- **Dual Export Formats:** The same underlying `RemediationHandoff` model powers both Markdown (`.md`) and JSON (`.json`) downloads from `/api/reports/[scanId]/handoff?format=markdown|json`.
- **Pure Read-Only:** Generating a handoff or downloading files never triggers fresh scans, external AI calls, or test runner executions, and never alters finding statuses in storage.

### Deliverables Created / Updated
1. `lib/handoff.ts`: Core data structures (`RemediationHandoff`, `RemediationFindingItem`, `ContainmentEvidenceSnapshot`, `CodingAgentInstructions`), builder function `buildRemediationHandoff`, and Markdown renderer `renderHandoffMarkdown`.
2. `app/api/reports/[scanId]/handoff/route.ts`: API endpoint serving JSON data (`GET /api/reports/:scanId/handoff`), Markdown download attachment (`?format=markdown`), and JSON download attachment (`?format=json`).
3. `components/report-view.tsx`: Added "Generate remediation handoff" button in the scan report view; modal dialog matching the `--color-vc-*` dark theme with operational notices, one-click copy to clipboard, direct downloads, and monospace preview.
4. `tests/handoff.test.ts`: 6 automated tests covering offline generation, direct/transitive guidance, truthful no-fix handling, coding agent instructions with "Not executed" labels, scan-bound protection evidence snapshotting, and Markdown rendering.

### Verification Results
| Verification Check | Command | Actual Recorded Result | Status |
|---|---|---|---|
| Full Automated Test Suite | `npm.cmd test` | **43 tests passed across 7 test suites (0 failed)**:<br>- Assessment Normalization & Rules (5)<br>- GitHub URL and Path Validation (4)<br>- Remediation Handoff for Coding Agent (6)<br>- npm Inventory Parser (7)<br>- Checkpoint 2 Protection Controller & Proxy Suite (11)<br>- Scanner Pipeline Integration (5)<br>- Store Persistence & Concurrency (5) | Passed |
| Linter Verification | `npm.cmd run lint` | ESLint 9 executed with **0 errors and 0 warnings**. | Passed |
| Production Build | `npm.cmd run build` | Next.js 16.3.5 (Turbopack) production compilation completed in 2.6s; TypeScript passed in 5.4s; all 15 routes generated (including `/api/reports/[scanId]/handoff`). | Passed |
| Existing Scan Handoff Generation | `verify_handoff.ts` on scan `4eaa6a9d` | Correctly extracted repo `renovatebot/tutorial`, commit `755485b7591d8eb8371fc923cce0172c4138176f`, lockfile hash `e9df11d4e6...`, 6 findings (5 direct, 1 transitive), candidate fixed releases without invention, and no protection evidence fallback. | Passed |
| API Route JSON & Downloads | `GET /api/reports/:scanId/handoff` | - JSON API: HTTP 200, `{ ok: true, data: {...}, markdown: "..." }`<br>- Markdown Download: HTTP 200, `Content-Disposition: attachment; filename="remediation-handoff-renovatebot-tutorial-4eaa6a9d.md"`, 10,094 bytes<br>- JSON Download: HTTP 200, `Content-Disposition: attachment; filename="remediation-handoff-renovatebot-tutorial-4eaa6a9d.json"`, schemaVersion 1 | Passed |
| Read-Only Integrity | Verification script | Verified `patchStatus` of all findings remained identical before and after handoff generation (no mutation). | Passed |
| Checkpoint 2 Continuity | Suite execution | Demo app, controller endpoints, proxy routing, approval lifecycle, and rollback verified unregressed and fully active. | Passed |


