/**
 * Stage wall elevations: one A3 drawing per wall side, from the same visible element set as a
 * stage's plan diagram (stageView.ts). Looking at the face from the room it faces, it shows what
 * that stage shows on that surface: the outermost visible face or layer, openings, the proposed
 * wall tile set-out, visible floor levels where they meet the wall, fixtures standing against
 * the face at their heights, and service points dimensioned along from the return wall's face
 * and up from the floor. Nothing is inferred: a height or position that is not known is listed
 * as "?" and never drawn. It never edits the model.
 */

import type { PlanModel, Wall, WallSideName, Item } from "../model/types";
import type { SheetFinding } from "./check";
import type { LibraryProduct } from "../model/productLibrary";
import { catalogForItem } from "../model/catalog";
import { segLen, type Pt } from "../model/geometry";
import { openingSpan } from "../model/issues";
import { layerLabel, offsetFromLine, resolveFace, sideFaces, wallBody } from "../model/faces";
import { DEFAULT_DATUM, floorLayerLabel, floorLevels, finishedLevel } from "../model/floor";
import { heightAt, surfaces } from "../model/drainage";
import { roughIn } from "../model/fixtures";
import { installationReading } from "../model/installation";
import { itemPolygon } from "../model/outline";
import { roomBeside, runLimit, tilingLayout, type RunLimit } from "../model/tiling";
import { PAPER, esc, f1, mm, tag } from "./floorPlan";
import { dimStatus, type ViewElement } from "./stageView";

const DRAW = { x: 12, y: 12, w: 262, h: 268 };
const PANEL = { x: 280, w: 132 };
const SCALES = [10, 20, 25, 50, 100];
/** a fixture whose footprint comes this close to the face is drawn on its elevation */
const NEAR_FACE = 0.15;

export interface ElevationSurface {
  wallId: string;
  side: WallSideName;
  /** "wall_n:right": the id export_diagram_view takes */
  id: string;
  room: string;
}

export interface ElevationOptions {
  label: string;
  findings: SheetFinding[];
  acknowledged?: { code: string; ref: string; reason: string; by: string }[];
  date?: string;
  note?: string;
  products?: LibraryProduct[];
}

/**
 * Strongest to weakest. ENT is "entered (not site-confirmed)", so it ranks below the confirmed,
 * measured and published statuses and above proposals and estimates; a default and an unknown
 * are weaker than any value.
 */
const STATUS_LADDER = ["site-confirmed", "measured", "published", "entered", "proposed", "estimated", "defaulted", "unknown"];

/** The weakest of the inputs: a derived value never prints a status stronger than any of them. Unrecognised statuses count as unknown. */
const weakestStatus = (statuses: string[]): string => {
  if (!statuses.length) return "unknown";
  const rank = Math.max(...statuses.map((s) => { const i = STATUS_LADDER.indexOf(s); return i < 0 ? STATUS_LADDER.length - 1 : i; }));
  return STATUS_LADDER[rank];
};

const surfaceId = (w: Wall, side: WallSideName) => `${w.id}:${side}`;

/** Every wall side that faces a room and has something of itself visible in the view. */
export function elevationSurfaces(model: PlanModel, elements: ViewElement[]): ElevationSurface[] {
  const vis = new Set(elements.map((e) => e.id));
  const out: ElevationSurface[] = [];
  for (const w of model.walls) {
    for (const side of ["left", "right"] as WallSideName[]) {
      const room = roomBeside(model, w, side);
      if (!room) continue;
      const shown = vis.has(`wall:${w.id}`) || elements.some((e) => e.ref === w.id && e.side === side);
      if (shown) out.push({ wallId: w.id, side, id: surfaceId(w, side), room: room.label });
    }
  }
  return out;
}

/** The outermost face of this side the view shows, as a face name runLimit and resolveFace take. */
function stageFace(w: Wall, side: WallSideName, vis: Set<string>): { name: string; label: string; layer?: string; layerId?: string } | null {
  const spec = w.sides?.[side];
  if (!spec) return null;
  const layers = spec.layers.filter((l) => vis.has(`wall:${w.id}:${side}:${l.id}`));
  if (layers.length) {
    const l = layers[layers.length - 1];
    const label = l.kind === "tile" ? "finished face" : l.kind === "board" ? "board face" : `${l.kind} face`;
    return { name: l.kind === "tile" ? "finished" : l.kind, label, layer: layerLabel(l), layerId: l.id };
  }
  if (vis.has(`wall:${w.id}:${side}:frame`)) return { name: "frame", label: "frame face" };
  if (vis.has(`wall:${w.id}:${side}:existing`)) return { name: "existing", label: "existing surface" };
  return null;
}

interface Placed {
  item: Item;
  no: string;
  label: string;
  s0: number;
  s1: number;
  /** distance in front of the face, for drawing order */
  depth: number;
  z0?: number;
  z1?: number;
  basis: string;
  heightNote: string;
  /** Kind-elevation stopgap (no #60 installation): envelope bottom, not a set-out. */
  dashed?: boolean;
}

/**
 * Render one wall side. A3 landscape in paper mm; end A is on the left when the face is seen
 * from the room (a left-side face is drawn mirrored so it reads as you stand in front of it).
 */
export function renderStageElevation(model: PlanModel, elements: ViewElement[], wallId: string, side: WallSideName, opts: ElevationOptions): string {
  const w = model.walls.find((x) => x.id === wallId);
  if (!w) throw new Error(`No wall ${wallId}`);
  const vis = new Set(elements.map((e) => e.id));
  const parts: string[] = [];
  const text = (x: number, y: number, s: string, size = 2.2, extra = "") =>
    parts.push(`<text x="${f1(x)}" y="${f1(y)}" font-size="${size}" ${extra}>${esc(s)}</text>`);
  const line = (x1: number, y1: number, x2: number, y2: number, extra = "") =>
    parts.push(`<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" ${extra}/>`);
  const rect = (x: number, y: number, rw: number, rh: number, extra = "") =>
    parts.push(`<rect x="${f1(Math.min(x, x + rw))}" y="${f1(y)}" width="${f1(Math.abs(rw))}" height="${f1(Math.max(rh, 0))}" ${extra}/>`);
  const de = (id: string) => `data-element="${esc(id)}"`;

  const len = segLen(w.ax, w.ay, w.bx, w.by) || 1;
  const A = { x: w.ax, y: w.ay };
  const d = { x: (w.bx - w.ax) / len, y: (w.by - w.ay) / len };
  const along = (p: Pt) => (p.x - A.x) * d.x + (p.y - A.y) * d.y;
  const room = roomBeside(model, w, side);
  const fb = room?.floorBuildUp;
  const datum = fb?.datum || DEFAULT_DATUM;
  const spec = w.sides?.[side];
  const face = stageFace(w, side, vis);

  // ---- scale: the longest and tallest wall in the plan, so every elevation of a project matches ----
  const maxLen = Math.max(...model.walls.map((x) => segLen(x.ax, x.ay, x.bx, x.by)), len);
  const maxH = Math.max(...model.walls.map((x) => x.height), w.height);
  const margin = 32;
  const N = SCALES.find((n) => (maxLen * 1000) / n <= DRAW.w - 2 * margin && (maxH * 1000) / n <= DRAW.h - 2 * margin - 20) ?? SCALES[SCALES.length - 1];
  const k = 1000 / N;
  const mirror = side === "left";
  const ox = DRAW.x + (DRAW.w - len * k) / 2;
  const oy = DRAW.y + (DRAW.h + w.height * k) / 2 - 6; // paper y of the datum
  const X = (s: number) => (mirror ? ox + (len - s) * k : ox + s * k);
  const Y = (z: number) => oy - z * k;

  parts.push(`<rect x="5" y="5" width="410" height="287" fill="none" stroke="#000" stroke-width="0.5"/>`);
  rect(DRAW.x, DRAW.y, DRAW.w, DRAW.h, `fill="none" stroke="#999" stroke-width="0.2"`);

  // ---- run limits at the stage face of each return wall ----
  const limA: RunLimit | null = face ? runLimit(model, w, side, "a", face.name as never) : null;
  const limB: RunLimit | null = face ? runLimit(model, w, side, "b", face.name as never) : null;
  const s0 = limA?.resolved ? limA.s! : 0;
  const s1 = limB?.resolved ? limB.s! : len;
  const fromA = (s: number) => (limA?.resolved ? `${mm(s - s0)} from ${face!.label} at A` : `${mm(s)} from end A (drawn line)`);

  // ---- the face itself ----
  const faceRes = face ? resolveFace(spec, face.layerId ?? face.name) : null;
  const fill: Record<string, string> = { existing: "#eeeeee", frame: "#efe2cf", board: "#f3e3c3", waterproofing: "#cfe4f3", adhesive: "#e3e3e3", finished: "#ffffff" };
  const wallShown = vis.has(`wall:${w.id}`) || !!face;
  if (wallShown) {
    rect(X(s0), Y(w.height), (s1 - s0) * k * (mirror ? -1 : 1), w.height * k, `fill="${face ? fill[face.name] ?? "#f4f4f4" : "#f4f4f4"}" stroke="#222" stroke-width="0.35" ${face?.layerId ? de(`wall:${w.id}:${side}:${face.layerId}`) : de(`wall:${w.id}`)}`);
    // the return walls, cut at the face
    for (const [s, dir] of [[s0, -1], [s1, 1]] as const) {
      const ww = 4 * (mirror ? -dir : dir);
      rect(X(s), Y(w.height), ww, w.height * k, `fill="#bdbdbd" stroke="#222" stroke-width="0.25"`);
    }
  }
  text(X(s0), Y(w.height) - 2.5, "A", 3, `font-weight="bold" text-anchor="middle"`);
  text(X(s1), Y(w.height) - 2.5, "B", 3, `font-weight="bold" text-anchor="middle"`);

  // ---- wall tile set-out, when the tile layer is shown ----
  const tileLayer = spec?.layers.find((l) => l.kind === "tile" && vis.has(`wall:${w.id}:${side}:${l.id}`));
  let tileNote = "";
  if (tileLayer) {
    const t = tilingLayout(model, w, side);
    if (t.pieces.length) {
      for (const p of t.pieces) rect(X(p.s0), Y(p.z1), (p.s1 - p.s0) * k * (mirror ? -1 : 1), (p.z1 - p.z0) * k, `fill="${p.cut ? "#f6e2cf" : "#fff"}" stroke="#9a9a9a" stroke-width="0.12" data-piece="${p.cut ? "cut" : "full"}"`);
      tileNote = `Proposed tile set-out: ${t.columns} columns × ${t.rows} courses, ${t.pieces.filter((p) => p.cut).length} cut pieces (see the wall tiling sheet for cuts).`;
    } else tileNote = !w.tiling?.[side] ? "Tile layer shown; no tile set-out recorded for this face." : `Tile set-out unresolved: ${t.missing.slice(0, 3).join("; ")}.`;
  }

  // ---- openings ----
  const openings = model.openings.filter((o) => o.wallId === w.id && vis.has(`opening:${o.id}`));
  for (const o of openings) {
    const [t0, t1] = openingSpan(w, o);
    const a = t0 * len, b = t1 * len;
    rect(X(a), Y(o.sill + o.height), (b - a) * k * (mirror ? -1 : 1), o.height * k, `fill="#dfe9f2" stroke="#2f78b7" stroke-width="0.35" ${de(`opening:${o.id}`)}`);
    const cx = (X(a) + X(b)) / 2;
    const mid = Y(o.sill + o.height / 2);
    text(cx, mid - 1, `${o.kind === "door" ? "DOOR" : "WINDOW"} ${mm(o.width)} ${tag(dimStatus(o.widthDefaulted))} × ${mm(o.height)} ${tag(dimStatus(o.heightDefaulted))}`, 2, `text-anchor="middle" fill="#2f78b7"`);
    if (o.kind === "window") text(cx, mid + 2.4, `sill ${mm(o.sill)} ${tag(dimStatus(o.sillDefaulted))} above ${datum}`, 1.8, `text-anchor="middle" fill="#2f78b7"`);
    // a jamb is the centre ± half the width, read from the A-end face: no better than either
    const jambTag = tag(weakestStatus([dimStatus(o.widthDefaulted), ...(limA?.resolved ? [limA.basis] : [])]));
    text(cx, mid + 4.8, `jambs ${limA?.resolved ? `${mm(a - s0)} / ${mm(b - s0)} ${jambTag} from ${face!.label} at A` : `${mm(a)} / ${mm(b)} ${jambTag} from end A`}`, 1.8, `text-anchor="middle" fill="#2f78b7"`);
  }

  // ---- floor levels where they meet the wall ----
  const floorRows: string[] = [];
  if (room && fb) {
    const levels = floorLevels(fb);
    const shownLevels = levels.filter((lv) => lv.level === "substrate" ? vis.has(`room:${room.id}:substrate`) : vis.has(`room:${room.id}:floor:${lv.level}`));
    for (const lv of shownLevels) {
      const layer = fb.layers.find((l) => l.id === lv.level);
      const name = layer ? floorLayerLabel(layer) : "substrate";
      if (!lv.resolved) { floorRows.push(`${name} top: ? (${lv.missing.join(", ")})`); continue; }
      line(X(s0), Y(lv.top!), X(s1), Y(lv.top!), `stroke="#7a5230" stroke-width="0.3" ${layer ? de(`room:${room.id}:floor:${layer.id}`) : de(`room:${room.id}:substrate`)}`);
      text(Math.max(X(s0), X(s1)) + 5, Y(lv.top!) + 0.7, `${name} ${lv.top! >= 0 ? "+" : ""}${mm(lv.top!)} ${tag(lv.basis)}`, 1.7, `fill="#7a5230"`);
      floorRows.push(`${name} top ${mm(lv.top!)} ${tag(lv.basis)} above ${datum} (flat build-up level)`);
    }
    // the finished floor along the face, with falls, where planes are recorded and the finished floor or fixtures are shown
    const finishedShown = fb.layers.length && vis.has(`room:${room.id}:floor:${fb.layers[fb.layers.length - 1].id}`);
    const fixturesShown = elements.some((e) => e.type === "fixture");
    if (room.drainage?.planes.length && (finishedShown || fixturesShown)) {
      const off = (faceRes?.resolved ? faceRes.offset! : wallBody(w).z + (side === "right" ? 1 : -1) * wallBody(w).depth / 2) + 0.01;
      const n = side === "left" ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x };
      const map = surfaces(room.drainage);
      const pts: string[] = [];
      let gaps = 0;
      for (let i = 0; i <= 40; i++) {
        const s = s0 + ((s1 - s0) * i) / 40;
        // a face behind the surveyed surface still meets the floor at the room's edge
        const px = Math.min(Math.max(A.x + d.x * s + n.x * off, room.x), room.x + room.w);
        const py = Math.min(Math.max(A.y + d.y * s + n.y * off, room.y), room.y + room.h);
        const h = heightAt(room.drainage, px, py, map);
        if (h.level === undefined) { gaps++; continue; }
        pts.push(`${f1(X(s))},${f1(Y(h.level))}`);
      }
      if (pts.length > 1) parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="#1a7f37" stroke-width="0.4" data-role="finished-floor-falls"/>`);
      floorRows.push(`Finished floor along this face follows the recorded falls (green)${gaps ? `; ${gaps} of 41 samples have no plane level` : ""}.`);
    }
  }
  line(X(s0) - (mirror ? -8 : 8), Y(0), X(s1) + (mirror ? -8 : 8), Y(0), `stroke="#000" stroke-width="0.25" stroke-dasharray="2 1"`);
  text(Math.min(X(s0), X(s1)) - 9, Y(0) + 0.7, `0 = ${datum}`, 1.7, `text-anchor="end" fill="#444"`);

  // ---- fixtures against this face ----
  const fixtureNo = new Map(model.items.map((it, i) => [it.id, `F${i + 1}`]));
  const faceOff = faceRes?.resolved ? faceRes.offset! : (() => { const b = wallBody(w); return b.z + (side === "right" ? 1 : -1) * b.depth / 2; })();
  const flatFinished = finishedLevel(fb);
  const placed: Placed[] = [];
  const shownIds = new Set<string>();
  const candidate = (it: Item) => vis.has(`item:${it.id}`);
  for (const it of model.items) {
    if (!candidate(it) || it.fittedTo) continue;
    const pg = itemPolygon(it);
    if (!pg) continue;
    const offs = pg.map((p) => offsetFromLine(w, side, p) - faceOff);
    const ss = pg.map(along);
    const anchored = it.anchor?.wallId === w.id && it.anchor.side === side;
    const near = Math.min(...offs) <= NEAR_FACE && Math.max(...offs) > -0.05 && Math.max(...ss) > 0 && Math.min(...ss) < len;
    if (!anchored && !near) continue;
    shownIds.add(it.id);
    placed.push({ item: it, no: fixtureNo.get(it.id)!, label: catalogForItem(it)?.label ?? it.kind, s0: Math.max(Math.min(...ss), 0), s1: Math.min(Math.max(...ss), len), depth: Math.max(0, Math.min(...offs)), ...vertical(model, it, room, flatFinished) });
  }
  // accessories fitted inside a fixture on this face go with it
  for (const it of model.items) {
    if (!candidate(it) || !it.fittedTo || !shownIds.has(it.fittedTo.hostId)) continue;
    const pg = itemPolygon(it);
    if (!pg) continue;
    const ss = pg.map(along);
    shownIds.add(it.id);
    placed.push({ item: it, no: fixtureNo.get(it.id)!, label: catalogForItem(it)?.label ?? it.kind, s0: Math.min(...ss), s1: Math.max(...ss), depth: -1, ...vertical(model, it, room, flatFinished) });
  }
  placed.sort((a, b) => b.depth - a.depth);
  for (const p of placed) {
    if (p.z0 === undefined || p.z1 === undefined) continue; // height unknown: listed, never drawn
    rect(X(p.s0), Y(p.z1), (p.s1 - p.s0) * k * (mirror ? -1 : 1), (p.z1 - p.z0) * k, `fill="#ffffff" fill-opacity="0.82" stroke="#444" stroke-width="0.3" ${p.dashed ? `stroke-dasharray="1.2 0.6"` : ""} ${de(`item:${p.item.id}`)}`);
    const cx = (X(p.s0) + X(p.s1)) / 2;
    text(cx, Y(p.z1) + 2.6, p.no, 2.2, `text-anchor="middle" font-weight="bold"`);
  }

  // ---- service points on fixtures set out from this face ----
  const spRows: { s: string; extra: string }[] = [];
  const labels: { x: number; y: number; w: number }[] = [];
  for (const it of model.items) {
    if (it.anchor?.wallId !== w.id || it.anchor.side !== side) continue;
    roughIn(model, it).forEach((r, i) => {
      const id = `item:${it.id}:sp:${r.pointId}`;
      if (!vis.has(id)) return;
      const no = `${fixtureNo.get(it.id)}.${i + 1}`;
      const floorAt = localFinished(model, room, r.x, r.y, flatFinished);
      const z = r.level ?? (r.up !== undefined && floorAt.level !== undefined ? floorAt.level + r.up : undefined);
      const colour = r.service === "waste" ? "#7a5230" : r.service === "water" ? "#2f78b7" : "#c0392b";
      const alongText = r.alongFromA !== undefined ? fromA(r.alongFromA) : "along ?";
      const upText = r.up !== undefined ? `${mm(r.up)} above finished floor` : "up ?";
      spRows.push({ s: `${no} ${r.service} · ${r.label}: ${alongText} · ${upText} · ${tag(r.status)}${r.entered.out !== undefined ? ` · ${mm(r.entered.out)}${r.entered.outMax !== undefined ? `–${mm(r.entered.outMax)}` : ""} out from ${r.entered.face} face` : ""}`, extra: `fill="${colour}" ${de(id)}` });
      if (r.alongFromA === undefined || z === undefined) return; // listed with "?"; never placed where it is not known
      const px = X(r.alongFromA), py = Y(z);
      parts.push(`<circle cx="${f1(px)}" cy="${f1(py)}" r="1.1" fill="${colour}" ${de(id)}/>`);
      const tagText = `${no} ${r.up !== undefined ? mm(r.up) : "?"} AFF`;
      const box = { x: px + 1.6, y: py - 1.2, w: tagText.length * 0.95 };
      while (labels.some((b) => Math.abs(b.y - box.y) < 2.1 && box.x < b.x + b.w && b.x < box.x + box.w)) box.y -= 2.3;
      labels.push(box);
      if (Math.abs(box.y - (py - 1.2)) > 0.1) line(px, py, box.x, box.y + 0.4, `stroke="${colour}" stroke-width="0.12"`);
      text(box.x, box.y, tagText, 1.7, `fill="${colour}"`);
    });
  }

  // ---- dimensions: run between return faces, wall height ----
  const yDim = Y(0) + 12;
  if (limA?.resolved && limB?.resolved) {
    line(X(s0), yDim, X(s1), yDim, `stroke="#000" stroke-width="0.2"`);
    for (const s of [s0, s1]) line(X(s), yDim - 1.5, X(s), yDim + 1.5, `stroke="#000" stroke-width="0.3"`);
    text((X(s0) + X(s1)) / 2, yDim - 1.2, `${mm(s1 - s0)} between ${face!.label}s of the return walls (${tag(limA.basis)}/${tag(limB.basis)})`, 2.1, `text-anchor="middle" data-dim="run"`);
  } else {
    text((X(0) + X(len)) / 2, yDim - 1.2, face ? `run between return faces: ? (${[...(limA?.missing ?? []), ...(limB?.missing ?? [])].slice(0, 2).join("; ")})` : `drawn length ${mm(len)} (no face of this side is shown)`, 2, `text-anchor="middle" fill="${face ? "#b00020" : "#000"}"`);
  }
  const xH = Math.max(X(s0), X(s1)) + 22;
  line(xH, Y(0), xH, Y(w.height), `stroke="#000" stroke-width="0.2"`);
  text(xH + 1.5, Y(w.height / 2), `${mm(w.height)} ${tag(dimStatus(w.heightDefaulted))} wall height above ${datum}`, 1.8, `transform="rotate(-90 ${f1(xH + 1.5)} ${f1(Y(w.height / 2))})" text-anchor="middle"`);

  // ---- scale bar ----
  const sbY = DRAW.y + DRAW.h - 7;
  for (let i = 0; i < 2; i++) rect(DRAW.x + 6 + i * 0.5 * k, sbY, 0.5 * k, 1.5, `fill="${i % 2 ? "#fff" : "#000"}" stroke="#000" stroke-width="0.2"`);
  text(DRAW.x + 6, sbY - 1, "0", 2);
  text(DRAW.x + 6 + k, sbY - 1, "1 m", 2);
  text(DRAW.x + 6, sbY + 4.5, `Scale 1:${N} at A3. Elevation looking at the face from ${room?.label ?? "the room"}; end A ${mirror ? "on the right" : "on the left"}. Dimensions in mm.`, 2);

  // ---- panel ----
  let y = 15;
  let overflowed = false;
  const BOTTOM = 232;
  const x0 = PANEL.x;
  const heading = (s: string) => { if (y > BOTTOM) return; text(x0, y, s, 2.7, `font-weight="bold"`); y += 4.2; };
  const row = (s: string, size = 1.95, extra = "") => {
    const max = Math.floor((PANEL.w - 3) / (size * 0.5));
    const lines: string[] = [];
    let cur = "";
    for (const word of s.split(" ")) { if ((cur + " " + word).trim().length > max && cur) { lines.push(cur); cur = word; } else cur = (cur + " " + word).trim(); }
    if (cur) lines.push(cur);
    for (const [i, l] of lines.entries()) {
      if (y > BOTTOM) { if (!overflowed) { text(x0, y, "… more: see the specification sheet", 1.9, `fill="#666"`); overflowed = true; } return; }
      text(x0 + (i ? 3 : 0), y, l, size, extra);
      y += size + 0.9;
    }
  };
  heading(`Stage: ${opts.label}`);
  row(`Wall ${w.id.replace(/^wall_/, "")}, ${side} side, facing ${room?.label ?? "?"}. Same visible set as the stage plan; everything else hidden, not removed.`);
  row("Status: SC site-confirmed · M measured · PUB published · P proposed · E estimated · DER derived · ENT entered · DEF default · ? unknown", 1.8, `fill="#444"`);
  y += 1.5;
  heading("This face");
  if (!face) row("No face or layer of this side is shown: the wall is drawn at its drawn length only.");
  else {
    row(`Shown to: ${face.label}${face.layer ? ` (${face.layer})` : ""}${faceRes?.resolved ? `, ${mm(faceRes.offset!)} from the drawn line ${tag(faceRes.basis)}` : " (position ?)"}.`);
    for (const l of spec?.layers ?? []) if (vis.has(`wall:${w.id}:${side}:${l.id}`)) row(`${layerLabel(l)}: ${l.thickness?.value !== undefined ? `${mm(l.thickness.value)} ${tag(l.thickness.status)}` : "thickness ?"}. Extent on the face is not modelled; drawn over the full face.`);
    if (limA) row(`End A: ${limA.label}${limA.resolved ? ` at ${mm(limA.s!)} along the drawn line` : ": ?"}.`);
    if (limB) row(`End B: ${limB.label}${limB.resolved ? ` at ${mm(limB.s!)} along the drawn line` : ": ?"}.`);
    if (tileNote) row(tileNote);
  }
  if (floorRows.length) { y += 1.5; heading("Floor at this wall"); floorRows.forEach((r) => row(r)); }
  if (placed.length) {
    y += 1.5;
    heading("Fixtures against this face");
    for (const p of placed) {
      row(`${p.no} ${p.label}: ${fromA(p.s0)} to ${limA?.resolved ? mm(p.s1 - s0) : mm(p.s1)} · ${p.z0 === undefined ? "height ?" : `${mm(p.z0)}–${mm(p.z1!)} above ${datum} ${p.basis === "unknown" ? "?" : tag(p.basis)}`} · ${p.heightNote}`, 1.95, de(`item:${p.item.id}`));
    }
  }
  if (spRows.length) { y += 1.5; heading("Service points (AFF = above finished floor)"); spRows.forEach((r) => row(r.s, 1.95, r.extra)); }
  const refs = new Set([w.id, ...placed.map((p) => p.item.id), ...openings.map((o) => o.id)]);
  const shownEls = new Set(elements.filter((e) => refs.has(e.ref) && (e.side === undefined || e.side === side)).map((e) => e.id));
  const unresolved = opts.findings.filter((f) => f.severity === "advisory" && f.ref.split(",").some((r) => shownEls.has(r) || refs.has(r)));
  if (unresolved.length) { y += 1.5; heading(`Unresolved on this face (${unresolved.length})`); unresolved.slice(0, 8).forEach((f) => row(`• ${f.message}`, 1.85, `fill="#7a3b00"`)); if (unresolved.length > 8) row(`… ${unresolved.length - 8} more: see the specification sheet`, 1.85, `fill="#666"`); }
  const acks = opts.acknowledged ?? [];
  if (acks.length) { y += 1.5; heading(`Exported past ${acks.length} blocking finding(s)`); acks.slice(0, 4).forEach((a) => row(`• ${a.code} (${a.ref}), ${a.by}: ${a.reason}`, 1.85, `fill="#b00020"`)); }

  // ---- title block ----
  const tb = model.sheetSet?.titleBlock ?? {};
  const tbY = 238;
  rect(x0 - 2, tbY, PANEL.w, 292 - tbY - 3, `fill="none" stroke="#000" stroke-width="0.35"`);
  const tby = (i: number) => tbY + 5 + i * 5;
  text(x0, tby(0), `Project: ${tb.project?.trim() || "?"}`, 2.5, `font-weight="bold"`);
  text(x0, tby(1), `Site / room: ${tb.site?.trim() || "?"}`, 2.2);
  text(x0, tby(2), `Stage elevation: ${opts.label} · wall ${w.id}, ${side} side`, 2.2);
  text(x0, tby(3), `Scale 1:${N} @ A3 · ${opts.date ? `Exported ${opts.date} · not a revision of A-01` : "PREVIEW, not exported"}`, 2.2);
  text(x0, tby(4), `Prepared by: ${tb.preparedBy?.trim() || "?"} · Plan: ${model.name}`, 2.1);
  text(x0, tby(5), opts.note ? `Note: ${opts.note}` : "", 2);
  rect(x0 - 2, tby(6) - 3.4, PANEL.w, 7, `fill="#b00020"`);
  text(x0 + PANEL.w / 2 - 2, tby(6) + 1.2, "PROPOSED · FOR TRADE REVIEW · NOT AS-BUILT · NOT A COMPLIANCE CERTIFICATE", 1.75, `text-anchor="middle" fill="#fff" font-weight="bold"`);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAPER.w}mm" height="${PAPER.h}mm" viewBox="0 0 ${PAPER.w} ${PAPER.h}" font-family="Helvetica, Arial, sans-serif" data-sheet="stage-elevation" data-wall="${esc(w.id)}" data-side="${side}" data-scale="${N}">`,
    `<metadata id="stage-view">${esc(JSON.stringify({ label: opts.label, surface: surfaceId(w, side), elements: elements.map((e) => e.id) }))}</metadata>`,
    `<rect width="${PAPER.w}" height="${PAPER.h}" fill="#fff"/>`,
    ...parts,
    `</svg>`,
  ].join("\n");
}

/** The finished floor at a plan point: the local plane level where falls are recorded, else the flat build-up. */
function localFinished(model: PlanModel, room: ReturnType<typeof roomBeside>, x: number | undefined, y: number | undefined, flat: ReturnType<typeof finishedLevel>): { level?: number; basis: string; datumOnly?: boolean } {
  if (room?.drainage?.planes.length && x !== undefined && y !== undefined) {
    const h = heightAt(room.drainage, x, y);
    if (h.level !== undefined) return { level: h.level, basis: h.basis };
  }
  // no floor build-up recorded at all: heights are read from the datum (the existing floor), and say so
  if (!room?.floorBuildUp) return { level: 0, basis: "estimated", datumOnly: true };
  return flat.resolved ? { level: flat.top, basis: flat.basis } : { basis: "unknown" };
}

/** Bottom and top of a fixture above the room datum, and where that comes from. Unknown stays unknown. */
function vertical(model: PlanModel, it: Item, room: ReturnType<typeof roomBeside>, flat: ReturnType<typeof finishedLevel>): Pick<Placed, "z0" | "z1" | "basis" | "heightNote" | "dashed"> {
  const cat = catalogForItem(it);
  if (!cat) return { basis: "unknown", heightNote: `kind ${it.kind} unknown` };
  if (it.installation) {
    const r = installationReading(model, it);
    if (r.bottom === undefined) return { basis: "unknown", heightNote: `installation height unresolved (${r.missing.join(", ")})` };
    return { z0: r.bottom, z1: r.top ?? r.bottom + cat.h, basis: r.basis, heightNote: "installation height above the named floor datum" };
  }
  const floor = localFinished(model, room, it.x, it.y, flat);
  if (floor.level === undefined) return { basis: "unknown", heightNote: "finished floor level unknown here" };
  const z0 = floor.level + (cat.elevation ?? 0);
  const on = floor.datumOnly ? "the existing floor (no floor build-up recorded)" : "the finished floor";
  const dashed = Boolean(cat.elevation || cat.stopgap);
  return cat.elevation
    ? { z0, z1: z0 + cat.h, basis: "estimated", dashed: true, heightNote: `${cat.elevationNote ? `${cat.elevationNote}; ` : ""}envelope bottom ${mm(cat.elevation)} above ${on} from the kind's data, not a set-out (dashed)` }
    : { z0, z1: z0 + cat.h, basis: floor.basis, ...(dashed ? { dashed: true } : {}), heightNote: `stands on ${on}; height ${mm(cat.h)} from the kind's envelope${dashed ? " (dashed)" : ""}` };
}
