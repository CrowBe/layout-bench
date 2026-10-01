/**
 * Wall tile set-out (#9): one side of one wall, as a PROPOSAL for review with a tiler. Never
 * an as-built record, a procurement list or a waterproofing compliance statement.
 *
 * Inputs are user-entered with a status: tile length and width, orientation, grout joint,
 * the reference face the run is cut to (the fixed board face or the finished face of each
 * return wall), the floor reference level, the origin, and the tiled height. Nothing is
 * defaulted. A layout with any unknown input still reports what it can and lists the rest.
 *
 * Coordinates are on the wall's elevation: `s` along the drawn line from end A (metres), and
 * `z` up from the room's floor datum (level 0, the same datum floor.ts and the 3D model use).
 *
 *  - The run along the wall is bounded at each end by the reference face of the return wall
 *    that meets this wall there, measured where that face crosses this wall's drawn line.
 *  - The tiled band runs from the floor reference level up `tiledHeight`.
 *  - The origin is the A-side edge of one full tile, `originAlong` from the named end's limit
 *    face (or from the run centre), and the bottom edge of one full course `originUp` above
 *    the floor reference. Tiles repeat from it at tile size plus joint.
 *  - Openings are cut to their clear span and sill/head as entered (heights above the floor
 *    datum). Reveal linings are not modelled.
 */

import type { Opening, PlanModel, Quantity, Room, TileFloorReference, TileOrientation, TileReferenceFace, ValueStatus, Wall, WallSideName, WallTiling } from "./types";
import { VALUE_STATUSES, input, known, offsetFromLine, resolveFace, sideNormal, weakest, type FaceInput } from "./faces";
import { DEFAULT_DATUM, finishedLevel, floorLevels, levelOfKind } from "./floor";
import { pointSegDist, quantize, segLen, type Pt } from "./geometry";

export const TILE_ORIENTATIONS: TileOrientation[] = ["landscape", "portrait"];
export const TILE_REFERENCES: TileReferenceFace[] = ["board", "finished"];
export const TILE_FLOOR_REFERENCES: TileFloorReference[] = ["finished", "screed", "substrate", "datum"];
export const TILE_ORIGIN_FROM = ["a", "b", "centre"] as const;

export const REFERENCE_LABELS: Record<TileReferenceFace, string> = { board: "board face", finished: "finished (tile) face" };
export const FLOOR_LABELS: Record<TileFloorReference, string> = {
  finished: "finished floor level", screed: "screed top", substrate: "substrate top", datum: "floor datum",
};

/** Edges closer than this to a tile edge count as on it (0.1 mm, the model's precision). */
const ON_EDGE = 1e-4;
/** Wall ends within this of another wall join it, as the 3D builder and A-01 sheet treat them. */
const JOIN = 0.09;

export type Basis = ValueStatus | "unknown";

/** One end of the run: where the return wall's reference face crosses this wall's line. */
export interface RunLimit {
  end: "a" | "b";
  /** metres along from end A; absent when unresolved */
  s?: number;
  resolved: boolean;
  basis: Basis;
  /** the return wall and the face cut to */
  wallId?: string;
  side?: WallSideName;
  label: string;
  missing: string[];
  /** the return wall is not square to this one */
  skew?: boolean;
}

export interface FloorRef {
  reference: TileFloorReference | null;
  /** metres above the datum; absent when unresolved */
  level?: number;
  resolved: boolean;
  basis: Basis | "datum";
  roomId?: string;
  datum: string;
  label: string;
  missing: string[];
}

/** A cut at one edge: the piece of tile on the tiled side of that edge. */
export interface EdgeCut {
  /** metres: the size of the piece, along or up */
  size: number;
  /** the full tile dimension in that direction */
  of: number;
  full: boolean;
  /** the edge falls in a grout joint: the piece is a full tile and this is the gap from it to the edge */
  gap?: number;
}

export interface OpeningCuts {
  openingId: string;
  kind: Opening["kind"];
  /** along from A; up from the datum */
  s0: number;
  s1: number;
  z0: number;
  z1: number;
  /** why its cuts are not given */
  unresolved?: string;
  /** piece beside the jamb nearer end A / end B, under the sill, over the head */
  jambA?: EdgeCut;
  jambB?: EdgeCut;
  sill?: EdgeCut;
  head?: EdgeCut;
}

export interface TilePiece {
  s0: number;
  s1: number;
  z0: number;
  z1: number;
  cut: boolean;
}

export interface TilingLayout {
  wallId: string;
  side: WallSideName;
  status: "proposed";
  /** every user input, with its status ("unknown" when not entered) */
  inputs: FaceInput[];
  choices: { orientation: TileOrientation | null; reference: TileReferenceFace | null; floor: TileFloorReference | null; originFrom: WallTiling["originFrom"] | null };
  /** what is not known yet; nothing here is filled with a default */
  missing: string[];
  resolved: boolean;
  /** weakest status among every input that reached a number */
  basis: Basis;
  /** the face of THIS wall side the tiles are fixed over, for reference */
  face: { label: string; offset?: number; resolved: boolean };
  limits: { a: RunLimit; b: RunLimit };
  floor: FloorRef;
  /** tile size on the wall: along and up, after orientation */
  tile?: { along: number; up: number };
  joint?: number;
  /** run length between limits; band height */
  run?: number;
  band?: { z0: number; z1: number };
  /** the origin on the elevation: A-side edge of a full tile, bottom of a full course */
  origin?: { s: number; z: number };
  cuts?: { a: EdgeCut; b: EdgeCut; bottom: EdgeCut; top: EdgeCut };
  columns?: number;
  rows?: number;
  openings: OpeningCuts[];
  pieces: TilePiece[];
  problems: { severity: "error" | "warning"; code: string; message: string }[];
}

const q = quantize;
const mmText = (m: number) => `${Math.round(m * 10000) / 10} mm`;

/** The room whose interior lies just off this side of the wall. */
export function roomBeside(model: PlanModel, wall: Wall, side: WallSideName): Room | undefined {
  const n = sideNormal(wall, side);
  const p = { x: (wall.ax + wall.bx) / 2 + n.x * 0.1, y: (wall.ay + wall.by) / 2 + n.y * 0.1 };
  return model.rooms.find((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
}

/** Where the run ends at one end of the wall: the reference face of the return wall there. */
export function runLimit(model: PlanModel, wall: Wall, side: WallSideName, end: "a" | "b", reference: TileReferenceFace | undefined): RunLimit {
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  const A = { x: wall.ax, y: wall.ay };
  const d = { x: (wall.bx - wall.ax) / len, y: (wall.by - wall.ay) / len };
  const P = end === "a" ? A : { x: wall.bx, y: wall.by };
  const inward = end === "a" ? 1 : -1; // along d, toward the other end
  const candidates = model.walls.filter((r) => {
    if (r.id === wall.id) return false;
    const ra = { x: r.ax, y: r.ay }, rb = { x: r.bx, y: r.by };
    const meets = Math.hypot(ra.x - P.x, ra.y - P.y) < JOIN || Math.hypot(rb.x - P.x, rb.y - P.y) < JOIN || pointSegDist(P, ra, rb) < JOIN;
    if (!meets) return false;
    // it must bound the tiled side: some part of it lies on that side of this wall
    return Math.max(offsetFromLine(wall, side, ra), offsetFromLine(wall, side, rb)) > 0.01;
  });
  const endName = end.toUpperCase();
  if (!candidates.length) {
    return { end, resolved: false, basis: "unknown", label: `end ${endName}: no return wall`, missing: [`a return wall at end ${endName} (none meets this wall there)`] };
  }
  if (!reference) {
    return { end, resolved: false, basis: "unknown", wallId: candidates[0].id, label: `end ${endName}: ${candidates[0].id}, face not chosen`, missing: ["reference face (board or finished)"] };
  }
  let best: RunLimit | undefined;
  for (const r of candidates) {
    const nl = sideNormal(r, "left");
    const rSide: WallSideName = (nl.x * d.x + nl.y * d.y) * inward > 0 ? "left" : "right";
    const nR = sideNormal(r, rSide);
    const dn = d.x * nR.x + d.y * nR.y;
    if (Math.abs(dn) < 1e-6) continue; // parallel: it does not cross this wall
    const f = resolveFace(r.sides?.[rSide], reference);
    const label = `${f.label} of ${r.id} (${rSide} side)`;
    if (!f.resolved) {
      const out: RunLimit = { end, resolved: false, basis: "unknown", wallId: r.id, side: rSide, label, missing: f.missing.map((m) => `${r.id} ${rSide} side: ${m}`) };
      best = best ?? out;
      continue;
    }
    const s = (f.offset! - ((A.x - r.ax) * nR.x + (A.y - r.ay) * nR.y)) / dn;
    const skew = Math.abs(Math.abs(dn) - 1) > 1e-4;
    const out: RunLimit = { end, s: q(s), resolved: true, basis: f.basis, wallId: r.id, side: rSide, label, missing: [], ...(skew ? { skew } : {}) };
    // innermost resolved face wins
    if (!best || !best.resolved || (end === "a" ? s > best.s! : s < best.s!)) best = out;
  }
  return best ?? { end, resolved: false, basis: "unknown", label: `end ${endName}: return wall is parallel`, missing: [`a return wall crossing end ${endName}`] };
}

/** The floor level the courses are measured from, read from the room's floor build-up (#6). */
export function floorReference(model: PlanModel, wall: Wall, side: WallSideName, reference: TileFloorReference | undefined): FloorRef {
  const room = roomBeside(model, wall, side);
  const datum = room?.floorBuildUp?.datum ?? DEFAULT_DATUM;
  if (!reference) return { reference: null, resolved: false, basis: "unknown", datum, label: "floor reference not chosen", missing: ["floor reference (finished, screed, substrate or datum)"], ...(room ? { roomId: room.id } : {}) };
  const label = FLOOR_LABELS[reference];
  if (reference === "datum") return { reference, level: 0, resolved: true, basis: "datum", datum, label: `${label} (${datum})`, missing: [], ...(room ? { roomId: room.id } : {}) };
  if (!room) return { reference, resolved: false, basis: "unknown", datum, label, missing: ["a room on this side of the wall (for its floor build-up)"] };
  const a = room.floorBuildUp;
  const lvl = reference === "finished" ? (a?.layers.length ? finishedLevel(a) : undefined)
    : reference === "screed" ? levelOfKind(a, "screed")
    : floorLevels(a)[0];
  if (!lvl) return { reference, resolved: false, basis: "unknown", datum, roomId: room.id, label, missing: [`${room.label} floor build-up: ${reference === "screed" ? "a screed layer" : "layers"} (none entered)`] };
  if (!lvl.resolved) return { reference, resolved: false, basis: "unknown", datum, roomId: room.id, label, missing: lvl.missing.map((m) => `${room.label} floor: ${m}`) };
  return { reference, level: lvl.top, resolved: true, basis: lvl.basis, datum, roomId: room.id, label, missing: [] };
}

/**
 * The tile piece on each side of an edge at `x`, for tiles starting at `origin` and repeating
 * every `tile + joint`. "before" is the piece below/toward A of the edge, "after" beyond it.
 */
export function edgeCut(origin: number, tile: number, joint: number, x: number, keep: "before" | "after"): EdgeCut {
  const pitch = tile + joint;
  const k = Math.floor((x - origin) / pitch + 1e-9);
  const within = x - (origin + k * pitch);
  if (keep === "before") {
    if (within <= ON_EDGE) return { size: q(tile), of: q(tile), full: true, gap: q(joint + within) };
    if (within >= tile - ON_EDGE) return { size: q(tile), of: q(tile), full: true, ...(within - tile > ON_EDGE ? { gap: q(within - tile) } : {}) };
    return { size: q(within), of: q(tile), full: false };
  }
  if (within <= ON_EDGE) return { size: q(tile), of: q(tile), full: true };
  if (within >= tile - ON_EDGE) return { size: q(tile), of: q(tile), full: true, gap: q(pitch - within) };
  return { size: q(tile - within), of: q(tile), full: false };
}

const qty = (field: string, v: Quantity | undefined) => input(field, v);

/** Derive the set-out of one wall side's tiling from the canonical model. */
export function tilingLayout(model: PlanModel, wall: Wall, side: WallSideName): TilingLayout {
  const t: WallTiling = wall.tiling?.[side] ?? {};
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  const inputs: FaceInput[] = [
    qty("tile length", t.tileLength),
    qty("tile width", t.tileWidth),
    qty("grout joint", t.joint),
    qty("origin along", t.originAlong),
    qty("origin up", t.originUp),
    qty("tiled height", t.tiledHeight),
  ];
  const missing = inputs.filter((i) => i.status === "unknown").map((i) => i.field);
  if (!t.orientation) missing.push("orientation (landscape or portrait)");
  if (!t.originFrom) missing.push("origin measured from (end A, end B or centre)");
  const faceOwn = t.reference ? resolveFace(wall.sides?.[side], t.reference) : undefined;
  const limits = { a: runLimit(model, wall, side, "a", t.reference), b: runLimit(model, wall, side, "b", t.reference) };
  const floor = floorReference(model, wall, side, t.floor);
  const limitMissing = [...limits.a.missing, ...limits.b.missing.filter((m) => !limits.a.missing.includes(m))];
  missing.push(...limitMissing.filter((m) => !missing.includes(m)), ...floor.missing);
  const problems: TilingLayout["problems"] = [];

  const out: TilingLayout = {
    wallId: wall.id, side, status: "proposed", inputs,
    choices: { orientation: t.orientation ?? null, reference: t.reference ?? null, floor: t.floor ?? null, originFrom: t.originFrom ?? null },
    missing, resolved: false, basis: "unknown",
    face: faceOwn ? { label: faceOwn.label, ...(faceOwn.resolved ? { offset: faceOwn.offset } : {}), resolved: faceOwn.resolved } : { label: "reference face not chosen", resolved: false },
    limits, floor, openings: [], pieces: [], problems,
  };

  for (const i of inputs) {
    if (i.value === null) continue;
    if (i.field !== "origin along" && i.field !== "origin up" && i.field !== "grout joint" && !(i.value > 0)) problems.push({ severity: "error", code: "tiling_nonpositive", message: `${i.field} must be greater than zero.` });
    if (i.field === "grout joint" && i.value < 0) problems.push({ severity: "error", code: "tiling_nonpositive", message: "grout joint cannot be negative." });
  }
  for (const l of [limits.a, limits.b]) if (l.skew) problems.push({ severity: "warning", code: "tiling_corner_not_square", message: `The return wall at end ${l.end.toUpperCase()} is not square to this wall; its cut is measured where its face crosses this wall's drawn line.` });

  // the tile on the wall, after orientation
  const L = t.tileLength?.value, W = t.tileWidth?.value;
  if (known(t.tileLength) && known(t.tileWidth) && t.orientation) {
    out.tile = t.orientation === "landscape" ? { along: L!, up: W! } : { along: W!, up: L! };
  }
  if (known(t.joint)) out.joint = t.joint.value;
  if (limits.a.resolved && limits.b.resolved) {
    out.run = q(limits.b.s! - limits.a.s!);
    if (out.run <= 0) problems.push({ severity: "error", code: "tiling_run_empty", message: `The limit faces at ends A and B leave no run (${mmText(out.run)}).` });
  }
  if (floor.resolved && known(t.tiledHeight)) {
    out.band = { z0: floor.level!, z1: q(floor.level! + t.tiledHeight.value) };
    if (out.band.z1 > wall.height + 1e-9) problems.push({ severity: "warning", code: "tiling_above_wall", message: `Tiled height reaches ${mmText(out.band.z1)} above the datum, over the ${mmText(wall.height)} wall.` });
  }
  if (out.tile && known(t.originAlong) && t.originFrom) {
    const from = t.originFrom;
    const ref = from === "a" ? limits.a : from === "b" ? limits.b : undefined;
    const base = from === "centre" ? (out.run !== undefined ? limits.a.s! + out.run / 2 : undefined) : ref!.resolved ? ref!.s! : undefined;
    if (base !== undefined) {
      const s = from === "b" ? base - t.originAlong.value - out.tile.along : base + t.originAlong.value;
      if (floor.resolved && known(t.originUp)) out.origin = { s: q(s), z: q(floor.level! + t.originUp.value) };
    }
  }
  if (problems.some((p) => p.severity === "error")) return out;
  if (!out.tile || out.joint === undefined || out.run === undefined || !out.band || !out.origin) {
    if (missing.length) problems.push({ severity: "warning", code: "tiling_unresolved", message: `Set-out has no cuts yet. Unknown: ${missing.join("; ")}.` });
    return out;
  }

  // ---- resolved: the grid ----
  const { along, up } = out.tile;
  const j = out.joint;
  const s0 = limits.a.s!, s1 = limits.b.s!;
  const { z0, z1 } = out.band;
  const o = out.origin;
  out.cuts = {
    a: edgeCut(o.s, along, j, s0, "after"),
    b: edgeCut(o.s, along, j, s1, "before"),
    bottom: edgeCut(o.z, up, j, z0, "after"),
    top: edgeCut(o.z, up, j, z1, "before"),
  };
  const pa = along + j, pu = up + j;
  const kA = Math.floor((s0 - o.s) / pa), kB = Math.ceil((s1 - o.s) / pa);
  const rA = Math.floor((z0 - o.z) / pu), rB = Math.ceil((z1 - o.z) / pu);

  // openings on this wall, in elevation; defaulted sizes are placeholders and are not cut to
  const holes: OpeningCuts[] = [];
  for (const op of model.openings.filter((x) => x.wallId === wall.id)) {
    const half = op.width / 2 / Math.max(len, 1e-9);
    const [t0, t1] = [op.t - half, op.t + half];
    const oc: OpeningCuts = { openingId: op.id, kind: op.kind, s0: q(t0 * len), s1: q(t1 * len), z0: q(op.sill), z1: q(op.sill + op.height) };
    if (oc.s1 <= s0 || oc.s0 >= s1 || oc.z1 <= z0 || oc.z0 >= z1) continue; // outside the tiled area
    const placeholder = [op.widthDefaulted && "width", op.kind === "window" && op.sillDefaulted && "sill", op.heightDefaulted && "height"].filter(Boolean);
    if (placeholder.length) {
      oc.unresolved = `${op.id} ${placeholder.join(", ")} ${placeholder.length === 1 ? "is a default placeholder" : "are default placeholders"}; enter the real size to cut around it`;
      missing.push(oc.unresolved);
    } else {
      if (oc.s0 > s0 + ON_EDGE) oc.jambA = edgeCut(o.s, along, j, oc.s0, "before");
      if (oc.s1 < s1 - ON_EDGE) oc.jambB = edgeCut(o.s, along, j, oc.s1, "after");
      if (oc.z0 > z0 + ON_EDGE) oc.sill = edgeCut(o.z, up, j, oc.z0, "before");
      if (oc.z1 < z1 - ON_EDGE) oc.head = edgeCut(o.z, up, j, oc.z1, "after");
    }
    holes.push(oc);
  }
  out.openings = holes;

  // pieces: each tile clipped to the band and run, minus openings
  let cols = 0;
  for (let k = kA; k <= kB; k++) {
    const a0 = Math.max(o.s + k * pa, s0), a1 = Math.min(o.s + k * pa + along, s1);
    if (a1 - a0 > ON_EDGE) cols++;
  }
  let rows = 0;
  for (let r = rA; r <= rB; r++) {
    const b0 = Math.max(o.z + r * pu, z0), b1 = Math.min(o.z + r * pu + up, z1);
    if (b1 - b0 > ON_EDGE) rows++;
  }
  out.columns = cols;
  out.rows = rows;
  for (let k = kA; k <= kB; k++) for (let r = rA; r <= rB; r++) {
    const ts0 = o.s + k * pa, tz0 = o.z + r * pu;
    let rects: TilePiece[] = [{ s0: Math.max(ts0, s0), s1: Math.min(ts0 + along, s1), z0: Math.max(tz0, z0), z1: Math.min(tz0 + up, z1), cut: false }];
    rects = rects.filter((p) => p.s1 - p.s0 > ON_EDGE && p.z1 - p.z0 > ON_EDGE);
    for (const h of holes) rects = rects.flatMap((p) => subtract(p, h));
    for (const p of rects) {
      const cut = p.s1 - p.s0 < along - ON_EDGE || p.z1 - p.z0 < up - ON_EDGE;
      out.pieces.push({ s0: q(p.s0), s1: q(p.s1), z0: q(p.z0), z1: q(p.z1), cut });
    }
  }
  out.missing = missing;
  out.resolved = missing.length === 0;
  const reached: FaceInput[] = [...inputs, { field: "limit A", value: s0, status: limits.a.basis as ValueStatus }, { field: "limit B", value: s1, status: limits.b.basis as ValueStatus }];
  if (floor.basis !== "datum") reached.push({ field: "floor reference", value: floor.level!, status: floor.basis as ValueStatus });
  out.basis = weakest(reached);
  if (!out.resolved) problems.push({ severity: "warning", code: "tiling_unresolved", message: `Set-out is incomplete. Unknown: ${missing.join("; ")}.` });
  return out;
}

/** A rectangle minus an opening: up to four rectangles. */
function subtract(p: TilePiece, h: { s0: number; s1: number; z0: number; z1: number; unresolved?: string }): TilePiece[] {
  if (h.s1 <= p.s0 || h.s0 >= p.s1 || h.z1 <= p.z0 || h.z0 >= p.z1) return [p];
  const out: TilePiece[] = [];
  if (h.s0 > p.s0) out.push({ ...p, s1: h.s0 });
  if (h.s1 < p.s1) out.push({ ...p, s0: h.s1 });
  const ms0 = Math.max(p.s0, h.s0), ms1 = Math.min(p.s1, h.s1);
  if (h.z0 > p.z0) out.push({ ...p, s0: ms0, s1: ms1, z1: h.z0 });
  if (h.z1 < p.z1) out.push({ ...p, s0: ms0, s1: ms1, z0: h.z1 });
  return out.filter((r) => r.s1 - r.s0 > ON_EDGE && r.z1 - r.z0 > ON_EDGE);
}

/** Problems with every recorded wall tiling, for get_issues. */
export function tilingProblems(model: PlanModel): { severity: "error" | "warning"; code: string; message: string; refs: string[] }[] {
  const out: { severity: "error" | "warning"; code: string; message: string; refs: string[] }[] = [];
  for (const w of model.walls) for (const side of ["left", "right"] as const) {
    if (!w.tiling?.[side]) continue;
    for (const p of tilingLayout(model, w, side).problems) out.push({ ...p, message: `Wall ${w.id} ${side} side tiling: ${p.message}`, refs: [w.id] });
  }
  return out;
}

export const isValueStatus = (v: unknown): v is ValueStatus => typeof v === "string" && (VALUE_STATUSES as string[]).includes(v);
export type { Pt };
