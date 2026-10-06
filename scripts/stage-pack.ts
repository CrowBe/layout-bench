/**
 * Per-phase diagram pack for the shipped Bathroom Concept sample.
 *
 * Each phase is a stage view (#41): a label plus the explicit list of layer and element ids that
 * are visible. Nothing is edited: the sample opens exactly as the app opens it, every phase is a
 * visibility choice over that one model, and the script fails if the model changed. For each
 * phase it writes the A3 plan, one elevation per room-facing wall side, the specification sheet,
 * and PNG previews of the drawings.
 *
 *   npm run stage-pack                 # every phase
 *   npm run stage-pack -- 01           # phases whose folder starts with 01
 *
 * PNG previews use Playwright's Chromium; set CHROMIUM_PATH to use another build.
 *
 * Output: shots/stage-pack/<phase>/ and shots/stage-pack/README.md
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Acknowledgement, PlanModel } from "../src/model/types";
import type { LibraryProduct } from "../src/model/productLibrary";
import { applyView, composeView, currentView } from "../src/sheets/viewState";
import { catalogue, renderStageDiagram, renderStageSpec } from "../src/sheets/stageView";
import { elevationSurfaces, renderStageElevation } from "../src/sheets/stageElevation";
import { reconcile } from "../src/sheets/check";

export interface Phase {
  /** folder name; its number orders the pack */
  slug: string;
  label: string;
  /** what the phase is, in the owner's construction order */
  summary: string;
  /** layer and element ids from list_diagram_content */
  visible: string[];
}

/**
 * The phases, in the sample's construction order (see its "Construction order" note). Add the next
 * phase here; the generator, previews and README follow.
 */
export const PHASES: Phase[] = [
  {
    slug: "01-post-demolition",
    label: "1. Post-demolition: frame and slab",
    summary:
      "Walls stripped to the timber frame and the floor taken back to the concrete slab, about 120 mm below the current tile (estimated; confirm after demolition). The door and window openings stay as openings in the frame.",
    visible: ["walls", "wall-frame", "rooms", "doors", "windows", "floor-substrate"],
  },
];

/** The sheet date: the local calendar day (YYYY-MM-DD), so a Sydney morning prints today, not UTC's yesterday. */
export const DATE = process.env.STAGE_PACK_DATE ?? new Date().toLocaleDateString("en-CA");
export const OUT = resolve("shots/stage-pack");

export interface PhaseFile { name: string; title: string; png?: string }
export interface Written {
  phase: Phase;
  files: PhaseFile[];
  rows: number;
  unknown: number;
  advisory: string[];
  notModelled: string[];
}

/** Spec rows the pack treats as unknown: status 'unknown', or a '?' value. */
export function countUnknown(rows: { value: string; status: string }[]): number {
  return rows.filter((r) => r.status === "unknown" || r.value === "?").length;
}

export function composePhase(projectId: string, model: PlanModel, phase: Phase, products: LibraryProduct[] = []) {
  const applied = applyView(projectId, model, phase.label, phase.visible);
  if (!applied.ok) throw new Error(`${phase.slug}: ${applied.summary}`);
  const composed = composeView(model, currentView(projectId)!, products);
  const ack = reconcile(composed.findings, []);
  if (!ack.ok) throw new Error(`${phase.slug}: blocking findings, fix them in the model first:\n${JSON.stringify(ack.open, null, 2)}`);
  return { composed, acknowledged: ack.acknowledged };
}

export interface WritePhaseInput {
  model: PlanModel;
  elements: ReturnType<typeof composeView>["resolution"]["elements"];
  findings: ReturnType<typeof composeView>["findings"];
  acknowledged?: Acknowledgement[];
  date: string;
  products?: LibraryProduct[];
  outDir: string;
  /** Runs after SVG/spec land in the temp dir. A throw leaves the existing phase folder untouched. */
  previews?: (dir: string, files: PhaseFile[]) => Promise<void>;
}

/** Replace dest with tmp; on failure restore dest if it had been moved aside. */
export function swapDir(tmp: string, dest: string) {
  const bak = `${dest}.bak`;
  // an interrupted earlier swap can leave the only copy in bak: put it back before clearing it
  if (!existsSync(dest) && existsSync(bak)) renameSync(bak, dest);
  rmSync(bak, { recursive: true, force: true });
  try {
    if (existsSync(dest)) renameSync(dest, bak);
    renameSync(tmp, dest);
  } catch (err) {
    if (!existsSync(dest) && existsSync(bak)) {
      try { renameSync(bak, dest); } catch { /* prefer the original error */ }
    }
    throw err;
  }
  rmSync(bak, { recursive: true, force: true });
}

/** Render one phase's plan, elevations and spec in memory, with the index entry they make. */
function renderPhase(phase: Phase, input: Omit<WritePhaseInput, "outDir" | "previews">) {
  const opts = { label: phase.label, findings: input.findings, acknowledged: input.acknowledged, date: input.date, products: input.products };
  const outputs: { file: PhaseFile; content: string }[] = [{ file: { name: "plan.svg", title: "Plan" }, content: renderStageDiagram(input.model, input.elements, opts) }];
  for (const s of elevationSurfaces(input.model, input.elements)) {
    outputs.push({ file: { name: `elevation-${s.wallId}-${s.side}.svg`, title: `Elevation ${s.wallId} (${s.side} side, from ${s.room})` }, content: renderStageElevation(input.model, input.elements, s.wallId, s.side, opts) });
  }
  const spec = renderStageSpec(input.model, input.elements, opts);
  outputs.push({ file: { name: "spec.html", title: "Specification sheet" }, content: spec.html });
  const written: Written = {
    phase, files: outputs.map((o) => o.file), rows: spec.rows.length,
    unknown: countUnknown(spec.rows),
    advisory: input.findings.filter((f) => f.severity === "advisory").map((f) => f.message),
    notModelled: catalogue(input.model).notModelled,
  };
  return { outputs, written };
}

/**
 * The index entry for a phase this run does not regenerate: rendered in memory, nothing written.
 * Previews are listed where the phase folder already has them.
 */
export function summarizePhase(phase: Phase, input: Omit<WritePhaseInput, "previews">): Written {
  const { written } = renderPhase(phase, input);
  for (const f of written.files.filter((x) => x.name.endsWith(".svg"))) {
    const png = f.name.replace(/\.svg$/, ".png");
    if (existsSync(join(input.outDir, phase.slug, png))) f.png = png;
  }
  return written;
}

/** The phases a CLI filter selects; a filter that matches no phase is an error, not an empty pack. */
export function selectPhases(only: string[], phases: Phase[] = PHASES): Phase[] {
  const selected = phases.filter((p) => !only.length || only.some((o) => p.slug.startsWith(o)));
  if (!selected.length) throw new Error(`No phase matches ${only.join(", ")}. Phases: ${phases.map((p) => p.slug).join(", ")}.`);
  return selected;
}

/**
 * Write one phase's plan, elevations, spec and optional previews into a temp dir, then swap it
 * into `outDir/<slug>` only after every output for that phase succeeds.
 */
export async function writePhase(phase: Phase, input: WritePhaseInput): Promise<Written> {
  const dest = join(input.outDir, phase.slug);
  const tmp = join(input.outDir, `.${phase.slug}.tmp`);
  mkdirSync(input.outDir, { recursive: true });
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    const { outputs, written } = renderPhase(phase, input);
    for (const o of outputs) writeFileSync(join(tmp, o.file.name), o.content);
    if (input.previews) await input.previews(tmp, written.files);
    swapDir(tmp, dest);
    return written;
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

export async function renderSvgPreviews(
  page: { setContent: (html: string) => Promise<unknown>; screenshot: (opts: { path: string }) => Promise<unknown> },
  dir: string,
  files: PhaseFile[],
): Promise<void> {
  for (const f of files.filter((x) => x.name.endsWith(".svg"))) {
    const svg = readFileSync(join(dir, f.name), "utf8").replace(/width="420mm" height="297mm"/, 'width="1680" height="1188"');
    await page.setContent(`<html><body style="margin:0;background:#fff">${svg}</body></html>`);
    f.png = f.name.replace(/\.svg$/, ".png");
    await page.screenshot({ path: join(dir, f.png) });
  }
}

export function indexMarkdown(written: Written[]): string {
  const md: string[] = [
    "# Stage diagram pack: Bathroom Concept",
    "",
    "Generated by `npm run stage-pack` from the shipped sample. Each phase is a stage view: the same model with only the listed layers visible. Nothing in the model is edited to make a phase look right.",
    "",
    "Every drawing is proposed set-out for trade review, not a compliance certificate. Values print with their status tag and datum; \"?\" means unknown.",
    "",
  ];
  for (const w of written) {
    md.push(`## ${w.phase.label}`, "", w.phase.summary, "", `Visible: ${w.phase.visible.map((v) => `\`${v}\``).join(", ")}`, "");
    md.push(`Specification: ${w.rows} row(s), ${w.unknown} unknown. [spec.html](${w.phase.slug}/spec.html)`, "");
    if (w.advisory.length) md.push("Open items:", "", ...w.advisory.map((a) => `- ${a}`), "");
    md.push("Not modelled (never drawn):", "", ...w.notModelled.map((n) => `- ${n}`), "");
    for (const f of w.files.filter((x) => x.png)) md.push(`### ${f.title}`, "", `[${f.name}](${w.phase.slug}/${f.name})`, "", `![${f.title}](${w.phase.slug}/${f.png})`, "");
  }
  return md.join("\n");
}

export async function generatePack(opts: { outDir?: string; only?: string[]; date?: string; phases?: Phase[]; previews?: boolean } = {}) {
  const outDir = opts.outDir ?? OUT;
  const only = opts.only ?? [];
  const date = opts.date ?? DATE;
  const phases = opts.phases ?? PHASES;
  const selected = selectPhases(only, phases);

  // The store saves to localStorage on every change; give it a throwaway one so the sample opens here
  // exactly as it does in the browser.
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  };

  const { store, actions, initializeProjects, projects } = await import("../src/model/store");
  const { DEMO_ID } = await import("../src/model/projects");
  const { productStore } = await import("../src/model/productLibrary");

  initializeProjects();
  const opened = projects.open(DEMO_ID);
  if (!opened.ok) throw new Error(`Could not open the sample: ${opened.summary}`);
  const pid = store.getState().activeProjectId ?? DEMO_ID;
  // The sample ships without a title block, which blocks every sheet. Fill it the way set_sheet_info
  // would; it names the sheet only. No site address is recorded, so the room stands in for the site.
  if (!store.getState().model.sheetSet?.titleBlock.project) {
    const tb = actions.setSheetInfo({ project: store.getState().model.name, site: "Bathroom (no site address recorded)" });
    if (!tb.ok) throw new Error(tb.summary);
  }
  const model = store.getState().model;
  const before = JSON.stringify(model);
  const products = productStore.getState().products;

  const browser = opts.previews === false ? null : await (async () => {
    // @ts-expect-error: the shared e2e helper is plain JS
    const { launch } = await import("../tests/browser.mjs");
    return launch();
  })();
  const page = browser ? await browser.newPage({ viewport: { width: 1680, height: 1188 }, deviceScaleFactor: 1 }) : null;
  const written: Written[] = [];
  try {
    for (const phase of selected) {
      const { composed, acknowledged } = composePhase(pid, model, phase, products);
      const w = await writePhase(phase, {
        model, elements: composed.resolution.elements, findings: composed.findings, acknowledged, date, products, outDir,
        ...(page ? { previews: (dir: string, files: PhaseFile[]) => renderSvgPreviews(page, dir, files) } : {}),
      });
      written.push(w);
      console.log(`${phase.slug}: ${composed.resolution.elements.length} element(s), ${w.files.filter((f) => f.name.endsWith(".svg")).length} drawing(s), ${w.rows} spec row(s)`);
    }
  } finally {
    await browser?.close();
  }

  if (JSON.stringify(store.getState().model) !== before) throw new Error("The model changed while composing views. Views must only change visibility.");

  // The index always lists every phase: ones this run skipped are summarised from the same model,
  // with the previews their folders already hold.
  const index = phases.map((phase) => written.find((w) => w.phase === phase) ?? (() => {
    const { composed, acknowledged } = composePhase(pid, model, phase, products);
    return summarizePhase(phase, { model, elements: composed.resolution.elements, findings: composed.findings, acknowledged, date, products, outDir });
  })());
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "README.md"), indexMarkdown(index));
  console.log(`Wrote ${written.length} phase(s) to ${outDir}`);
  return written;
}

function invokedAsCli(): boolean {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return resolve(arg) === fileURLToPath(import.meta.url);
  } catch {
    return arg.replace(/\\/g, "/").endsWith("/scripts/stage-pack.ts");
  }
}

if (invokedAsCli()) {
  try {
    await generatePack({ only: process.argv.slice(2) });
  } catch (err) {
    console.error(err instanceof Error ? err.stack ?? err.message : err);
    process.exitCode = 1;
  }
}
