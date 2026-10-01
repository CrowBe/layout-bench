/**
 * Wall tile set-out sheet (#9): the elevation of one wall side, drawn to scale on A3 landscape
 * as SVG in paper millimetres, from the same derivation (model/tiling.ts) the Inspector and 3D
 * use. It prints the tile size, joint, origin, the reference face every along-the-wall
 * dimension is taken to, the floor level every height is taken from, each edge cut, and the
 * status of every input. Unknown inputs print as "?" and are listed; it is always a PROPOSED
 * set-out for review with the tiler, never as-built and never a compliance certificate.
 */

import type { PlanModel, WallSideName } from "../model/types";
import { segLen } from "../model/geometry";
import { roomOnSide } from "../model/faces";
import { REFERENCE_LABELS, tilingLayout, type EdgeCut, type TilingLayout } from "../model/tiling";
import { PAPER, esc, f1, mm, tag } from "./floorPlan";

const DRAW = { x: 12, y: 12, w: 262, h: 268 };
const PANEL = { x: 280, w: 132 };
const SCALES = [10, 20, 25, 50, 100];

export interface TilingSheetOptions {
  /** printed in the title block; defaults to the plan name */
  title?: string;
}

const cutText = (c: EdgeCut | undefined) => !c ? "?" : c.full ? `full${c.gap ? ` + ${mm(c.gap)} gap` : ""}` : mm(c.size);

/** One-line description of each cut, for the panel and tools. */
export function cutRows(l: TilingLayout): { key: string; label: string; value: string }[] {
  const ref = l.choices.reference ? `to ${REFERENCE_LABELS[l.choices.reference]}` : "to ? face";
  const rows = [
    { key: "a", label: `End A cut (${ref} of ${l.limits.a.wallId ?? "?"})`, value: cutText(l.cuts?.a) },
    { key: "b", label: `End B cut (${ref} of ${l.limits.b.wallId ?? "?"})`, value: cutText(l.cuts?.b) },
    { key: "bottom", label: `Bottom course (from ${l.floor.label})`, value: cutText(l.cuts?.bottom) },
    { key: "top", label: "Top course (at tiled height)", value: cutText(l.cuts?.top) },
  ];
  for (const o of l.openings) {
    const name = `${o.kind === "door" ? "Door" : "Window"} ${o.openingId}`;
    if (o.unresolved) { rows.push({ key: `${o.openingId}:all`, label: name, value: "?" }); continue; }
    if (o.jambA) rows.push({ key: `${o.openingId}:jambA`, label: `${name} jamb, A side`, value: cutText(o.jambA) });
    if (o.jambB) rows.push({ key: `${o.openingId}:jambB`, label: `${name} jamb, B side`, value: cutText(o.jambB) });
    if (o.sill) rows.push({ key: `${o.openingId}:sill`, label: `${name} under sill`, value: cutText(o.sill) });
    if (o.head) rows.push({ key: `${o.openingId}:head`, label: `${name} over head`, value: cutText(o.head) });
  }
  return rows;
}

export function renderTilingSheet(model: PlanModel, wallId: string, side: WallSideName, opts: TilingSheetOptions = {}): string {
  const wall = model.walls.find((w) => w.id === wallId);
  if (!wall) throw new Error(`No wall ${wallId}`);
  const l = tilingLayout(model, wall, side);
  const t = wall.tiling?.[side] ?? {};
  const parts: string[] = [];
  const text = (x: number, y: number, s: string, size = 2.4, extra = "") =>
    parts.push(`<text x="${f1(x)}" y="${f1(y)}" font-size="${size}" ${extra}>${esc(s)}</text>`);
  const line = (x1: number, y1: number, x2: number, y2: number, extra = "") =>
    parts.push(`<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" ${extra}/>`);
  const rect = (x: number, y: number, w: number, h: number, extra = "") =>
    parts.push(`<rect x="${f1(x)}" y="${f1(y)}" width="${f1(Math.max(w, 0))}" height="${f1(Math.max(h, 0))}" ${extra}/>`);

  // ---- scale: the wall's drawn length and height, with room for dimensions ----
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  const top = Math.max(wall.height, l.band?.z1 ?? 0);
  const margin = 30;
  const N = SCALES.find((n) => (len * 1000) / n <= DRAW.w - 2 * margin && (top * 1000) / n <= DRAW.h - 2 * margin) ?? SCALES[SCALES.length - 1];
  const k = 1000 / N;
  const ox = DRAW.x + (DRAW.w - len * k) / 2;
  const oy = DRAW.y + (DRAW.h + top * k) / 2; // paper y of the floor datum
  const X = (s: number) => ox + s * k;
  const Y = (z: number) => oy - z * k;

  parts.push(`<rect x="5" y="5" width="410" height="287" fill="none" stroke="#000" stroke-width="0.5"/>`);
  rect(DRAW.x, DRAW.y, DRAW.w, DRAW.h, `fill="none" stroke="#999" stroke-width="0.2"`);

  // ---- wall outline (drawn line extent) and datum ----
  rect(X(0), Y(wall.height), len * k, wall.height * k, `fill="#f4f4f4" stroke="#888" stroke-width="0.25" data-role="wall"`);
  line(X(0) - 8, Y(0), X(len) + 8, Y(0), `stroke="#000" stroke-width="0.3"`);
  text(X(len) + 9, Y(0) + 0.8, `0 = ${l.floor.datum}`, 1.9, `fill="#444"`);
  text(X(0), Y(wall.height) - 2, "A", 3, `font-weight="bold" text-anchor="middle"`);
  text(X(len), Y(wall.height) - 2, "B", 3, `font-weight="bold" text-anchor="middle"`);

  // ---- tile pieces ----
  for (const p of l.pieces) {
    rect(X(p.s0), Y(p.z1), (p.s1 - p.s0) * k, (p.z1 - p.z0) * k, `fill="${p.cut ? "#f3d2b3" : "#fff"}" stroke="#555" stroke-width="0.15"${p.cut ? ` data-piece="cut"` : ` data-piece="full"`}`);
  }

  // ---- openings ----
  for (const o of model.openings.filter((x) => x.wallId === wall.id)) {
    const half = o.width / 2;
    const c = o.t * len;
    const oc = l.openings.find((x) => x.openingId === o.id);
    rect(X(c - half), Y(o.sill + o.height), o.width * k, o.height * k, `fill="#dfe9f2" stroke="#2f78b7" stroke-width="0.3" data-opening="${esc(o.id)}"`);
    text(X(c), Y(o.sill + o.height / 2), `${o.kind === "door" ? "DOOR" : "WINDOW"} ${o.id}`, 2.2, `text-anchor="middle" fill="#2f78b7"`);
    text(X(c), Y(o.sill + o.height / 2) + 3, `${mm(o.width)} × ${mm(o.height)}, sill ${mm(o.sill)} above datum`, 1.8, `text-anchor="middle" fill="#2f78b7"`);
    if (oc?.unresolved) text(X(c), Y(o.sill + o.height / 2) + 6, `size is a placeholder: cuts ?`, 1.8, `text-anchor="middle" fill="#b00020"`);
    const tagCut = (x: number, y: number, key: string, cut: EdgeCut | undefined, anchor = "middle") => {
      if (cut) text(x, y, cutText(cut), 1.9, `text-anchor="${anchor}" fill="#9a4d00" font-weight="bold" data-cut="${esc(`${o.id}:${key}`)}"`);
    };
    if (oc && !oc.unresolved) {
      tagCut(X(c - half) - 1, Y(o.sill + o.height / 2), "jambA", oc.jambA, "end");
      tagCut(X(c + half) + 1, Y(o.sill + o.height / 2), "jambB", oc.jambB, "start");
      tagCut(X(c), Y(o.sill) + 2.6, "sill", oc.sill);
      tagCut(X(c), Y(o.sill + o.height) - 1, "head", oc.head);
    }
  }

  // ---- limit faces (run ends) ----
  for (const lim of [l.limits.a, l.limits.b]) {
    if (lim.s === undefined) continue;
    line(X(lim.s), Y(top) - 6, X(lim.s), Y(0) + 4, `stroke="#8a5a1c" stroke-width="0.35" stroke-dasharray="1.2 0.8" data-limit="${lim.end}"`);
    text(X(lim.s) + (lim.end === "a" ? 1 : -1), Y(top) - 7, `${lim.label} (${tag(lim.basis)})`, 1.7, `text-anchor="${lim.end === "a" ? "start" : "end"}" fill="#8a5a1c"`);
  }

  // ---- floor reference and tiled height ----
  if (l.band) {
    line(X(0) - 4, Y(l.band.z0), X(len) + 4, Y(l.band.z0), `stroke="#1a7f37" stroke-width="0.35" data-role="floor-reference"`);
    text(X(0) - 5, Y(l.band.z0) + 0.8, `${l.floor.label} +${mm(l.band.z0)} (${l.floor.basis === "datum" ? "datum" : tag(l.floor.basis)})`, 1.8, `text-anchor="end" fill="#1a7f37"`);
    line(X(0) - 4, Y(l.band.z1), X(len) + 4, Y(l.band.z1), `stroke="#1a7f37" stroke-width="0.35" stroke-dasharray="2 1"`);
    text(X(0) - 5, Y(l.band.z1) + 0.8, `tiled height ${mm(t.tiledHeight?.value ?? 0)} above ${l.floor.label} (${tag(t.tiledHeight?.status)})`, 1.8, `text-anchor="end" fill="#1a7f37"`);
  }

  // ---- origin ----
  if (l.origin && l.tile) {
    const x = X(l.origin.s), y = Y(l.origin.z);
    rect(x, Y(l.origin.z + l.tile.up), l.tile.along * k, l.tile.up * k, `fill="none" stroke="#b00020" stroke-width="0.5" data-role="origin-tile"`);
    line(x - 3, y, x + 3, y, `stroke="#b00020" stroke-width="0.4"`);
    line(x, y - 3, x, y + 3, `stroke="#b00020" stroke-width="0.4"`);
    text(x + 1.2, y - 1.2, "ORIGIN", 1.9, `fill="#b00020" font-weight="bold"`);
  }

  // ---- edge cut dimensions ----
  if (l.cuts && l.band && l.run !== undefined) {
    const s0 = l.limits.a.s!, s1 = l.limits.b.s!;
    const yDim = Y(0) + 9;
    const aEnd = s0 + (l.cuts.a.full ? 0 : l.cuts.a.size);
    const bStart = s1 - (l.cuts.b.full ? 0 : l.cuts.b.size);
    line(X(s0), yDim, X(s1), yDim, `stroke="#000" stroke-width="0.2"`);
    for (const s of [s0, aEnd, bStart, s1]) line(X(s), yDim - 1.5, X(s), yDim + 1.5, `stroke="#000" stroke-width="0.2"`);
    parts.push(`<text x="${f1(X(s0))}" y="${f1(yDim - 2)}" font-size="2.1" font-weight="bold" fill="#9a4d00" data-cut="a">${esc(cutText(l.cuts.a))}</text>`);
    parts.push(`<text x="${f1(X(s1))}" y="${f1(yDim - 2)}" font-size="2.1" font-weight="bold" fill="#9a4d00" text-anchor="end" data-cut="b">${esc(cutText(l.cuts.b))}</text>`);
    text((X(s0) + X(s1)) / 2, yDim + 4, `run ${mm(l.run)} between ${REFERENCE_LABELS[l.choices.reference!]}s`, 2, `text-anchor="middle"`);
    const xDim = X(len) + 10;
    line(xDim, Y(l.band.z0), xDim, Y(l.band.z1), `stroke="#000" stroke-width="0.2"`);
    parts.push(`<text x="${f1(xDim + 1.5)}" y="${f1(Y(l.band.z0) - 1)}" font-size="2.1" font-weight="bold" fill="#9a4d00" data-cut="bottom">${esc(cutText(l.cuts.bottom))}</text>`);
    parts.push(`<text x="${f1(xDim + 1.5)}" y="${f1(Y(l.band.z1) + 3)}" font-size="2.1" font-weight="bold" fill="#9a4d00" data-cut="top">${esc(cutText(l.cuts.top))}</text>`);
  }

  // ---- big status stamp on the drawing ----
  text(DRAW.x + 3, DRAW.y + 6, "PROPOSED SET-OUT · NOT AS-BUILT", 3.4, `fill="#b00020" font-weight="bold" data-role="status"`);
  if (!l.cuts) text(DRAW.x + 3, DRAW.y + 11, "UNRESOLVED: no cuts until every input below is entered", 2.6, `fill="#b00020"`);

  // ---- panel ----
  const x0 = PANEL.x;
  let y = 16;
  const heading = (s: string) => { text(x0, y, s, 2.8, `font-weight="bold"`); y += 4.6; };
  const row = (s: string, extra = "") => { text(x0, y, s, 2.1, extra); y += 3.5; };
  const qv = (q: { value?: number; status?: string } | undefined) => q?.value !== undefined ? `${mm(q.value)} (${tag(q.status)})` : "? (unknown)";
  heading("Tile set-out (proposed)");
  const size = t.tileLength?.value !== undefined && t.tileWidth?.value !== undefined ? `${mm(t.tileLength.value)} × ${mm(t.tileWidth.value)}` : `${t.tileLength?.value !== undefined ? mm(t.tileLength.value) : "?"} × ${t.tileWidth?.value !== undefined ? mm(t.tileWidth.value) : "?"}`;
  row(`Tile: ${size} mm (${tag(t.tileLength?.status)}/${tag(t.tileWidth?.status)}), ${t.orientation ?? "orientation ?"}`);
  row(`Grout joint: ${qv(t.joint)}`);
  row(`Cut to: ${t.reference ? REFERENCE_LABELS[t.reference] : "?"} of each return wall`);
  row(`This wall's ${l.face.label}: ${l.face.offset !== undefined ? `${mm(l.face.offset)} from drawn line` : "?"}`);
  row(`Floor reference: ${l.floor.label}${l.floor.level !== undefined ? ` = +${mm(l.floor.level)} above ${l.floor.datum}` : " ?"}`);
  row(`Origin: ${qv(t.originAlong)} from ${t.originFrom === "centre" ? "run centre" : t.originFrom ? `end ${t.originFrom.toUpperCase()} ${t.reference ?? "?"} face` : "?"}`);
  row(`        ${qv(t.originUp)} above ${l.floor.label}`);
  row(`Tiled height: ${qv(t.tiledHeight)} above ${l.floor.label}`);
  if (l.columns !== undefined) row(`${l.columns} columns × ${l.rows} courses, ${l.pieces.filter((p) => p.cut).length} cut pieces of ${l.pieces.length}`);
  y += 2;
  heading("Cuts (mm)");
  for (const r of cutRows(l)) row(`${r.label}: ${r.value}`);
  if (l.missing.length) {
    y += 2;
    heading(`Unresolved (${l.missing.length})`);
    for (const m of l.missing.slice(0, 10)) row(`• ${m}`.slice(0, 80), `fill="#b00020"`);
    if (l.missing.length > 10) row(`… and ${l.missing.length - 10} more`, `fill="#b00020"`);
  }
  const problems = l.problems.filter((p) => p.code !== "tiling_unresolved");
  if (problems.length) {
    y += 2;
    heading("Check");
    for (const p of problems.slice(0, 5)) row(`• ${p.message}`.slice(0, 80), `fill="#b00020"`);
  }
  y += 2;
  heading("Legend");
  row("Along-wall dimensions are to the face named; heights are from the floor reference.");
  row("Status: SC site-confirmed · M measured · PUB published · P proposed · E estimated · ? unknown");
  row("Tinted pieces are cut. Openings are cut to their entered clear size; reveals not modelled.");

  // ---- title block ----
  const tbY = 244;
  rect(x0 - 2, tbY, PANEL.w, 292 - tbY - 3, `fill="none" stroke="#000" stroke-width="0.35"`);
  const room = roomOnSide(wall, side, model.rooms);
  const tb = model.sheetSet?.titleBlock ?? {};
  text(x0, tbY + 5, `${opts.title ?? tb.project ?? model.name}`, 2.6, `font-weight="bold"`);
  text(x0, tbY + 10, `Wall ${wall.id}, ${side} side${room ? ` (faces ${room})` : ""} · elevation looking at the face`, 2.1);
  text(x0, tbY + 15, `Scale 1:${N} @ A3 · basis: ${l.basis === "unknown" ? "incomplete" : l.basis}`, 2.1);
  text(x0, tbY + 20, `Prepared by: ${tb.preparedBy?.trim() || "?"}`, 2.1);
  rect(x0 - 2, tbY + 34, PANEL.w, 7, `fill="#b00020"`);
  text(x0 + PANEL.w / 2 - 2, tbY + 38.6, "PROPOSED SET-OUT FOR TILER REVIEW · NOT AS-BUILT · NOT A COMPLIANCE CERTIFICATE", 1.8, `text-anchor="middle" fill="#fff" font-weight="bold"`);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAPER.w}mm" height="${PAPER.h}mm" viewBox="0 0 ${PAPER.w} ${PAPER.h}" font-family="Helvetica, Arial, sans-serif" data-sheet="wall-tiling" data-wall="${esc(wall.id)}" data-side="${side}" data-scale="${N}" data-status="proposed">`,
    `<rect width="${PAPER.w}" height="${PAPER.h}" fill="#fff"/>`,
    ...parts,
    `</svg>`,
  ].join("\n");
}
