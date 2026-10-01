/**
 * Fixtures set out from wall faces (#5). A fixture anchored to a face takes its position from
 * that face, and its service points are measured from faces too, so every rough-in figure can
 * be read against the frame, the fixed board and the finished tile. Nothing here fills in an
 * unknown: an unresolved face or value leaves the result unresolved and says what is missing.
 */

import type { FixtureAnchor, Item, PlanModel, ServicePoint, ValueStatus, Wall, WallSideName } from "./types";
import { catalogByKind } from "./catalog";
import { quantize, segLen, type ORect, type Pt } from "./geometry";
import { VALUE_STATUSES, layerLabel, resolveFace, sideFaces, sideNormal, wallBody } from "./faces";

const dirOf = (w: Wall): Pt => {
  const len = segLen(w.ax, w.ay, w.bx, w.by) || 1;
  return { x: (w.bx - w.ax) / len, y: (w.by - w.ay) / len };
};

/** Rotation (degrees CCW, the place_item convention) that makes a piece face direction n. */
export const facingRotation = (n: Pt): number => {
  const deg = (Math.atan2(n.x, n.y) * 180) / Math.PI;
  return quantize(((deg % 360) + 360) % 360);
};

export interface AnchorPose {
  resolved: boolean;
  x?: number;
  y?: number;
  rotation?: number;
  /** distance from wall end A to the fixture centreline */
  alongFromA?: number;
  /** offset of the fixture back from the drawn line, toward the side */
  backOffset?: number;
  missing: string[];
}

/** Where an anchored fixture sits, from its wall, face, gap and distance. */
export function anchorPose(model: PlanModel, item: Item): AnchorPose {
  const a = item.anchor;
  if (!a) return { resolved: false, missing: ["anchor"] };
  const wall = model.walls.find((w) => w.id === a.wallId);
  if (!wall) return { resolved: false, missing: [`wall ${a.wallId}`] };
  const face = resolveFace(wall.sides?.[a.side], a.face);
  const cat = catalogByKind(item.kind);
  const missing = [...face.missing, ...(cat ? [] : [`footprint of kind ${item.kind}`])];
  if (!face.resolved || !cat) return { resolved: false, missing };
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  // a wall shortened after set-out can leave the fixture beyond its end: do not place it in mid-air
  if (a.distance > len + 1e-9) return { resolved: false, missing: [`anchor distance ${Math.round(a.distance * 1000)} mm, beyond the ${Math.round(len * 1000)} mm wall`] };
  const alongFromA = a.from === "b" ? len - a.distance : a.distance;
  const d = dirOf(wall);
  const n = sideNormal(wall, a.side);
  const backOffset = face.offset! + a.gap;
  const centre = backOffset + cat.d / 2;
  return {
    resolved: true,
    x: quantize(wall.ax + d.x * alongFromA + n.x * centre),
    y: quantize(wall.ay + d.y * alongFromA + n.y * centre),
    rotation: facingRotation(n),
    alongFromA: quantize(alongFromA),
    backOffset: quantize(backOffset),
    missing: [],
  };
}

/** Re-derive every anchored fixture. Returns the same model when nothing moved. */
export function applyAnchors(model: PlanModel): PlanModel {
  let changed = false;
  const items = model.items.map((it) => {
    if (!it.anchor) return it;
    const pose = anchorPose(model, it);
    if (!pose.resolved || (it.x === pose.x && it.y === pose.y && it.rotation === pose.rotation)) return it;
    changed = true;
    return { ...it, x: pose.x!, y: pose.y!, rotation: pose.rotation! };
  });
  return changed ? { ...model, items } : model;
}

/** A face offset of one side, by name, or unresolved. */
function faceOffset(wall: Wall, side: WallSideName, face: string) {
  return resolveFace(wall.sides?.[side], face);
}

export interface FaceDistance {
  face: string;
  label: string;
  resolved: boolean;
  /** distance from this face to the point, toward the room */
  value?: number;
  max?: number;
  missing: string[];
}

export interface RoughInReading {
  pointId: string;
  label: string;
  service: ServicePoint["service"];
  status: ValueStatus;
  source?: string;
  /** what the point was entered against */
  entered: { face: string; out?: number; outMax?: number; across?: number; up?: number };
  resolved: boolean;
  missing: string[];
  /** distance out from every face of the anchor wall side */
  fromFaces: FaceDistance[];
  alongFromA?: number;
  alongFromB?: number;
  /** above the finished floor, as entered: floor levels arrive with #6 */
  up?: number;
  x?: number;
  y?: number;
}

/** Read one fixture's service points against every face of the wall side it is anchored to. */
export function roughIn(model: PlanModel, item: Item): RoughInReading[] {
  const a = item.anchor;
  const wall = a ? model.walls.find((w) => w.id === a.wallId) : undefined;
  const pose = anchorPose(model, item);
  return (item.servicePoints ?? []).map((sp) => {
    const missing: string[] = [];
    if (!a) missing.push("fixture anchor (place it against a wall face)");
    else if (!pose.resolved) missing.push(...pose.missing.map((m) => `anchor: ${m}`));
    if (sp.out === undefined) missing.push("out distance");
    if (sp.across === undefined) missing.push("across offset");
    const base: RoughInReading = {
      pointId: sp.id, label: sp.label, service: sp.service, status: sp.status, ...(sp.source ? { source: sp.source } : {}),
      entered: {
        face: sp.face,
        ...(sp.out !== undefined ? { out: sp.out } : {}), ...(sp.outMax !== undefined ? { outMax: sp.outMax } : {}),
        ...(sp.across !== undefined ? { across: sp.across } : {}), ...(sp.up !== undefined ? { up: sp.up } : {}),
      },
      resolved: false, missing, fromFaces: [], ...(sp.up !== undefined ? { up: sp.up } : {}),
    };
    if (!a || !wall) return base;
    const ref = faceOffset(wall, a.side, sp.face);
    if (!ref.resolved) missing.push(...ref.missing.map((m) => `${sp.face} face: ${m}`));
    const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
    const outAt = ref.resolved && sp.out !== undefined ? ref.offset! + sp.out : undefined;
    const outMaxAt = ref.resolved && sp.outMax !== undefined ? ref.offset! + sp.outMax : undefined;
    const faces = sideFaces(wall.sides?.[a.side]);
    const named = [
      { face: "existing", f: faces[0] },
      { face: "frame", f: faces[1] },
      { face: "board", f: resolveFace(wall.sides?.[a.side], "board") },
      { face: "finished", f: resolveFace(wall.sides?.[a.side], "finished") },
    ];
    base.fromFaces = named.map(({ face, f }) => {
      const m = [...f.missing, ...(outAt === undefined ? ["point position"] : [])];
      return {
        face,
        label: f.label,
        resolved: f.resolved && outAt !== undefined,
        ...(f.resolved && outAt !== undefined ? { value: quantize(outAt - f.offset!) } : {}),
        ...(f.resolved && outMaxAt !== undefined ? { max: quantize(outMaxAt - f.offset!) } : {}),
        missing: f.resolved && outAt !== undefined ? [] : m,
      };
    });
    if (pose.resolved && sp.across !== undefined) {
      // across is measured facing the fixture, left negative; facing it, right runs along the
      // wall from A to B on the right side, and from B to A on the left side
      const alongFromA = pose.alongFromA! + (a.side === "right" ? sp.across : -sp.across);
      base.alongFromA = quantize(alongFromA);
      base.alongFromB = quantize(len - alongFromA);
      if (outAt !== undefined) {
        const d = dirOf(wall);
        const n = sideNormal(wall, a.side);
        base.x = quantize(wall.ax + d.x * alongFromA + n.x * outAt);
        base.y = quantize(wall.ay + d.y * alongFromA + n.y * outAt);
      }
    }
    base.resolved = missing.length === 0;
    return base;
  });
}

/**
 * What a wall occupies across its thickness, for clash checks: the 3D body plus any resolved
 * build-up, in the wall's local frame (+ toward the right side).
 */
export function wallOccupied(wall: Wall): { zMin: number; zMax: number } {
  const body = wallBody(wall);
  let zMin = body.z - body.depth / 2;
  let zMax = body.z + body.depth / 2;
  const right = resolveFace(wall.sides?.right, "finished");
  const left = resolveFace(wall.sides?.left, "finished");
  if (right.resolved) zMax = Math.max(zMax, right.offset!);
  if (left.resolved) zMin = Math.min(zMin, -left.offset!);
  return { zMin, zMax };
}

/** The occupied wall as an oriented rectangle. */
export function wallOccupiedRect(wall: Wall): ORect {
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  const { zMin, zMax } = wallOccupied(wall);
  const n = sideNormal(wall, "right");
  const mid = (zMin + zMax) / 2;
  return {
    cx: (wall.ax + wall.bx) / 2 + n.x * mid,
    cy: (wall.ay + wall.by) / 2 + n.y * mid,
    hw: len / 2,
    hd: (zMax - zMin) / 2,
    rot: Math.atan2(wall.by - wall.ay, wall.bx - wall.ax),
  };
}

export interface Clearance {
  direction: "left" | "right" | "front";
  /** metres to the nearest wall surface, null when nothing is hit within 10 m */
  distance: number | null;
  wallId?: string;
  /** which surface was hit: the finished face when recorded, else the wall body */
  surface?: string;
}

/**
 * Clear space beside and in front of an anchored fixture, to the nearest wall surface: its
 * finished face when that is resolved, otherwise the modelled wall body.
 */
export function clearances(model: PlanModel, item: Item): Clearance[] {
  const pose = anchorPose(model, item);
  const a = item.anchor;
  const cat = catalogByKind(item.kind);
  const wall = a ? model.walls.find((w) => w.id === a.wallId) : undefined;
  if (!pose.resolved || !a || !cat || !wall) return [];
  const d = dirOf(wall);
  const n = sideNormal(wall, a.side);
  // facing the fixture, its right runs along +d on the right side, -d on the left side
  const right = a.side === "right" ? d : { x: -d.x, y: -d.y };
  const centre = { x: pose.x!, y: pose.y! };
  const rays: { direction: Clearance["direction"]; o: Pt; u: Pt }[] = [
    { direction: "left", o: { x: centre.x - right.x * cat.w / 2, y: centre.y - right.y * cat.w / 2 }, u: { x: -right.x, y: -right.y } },
    { direction: "right", o: { x: centre.x + right.x * cat.w / 2, y: centre.y + right.y * cat.w / 2 }, u: right },
    { direction: "front", o: { x: centre.x + n.x * cat.d / 2, y: centre.y + n.y * cat.d / 2 }, u: n },
  ];
  return rays.map(({ direction, o, u }) => {
    let best: Clearance = { direction, distance: null };
    for (const w of model.walls) {
      if (w.id === wall.id && direction === "front") continue;
      const nw = sideNormal(w, "right");
      const dn = u.x * nw.x + u.y * nw.y;
      if (Math.abs(dn) < 0.5) continue; // running along this wall, not toward its face
      const { zMin, zMax } = wallOccupied(w);
      const s0 = (o.x - w.ax) * nw.x + (o.y - w.ay) * nw.y;
      // flush with a face, within the 0.1 mm storage precision, counts as touching it
      const TOL = 2e-4;
      if (s0 > zMin + TOL && s0 < zMax - TOL) continue; // starts inside this wall
      const plane = s0 >= (zMin + zMax) / 2 ? zMax : zMin;
      const t = (plane - s0) / dn;
      if (!(t >= -TOL) || t > 10) continue;
      const hit = { x: o.x + u.x * t, y: o.y + u.y * t };
      const wd = dirOf(w);
      const along = (hit.x - w.ax) * wd.x + (hit.y - w.ay) * wd.y;
      const wlen = segLen(w.ax, w.ay, w.bx, w.by);
      if (along < -0.2 || along > wlen + 0.2) continue;
      if (best.distance === null || t < best.distance) {
        const side: WallSideName = plane === zMax ? "right" : "left";
        const finished = resolveFace(w.sides?.[side], "finished");
        best = { direction, distance: quantize(Math.max(0, t)), wallId: w.id, surface: finished.resolved ? "finished face" : "wall body" };
      }
    }
    return best;
  });
}

/** Problems with anchors and service points, for get_issues. */
export function fixtureProblems(model: PlanModel): { severity: "error" | "warning"; code: string; message: string; refs: string[] }[] {
  const out: { severity: "error" | "warning"; code: string; message: string; refs: string[] }[] = [];
  for (const it of model.items) {
    const label = catalogByKind(it.kind)?.label ?? it.kind;
    if (it.anchor) {
      const pose = anchorPose(model, it);
      const wall = model.walls.find((w) => w.id === it.anchor!.wallId);
      if (!wall) {
        out.push({ severity: "error", code: "fixture_anchor_wall_missing", message: `${label} is set out from wall ${it.anchor.wallId}, which no longer exists.`, refs: [it.id] });
      } else if (it.anchor.distance > segLen(wall.ax, wall.ay, wall.bx, wall.by) + 1e-9) {
        out.push({ severity: "error", code: "fixture_anchor_off_wall", message: `${label} is set out ${Math.round(it.anchor.distance * 1000)} mm from end ${it.anchor.from.toUpperCase()} of ${wall.id}, which is now only ${Math.round(segLen(wall.ax, wall.ay, wall.bx, wall.by) * 1000)} mm long. Re-enter its set-out.`, refs: [it.id, wall.id] });
      } else if (!pose.resolved) {
        out.push({ severity: "warning", code: "fixture_anchor_unresolved", message: `${label}'s position is unresolved: missing ${pose.missing.join(", ")}. It stays where it was until they are entered.`, refs: [it.id, it.anchor.wallId] });
      }
    }
    for (const r of roughIn(model, it)) {
      if (!r.resolved) out.push({ severity: "warning", code: "service_point_unresolved", message: `${label} ${r.label}: missing ${r.missing.join(", ")}.`, refs: [it.id] });
    }
  }
  return out;
}

export const ANCHOR_STATUSES = VALUE_STATUSES;
export const faceChoices = (wall: Wall, side: WallSideName): { face: string; label: string }[] => [
  { face: "existing", label: "Existing surface" },
  { face: "frame", label: "Frame face" },
  { face: "board", label: "Board face" },
  { face: "finished", label: "Finished face" },
  ...(wall.sides?.[side]?.layers ?? []).map((l) => ({ face: l.id, label: `${layerLabel(l)} face` })),
];

export type { FixtureAnchor };
