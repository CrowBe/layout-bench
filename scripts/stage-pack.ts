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

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

/** The local calendar day as YYYY-MM-DD, built from its parts so no locale data can change the format. */
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The sheet date: STAGE_PACK_DATE when it is a YYYY-MM-DD date, else today's local date (so a Sydney
 * morning prints today, not UTC's yesterday). An empty override is ignored; a malformed one is an error.
 */
export function packDate(override = process.env.STAGE_PACK_DATE, now = new Date()): string {
  const v = override?.trim();
  if (!v) return localDate(now);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  if (!m || !d || localDate(d) !== v) throw new Error(`STAGE_PACK_DATE must be a YYYY-MM-DD date, got "${v}".`);
  return v;
}

export const DATE = packDate();
export const OUT = resolve("shots/stage-pack");

export interface PhaseFile { name: string; title: string; png?: string }
/** A phase in the index that has no folder on disk yet. */
export interface NotGenerated { phase: Phase; notGenerated: true }
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

const unescapeHtml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const cells = (tr: string) => [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => unescapeHtml(m[1]));

/**
 * The index entry for a phase this run does not regenerate, read from what is on disk: counts and
 * open items from its spec.html, drawings from the files that exist, so the README agrees with the
 * committed sheets even if the model has changed since. A phase with no folder or no spec is
 * reported as not generated, and nothing is linked for it.
 */
export function summarizePhase(phase: Phase, outDir: string): Written | NotGenerated {
  const dir = join(outDir, phase.slug);
  const specPath = join(dir, "spec.html");
  if (!existsSync(specPath)) return { phase, notGenerated: true };
  const spec = readFileSync(specPath, "utf8");
  // spec columns, from the end: value, status, measured from, source, missing (the element label cell only starts a group)
  const rows = [...spec.matchAll(/<tr data-element="[^"]*"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => cells(m[1]));
  const unknown = rows.filter((c) => c.at(-5) === "?" || / unknown$/.test(c.at(-4) ?? "")).length;
  const unresolved = /<h2>Unresolved in this view \(\d+\)<\/h2><ul>([\s\S]*?)<\/ul>/.exec(spec)?.[1] ?? "";
  const advisory = [...unresolved.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => unescapeHtml(m[1]));

  const planPath = join(dir, "plan.svg");
  const plan = existsSync(planPath) ? readFileSync(planPath, "utf8") : "";
  const notModelledLine = /Not modelled, never drawn: ([^<]*?)\.<\/text>/.exec(plan)?.[1];
  const notModelled = notModelledLine ? unescapeHtml(notModelledLine).split("; ") : [];
  // elevations in the plan's element order (the model's wall order when it was generated)
  const order = (() => { try { return (JSON.parse(unescapeHtml(/<metadata id="stage-view">([^<]*)<\/metadata>/.exec(plan)?.[1] ?? "{}")).elements ?? []) as string[]; } catch { return []; } })();
  const rank = (wallId: string) => { const i = order.indexOf(`wall:${wallId}`); return i < 0 ? order.length : i; };
  const elevations = readdirSync(dir).filter((n) => /^elevation-.+\.svg$/.test(n)).map((name) => {
    const svg = readFileSync(join(dir, name), "utf8");
    const wallId = /data-wall="([^"]*)"/.exec(svg)?.[1] ?? name;
    const side = /data-side="([^"]*)"/.exec(svg)?.[1] ?? "";
    const room = /facing ([^<.]+)\./.exec(svg)?.[1];
    return { wallId, file: { name, title: `Elevation ${wallId} (${side} side${room ? `, from ${unescapeHtml(room)}` : ""})` } as PhaseFile };
  }).sort((a, b) => rank(a.wallId) - rank(b.wallId) || a.file.name.localeCompare(b.file.name)).map((e) => e.file);

  const files: PhaseFile[] = [...(plan ? [{ name: "plan.svg", title: "Plan" }] : []), ...elevations, { name: "spec.html", title: "Specification sheet" }];
  for (const f of files.filter((x) => x.name.endsWith(".svg"))) {
    const png = f.name.replace(/\.svg$/, ".png");
    if (existsSync(join(dir, png))) f.png = png;
  }
  return { phase, files, rows: rows.length, unknown, advisory, notModelled };
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

export function indexMarkdown(written: (Written | NotGenerated)[]): string {
  const md: string[] = [
    "# Stage diagram pack: Bathroom Concept",
    "",
    "Generated by `npm run stage-pack` from the shipped sample. Each phase is a stage view: the same model with only the listed layers visible. Nothing in the model is edited to make a phase look right.",
    "",
    "Every drawing is proposed set-out for trade review, not a compliance certificate. Values print with their status tag and datum; \"?\" means unknown.",
    "",
  ];
  for (const w of written) {
    if ("notGenerated" in w) {
      md.push(`## ${w.phase.label}`, "", w.phase.summary, "", `Not generated yet. Run \`npm run stage-pack -- ${w.phase.slug.split("-")[0]}\`.`, "");
      continue;
    }
    md.push(`## ${w.phase.label}`, "", w.phase.summary, "", `Visible: ${w.phase.visible.map((v) => `\`${v}\``).join(", ")}`, "");
    md.push(`Specification: ${w.rows} row(s), ${w.unknown} unknown. [spec.html](${w.phase.slug}/spec.html)`, "");
    if (w.advisory.length) md.push("Open items:", "", ...w.advisory.map((a) => `- ${a}`), "");
    md.push("Not modelled (never drawn):", "", ...w.notModelled.map((n) => `- ${n}`), "");
    for (const f of w.files.filter((x) => x.name.endsWith(".svg"))) {
      md.push(`### ${f.title}`, "", `[${f.name}](${w.phase.slug}/${f.name})`, "");
      if (f.png) md.push(`![${f.title}](${w.phase.slug}/${f.png})`, "");
    }
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

  // The index lists every phase, each read back from its folder on disk, so a filtered run and a full
  // run write the same README for the same files, and it never links a file that is not there.
  const index = phases.map((phase) => summarizePhase(phase, outDir));
  if (JSON.stringify(store.getState().model) !== before) throw new Error("The model changed while composing views. Views must only change visibility.");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "README.md"), indexMarkdown(index));
  console.log(`Wrote ${written.length} phase(s) to ${outDir}`);
  return written;
}

/** True when this file is the script being run: vite-node sets argv[1] to it only with --script. */
export function invokedAsCli(arg = process.argv[1]): boolean {
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
