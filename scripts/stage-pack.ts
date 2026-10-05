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

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

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
const { applyView, composeView, currentView } = await import("../src/sheets/viewState");
const { catalogue, renderStageDiagram, renderStageSpec } = await import("../src/sheets/stageView");
const { elevationSurfaces, renderStageElevation } = await import("../src/sheets/stageElevation");
const { reconcile } = await import("../src/sheets/check");

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

const DATE = process.env.STAGE_PACK_DATE ?? new Date().toISOString().slice(0, 10);
const OUT = resolve("shots/stage-pack");
const only = process.argv.slice(2);

initializeProjects();
const opened = projects.open(DEMO_ID);
if (!opened.ok) throw new Error(`Could not open the sample: ${opened.summary}`);
const pid = store.getState().activeProjectId;
// The sample ships without a title block, which blocks every sheet. Fill it the way set_sheet_info
// would; it names the sheet only. No site address is recorded, so the room stands in for the site.
if (!store.getState().model.sheetSet?.titleBlock.project) {
  const tb = actions.setSheetInfo({ project: store.getState().model.name, site: "Bathroom (no site address recorded)" });
  if (!tb.ok) throw new Error(tb.summary);
}
const model = store.getState().model;
const before = JSON.stringify(model);
const products = productStore.getState().products;

interface Written { phase: Phase; files: { name: string; title: string; png?: string }[]; rows: number; unknown: number; advisory: string[]; notModelled: string[] }
const written: Written[] = [];

for (const phase of PHASES.filter((p) => !only.length || only.some((o) => p.slug.startsWith(o)))) {
  const applied = applyView(pid, model, phase.label, phase.visible);
  if (!applied.ok) throw new Error(`${phase.slug}: ${applied.summary}`);
  const c = composeView(model, currentView(pid)!, products);
  const ack = reconcile(c.findings, []);
  if (!ack.ok) throw new Error(`${phase.slug}: blocking findings, fix them in the model first:\n${JSON.stringify(ack.open, null, 2)}`);

  const opts = { label: phase.label, findings: c.findings, acknowledged: ack.acknowledged, date: DATE, products };
  const dir = join(OUT, phase.slug);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const files: Written["files"] = [];
  writeFileSync(join(dir, "plan.svg"), renderStageDiagram(model, c.resolution.elements, opts));
  files.push({ name: "plan.svg", title: "Plan" });
  for (const s of elevationSurfaces(model, c.resolution.elements)) {
    const name = `elevation-${s.wallId}-${s.side}.svg`;
    writeFileSync(join(dir, name), renderStageElevation(model, c.resolution.elements, s.wallId, s.side, opts));
    files.push({ name, title: `Elevation ${s.wallId} (${s.side} side, from ${s.room})` });
  }
  const spec = renderStageSpec(model, c.resolution.elements, opts);
  writeFileSync(join(dir, "spec.html"), spec.html);
  files.push({ name: "spec.html", title: "Specification sheet" });

  written.push({
    phase, files, rows: spec.rows.length,
    unknown: spec.rows.filter((r) => r.value === "?").length,
    advisory: c.findings.filter((f) => f.severity === "advisory").map((f) => f.message),
    notModelled: catalogue(model).notModelled,
  });
  console.log(`${phase.slug}: ${c.resolution.elements.length} element(s), ${files.length - 1} drawing(s), ${spec.rows.length} spec row(s)`);
}

if (JSON.stringify(store.getState().model) !== before) throw new Error("The model changed while composing views. Views must only change visibility.");

// PNG previews of every drawing, for reading the pack on GitHub
// @ts-expect-error: the shared e2e helper is plain JS
const { launch } = await import("../tests/browser.mjs");
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 1188 }, deviceScaleFactor: 1 });
for (const w of written) {
  for (const f of w.files.filter((x) => x.name.endsWith(".svg"))) {
    // A3 at 4 px per paper mm, on white
    const svg = readFileSync(join(OUT, w.phase.slug, f.name), "utf8").replace(/width="420mm" height="297mm"/, 'width="1680" height="1188"');
    await page.setContent(`<html><body style="margin:0;background:#fff">${svg}</body></html>`);
    f.png = f.name.replace(/\.svg$/, ".png");
    await page.screenshot({ path: join(OUT, w.phase.slug, f.png) });
  }
}
await browser.close();

// the pack index
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
writeFileSync(join(OUT, "README.md"), md.join("\n"));
console.log(`Wrote ${written.length} phase(s) to ${OUT}`);
