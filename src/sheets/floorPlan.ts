/**
 * Sheet A-01 (#29): the dimensioned floor plan with wall faces and rough-in, drawn to scale on
 * A3 landscape as SVG in paper millimetres. Everything is derived from the canonical model.
 * Every printed number carries a status tag, unknowns print as "?", and anything issued past
 * a blocking finding is listed on the sheet with its reason.
 */

import type { PlanModel, SheetRevision, Wall, WallSideName } from "../model/types";
import { catalogForItem, catalogByKind } from "../model/catalog";
import { pointSegDist, rectCorners, segLen, type ORect, type Pt } from "../model/geometry";
import { openingSpan } from "../model/issues";
import { resolveFace, sideFaces, sideNormal, layerLabel } from "../model/faces";
import { anchorPose, roughIn, wallOccupied, wallOccupiedRect } from "../model/fixtures";
import { itemPolygon } from "../model/outline";
import { sheetById, type SheetFinding } from "./check";

export const PAPER = { w: 420, h: 297 }; // A3 landscape, mm
const DRAW = { x: 12, y: 12, w: 248, h: 268 }; // drawing area
const PANEL = { x: 266, w: 146 };
const SCALES = [10, 20, 25, 50, 100, 200];

/** Status tags printed after every value; the legend spells them out. */
export const TAGS: Record<string, string> = {
  "site-confirmed": "SC", measured: "M", published: "PUB", proposed: "P", estimated: "E",
  derived: "DER", entered: "ENT", defaulted: "DEF", unknown: "?",
};
export const tag = (status: string | undefined) => TAGS[status ?? "unknown"] ?? "?";

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const f1 = (n: number) => (Math.round(n * 100) / 100).toString();
export const mm = (m: number) => {
  const v = Math.round(m * 10000) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

/**
 * A wall's occupied rectangle, lengthened at each end to reach the far face of any wall that
 * meets it there, so corners close the way they do in 3D. `occupied` says what a wall takes up
 * across its thickness: by default the body plus any resolved build-up.
 */
export function joinedRect(model: PlanModel, w: Wall, occupied: (w: Wall) => { zMin: number; zMax: number } = wallOccupied): ORect {
  const r = occupiedRect(w, occupied(w));
  const reach = (p: Pt) => {
    let ext = 0;
    for (const o of model.walls) {
      if (o.id === w.id) continue;
      const touches = [{ x: o.ax, y: o.ay }, { x: o.bx, y: o.by }].some((e) => Math.hypot(e.x - p.x, e.y - p.y) < 0.09) || pointSegDist(p, { x: o.ax, y: o.ay }, { x: o.bx, y: o.by }) < 0.09;
      if (!touches) continue;
      const occ = occupied(o);
      ext = Math.max(ext, Math.abs(occ.zMin), Math.abs(occ.zMax));
    }
    return ext;
  };
  const ea = reach({ x: w.ax, y: w.ay });
  const eb = reach({ x: w.bx, y: w.by });
  const len = segLen(w.ax, w.ay, w.bx, w.by) || 1;
  const d = { x: (w.bx - w.ax) / len, y: (w.by - w.ay) / len };
  const shift = (eb - ea) / 2;
  return { ...r, cx: r.cx + d.x * shift, cy: r.cy + d.y * shift, hw: r.hw + (ea + eb) / 2 };
}

/** wallOccupiedRect for any extent across the thickness. */
function occupiedRect(w: Wall, { zMin, zMax }: { zMin: number; zMax: number }): ORect {
  const r = wallOccupiedRect(w);
  const n = sideNormal(w, "right");
  const mid = (zMin + zMax) / 2;
  return { ...r, cx: (w.ax + w.bx) / 2 + n.x * mid, cy: (w.ay + w.by) / 2 + n.y * mid, hd: (zMax - zMin) / 2 };
}

export interface RenderOptions {
  sheet: string;
  findings: SheetFinding[];
  /** the revision being issued; null renders an unissued preview */
  revision: SheetRevision | null;
}

export function renderFloorPlan(model: PlanModel, opts: RenderOptions): string {
  const sheet = sheetById(opts.sheet)!;
  const parts: string[] = [];
  const text = (x: number, y: number, s: string, size = 2.4, extra = "") =>
    parts.push(`<text x="${f1(x)}" y="${f1(y)}" font-size="${size}" ${extra}>${esc(s)}</text>`);
  const line = (a: Pt, b: Pt, extra = "") => parts.push(`<line x1="${f1(a.x)}" y1="${f1(a.y)}" x2="${f1(b.x)}" y2="${f1(b.y)}" ${extra}/>`);
  const poly = (pts: Pt[], extra = "") => parts.push(`<polygon points="${pts.map((p) => `${f1(p.x)},${f1(p.y)}`).join(" ")}" ${extra}/>`);

  // ---- scale and placement ----
  const xs: number[] = [];
  const ys: number[] = [];
  for (const w of model.walls) for (const c of rectCorners(joinedRect(model, w))) { xs.push(c.x); ys.push(c.y); }
  for (const r of model.rooms) { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); }
  // fit the plan itself, wherever it was drawn; an empty plan gets a 1 m frame
  if (!xs.length) { xs.push(0, 1); ys.push(0, 1); }
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const margin = 24; // paper mm kept for dimensions
  const N = SCALES.find((n) => ((maxX - minX) * 1000) / n <= DRAW.w - 2 * margin && ((maxY - minY) * 1000) / n <= DRAW.h - 2 * margin) ?? SCALES[SCALES.length - 1];
  const k = 1000 / N;
  const ox = DRAW.x + (DRAW.w - (maxX - minX) * k) / 2;
  const oy = DRAW.y + (DRAW.h - (maxY - minY) * k) / 2;
  const P = (p: Pt): Pt => ({ x: ox + (p.x - minX) * k, y: oy + (p.y - minY) * k });
  const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

  // ---- frame ----
  parts.push(`<rect x="5" y="5" width="410" height="287" fill="none" stroke="#000" stroke-width="0.5"/>`);
  parts.push(`<rect x="${DRAW.x}" y="${DRAW.y}" width="${DRAW.w}" height="${DRAW.h}" fill="none" stroke="#999" stroke-width="0.2"/>`);

  // ---- rooms ----
  for (const r of model.rooms) {
    const c = P({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    text(c.x, c.y, r.label.toUpperCase(), 3, `text-anchor="middle" fill="#888"`);
  }

  // ---- walls as built, openings cut through them ----
  for (const w of model.walls) {
    poly(rectCorners(joinedRect(model, w)).map(P), `fill="#d9d9d9" stroke="#222" stroke-width="0.35" data-wall="${esc(w.id)}"`);
  }
  for (const o of model.openings) {
    const w = model.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const [t0, t1] = openingSpan(w, o);
    const rect = wallOccupiedRect(w);
    const d = { x: (w.bx - w.ax), y: (w.by - w.ay) };
    const n = sideNormal(w, "right");
    const mid = { x: rect.cx - (w.ax + w.bx) / 2, y: rect.cy - (w.ay + w.by) / 2 };
    const at = (t: number, s: number) => ({ x: w.ax + d.x * t + mid.x + n.x * s, y: w.ay + d.y * t + mid.y + n.y * s });
    poly([at(t0, -rect.hd), at(t1, -rect.hd), at(t1, rect.hd), at(t0, rect.hd)].map(P), `fill="#fff" stroke="#222" stroke-width="0.25" data-opening="${esc(o.id)}"`);
    const len = segLen(w.ax, w.ay, w.bx, w.by);
    const c = P(at((t0 + t1) / 2, 0));
    const widthTag = o.widthDefaulted ? "DEF" : o.widthDefaulted === false ? "ENT" : "?";
    const centreA = o.t * len;
    text(c.x, c.y - 3.2, `${o.kind === "door" ? "D" : "W"} ${mm(o.width)} ${widthTag}`, 2.2, `text-anchor="middle"`);
    text(c.x, c.y + 4.6, `c/l ${mm(centreA)} from A`, 1.9, `text-anchor="middle" fill="#444"`);
  }

  // ---- wall faces ----
  const faceStyle: Record<string, string> = {
    existing: `stroke="#2f78b7" stroke-width="0.25" stroke-dasharray="1.2 0.8"`,
    frame: `stroke="#8a5a1c" stroke-width="0.25" stroke-dasharray="0.6 0.6"`,
    finished: `stroke="#000" stroke-width="0.45"`,
  };
  for (const w of model.walls) {
    for (const side of ["left", "right"] as const) {
      const spec = w.sides?.[side];
      if (!spec) continue;
      const n = sideNormal(w, side);
      for (const name of ["existing", "frame", "finished"]) {
        const f = resolveFace(spec, name);
        if (!f.resolved) continue;
        const a = { x: w.ax + n.x * f.offset!, y: w.ay + n.y * f.offset! };
        const b = { x: w.bx + n.x * f.offset!, y: w.by + n.y * f.offset! };
        line(P(a), P(b), `${faceStyle[name]} data-face="${esc(`${w.id}:${side}:${name}`)}"`);
      }
    }
  }

  // ---- wall length dimensions, outside the room ----
  for (const w of model.walls) {
    const len = segLen(w.ax, w.ay, w.bx, w.by);
    const mid = { x: (w.ax + w.bx) / 2, y: (w.ay + w.by) / 2 };
    const nr = sideNormal(w, "right");
    const outward = (centre.x - mid.x) * nr.x + (centre.y - mid.y) * nr.y > 0 ? { x: -nr.x, y: -nr.y } : nr;
    const off = 14 / k; // 14 paper mm outside the line
    const a = P({ x: w.ax + outward.x * off, y: w.ay + outward.y * off });
    const b = P({ x: w.bx + outward.x * off, y: w.by + outward.y * off });
    line(a, b, `stroke="#000" stroke-width="0.18"`);
    for (const e of [a, b]) line({ x: e.x - 1, y: e.y - 1 }, { x: e.x + 1, y: e.y + 1 }, `stroke="#000" stroke-width="0.3"`);
    const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    const upright = angle > 90 || angle < -90 ? angle + 180 : angle;
    const m = { x: (a.x + b.x) / 2 + outward.x * 1.8, y: (a.y + b.y) / 2 + outward.y * 1.8 };
    // the printed length is along the drawn line; say so unless that line is an existing surface
    const onLine = (["left", "right"] as const).some((side) => {
      const f = resolveFace(w.sides?.[side], "existing");
      return f.resolved && Math.abs(f.offset!) < 1e-4;
    });
    parts.push(`<text x="${f1(m.x)}" y="${f1(m.y)}" font-size="2.4" text-anchor="middle" dominant-baseline="middle" transform="rotate(${f1(upright)} ${f1(m.x)} ${f1(m.y)})" data-dim="${esc(w.id)}">${esc(`${mm(len)} ENT · ${w.id.replace(/^wall_/, "")} A→B ${onLine ? "(existing surface)" : "(drawn line)"}`)}</text>`);
  }

  // ---- fixtures, set-out, service points ----
  const fixtures = model.items.filter((it) => catalogForItem(it));
  const fixtureNo = new Map(fixtures.map((it, i) => [it.id, `F${i + 1}`]));
  for (const it of fixtures) {
    const cat = catalogForItem(it)!;
    poly(itemPolygon(it)!.map(P), `fill="#fff" stroke="#444" stroke-width="0.3"${cat.stopgap ? ` stroke-dasharray="1.2 0.6"` : ""} data-item="${esc(it.id)}"`);
    const c = P({ x: it.x, y: it.y });
    text(c.x, c.y, fixtureNo.get(it.id)!, 2.6, `text-anchor="middle" dominant-baseline="middle" font-weight="bold"`);
    const pose = anchorPose(model, it);
    if (it.anchor && pose.resolved) {
      text(c.x, c.y + 3.4, `${mm(it.anchor.distance)} from ${it.anchor.from.toUpperCase()} · ${mm(it.anchor.gap)} off ${it.anchor.face} ${tag(it.anchor.status)}`, 1.8, `text-anchor="middle" fill="#444"`);
    }
    roughIn(model, it).forEach((r, i) => {
      if (r.x === undefined || r.y === undefined) return;
      const p = P({ x: r.x, y: r.y });
      const fill = r.service === "waste" ? "#7a5230" : r.service === "water" ? "#2f78b7" : "#c0392b";
      parts.push(`<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="1.1" fill="${fill}" data-sp="${esc(`${it.id}:${r.pointId}`)}"/>`);
      text(p.x + 1.5, p.y - 1.2, `${fixtureNo.get(it.id)}.${i + 1}`, 1.8, `fill="${fill}"`);
    });
  }

  // ---- scale bar ----
  const sbY = DRAW.y + DRAW.h - 6;
  for (let i = 0; i < 2; i++) {
    parts.push(`<rect x="${f1(DRAW.x + 6 + i * 0.5 * k)}" y="${f1(sbY)}" width="${f1(0.5 * k)}" height="1.5" fill="${i % 2 ? "#fff" : "#000"}" stroke="#000" stroke-width="0.2"/>`);
  }
  text(DRAW.x + 6, sbY - 1, "0", 2);
  text(DRAW.x + 6 + k, sbY - 1, "1 m", 2);
  text(DRAW.x + 6, sbY + 4.5, `Scale 1:${N} at A3. Orientation not recorded. Dimensions in mm.`, 2);

  // ---- right panel: legend, build-up, rough-in, unresolved, acknowledgements, title block ----
  let y = 14;
  let overflowed = false;
  const PANEL_BOTTOM = 228; // the title block starts at 236
  const x0 = PANEL.x;
  const heading = (s: string) => { if (y > PANEL_BOTTOM) return; text(x0, y, s, 2.8, `font-weight="bold"`); y += 4; };
  // wrap to the panel width: about 0.52 × font size per character in Helvetica
  const row = (s: string, size = 2.1, extra = "") => {
    const max = Math.floor((PANEL.w - 4) / (size * 0.52));
    const lines: string[] = [];
    let cur = "";
    for (const word of s.split(" ")) {
      if ((cur + " " + word).trim().length > max && cur) { lines.push(cur); cur = word; } else cur = (cur + " " + word).trim();
    }
    if (cur) lines.push(cur);
    for (const [i, l] of lines.entries()) {
      if (y > PANEL_BOTTOM) {
        if (!overflowed) { text(x0, y, "… more: see check_sheets / get_rough_in", 2, `fill="#666"`); overflowed = true; }
        return;
      }
      text(x0 + (i ? 3 : 0), y, l, size, extra);
      y += size + 1;
    }
  };
  const limitRows = (rows: string[], max: number, extra = "") => {
    rows.slice(0, max).forEach((r) => row(r, 2.1, extra));
    if (rows.length > max) row(`… ${rows.length - max} more: see get_rough_in / check_sheets`, 2, `fill="#666"`);
  };

  heading("Legend");
  row("Status: SC site-confirmed · M measured · PUB published · P proposed");
  row("E estimated · DER derived (converted, not published) · ENT entered (not site-confirmed) · DEF default · ? unknown");
  row("Faces: blue dashed existing · brown dotted frame · black finished");
  row("Points: brown waste · blue water · red power. Grey = wall as built.");
  y += 2;

  heading("Wall build-up (mm from drawn line, toward the side)");
  const buildRows: string[] = [];
  for (const w of model.walls) {
    for (const side of ["left", "right"] as WallSideName[]) {
      const spec = w.sides?.[side];
      if (!spec) continue;
      const faces = sideFaces(spec);
      const cell = (i: number) => (faces[i].resolved ? `${mm(faces[i].offset!)} ${tag(faces[i].basis)}` : "?");
      buildRows.push(`${w.id.replace(/^wall_/, "")} ${side}: existing ${cell(0)} · frame ${cell(1)} · ${spec.layers.map((l, i) => `${layerLabel(l)} ${l.thickness.value !== undefined ? mm(l.thickness.value) : "?"}${faces[2 + i]?.resolved ? "" : "?"}`).join(" / ") || "no layers"}`);
    }
  }
  limitRows(buildRows.length ? buildRows : ["No faces recorded: dimensions refer to drawn wall lines."], 8);
  y += 2;

  heading("Rough-in (mm out from face · along from A · up from FFL)");
  const roughRows: string[] = [];
  for (const it of fixtures) {
    const label = catalogForItem(it)!.label;
    roughRows.push(`${fixtureNo.get(it.id)} ${label}${it.anchor ? "" : " (not set out)"}`);
    roughIn(model, it).forEach((r, i) => {
      const fv = (face: string) => {
        const f = r.fromFaces.find((x) => x.face === face);
        return f?.resolved ? `${mm(f.value!)}${f.max !== undefined ? `–${mm(f.max)}` : ""}` : "?";
      };
      roughRows.push(`  ${fixtureNo.get(it.id)}.${i + 1} ${r.label}: frame ${fv("frame")} · board ${fv("board")} · fin ${fv("finished")} · A ${r.alongFromA !== undefined ? mm(r.alongFromA) : "?"} · up ${r.up !== undefined ? mm(r.up) : "?"} ${tag(r.status)}`);
    });
  }
  limitRows(roughRows.length ? roughRows : ["No fixtures."], 16);
  y += 2;

  const unresolved = opts.findings.filter((f) => f.severity === "advisory");
  heading(`Unresolved (${unresolved.length})`);
  limitRows(unresolved.map((f) => `• ${f.message}`), 10, `fill="#7a3b00"`);
  y += 2;

  const acks = opts.revision?.acknowledged ?? [];
  if (acks.length) {
    heading(`Issued past ${acks.length} blocking finding(s)`);
    limitRows(acks.map((a) => `• ${a.code} (${a.ref}), ${a.by}: ${a.reason}`), 6, `fill="#b00020"`);
  } else if (!opts.revision) {
    const blocking = opts.findings.filter((f) => f.severity === "blocking");
    if (blocking.length) {
      heading(`Blocking (${blocking.length}): not issuable yet`);
      limitRows(blocking.map((f) => `• ${f.message}`), 6, `fill="#b00020"`);
    }
  }

  // title block, pinned to the bottom of the panel
  const tb = model.sheetSet?.titleBlock ?? {};
  const tbY = 236;
  parts.push(`<rect x="${x0 - 2}" y="${tbY}" width="${PANEL.w}" height="${292 - tbY - 3}" fill="none" stroke="#000" stroke-width="0.35"/>`);
  const tby = (i: number) => tbY + 5 + i * 5.2;
  text(x0, tby(0), `Project: ${tb.project?.trim() || "?"}`, 2.6, `font-weight="bold"`);
  text(x0, tby(1), `Site / room: ${tb.site?.trim() || "?"}`, 2.4);
  text(x0, tby(2), `Sheet ${sheet.number}: ${sheet.title}`, 2.4);
  text(x0, tby(3), `Scale 1:${N} @ A3 · ${opts.revision ? `Rev ${opts.revision.rev} · ${opts.revision.date}` : "PREVIEW, not issued"}`, 2.4);
  text(x0, tby(4), `Prepared by: ${tb.preparedBy?.trim() || "?"} · Plan: ${model.name}`, 2.2);
  text(x0, tby(5), opts.revision?.note ? `Note: ${opts.revision.note}` : "", 2.1);
  parts.push(`<rect x="${x0 - 2}" y="${tby(6) - 3.4}" width="${PANEL.w}" height="7" fill="#b00020"/>`);
  text(x0 + PANEL.w / 2 - 2, tby(6) + 1.2, "PROPOSED · FOR TRADE REVIEW · NOT AS-BUILT · NOT A COMPLIANCE CERTIFICATE", 2.1, `text-anchor="middle" fill="#fff" font-weight="bold"`);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAPER.w}mm" height="${PAPER.h}mm" viewBox="0 0 ${PAPER.w} ${PAPER.h}" font-family="Helvetica, Arial, sans-serif" data-sheet="${sheet.id}" data-scale="${N}">`,
    `<rect width="${PAPER.w}" height="${PAPER.h}" fill="#fff"/>`,
    ...parts,
    `</svg>`,
  ].join("\n");
}
