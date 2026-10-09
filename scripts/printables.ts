/**
 * The shipped sample's printable packs: every drawing and sheet the stage pack and the sample sheets
 * already export, bound into one PDF per construction stage plus an overview pack (cover, who needs
 * what, open decisions, the fixture schedule read from the model, A-01 and the 3D renders). Nothing
 * is redrawn here: each page is the saved SVG or HTML, printed by Chromium. Run the generators first.
 *
 *   npm run stage-pack && npm run sample-sheets && npm run printables
 *
 * A stage pack leaves out a wall elevation that shows nothing new at that stage (no fitting,
 * service point, opening or the wall itself appears on it for the first time): its plan and
 * specification still carry the stage. Stage 8 uses the wall tiling sheets in place of its own
 * tiled elevations.
 *
 * A3 landscape prints each sheet as it is. A4 splits each A3 drawing sheet in two at its panel edge
 * and prints both halves at actual size: the drawing (still at its stated scale, with a true scale
 * bar) and then its notes and title block. HTML sheets reflow onto A4 landscape.
 *
 * Output: shots/printables/A4/*.pdf and shots/printables/A3/*.pdf, and their README.md.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

// ---- what goes in, pack by pack ------------------------------------------------------------------
type Kind = "svg" | "html";
interface Part { title: string; kind: Kind; path: string }
interface Pack { slug: string; title: string; summary: string; parts: Part[] }

const need = (p: string) => { if (!existsSync(p)) throw new Error(`Missing ${p}: run npm run stage-pack and npm run sample-sheets first.`); return p; };
const WALL_NAMES: Record<string, string> = { wall_n: "window wall (north)", wall_e: "right wall (east)", wall_s: "door wall (south)", wall_w: "left wall (west)" };
const elementsOf = (svg: string) => new Set([...svg.matchAll(/data-element="([^"]+)"/g)].map((m) => m[1]));
const viewElements = (svg: string) => new Set<string>(JSON.parse((/<metadata id="stage-view">([^<]*)</.exec(svg)?.[1] ?? "{}").replace(/&quot;/g, '"').replace(/&amp;/g, "&")).elements ?? []);
/** A fitting, service point, opening or the bare wall: what an elevation is for. Layers and floor build-up read from the plan. */
const setOutOnWall = (id: string) => /^(item|opening):/.test(id) || /^wall:[^:]+$/.test(id);

const tilingSheets = readdirSync(SHEETS).filter((n) => /^wall-tiling-.*\.svg$/.test(n)).sort((a, b) => wallOrder(a) - wallOrder(b));
const tiledWalls = new Set(tilingSheets.map((f) => /wall-tiling-(wall_\w)-/.exec(f)?.[1]));

// the tiling sheets and the heating review go in the first stage that shows tiles or the cable
const firstShowing = (layer: string) => PHASES.find((p) => p.visible.includes(layer))?.slug;
const TILE_STAGE = firstShowing("wall-tile"), HEATING_STAGE = firstShowing("floor-heating-cable");

const packs: Pack[] = [{
  slug: "00-overview", title: "Overview",
  summary: "Start here: who needs which pack, the owner decisions still open, what to measure first, the fixture schedule, the A-01 floor plan and the room in 3D.",
  parts: [{ title: "A-01 floor plan", kind: "svg", path: need(join(SHEETS, "A-01-floor-plan.svg")) }],
}];
const dropped = new Map<string, string[]>(); // stage label -> walls left out
let seen = new Set<string>();
for (const phase of PHASES) {
  const dir = join(STAGES, phase.slug);
  const plan = readFileSync(need(join(dir, "plan.svg")), "utf8");
  const shown = viewElements(plan);
  const fresh = new Set([...shown].filter((id) => !seen.has(id)));
  seen = new Set([...seen, ...shown]);
  const parts: Part[] = [{ title: "Plan", kind: "svg", path: join(dir, "plan.svg") }];
  for (const f of readdirSync(dir).filter((n) => /^elevation-.*\.svg$/.test(n)).sort((a, b) => wallOrder(a) - wallOrder(b))) {
    const wall = /elevation-(wall_\w)-/.exec(f)?.[1] ?? "";
    const title = `Elevation, ${WALL_NAMES[wall] ?? wall}`;
    const tiled = phase.slug === TILE_STAGE && tiledWalls.has(wall);
    if (tiled || ![...elementsOf(readFileSync(join(dir, f), "utf8"))].some((id) => fresh.has(id) && setOutOnWall(id))) { dropped.set(phase.label, [...(dropped.get(phase.label) ?? []), WALL_NAMES[wall] ?? wall]); continue; }
    parts.push({ title, kind: "svg", path: join(dir, f) });
  }
  parts.push({ title: "Specification", kind: "html", path: need(join(dir, "spec.html")) });
  if (phase.slug === HEATING_STAGE) for (const f of readdirSync(SHEETS).filter((n) => /^heating-.*\.html$/.test(n))) parts.push({ title: "Heating review", kind: "html", path: join(SHEETS, f) });
  if (phase.slug === TILE_STAGE) {
    for (const f of readdirSync(SHEETS).filter((n) => /^floor-tiling-.*\.svg$/.test(n))) parts.push({ title: "Floor tiling", kind: "svg", path: join(SHEETS, f) });
    for (const f of tilingSheets) parts.push({ title: `Wall tiling, ${WALL_NAMES[/wall-tiling-(wall_\w)-/.exec(f)![1]]}`, kind: "svg", path: join(SHEETS, f) });
  }
  packs.push({ slug: phase.slug, title: phase.label, summary: phase.summary, parts });
}

function wallOrder(name: string) { return ["wall_n", "wall_e", "wall_s", "wall_w"].findIndex((w) => name.includes(w)); }

// ---- pages generated here: cover, schedule, renders ----------------------------------------------
type Paper = "A3" | "A4";
// A3 pages are fixed sheets with a frame. A4 pages flow: a table longer than one page runs on.
const SHEET_CSS: Record<Paper, string> = {
  A3: `@page{size:420mm 297mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}body{font:10.5pt Helvetica,Arial,sans-serif;color:#111}
.sheet{width:420mm;height:297mm;padding:12mm 14mm 10mm;position:relative;overflow:hidden;page-break-after:always;border:0}`,
  A4: `@page{size:297mm 210mm;margin:9mm 11mm 10mm}*{box-sizing:border-box}html,body{margin:0;padding:0}body{font:9.5pt Helvetica,Arial,sans-serif;color:#111}
.sheet{width:100%;border:0}.frame{display:none}.sheet>.cols{height:auto!important}.sheet .small{font-size:8pt}.sheet .tiny{font-size:7pt}.hero{max-height:80mm;object-fit:contain}`,
};
const PAGE_CSS = (paper: Paper) => `${SHEET_CSS[paper]}
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

/** Which packs each trade needs, by slug prefix. */
const TRADES: [string, string[]][] = [
  ["Demolition / builder", ["00", "01", "02"]],
  ["Plumber", ["00", "03", "06", "09"]],
  ["Electrician", ["00", "03", "05"]],
  ["Waterproofer", ["04", "06"]],
  ["Tiler", ["06", "07", "08"]],
  ["Glazier / fit-out", ["00", "09"]],
];
const packName = (prefix: string) => { const p = packs.find((k) => k.slug.startsWith(prefix))!; return `${p.slug}.pdf`; };

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

type Toc = { title: string; first: number; count: number }[];

function coverPage(pack: Pack, toc: Toc, total: number, paper: Paper): string {
  const overview = pack.slug.startsWith("00");
  const hero = overview && existsSync(join(RENDERS, "stage-6-fit-out.png")) ? `<img class="hero" src="${dataUri(join(RENDERS, "stage-6-fit-out.png"))}" style="width:100%;border:0.2mm solid #999">` : "";
  const prefix = pack.slug.slice(0, 2);
  const trades = TRADES.filter(([, keys]) => keys.includes(prefix)).map(([t]) => t);
  const contents = toc.map((t) => `<tr><td>${esc(t.title)}</td><td style="text-align:right;white-space:nowrap">${t.count === 1 ? t.first : `${t.first}–${t.first + t.count - 1}`}</td></tr>`).join("");
  return page(`<div class="cols c2" style="grid-template-columns:1.05fr 1fr;height:100%">
<div><h1>${esc(model.name)}: ${esc(pack.title)}</h1>
<div class="muted">Bathroom renovation · ${esc(model.sheetSet?.titleBlock.site ?? "")} · pack ${prefix} of ${packs.length - 1} · printed ${DATE} · ${total} ${paper} pages</div>
<p><span class="banner">PROPOSED · FOR TRADE REVIEW · NOT AS-BUILT · NOT A COMPLIANCE CERTIFICATE</span></p>
<p>${esc(pack.summary)}</p>
${trades.length ? `<p class="small"><b>For:</b> ${esc(trades.join(", "))}.</p>` : ""}
${hero}
<h2>How to read these sheets</h2>
<ul class="small"><li>Dimensions in millimetres. Every figure carries its status: ${LEGEND}. Treat anything not SC or M as a figure to check on site.</li>
<li>Elevations look at a wall from inside the room; end A is on the left. Wall fittings are set out from the wall's finished (tile) face: centreline along from the return wall's face at A, bottom above the finished floor.</li>
<li>F1, F2… are the fixtures (fixture schedule in ${packName("00")}); F11.2 is service point 2 of fixture 11. "?" means not known yet and never drawn.</li>
${paper === "A3"
    ? `<li>Scale 1:20 at A3 on the plans and elevations. Print at 100% ("actual size"), never "fit to page".</li>`
    : `<li>Each drawing is two A4 pages: the drawing at its stated scale (1:20 on the plans and elevations), then its notes and title block. Print at 100% ("actual size"), never "fit to page"; the 1 m scale bar at the top of each drawing page then measures 50 mm.</li>`}
${overview ? "" : `<li>A wall elevation is left out when nothing new is set out on that wall at this stage; the plan and specification still cover the stage. Open decisions and what is still to measure: ${packName("00")}.</li>`}</ul>
<p class="tiny muted">Generated from the project model by npm run printables; the drawings are the same exports saved in the repository (shots/stage-pack, shots/sample-sheets).</p></div>
<div><h2>In this pack</h2><table class="small"><tr><th>Sheet</th><th style="text-align:right">Page</th></tr>${contents}</table></div></div>`);
}

function indexPage(): string {
  const trades = TRADES.map(([t, keys]) => `<tr><td><b>${t}</b></td><td>${keys.map((k) => esc(packName(k))).join(", ")}</td></tr>`).join("");
  const list = packs.map((p) => `<tr><td>${esc(p.slug)}.pdf</td><td>${esc(p.title)}</td></tr>`).join("");
  const measure = stillNeedsCaptainsMeasurement.map((m) => `<li><b>${esc(m.fitting)}</b>: ${esc(m.what)}. <span class="muted">From: ${esc(m.from)}.</span></li>`).join("");
  return page(`<h1>Who needs what, and what is still open</h1>
<div class="cols c2"><div>
<h2>The packs</h2><table class="small"><tr><th>File</th><th>Stage</th></tr>${list}</table>
<h2>Packs by trade</h2><table class="small"><tr><th>Trade</th><th>Packs</th></tr>${trades}</table>
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

/** Where each sheet type's drawing area ends and its notes panel begins, in paper mm (src/sheets). */
const PANEL_EDGE: Record<string, number> = { "floor-plan": 263, "stage-view": 263, "stage-elevation": 277, "wall-tiling": 277, "floor-tiling": 224 };
const FOOT = 264; // paper y below which a sheet's drawing area holds only its scale bar and caption
const HEAD = 22; // paper y above which it holds only a status line
const A4 = { w: 210, h: 297 };
const MARGIN = { side: 6, top: 20, bottom: 9 }; // the top strip holds the header and scale bar; the bottom the page stamp
const OVERLAP = 10; // mm a drawing repeats across a page join, when it needs more than one page

interface Half { svg: string; x: number; y: number; w: number; h: number }

/**
 * Split one A3 sheet at its panel edge, in the browser so text and rotated labels measure as
 * drawn. Each top-level element goes to the side its centre is on; the sheet frame and the
 * drawing-area border go to neither. Coordinates stay in paper mm, so the drawing half keeps the
 * sheet's scale exactly.
 */
async function splitSheet(svgSrc: string, edge: number): Promise<{ drawing: Half; panel: Half; caption: string }> {
  await tab.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0}svg{display:block}</style>${svgSrc}`, { waitUntil: "load" });
  return tab.evaluate(({ edge, foot, head }: { edge: number; foot: number; head: number }) => {
    const root = document.querySelector("svg")!;
    const vb = root.viewBox.baseVal;
    const r0 = root.getBoundingClientRect();
    const k = r0.width / vb.width;
    const caption: string[] = [];
    const side = new Map<Element, "drawing" | "panel" | "none">();
    const box = { drawing: [Infinity, Infinity, -Infinity, -Infinity], panel: [Infinity, Infinity, -Infinity, -Infinity] };
    for (const el of Array.from(root.children)) {
      if (["metadata", "defs", "style"].includes(el.tagName)) continue;
      const r = el.getBoundingClientRect();
      const x0 = vb.x + (r.left - r0.left) / k, y0 = vb.y + (r.top - r0.top) / k, x1 = x0 + r.width / k, y1 = y0 + r.height / k;
      // the background, the sheet frame and the drawing-area border: frames, not content
      if (el.tagName === "rect" && x1 - x0 > 200 && y1 - y0 > 200) { side.set(el, "none"); continue; }
      if (!r.width && !r.height) { side.set(el, "none"); continue; }
      // the sheet's own scale bar and its caption sit in the drawing area's bottom strip, and a status
      // line may sit in its top corner, well clear of the drawing: the A4 page draws its own bar and
      // prints those lines in its header instead
      if ((x0 + x1) / 2 < edge && (y0 > foot || y1 < head)) { side.set(el, "none"); if (el.tagName === "text") caption.push(el.textContent ?? ""); continue; }
      const s = (x0 + x1) / 2 < edge ? "drawing" : "panel";
      side.set(el, s);
      const b = box[s];
      b[0] = Math.min(b[0], x0); b[1] = Math.min(b[1], y0); b[2] = Math.max(b[2], x1); b[3] = Math.max(b[3], y1);
    }
    const half = (s: "drawing" | "panel") => {
      const pad = 2;
      const [x0, y0, x1, y1] = box[s];
      const x = x0 - pad, y = y0 - pad, w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad;
      const copy = root.cloneNode(false) as SVGSVGElement;
      for (const el of Array.from(root.children)) if (!side.has(el) || side.get(el) === s) copy.appendChild(el.cloneNode(true));
      copy.removeAttribute("width"); copy.removeAttribute("height"); copy.removeAttribute("style");
      copy.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
      return { svg: copy.outerHTML, x, y, w, h };
    };
    return { drawing: half("drawing"), panel: half("panel"), caption: caption.filter((t) => /[a-z]{3}/i.test(t)).join(" ") };
  }, { edge, foot: FOOT, head: HEAD });
}

const pageHtml = (w: number, h: number, body: string) =>
  `<!doctype html><meta charset="utf-8"><style>@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0}body{font:8pt Helvetica,Arial,sans-serif;color:#111;width:${w}mm;height:${h}mm;position:relative;overflow:hidden}svg{display:block}</style>${body}`;

/** A true scale bar for 1:N: 1 m in 0.5 m halves, so a printed page can be checked with a rule. */
function scaleBar(n: number): string {
  const len = 1000 / n; // paper mm per metre
  return `<svg width="${len + 12}mm" height="9mm" viewBox="-2 0 ${len + 12} 9"><rect x="0" y="4" width="${len / 2}" height="1.6" fill="#000"/><rect x="${len / 2}" y="4" width="${len / 2}" height="1.6" fill="#fff" stroke="#000" stroke-width="0.25"/><rect x="0" y="4" width="${len}" height="1.6" fill="none" stroke="#000" stroke-width="0.25"/>
<text x="0" y="3" font-size="2.4" text-anchor="middle">0</text><text x="${len / 2}" y="3" font-size="2.4" text-anchor="middle">0.5</text><text x="${len}" y="3" font-size="2.4" text-anchor="middle">1 m</text><text x="0" y="8.6" font-size="2.1">1 m = ${len.toFixed(0)} mm at 1:${n}</text></svg>`;
}

/** The A4 pages for one A3 drawing sheet: its drawing at actual size (over more than one page only when it must), then its panel. */
async function printSheetA4(p: Part, src: string, heading: string): Promise<Uint8Array[]> {
  const kind = /data-sheet="([^"]+)"/.exec(src)?.[1] ?? "";
  const edge = PANEL_EDGE[kind];
  if (edge === undefined) throw new Error(`${p.path}: no A4 split for sheet type "${kind}"`);
  // the halves still say which paper their scale is for
  const { drawing, panel, caption } = await splitSheet(src.replace(/(\bat|@) A3\b/g, "$1 A4"), edge);
  const n = Number(/data-scale="(\d+)"/.exec(src)?.[1] ?? /Scale 1:(\d+)/.exec(src)?.[1] ?? NaN);
  const out: Uint8Array[] = [];

  // portrait unless only landscape takes the drawing whole; else as few pages as either way needs
  const fit = (pw: number, ph: number) => {
    const aw = pw - 2 * MARGIN.side, ah = ph - MARGIN.top - MARGIN.bottom;
    const cols = drawing.w <= aw ? 1 : Math.ceil((drawing.w - OVERLAP) / (aw - OVERLAP));
    const rows = drawing.h <= ah ? 1 : Math.ceil((drawing.h - OVERLAP) / (ah - OVERLAP));
    return { pw, ph, aw, ah, cols, rows };
  };
  const options = [fit(A4.w, A4.h), fit(A4.h, A4.w)];
  const f = options.reduce((a, b) => (b.cols * b.rows < a.cols * a.rows ? b : a));
  const tiles = f.cols * f.rows;
  for (let r = 0; r < f.rows; r++) for (let c = 0; c < f.cols; c++) {
    const w = f.cols === 1 ? drawing.w : Math.min(f.aw, drawing.w - c * (f.aw - OVERLAP));
    const h = f.rows === 1 ? drawing.h : Math.min(f.ah, drawing.h - r * (f.ah - OVERLAP));
    const x = drawing.x + c * (f.aw - OVERLAP), y = drawing.y + r * (f.ah - OVERLAP);
    const svg = drawing.svg.replace(/viewBox="[^"]*"/, `viewBox="${x} ${y} ${w} ${h}" width="${w}mm" height="${h}mm"`);
    const part = tiles > 1 ? ` Part ${r * f.cols + c + 1} of ${tiles}, overlapping the next by ${OVERLAP} mm.` : "";
    const scale = Number.isFinite(n)
      ? `${caption || `Scale 1:${n} at A4.`}${part} Print at 100% (actual size), never "fit to page". Notes and title block on the next page.`
      : `${caption || "Diagram, not to scale: use the written dimensions."}${part} Notes on the next page.`;
    out.push(await printHtml(pageHtml(f.pw, f.ph, `<div style="position:absolute;left:${MARGIN.side}mm;top:6mm;right:${MARGIN.side + (Number.isFinite(n) ? 64 : 0)}mm"><b style="font-size:10pt">${esc(heading)}</b><br>${esc(scale)}</div>
${Number.isFinite(n) ? `<div style="position:absolute;right:${MARGIN.side}mm;top:5mm">${scaleBar(n)}</div>` : ""}
<div style="position:absolute;left:${MARGIN.side + (f.aw - w) / 2}mm;top:${MARGIN.top + (f.ah - h) / 2}mm">${svg}</div>`)));
  }

  // the notes and title block: text, not a drawing, so it may shrink a little to fit
  const aw = A4.w - 2 * MARGIN.side, ah = A4.h - 6 - MARGIN.bottom;
  const s = Math.min(1, aw / panel.w, ah / panel.h);
  const svg = panel.svg.replace(/viewBox="[^"]*"/, `viewBox="${panel.x} ${panel.y} ${panel.w} ${panel.h}" width="${panel.w * s}mm" height="${panel.h * s}mm"`);
  out.push(await printHtml(pageHtml(A4.w, A4.h, `<div style="position:absolute;left:${(A4.w - panel.w * s) / 2}mm;top:6mm">${svg}</div>`)));
  return out;
}

async function printPart(p: Part, paper: Paper, heading: string): Promise<Uint8Array[]> {
  const src = readFileSync(p.path, "utf8");
  if (p.kind === "svg") {
    const svg = src.replace(/^<\?xml[^>]*>\s*/, "");
    if (paper === "A4") return printSheetA4(p, svg, heading);
    return [await printHtml(`<!doctype html><meta charset="utf-8"><style>@page{size:420mm 297mm;margin:0}html,body{margin:0}</style>${svg.replace(/<svg /, '<svg style="display:block;width:420mm;height:297mm" ')}`)];
  }
  // an HTML sheet keeps its own styles; only the paper changes to landscape, with room for the page stamp
  const size = paper === "A3" ? "420mm 297mm;margin:10mm 12mm 12mm" : "297mm 210mm;margin:9mm 10mm 11mm";
  // tables print a little tighter than on screen: the same rows, fewer pages
  const css = `<style>@page{size:${size}}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{max-width:none;margin:0;font-size:10px}td,th{padding:1.5px 4px}</style>`;
  return [await printHtml(src.includes("</head>") ? src.replace("</head>", `${css}</head>`) : css + src)];
}

async function merge(pdfs: Uint8Array[]): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  for (const bytes of pdfs) { const src = await PDFDocument.load(bytes); for (const pg of await doc.copyPages(src, src.getPageIndices())) doc.addPage(pg); }
  return doc;
}

async function bindPack(pack: Pack, paper: Paper): Promise<number> {
  const printed: { part: Part; pdf: PDFDocument }[] = [];
  for (const part of pack.parts) printed.push({ part, pdf: await merge(await printPart(part, paper, pack.slug.startsWith("00") ? part.title : `${pack.title}: ${part.title}`)) });
  const css = `<!doctype html><meta charset="utf-8"><style>${PAGE_CSS(paper)}</style>`;
  const overview = pack.slug.startsWith("00");
  const tail = overview ? [await PDFDocument.load(await printHtml(`${css}${rendersPage()}`))] : [];
  const tailPages = tail.reduce((n, d) => n + d.getPageCount(), 0);
  // the front matter's page numbers depend on its own length; on A4 a table may run on, so settle it
  const fixed = overview ? [indexPage(), schedulePage()] : [];
  const fixedDocs: PDFDocument[] = [];
  for (const html of fixed) fixedDocs.push(await PDFDocument.load(await printHtml(css + html))); // one tab: one print at a time
  const fixedTitles = ["Who needs what, open decisions, still to measure", "Fixture schedule"];
  let coverPages = 1;
  let cover: PDFDocument;
  let total = 0;
  for (let pass = 0; ; pass++) {
    let at = coverPages + 1;
    const toc: Toc = [];
    for (const [i, d] of fixedDocs.entries()) { toc.push({ title: fixedTitles[i], first: at, count: d.getPageCount() }); at += d.getPageCount(); }
    for (const { part, pdf } of printed) { toc.push({ title: part.title, first: at, count: pdf.getPageCount() }); at += pdf.getPageCount(); }
    if (overview) toc.push({ title: "3D renders", first: at, count: tailPages });
    total = at - 1 + tailPages;
    cover = await PDFDocument.load(await printHtml(css + coverPage(pack, toc, total, paper)));
    if (cover.getPageCount() === coverPages) break;
    if (paper === "A3" || pass === 2) throw new Error(`${pack.slug}: the cover ran to ${cover.getPageCount()} pages: shorten it.`);
    coverPages = cover.getPageCount();
  }
  if (paper === "A3" && [...fixedDocs, ...tail].some((d) => d.getPageCount() !== 1)) throw new Error(`${pack.slug}: an A3 front or back page ran over one page.`);

  const out = await PDFDocument.create();
  out.setTitle(`${model.name}: ${pack.title} (${paper})`);
  out.setSubject("Proposed, for trade review. Not as-built, not a compliance certificate.");
  out.setCreator("Reno Layouts (npm run printables)");
  for (const doc of [cover!, ...fixedDocs, ...printed.map((p) => p.pdf), ...tail]) for (const pg of await out.copyPages(doc, doc.getPageIndices())) out.addPage(pg);
  // page stamp in the bottom margin, outside every sheet's own border
  const font = await out.embedFont(StandardFonts.Helvetica);
  const pages = out.getPages();
  pages.forEach((pg, i) => {
    const label = `${model.name} · ${pack.title} · ${DATE} · page ${i + 1} of ${pages.length}`;
    pg.drawText(label, { x: pg.getWidth() - 14 - font.widthOfTextAtSize(label, 6.5), y: 5.5, size: 6.5, font, color: rgb(0.35, 0.35, 0.35) });
  });
  if (pages.length !== total) throw new Error(`${pack.slug}: bound ${pages.length} pages, contents says ${total}.`);
  writeFileSync(join(OUT, paper, `${pack.slug}.pdf`), await out.save());
  console.log(`${paper}/${pack.slug}.pdf: ${pages.length} page(s)`);
  return pages.length;
}

try {
  const n: Record<Paper, number[]> = { A3: [], A4: [] };
  for (const paper of ["A4", "A3"] as const) {
    rmSync(join(OUT, paper), { recursive: true, force: true });
    mkdirSync(join(OUT, paper), { recursive: true });
    for (const pack of packs) n[paper].push(await bindPack(pack, paper));
  }
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  writeFileSync(join(OUT, "README.md"), [
    `# Printable packs: ${model.name}`, "",
    "Generated by `npm run printables` (after `npm run stage-pack` and `npm run sample-sheets`). One pack per construction stage, plus an overview to start from. Print at 100 % (actual size), never \"fit to page\", so the 1:20 drawings scale.", "",
    "| Pack | A4 | A3 landscape |", "| --- | --- | --- |",
    ...packs.map((p, i) => `| ${p.title} | [${n.A4[i]} pages](A4/${p.slug}.pdf) | [${n.A3[i]} pages](A3/${p.slug}.pdf) |`),
    `| All packs | ${sum(n.A4)} pages | ${sum(n.A3)} pages |`, "",
    "Each stage pack is a cover (what the stage is, who it is for, contents), the stage plan, the wall elevations that show something new at that stage, and the stage's specification. Stage 5 adds the heating review; stage 8 adds the floor and wall tiling sheets. The overview holds who needs which pack, the open owner decisions, what is still to measure, the fixture schedule, A-01 and the 3D renders.", "",
    "Wall elevations left out because nothing new is set out on that wall at that stage, or (stage 8) its wall tiling sheet covers it:", "",
    ...[...dropped].map(([stage, walls]) => `- ${stage}: ${walls.length === 4 ? "all four walls" : walls.join(", ")}`), "",
    "On A4 each A3 drawing sheet becomes two pages: the drawing at the same scale, with a 1 m scale bar at the top to check the print against (50 mm at 1:20), then its notes and title block. A drawing too big for one A4 page runs over several, overlapping by 10 mm. Specifications, the heating review and the front pages reflow onto A4 landscape.", "",
    "Every drawing is the saved export it names. On A4 the sheet's own scale bar, caption and status line move into the page header, and \"at A3\" reads \"at A4\"; the covers, index, schedule and renders pages are built from the same model. Proposed, for trade review: not as-built and not a compliance certificate.", "",
  ].join("\n"));
} finally {
  await browser.close();
}
