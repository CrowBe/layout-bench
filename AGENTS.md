# AGENTS.md

How to work on this repository. [README.md](README.md) is the user guide;
[docs/TOOLS.md](docs/TOOLS.md) lists the WebMCP tools. Keep each fact in one of these three
files and point to it from the others.

## What this is

A client-only Vite + React 19 + TypeScript (strict) app: a millimetre floor-plan and renovation
editor with a Three.js 3D view, SVG trade drawings, and a WebMCP tool surface so a browser agent
edits the same model a person does. No backend. Forked from
[Alza](https://github.com/Elioz404/Alza); keep its attribution in README and LICENSE.

## Commands

```bash
npm install
npm run dev            # studio on :5199
npm run partner        # partner shop origin on :5200 (cross-origin tools)
npm test               # vitest unit tests (tests/*.test.ts)
npm run test:e2e       # starts a dev server, runs every tests/*.e2e.mjs, 3 at a time
npm run build          # tsc -b + vite build: the studio and partner/ entry points into dist/
```

`npm run build` is the typecheck. Run it and `npm test` before every push; run the e2e suites
that cover what you changed (`npm run test:e2e -- <name fragment>`).

Browser tests launch Chromium through [`tests/browser.mjs`](tests/browser.mjs): Playwright's
own build, or `CHROMIUM_PATH`. Some unit tests also launch it. [`tests/run-e2e.mjs`](tests/run-e2e.mjs)
documents `ALZA_BASE_URL`, `E2E_JOBS` and `UPDATE_SHOTS`. A suite that needs the real WebMCP
runtime (`navigator.modelContextTesting`, Chromium with `--enable-features=WebMCP,WebMCPTesting`)
prints `SKIP:` with the reason when it is missing.

## Repository map

```
src/model/    domain: types, geometry and precision, store (shared actions, undo, activity),
              projects (local storage), constraint checker (issues.ts), wall faces, floor,
              drainage, heating, tiling, fixtures, installation, outlines, products and the
              product library, review, revisions, bundles, seeds (seed-bathroom.ts is the sample)
src/sheets/   SVG/HTML outputs: A-01 floor plan and preflight, wall and floor tiling sheets,
              heating review, stage views (viewState.ts), stage plans and elevations
src/three/    3D build from the model, fixture geometry, Scene3D (orbit/top/walk, OBJ/PNG)
src/editor/   the 2D SVG editor
src/mcp/      registry.ts (registration, logging, approval gate), tools.ts (every tool),
              bootstrap.ts (runtime detection, dynamic tool), supplier.ts (cross-origin bridge)
src/ui/       React panels: App, Sidebar, Inspector and its editors, ProductsPage, SheetsPanel,
              ToolRunner, ActivityFeed, ApprovalBar, ProjectChooser
partner/      the second-origin demo shop that publishes its own tools
plugins/      reno-layouts skills-only plugin (SKILL.md files + .codex-plugin manifest)
scripts/      sample output generators (stage-pack, sample-sheets, printables, print-3d)
tests/        *.test.ts unit tests, *.e2e.mjs browser suites, run-e2e.mjs, browser.mjs
shots/        committed outputs; see the sample table in README
*.mjs (root)  stage-shots.mjs (sample 3D renders), serve-local.mjs (dist/ on two origins),
              e2e-full.mjs, and Alza's original demo-film tooling (trace.mjs, record6.mjs, shots.mjs)
```

## Architecture rules

These hold across the codebase. A change that breaks one needs the user's agreement first.

**One model, two users.** A vanilla zustand store ([`src/model/store.ts`](src/model/store.ts))
backs both the React UI and the WebMCP tools. A tool calls the same store action the UI control
calls, so validation, undo and the activity feed are identical for both. Never give a tool its
own write path.

**Units and precision.** Plan units are metres, stored rounded to 0.1 mm
([`geometry.ts`](src/model/geometry.ts)). Tool input and typed values are never snapped; input
finer than 0.1 mm is rounded and the result says so. Pointer snap is a drawing aid only.

**Unknown stays unknown.** Every supplied value carries a status (`site-confirmed`, `measured`,
`published`, `proposed`, `estimated`, `derived`, `modelled`) and, for a length, the face or datum
it is measured from. Never substitute a default for a missing input: leave it null, mark it
unresolved and name what is missing. A placeholder the app does create (a door height nobody
gave) is flagged as defaulted and warned on by `get_issues`. Outputs print unknowns as "?" and
keep every status tag. A surveyed surface is never converted into a frame position.

**Faces and datums.** Each wall side records its existing surface, frame face and proposed
build-up ([`faces.ts`](src/model/faces.ts)). Fixtures and service points are set out from a named
face and follow it. Floors record layers from the substrate up and may carry a finished-level
target. Readings (rough-in, tiling cuts, heights) report the face or level they are taken from.

**Views never edit the model.** Construction-stage views live in
[`viewState.ts`](src/sheets/viewState.ts), outside the project document and its undo history.
Composing a stage changes visibility only, refuses ids the model does not have, and never fakes a
layer that is not modelled. Exports and the 3D view render from the same visible set.

**Sheets are preflighted.** `check_sheets` returns blocking and advisory findings.
`export_sheet` refuses while a blocking finding is neither fixed nor acknowledged; the
acknowledgement reason prints on the sheet.

**Humans own acceptance.** An agent may request and submit product research, with `published`
values only, each with a source and locator. Accepting a product or a catalogue revision,
applying a revision to placed fixtures, and recording human measurements of reused fittings are
human-only UI actions with no tool. Accepting a revision never changes placed fixtures by itself.
Placed fixtures carry product and geometry snapshots that travel with project export.

**Derived product figures are read, not copied.** Heating cable length, output and coverage are
read from the referenced product through [`heatingProduct.ts`](src/model/heatingProduct.ts).
Follow the same pattern for any new product-derived value.

**Outputs are proposals.** Drawings, tiling, heating and rough-in outputs are proposed set-out for
trade review. Never phrase an output as as-built, a procurement quantity or a compliance approval.

**Storage.** Projects save to `localStorage` (`alza.projects.v1`, [`projects.ts`](src/model/projects.ts)).
The product library is shared across projects; attachment files live in IndexedDB. A storage
failure or unreadable version must refuse and offer a backup, never overwrite.

## WebMCP conventions

- Tools are defined in [`src/mcp/tools.ts`](src/mcp/tools.ts) and registered by
  [`registry.ts`](src/mcp/registry.ts) with `registerTool(descriptor, { signal, exposedTo })`.
  Unregister by aborting the signal; that is what makes the runtime emit `toolchange`.
- Every tool has a `name`, a short `title`, a description that states units, datums and status
  meanings, and an `inputSchema` with `additionalProperties: false`. The description is the
  agent's documentation; keep it complete there rather than in a doc.
- Mark reads `readOnlyHint`. Mark tools that delete user work `destructiveHint` with a `confirm`
  sentence: WebMCP does not define that hint, so `executeWrapped` enforces it page-side through
  the approval gate. Content from another origin gets `untrustedContentHint`.
- `extend_selected_wall` is registered only while a wall is selected ([`bootstrap.ts`](src/mcp/bootstrap.ts)).
- The partner shop is reached with `getTools({ fromOrigins })` / `executeTool()`, falling back to
  `postMessage` where a runtime lacks cross-origin support. Origins come from `.env` (dev) and
  `.env.production` (build); `vite.config.ts` writes them into `dist/_headers`.
- `TRACING_PROTOCOL` in `tools.ts` is the plan-tracing procedure; it travels in tool descriptions.
- Without a WebMCP runtime the app must work unchanged; agent-only panels stay hidden.

**Adding or changing a tool:** add it to `TOOLS` in the right section, add a unit test and,
where it has UI, cover it in an e2e suite. Update [docs/TOOLS.md](docs/TOOLS.md) in the same PR.
If a skill in `plugins/reno-layouts/skills/` names the tool, update the skill too.

## The sample and its saved outputs

`src/model/seed-bathroom.ts` is a real project. The owner's decisions and their sources live in
its notes; do not invent values for it. Its outputs are committed under `shots/` (table in
README). After changing anything that affects rendering, regenerate them:

```bash
npm run stage-pack && npm run sample-sheets && npm run printables && npm run print-3d
npm run dev & node stage-shots.mjs     # 3D renders need the dev server
```

`stage-pack` and `sample-sheets` open the sample as the app does and fail if rendering changed
the model. Commit
the regenerated files with the change; a clean `git status` after regenerating means the saved
outputs match.

## Docs

- README: for people using the app. AGENTS.md: this file. docs/TOOLS.md: the tool list.
- No new top-level docs without the user's agreement. Generated indexes under `shots/` are
  written by their scripts; edit the script, not the file.
- Docs describe current behaviour only. Delete text when the behaviour changes; no changelog
  sections or issue-numbered history (git log and PRs hold that).

## Pull requests

Use the repository's existing style: a plain-language title, then what changed and how it was
checked. Keep PRs to one concern and run the checks above before pushing.
