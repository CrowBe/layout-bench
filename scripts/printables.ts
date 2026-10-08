/**
 * The shipped sample's printable trade set: every drawing and sheet the stage pack and the sample
 * sheets already export, bound into A3 landscape PDFs with a cover, a who-needs-what index, a
 * fixture schedule read from the model, the open decisions and the 3D renders. Nothing is redrawn
 * here: each page is the saved SVG or HTML, printed by Chromium as it is. Run the generators first.
 *
 *   npm run stage-pack && npm run sample-sheets && npm run printables
 *
 * Output: shots/printables/bathroom-trade-set-A3.pdf (everything, specs included),
 * shots/printables/bathroom-wall-set-A3.pdf (drawings only, to pin up) and their README.md.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Item, PlanModel } from "../src/model/types";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SHOTS = join(ROOT, "shots");
const OUT = join(SHOTS, "printables");
const STAGES = join(SHOTS, "stage-pack");
const SHEETS = join(SHOTS, "sample-sheets");
const RENDERS = join(SHOTS, "renovation-3d");

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

const { store, initializeProjects, projects } = await import("../src/model/store");
const { DEMO_ID } = await import("../src/model/projects");
const { catalogForItem } = await import("../src/model/catalog");
const { anchorPose, roughIn } = await import("../src/model/fixtures");
const { installationReading } = await import("../src/model/installation");
const { runLimit } = await import("../src/model/tiling");
const { esc, mm, tag } = await import("../src/sheets/floorPlan");
const { PHASES, localDate } = await import("./stage-pack");
const { stillNeedsCaptainsMeasurement } = await import("../src/model/seed-bathroom");

initializeProjects();
const opened = projects.open(DEMO_ID);
if (!opened.ok) throw new Error(`Could not open the sample: ${opened.summary}`);
const model: PlanModel = store.getState().model;
const DATE = process.env.PRINT_DATE ?? localDate();

// ---- what goes in, in binding order ------------------------------------------------------------
type Kind = "svg" | "html" | "page";
interface Part { title: string; section: string; kind: Kind; path?: string; html?: string; wall: boolean }

const need = (p: string) => { if (!existsSync(p)) throw new Error(`Missing ${p}: run npm run stage-pack and npm run sample-sheets first.`); return p; };
const WALL_NAMES: Record<string, string> = { wall_n: "window wall (north)", wall_e: "right wall (east)", wall_s: "door wall (south)", wall_w: "left wall (west)" };

const parts: Part[] = [];
parts.push({ title: "A-01 floor plan", section: "Overview", kind: "svg", path: need(join(SHEETS, "A-01-floor-plan.svg")), wall: true });
for (const phase of PHASES) {
  const dir = join(STAGES, phase.slug);
  parts.push({ title: `${phase.label}: plan`, section: phase.label, kind: "svg", path: need(join(dir, "plan.svg")), wall: true });
  for (const f of readdirSync(dir).filter((n) => /^elevation-.*\.svg$/.test(n)).sort((a, b) => wallOrder(a) - wallOrder(b))) {
    const wall = /elevation-(wall_\w)-/.exec(f)?.[1] ?? "";
    parts.push({ title: `${phase.label}: elevation, ${WALL_NAMES[wall] ?? wall}`, section: phase.label, kind: "svg", path: join(dir, f), wall: true });
  }
  parts.push({ title: `${phase.label}: specification`, section: phase.label, kind: "html", path: need(join(dir, "spec.html")), wall: false });
}
for (const f of readdirSync(SHEETS).filter((n) => n.endsWith(".svg") && !n.startsWith("A-01")).sort((a, b) => (a.startsWith("floor") ? -1 : b.startsWith("floor") ? 1 : wallOrder(a) - wallOrder(b)))) {
  const wall = /wall-tiling-(wall_\w)-/.exec(f)?.[1];
  parts.push({ title: wall ? `Wall tiling: ${WALL_NAMES[wall]}` : "Floor tiling", section: "Tiling", kind: "svg", path: join(SHEETS, f), wall: true });
}
// the heating review runs to many pages of route tables: the folder copy only; the wall set has the stage 5 plan
for (const f of readdirSync(SHEETS).filter((n) => /^heating-.*\.html$/.test(n))) parts.push({ title: "Heating review", section: "Heating", kind: "html", path: join(SHEETS, f), wall: false });

function wallOrder(name: string) { return ["wall_n", "wall_e", "wall_s", "wall_w"].findIndex((w) => name.includes(w)); }

// ---- pages generated here: cover, schedule, renders ----------------------------------------------
const PAGE_CSS = `@page{size:420mm 297mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}body{font:10.5pt Helvetica,Arial,sans-serif;color:#111}
.sheet{width:420mm;height:297mm;padding:12mm 14mm 10mm;position:relative;overflow:hidden;page-break-after:always;border:0}
.frame{position:absolute;inset:5mm;border:0.5mm solid #000}
h1{font-size:22pt;margin:0 0 2mm}h2{font-size:12.5pt;margin:4mm 0 1.5mm;border-bottom:0.3mm solid #999;padding-bottom:0.8mm}h3{font-size:10.5pt;margin:2.5mm 0 1mm}
.banner{background:#b00020;color:#fff;font-weight:bold;padding:1.5mm 3mm;display:inline-block;font-size:9.5pt;letter-spacing:0.02em}
.muted{color:#555}.small{font-size:8.5pt}.tiny{font-size:7.5pt}
table{border-collapse:collapse;width:100%}td,th{border:0.2mm solid #bbb;padding:0.9mm 1.4mm;text-align:left;vertical-align:top}th{background:#eee}
.cols{display:grid;gap:7mm}.c2{grid-template-columns:1fr 1fr}.c3{grid-template-columns:1fr 1fr 1fr}
ul,ol{margin:0;padding-left:5mm}li{margin:0.5mm 0}
.renders{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm}.renders figure{margin:0}.renders img{width:100%;border:0.2mm solid #999;display:block}.renders figcaption{font-size:8.5pt;margin-top:1mm}
.tag{font-weight:bold}`;

const dataUri = (p: string) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;
const page = (body: string) => `<section class="sheet"><div class="frame"></div>${body}</section>`;

const LEGEND = "SC site-confirmed · M measured · PUB published · P proposed · E estimated · DER derived · ENT entered · DEF default · ? unknown";

/** Owner decisions still open (project notes, 7 Oct 2026). A drawing that depends on one prints the value in use, tagged. */
const OPEN_DECISIONS = [
  "Shower lower bracket height: 1200 mm above the finished floor is in use (P, owner proposal, not confirmed); the G1/2 inlet follows at 1700 mm.",
  "Heating cable under the toilet and the vanity: keep-outs not decided; the proposed route runs under both.",
  "Wall membrane extent: whole window wall, side walls to 100 mm past the screen line, 150 mm strip elsewhere (proposed). Wall layers are whole-wall in the model, so it is a note, not drawn (#88).",
  "Which face the screen's 1200 mm (and the other 'from the window wall' figures) is measured to: drawings hold them from the window wall's existing surface.",
  "Shower mixer and towel rails along the left wall: places not chosen; drawn where the plan has them, tagged E.",
];
const MEASURE_FIRST = [
  "Before strip-out: present positions of the vanity's waste and water points, the shaving cabinet and the GPO, so the 300 mm moves can be set out.",
  "After demolition: slab level (about 120 mm below the current tile, E), the frame faces of each wall, and the wall height from the slab.",
  "Once the frame is confirmed, the finished faces follow; every set-out on these sheets is read off those faces.",
];

/** Which pages each trade needs, by section title. */
const TRADES: [string, string[]][] = [
  ["Demolition / builder", ["1. Post-demolition", "2. Frame prep", "A-01"]],
  ["Plumber", ["3. Rough-in", "6. Screed and falls", "9. Fit-out", "Fixture schedule"]],
  ["Electrician", ["3. Rough-in", "5. Heating cable", "Heating review", "Fixture schedule"]],
  ["Waterproofer", ["4. Waterproofing", "6. Screed and falls"]],
  ["Tiler", ["6. Screed and falls", "7. Tile adhesive", "8. Tiles laid", "Floor tiling", "Wall tiling"]],
  ["Glazier / fit-out", ["9. Fit-out", "Fixture schedule"]],
];

function scheduleRows(): string {
  const fixtureNo = new Map(model.items.map((it, i) => [it.id, `F${i + 1}`]));
  const host = (it: Item) => model.items.find((x) => x.id === it.fittedTo?.hostId);
  return model.items.map((it) => {
    const cat = catalogForItem(it);
    const p = it.productIdentity;
    const product = p ? [p.manufacturer, p.model, p.code].filter(Boolean).join(" · ") || p.physicalItem?.label || "?" : "not recorded";
    let where = "not set out from a wall: position as drawn on the plan";
    if (it.anchor) {
      const wall = model.walls.find((w) => w.id === it.anchor!.wallId)!;
      const pose = anchorPose(model, it);
      const limA = runLimit(model, wall, it.anchor.side, "a", "finished");
      where = pose.resolved && limA.resolved
        ? `${WALL_NAMES[wall.id] ?? wall.id}: back on the finished face, centreline ${mm(pose.alongFromA! - limA.s!)} ${tag(it.anchor.status)} along from ${limA.label.replace(/ \(right side\)/, "").replace(/wall_[nesw]/, (w) => `the ${WALL_NAMES[w]}`)}`
        : `${WALL_NAMES[wall.id] ?? wall.id}: set-out unresolved`;
    } else if (it.fittedTo) where = `in ${fixtureNo.get(it.fittedTo.hostId)} ${catalogForItem(host(it)!)?.label ?? ""}: ${mm(it.fittedTo.across)} across, ${mm(it.fittedTo.out)} from its back (DER)`;
    let height = "stands on the finished floor";
    if (it.installation) {
      const r = installationReading(model, it);
      height = r.bottom !== undefined ? `bottom ${mm(r.bottom)} ${tag(r.basis)} above the finished floor${cat?.elevationNote ? ` (${cat.elevationNote})` : ""}` : `? (${r.missing.join(", ")})`;
    } else if (cat?.elevation) height = "? (no recorded height)";
    const services = roughIn(model, it).map((r) => `${r.service}: ${r.label}${r.up !== undefined ? `, ${mm(r.up)} ${tag(r.status)} up` : ""}${r.entered.across !== undefined ? `, ${mm(r.entered.across)} ${tag(r.status)} across` : ""}${r.entered.out !== undefined ? `, ${mm(r.entered.out)}${r.entered.outMax !== undefined ? `–${mm(r.entered.outMax)}` : ""} ${tag(r.status)} out` : ""}`);
    return `<tr><td><b>${fixtureNo.get(it.id)}</b></td><td>${esc(cat?.label ?? it.kind)}</td><td>${esc(product)}</td><td>${esc(it.selectionStatus ?? "unknown")}</td><td>${cat ? `${mm(cat.w)} × ${mm(cat.d)} × ${mm(cat.h)}` : "?"}</td><td>${esc(where)}</td><td>${esc(height)}</td><td>${services.length ? services.map(esc).join("<br>") : "<span class=muted>none recorded</span>"}</td></tr>`;
  }).join("");
}

function coverPage(toc: { title: string; first: number; count: number }[], set: string, total: number): string {
  const sections = [...new Map(toc.map((t) => [t.title.split(":")[0], t])).values()];
  const hero = existsSync(join(RENDERS, "stage-6-fit-out.png")) ? `<img src="${dataUri(join(RENDERS, "stage-6-fit-out.png"))}" style="width:100%;border:0.2mm solid #999">` : "";
  // one row per section: its sheets in order and the pages they cover
  const groups: { section: string; sheets: string[]; first: number; last: number }[] = [];
  for (const t of toc) {
    const [section, sheet] = t.title.includes(": ") ? [t.title.slice(0, t.title.lastIndexOf(": ")), t.title.slice(t.title.lastIndexOf(": ") + 2)] : [t.title, ""];
    const g = groups[groups.length - 1];
    if (g && g.section === section) { if (sheet) g.sheets.push(sheet); g.last = t.first + t.count - 1; }
    else groups.push({ section, sheets: sheet ? [sheet] : [], first: t.first, last: t.first + t.count - 1 });
  }
  const contents = groups.map((g) => `<tr><td><b>${esc(g.section)}</b>${g.sheets.length ? `<br><span class="muted">${esc(g.sheets.join(" · "))}</span>` : ""}</td><td style="text-align:right;white-space:nowrap">${g.first === g.last ? g.first : `${g.first}–${g.last}`}</td></tr>`).join("");
  return page(`<div class="cols c2" style="grid-template-columns:1.05fr 1fr;height:100%">
<div><h1>${esc(model.name)}: ${set}</h1>
<div class="muted">Bathroom renovation · ${esc(model.sheetSet?.titleBlock.site ?? "")} · printed ${DATE} · ${total} A3 pages</div>
<p><span class="banner">PROPOSED · FOR TRADE REVIEW · NOT AS-BUILT · NOT A COMPLIANCE CERTIFICATE</span></p>
${hero}
<h2>How to read these sheets</h2>
<ul class="small"><li>Dimensions in millimetres. Every figure carries its status: ${LEGEND}. Treat anything not SC or M as a figure to check on site.</li>
<li>Elevations look at a wall from inside the room; end A is on the left. Wall fittings are set out from the wall's finished (tile) face: centreline along from the return wall's face at A, bottom above the finished floor.</li>
<li>F1, F2… are the fixtures (see the fixture schedule); F11.2 is service point 2 of fixture 11. "?" means not known yet and never drawn.</li>
<li>Scale 1:20 at A3 on the plans and elevations. Print at 100% ("actual size"), never "fit to page".</li></ul>
<p class="tiny muted">${sections.length} sections. Generated from the project model by npm run printables; the drawings are the same exports saved in the repository (shots/stage-pack, shots/sample-sheets).</p></div>
<div><h2>Contents</h2><table class="tiny"><tr><th>Sheet</th><th style="text-align:right">Page</th></tr>${contents}</table></div></div>`);
}

function indexPage(toc: { title: string; first: number; count: number }[]): string {
  const pagesFor = (keys: string[]) => keys.map((k) => {
    const hits = toc.filter((t) => t.title.includes(k));
    if (!hits.length) return "";
    const first = hits[0].first, last = hits[hits.length - 1].first + hits[hits.length - 1].count - 1;
    return `${esc(k.replace(/^\d\. /, ""))} (p. ${first === last ? first : `${first}–${last}`})`;
  }).filter(Boolean).join("; ");
  const trades = TRADES.map(([t, keys]) => `<tr><td><b>${t}</b></td><td>${pagesFor(keys)}</td></tr>`).join("");
  const measure = stillNeedsCaptainsMeasurement.map((m) => `<li><b>${esc(m.fitting)}</b>: ${esc(m.what)}. <span class="muted">From: ${esc(m.from)}.</span></li>`).join("");
  return page(`<h1>Who needs what, and what is still open</h1>
<div class="cols c2"><div>
<h2>Sheets by trade</h2><table class="small"><tr><th>Trade</th><th>Sheets</th></tr>${trades}</table>
<h2>Open owner decisions</h2><ol class="small">${OPEN_DECISIONS.map((d) => `<li>${esc(d)}</li>`).join("")}</ol>
<h2>Measure first</h2><ol class="small">${MEASURE_FIRST.map((d) => `<li>${esc(d)}</li>`).join("")}</ol>
</div><div><h2>Still to measure or confirm (${stillNeedsCaptainsMeasurement.length})</h2><ol class="tiny">${measure}</ol></div></div>`);
}

function schedulePage(): string {
  return page(`<h1>Fixture schedule</h1><p class="small muted">From the project model. Set-out along a wall is read from the return wall's finished face; heights are above the finished floor (flat target 0 P = the current tile level). Status: ${LEGEND}.</p>
<table class="tiny"><tr><th>No.</th><th>Item</th><th>Product</th><th>Selection</th><th>Envelope W × D × H</th><th>Set-out</th><th>Height</th><th>Service points (up above finished floor; across the fixture's centreline facing it, left −; out from the wall face)</th></tr>${scheduleRows()}</table>`);
}

function rendersPage(): string {
  const shots = [
    ["finished-top.png", "Finished room, from above"], ["finished-walk.png", "Finished room, eye level"],
    ["stage-1-post-demolition.png", "1. Post-demolition"], ["stage-2-rough-in.png", "2–3. Frame and rough-in"],
    ["stage-3-board-and-window.png", "Board and window"], ["stage-4-waterproofing.png", "4. Waterproofing"],
    ["stage-5-screed-and-tiles.png", "5–8. Screed and tiles"], ["stage-6-fit-out.png", "9. Fit-out"],
  ].filter(([f]) => existsSync(join(RENDERS, f)));
  return page(`<h1>The room in 3D, stage by stage</h1><p class="small muted">Renders of the same model the drawings come from (shots/renovation-3d). For orientation only: dimension from the drawings.</p>
<div class="renders">${shots.map(([f, c]) => `<figure><img src="${dataUri(join(RENDERS, f))}"><figcaption>${esc(c)}</figcaption></figure>`).join("")}</div>`);
}

// ---- print ----------------------------------------------------------------------------------------
// @ts-expect-error: the shared e2e helper is plain JS
const { launch } = await import("../tests/browser.mjs");
const browser = await launch();
const tab = await browser.newPage();

async function printHtml(html: string): Promise<Uint8Array> {
  await tab.setContent(html, { waitUntil: "load" });
  return tab.pdf({ preferCSSPageSize: true, printBackground: true });
}
async function printPart(p: Part): Promise<Uint8Array> {
  const src = readFileSync(p.path!, "utf8");
  if (p.kind === "svg") {
    const svg = src.replace(/^<\?xml[^>]*>\s*/, "").replace(/<svg /, '<svg style="display:block;width:420mm;height:297mm" ');
    return printHtml(`<!doctype html><meta charset="utf-8"><style>@page{size:420mm 297mm;margin:0}html,body{margin:0}</style>${svg}`);
  }
  // an HTML sheet keeps its own styles; only the paper changes to A3 landscape, with room for the page stamp
  const a3 = `<style>@page{size:420mm 297mm;margin:10mm 12mm 12mm}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{max-width:none}</style>`;
  return printHtml(src.includes("</head>") ? src.replace("</head>", `${a3}</head>`) : a3 + src);
}

async function bind(set: string, file: string, chosen: Part[]): Promise<number> {
  const printed: { part: Part; pdf: PDFDocument }[] = [];
  for (const part of chosen) printed.push({ part, pdf: await PDFDocument.load(await printPart(part)) });
  const front = 3; // cover, index, schedule
  const extra = 1; // renders page at the end
  let at = front + 1;
  const toc = printed.map(({ part, pdf }) => { const t = { title: part.title, first: at, count: pdf.getPageCount() }; at += t.count; return t; });
  toc.unshift({ title: "Who needs what, open decisions, still to measure", first: 2, count: 1 }, { title: "Fixture schedule", first: 3, count: 1 });
  toc.push({ title: "3D renders", first: at, count: 1 });
  const total = at - 1 + extra;
  const head = await PDFDocument.load(await printHtml(`<!doctype html><meta charset="utf-8"><style>${PAGE_CSS}</style>${coverPage(toc, set, total)}${indexPage(toc)}${schedulePage()}`));
  const tail = await PDFDocument.load(await printHtml(`<!doctype html><meta charset="utf-8"><style>${PAGE_CSS}</style>${rendersPage()}`));
  if (head.getPageCount() !== front) throw new Error(`Front matter ran to ${head.getPageCount()} pages, expected ${front}: shorten it.`);

  const out = await PDFDocument.create();
  out.setTitle(`${model.name}: ${set}`);
  out.setSubject("Proposed, for trade review. Not as-built, not a compliance certificate.");
  out.setCreator("Reno Layouts (npm run printables)");
  for (const doc of [head, ...printed.map((p) => p.pdf), tail]) for (const pg of await out.copyPages(doc, doc.getPageIndices())) out.addPage(pg);
  // page stamp in the bottom margin, outside every sheet's own border
  const font = await out.embedFont(StandardFonts.Helvetica);
  const pages = out.getPages();
  pages.forEach((pg, i) => {
    const label = `${model.name} · ${set} · ${DATE} · page ${i + 1} of ${pages.length}`;
    pg.drawText(label, { x: pg.getWidth() - 14 - font.widthOfTextAtSize(label, 6.5), y: 5.5, size: 6.5, font, color: rgb(0.35, 0.35, 0.35) });
  });
  if (pages.length !== total) throw new Error(`Bound ${pages.length} pages, contents says ${total}.`);
  writeFileSync(join(OUT, file), await out.save());
  console.log(`${file}: ${pages.length} A3 page(s)`);
  return pages.length;
}

mkdirSync(OUT, { recursive: true });
try {
  const full = await bind("trade set", "bathroom-trade-set-A3.pdf", parts);
  const wall = await bind("wall set (drawings)", "bathroom-wall-set-A3.pdf", parts.filter((p) => p.wall));
  writeFileSync(join(OUT, "README.md"), [
    `# Printable trade set: ${model.name}`, "",
    "Generated by `npm run printables` (after `npm run stage-pack` and `npm run sample-sheets`). A3 landscape; print at 100 % (actual size) so the 1:20 drawings scale.", "",
    `- [bathroom-wall-set-A3.pdf](bathroom-wall-set-A3.pdf): ${wall} pages. The drawings to pin up: cover and contents, who needs what, the fixture schedule, A-01, every stage plan and wall elevation, the tiling sheets and the 3D renders (the heating route is on the stage 5 plan).`,
    `- [bathroom-trade-set-A3.pdf](bathroom-trade-set-A3.pdf): ${full} pages. The same plus every stage's full specification table, for the folder.`, "",
    "Every page is the saved export it names, unchanged; the cover, index, schedule and renders pages are built from the same model. Proposed, for trade review: not as-built and not a compliance certificate.", "",
  ].join("\n"));
} finally {
  await browser.close();
}
