# Antigravity implementation prompt — checkpoint-one dark theme
## Execution contract

Implement this task in the existing project. This prompt is written for the coding model selected in Antigravity (the user calls it Gemini 3.8 Flash), with Turbo mode enabled. That label is NOT an instruction to change the application's Gemini API model.

Complete the phases below in order. Give short progress updates and continue automatically after each exit check passes. Do not stop after planning. Do not ask for routine confirmation. If a phase fails, diagnose and fix only the relevant styling issue, then repeat its affected check. Never claim unexecuted verification.

**Deliverable: the existing working checkpoint-one app with the specified dark palette, and no functional changes. Stop before checkpoint two.**

## 1. Project facts and priorities

The existing application is the Vulnerability Response Console, also referred to in the supplied design brief as VulnCheck AI. Preserve its current displayed name; this task does not rename the product.

Reported stack: Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, Lucide React, and Framer Motion. Inspect package.json to confirm the installed setup. Do not upgrade versions or install anything.

Environment: Windows 11 and PowerShell. Use npm.cmd and npx.cmd where needed; do not change the PowerShell execution policy. Work from the currently opened repository, not a hardcoded drive path.

Checkpoint one already includes:
- Repository registration and commit-pinned manifest fetching.
- npm inventory and live OSV advisory matching.
- Gemini explanations with deterministic fallback and partial coverage.
- Findings, evidence, recommendations, reports and exports.
- In-app notifications, community early-warning submissions, local JSON persistence.

These are working product features to preserve. Do not repair inventory classification, alter AI summaries, or implement other previously discussed corrections during this styling pass. Mention any observed issue separately.

Current UI already contains dark surfaces. Recolour existing light OR dark surfaces to the palette below. Do not assume the app starts in light mode.

Priority order:
1. Preserve existing behavior, data, layout, typography, and accessibility.
2. Apply the exact base palette through the existing styling system.
3. Keep status meaning and interaction states readable.
4. Minimize code and file changes.

The palette is the source of truth. If a reference image exists, use it only for colour guidance. If missing, continue using this document; do not invent layouts.

## 2. Hard scope and file budget

Allowed edits:
- Existing global/component CSS: colour variables and colour declarations.
- Existing TSX/JSX: colour-related class names and style values only.
- Existing colour variant mappings: style strings only; preserve keys, conditions, labels, and behavior.
- One short appended entry in docs/PROGRESS.md, only if that file already exists.

Budget:
- Zero new application files, pages, components, dependencies, assets, or config files.
- Target at most 8 existing application/styling files modified, plus the existing progress file.
- If inspection proves more existing files own necessary hardcoded colours, list those actual paths with a one-line reason and make only colour edits there. Do not create abstractions to meet an arbitrary file count.
- No new theme provider, theme switcher, design-system layer, utility package, or demonstration route.
- No permanent helper scripts, screenshot folders, extra implementation plans, or test fixtures.
- Prefer the browser tool's existing screenshot output. Any essential temporary artifacts stay outside tracked source and contain no secrets.

Read-only/protected areas:
- app/api/**, backend/controller code, scanner, inventory, OSV, GitHub and AI logic.
- lib/contracts.ts, lib/store.ts, lib/scanner.ts, lib/github.ts, lib/inventory.ts,
  lib/osv.ts, lib/assessment.ts, lib/ai.ts, lib/report.ts, lib/notifications.ts.
- package.json, lockfiles, Next.js/PostCSS/TypeScript configuration.
- .env files, secrets, authentication/session configuration.
- data/state.json and all stored scan reports.
- Existing test files, routing logic, hooks, data fetching, schemas, and API contracts.

Do not read or print .env contents. Do not reset Git, remove untracked user files, overwrite user changes, delete node_modules, or reinstall dependencies. Do not commit or push automatically.

Layout must remain identical:
- No DOM restructuring, added wrappers, moved sections, changed columns, or new navigation.
- No changes to width/height, margins, padding, gaps, grids, flex behavior, responsive breakpoints,
  radii, font family/size/weight, line height, letter spacing, icons, or animation timing.
- Preserve existing shadow geometry; recolour an existing shadow only when necessary.
- Preserve labels, severity text, disclaimer text, loading text, and scan counts exactly.
- Do not add missing features from the original generic design brief.

## 3. Phase A — inspect and freeze the baseline

1. Read applicable repository instructions, package.json, and relevant existing progress notes.
2. Run git status --short. Record existing modifications without altering them.
3. Use rg --files to locate source files. Exclude node_modules, .next, .git and persisted data
   from broad styling searches.
4. Locate the global stylesheet imported by the root layout. It may be app/globals.css,
   src/app/globals.css, or another existing path.
5. Inspect only the actual UI entry points and their imported components. Expected paths from
   checkpoint one are candidates, not permission to create missing files:

| Expected path | Inspect for |
|---|---|
| app/globals.css or actual equivalent | Tailwind import, tokens, base surfaces, overrides |
| app/layout.tsx | Existing global background/text classes and stylesheet import |
| app/page.tsx | Existing console page colour classes |
| components/console.tsx | Repository form, shell, tabs/navigation, inbox, scan cards |
| components/report-view.tsx | Findings, filters, severity badges, evidence, AI indicators |
| components/community-report-form.tsx | Existing early-warning form and notices |
| app/reports/[scanId]/page.tsx | Existing standalone report surfaces |
| Existing shared UI components they import | Actual hardcoded button/dialog/input colours |

6. Search for colour utilities (bg-, text-, border-, ring-, outline-, fill-, stroke-),
   hexadecimal values and inline colour styles. Inspect context before replacing.
   text-sm, border-2, ring-2 and similar classes are NOT colours.
7. If browser tools are available, capture a baseline view of the existing console and
   saved report at the same viewport you will use after editing.
8. Print a brief plan containing the actual files to edit and the chosen token mechanism.

Exit check: the real styling owners are identified; no protected files have been edited.
Continue immediately to Phase B.

## 4. Phase B — define the palette once

Required colour values:

| Semantic role | Hex |
|---|---|
| Page background | #06131B |
| Existing sidebar/navigation background | #020B10 |
| Cards, dialogs, panels | #0A1B25 |
| Inputs and elevated/nested surfaces | #10232E |
| Primary action background | #17352D |
| Primary action hover | #21483A |
| Active navigation/selection | #0B2A23 |
| Accent, focus and success | #69C99A |
| Primary text | #F5E6C8 |
| Secondary text | #9CB2C3 |
| Decorative borders/dividers | #1C3440 |
| Warning | #E9C77B |
| Danger | #E47777 |
| Information | #79BDE8 |

Choose exactly ONE approach:
A. If semantic tokens already exist, update their values in the existing theme mechanism
   and preserve consumers. Respect the expected value format: do not put a hex value
   into a variable consumed as hsl(var(--token)).
B. If no suitable semantic tokens exist, add the following block in the existing global
   stylesheet, retaining the current Tailwind import. Do not create tailwind.config.js.

```css
@theme {
  --color-vc-background: #06131B;
  --color-vc-sidebar: #020B10;
  --color-vc-card: #0A1B25;
  --color-vc-input: #10232E;
  --color-vc-primary: #17352D;
  --color-vc-primary-hover: #21483A;
  --color-vc-navigation-active: #0B2A23;
  --color-vc-accent: #69C99A;
  --color-vc-text-primary: #F5E6C8;
  --color-vc-text-secondary: #9CB2C3;
  --color-vc-border: #1C3440;
  --color-vc-success: #69C99A;
  --color-vc-warning: #E9C77B;
  --color-vc-danger: #E47777;
  --color-vc-info: #79BDE8;
}
```

This is a Tailwind v4 fallback, not a mandatory parallel token system. It permits literal
utilities such as bg-vc-card, text-vc-text-primary, border-vc-border and
hover:bg-vc-primary-hover. Keep the chosen utility strings statically visible to Tailwind.
Never construct classes like "bg-" + colourName at runtime.

Ordinary :root variables do not by themselves generate Tailwind utilities. If the project
already uses :root/.dark variables with @theme inline mappings, preserve that pattern
instead of copying the fallback block.

Do not reset --color-* globally: that could remove unrelated existing utilities.
Do not add light/dark state management. Ensure existing media queries or dark selectors
do not override this palette unintentionally.

Official reference if needed: https://tailwindcss.com/docs/theme

Exit check: one coherent token system provides every required colour without package changes.

## 5. Phase C — apply colours by component role

Work in this order: global surface → console shell → forms/inbox → report view → community form
→ standalone report → shared overlays. Reuse existing components.

| Existing element | Required treatment |
|---|---|
| Main page | Background token, readable inherited foreground |
| Existing sidebar/header | Sidebar surface; preserve dimensions and items |
| Active nav/tab | Active surface; cream text; preserve selection conditions |
| Cards/report panels | Card surface, subtle border, cream titles |
| Nested evidence/code/metadata panels | Input surface; preserve monospace font and wrapping |
| Form controls | Input background, cream value, secondary placeholder, visible focus |
| Primary buttons | Primary green, primary-hover green, cream label |
| Secondary/cancel buttons | Existing structure; dark surface and readable text |
| Destructive controls | Danger treatment, never generic success green |
| Findings table | Card surface; input-tone existing hover/selected surface; subtle dividers |
| Source/advisory links | Accent or information colour; preserve existing underline/focus behavior |
| Existing dialog/drawer/popover | Card or input surface; preserve portal, positioning and close behavior |
| Loading indicators | Accent/information; preserve animation, size and conditional rendering |
| Empty/error panels | Existing content and logic, appropriate neutral/danger palette |
| Notifications | Preserve unread marker and read-state distinction; colour changes only |

Important details:
- Keep dim modal backdrops dim. Do not turn overlays opaque by bulk replacement.
- Preserve transparent icon-button backgrounds where intentional.
- Lucide icons using currentColor should inherit the correct foreground; do not edit SVG paths.
- Recolour existing native select/options and autofill styles only if needed. If the entire app
  is already intended to be dark, colour-scheme: dark may be set in the existing root style.
- Do not replace every blue/green/red class with the same green. Read its meaning first.
- Do not use global universal selectors or blanket !important rules to conceal hardcoded colours.
- Keep existing gradients/shadows structurally intact; change only their colours if required.
- Do not recolour downloaded Markdown/JSON data. This task changes the rendered interface.

Severity and evidence:
- Keep severity labels and existing icons unchanged. They must remain distinguishable without colour.
- Default mapping where an existing mapping needs replacement:
  critical = danger, high = warning, medium = information, low/unknown = secondary text.
- Use subtle tinted backgrounds only where badges already have tinted backgrounds.
- Use success green for successful operations, not to imply an affected dependency is safe.
- Preserve differences between complete/partial/failed scans and full/partial/unavailable AI.
- Preserve existing AI/deterministic attribution and unverified community-signal warnings.
- Do not change severity ranking or business logic to produce these colours.

Accessibility:
- Retain focus ring/outline width, offsets and trigger behavior; recolour with the accent token.
- The subtle border token is decorative, not the only focus indicator.
- Check text contrast against the actual composited background, including tinted/transparent badges.
  Target 4.5:1 for normal text and 3:1 for large text and essential UI indicators.
- Use cream/secondary foregrounds where required for readable text; adjust a local colour pairing
  or tint without changing the base palette, label, font size or layout.
- Do not remove disabled attributes or pointer-event behavior. Preserve existing disabled opacity
  unless a colour-only correction is necessary.

Exit check: every existing surface uses the intended palette; interactive/status meaning remains intact.

## 6. Phase D — inspect the diff before running checks

Run git diff --stat and inspect git diff for each touched file.
For files with pre-existing edits, distinguish your own changes from the baseline.

Confirm:
- Only colours, colour tokens, and strictly necessary colour-scheme styling changed.
- No handlers, hooks, imports of functional modules, schema fields, fetch URLs or API payloads changed.
- No new page, component, dependency, config, or data file was created.
- No content, product name, layout classes or typography changed.
- No indiscriminate replacement changed severity meanings or disabled/loading behavior.
- No secrets were opened or included in output.
- All edited files are accounted for in the initial plan or a short justified extension.

Revert only your own unintended changes. Never undo someone else's baseline work.
Do not refactor unrelated code discovered during review.

## 7. Phase E — validation with existing saved data

Run the existing scripts from the project root, sequentially:
```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

Check scripts exist first; if absent, report that rather than creating them.
Do not add tests that only assert literal colour strings.
Do not run commands repeatedly without a failure or relevant new edit.

Use the existing running local server when available. Otherwise start:
```powershell
npm.cmd run dev
```
Use the URL the server actually prints. Do not kill unrelated processes or assume a port.

Browser checklist, if browser tools are available:
1. Console loads with correct background/text, no new hydration or runtime errors.
2. Open and close repository registration; inspect focused fields and select options.
3. Exercise existing empty/invalid form validation without creating an unwanted repository.
4. Open the actual saved Renovate tutorial report, if present.
   Earlier evidence showed six findings, seven dependencies and partial AI; these are
   historical test observations, NOT constants to put in the UI.
5. Use available finding filters/search and open a detail view; inspect evidence, links,
   recommendation labels and AI attribution.
6. Download existing Markdown/JSON exports; confirm these still work without changing their contents.
7. Open notifications; verify existing read/unread styling. If testing a read-state change,
   use one existing demo notification and report that interaction; never edit state.json directly.
8. Inspect the community form and its unverified-signal notice without submitting a new analysis.
9. Open the existing standalone report route using a real saved scan ID.
10. Check at desktop (~1440px), tablet (~768px) and phone (~390px) widths using existing breakpoints.
    Compare with the baseline; do not undertake a responsive redesign.
11. Inspect normal, hover, selected, keyboard-focus, disabled and available loading/error/empty states.
    If a state cannot be reached without an external call, inspect its style branch and mark it
    code-reviewed rather than browser-verified.
12. Compare baseline and final screenshots at matching viewports where available.

Do not trigger paid/live scans or AI calls to test colours. No new GitHub, OSV, Gemini or email
requests are necessary. Do not inject mock reports into persisted data to manufacture UI states.

If browser tools are unavailable, complete the code checks and explicitly list visual/manual
checks as unverified. Do not install a browser automation stack or claim a screenshot review.
Pre-existing unrelated failures must be reported, not repaired by changing backend scope.

Exit check: relevant automated checks passed or are honestly documented, and available visual
checks show colour-only changes with the existing flow preserved.

## 8. Phase F — handoff and stop

Append one concise dark-theme entry to the existing docs/PROGRESS.md if it exists.
Preserve all prior checkpoint records. Do not mark checkpoint two started or completed.

Final response must contain:
- Actual changed files and a short reason for each.
- Confirmation that this was a palette-only update.
- Actual lint/test/build outcomes.
- Browser checks performed and any unverified states.
- Any pre-existing issues observed, clearly separate from changes made.
- Confirmation that no checkpoint-two features were added.

Do not create a separate audit document or repeat this entire prompt in the final response.
Do not automatically commit, push, deploy, upgrade packages, or continue into checkpoint two.

**Begin Phase A now. Continue through Phase F, then stop.**

