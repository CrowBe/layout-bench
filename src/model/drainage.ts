/**
 * Drainage geometry (#7) — proposed wastes and sloped floor planes, and the floor heights they
 * imply. Levels are metres above the room's floor datum (see floor.ts), up positive.
 *
 * Heights are derived only from entered inputs. A plane resolves when it has
 *   - a waste level and a fall (rising away from the waste), or
 *   - a waste level and one control level (the fall is worked out from them), or
 *   - three non-collinear control levels.
 * Anything less is unresolved and names what is missing; no slope or level is assumed.
 */

import type { Drainage, FloorPlane, Opening, PlanModel, Room, ValueStatus, Waste, Wall } from "./types";
import { input, known, weakest, type FaceInput } from "./faces";
import { finishedLevel } from "./floor";
import { pointSegDist, quantize, type Pt } from "./geometry";

/** Levels closer than this are the same level (1 mm). */
export const LEVEL_TOL = 0.001;
const EPS = 1e-9;

export type SurfaceMethod = "fall" | "waste+control" | "controls";

export interface PlaneSurface {
  planeId: string;
  resolved: boolean;
  method?: SurfaceMethod;
  /** Rise per metre away from the waste; derived when not entered. */
  fall?: number;
  /** Rise per metre in x and y; the downhill direction is the negative of it. */
  gradient?: { x: number; y: number };
  /** Heights follow the distance to the waste, not a single tilted plane. */
  radial: boolean;
  basis: ValueStatus | "unknown";
  inputs: FaceInput[];
  missing: string[];
  /** Why a plane that has inputs still cannot be derived. */
  unsupported?: string;
  level: (x: number, y: number) => number | undefined;
}

export interface DrainProblem {
  severity: "error" | "warning";
  code: string;
  message: string;
}

const wasteDist = (w: Waste, p: Pt) => pointSegDist(p, { x: w.ax, y: w.ay }, { x: w.bx, y: w.by });
const wasteOf = (d: Drainage, plane: FloorPlane) => (plane.wasteId ? d.wastes.find((w) => w.id === plane.wasteId) : undefined);

/** Derive one plane's surface from its inputs. */
export function planeSurface(d: Drainage, plane: FloorPlane): PlaneSurface {
  const none = (inputs: FaceInput[], missing: string[], unsupported?: string, radial = false): PlaneSurface => ({
    planeId: plane.id, resolved: false, radial, basis: "unknown", inputs, missing, ...(unsupported ? { unsupported } : {}), level: () => undefined,
  });
  const controls = plane.controls.filter((c) => known(c.level));
  const waste = wasteOf(d, plane);

  if (plane.wasteId) {
    if (!waste) return none([], [`waste ${plane.wasteId}`], `Waste "${plane.wasteId}" does not exist.`, true);
    const wl = input(`${waste.label} level`, waste.level);
    const inputs: FaceInput[] = [wl];
    const missing: string[] = [];
    if (wl.status === "unknown") missing.push(wl.field);
    let fall: number | undefined;
    if (known(plane.fall)) {
      inputs.push(input("fall", plane.fall));
      fall = plane.fall.value;
    } else if (controls.length) {
      const c = controls[0];
      inputs.push(input(`${c.label} level`, c.level));
      const run = wasteDist(waste, c);
      if (wl.value !== null) {
        if (run < EPS) return none(inputs, missing, `${c.label} sits on the waste, so it gives no fall.`, true);
        fall = (c.level.value! - wl.value) / run;
      }
    } else {
      missing.push("fall or a control level");
    }
    if (missing.length || fall === undefined) return none(inputs, missing, undefined, true);
    const base = wl.value!;
    return {
      planeId: plane.id, resolved: true, method: known(plane.fall) ? "fall" : "waste+control", fall: quantize(fall), radial: true,
      basis: weakest(inputs), inputs, missing: [],
      level: (x, y) => quantize(base + fall! * wasteDist(waste, { x, y })),
    };
  }

  const inputs = controls.map((c) => input(`${c.label} level`, c.level));
  if (controls.length < 3) return none(inputs, [`${3 - controls.length} more control level${3 - controls.length === 1 ? "" : "s"} (or choose a waste)`]);
  const [a, b, c] = controls;
  const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(det) < 1e-6) return none(inputs, [], "The first three control levels are in a line, so they do not fix a plane.");
  const za = a.level.value!, zb = b.level.value!, zc = c.level.value!;
  const gx = ((zb - za) * (c.y - a.y) - (zc - za) * (b.y - a.y)) / det;
  const gy = ((zc - za) * (b.x - a.x) - (zb - za) * (c.x - a.x)) / det;
  return {
    planeId: plane.id, resolved: true, method: "controls", gradient: { x: gx, y: gy }, fall: Math.hypot(gx, gy), radial: false,
    basis: weakest(inputs.slice(0, 3)), inputs: inputs.slice(0, 3), missing: [],
    level: (x, y) => quantize(za + gx * (x - a.x) + gy * (y - a.y)),
  };
}

const inside = (p: FloorPlane, x: number, y: number) => x >= p.x - EPS && x <= p.x + p.w + EPS && y >= p.y - EPS && y <= p.y + p.h + EPS;

export interface HeightAt {
  x: number;
  y: number;
  planeId?: string;
  level?: number;
  basis: ValueStatus | "unknown";
  /** why there is no level */
  reason?: string;
}

/** The derived floor height at a plan point. */
export function heightAt(d: Drainage | undefined, x: number, y: number, surfaces?: Map<string, PlaneSurface>): HeightAt {
  const plane = d?.planes.find((p) => inside(p, x, y));
  if (!d || !plane) return { x, y, basis: "unknown", reason: "no floor plane covers this point" };
  const s = surfaces?.get(plane.id) ?? planeSurface(d, plane);
  if (!s.resolved) return { x, y, planeId: plane.id, basis: "unknown", reason: `plane "${plane.label}" is unresolved${s.missing.length ? ` (missing ${s.missing.join(", ")})` : ""}` };
  return { x, y, planeId: plane.id, level: s.level(x, y), basis: s.basis };
}

export const surfaces = (d: Drainage | undefined): Map<string, PlaneSurface> => new Map((d?.planes ?? []).map((p) => [p.id, planeSurface(d!, p)]));

/** Heights along a straight line across the plan, ends included. */
export function sectionAlong(d: Drainage | undefined, from: Pt, to: Pt, samples = 21): (HeightAt & { s: number })[] {
  const n = Math.max(2, Math.min(200, Math.floor(samples)));
  const map = surfaces(d);
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    return { s: quantize(len * t), ...heightAt(d, quantize(x), quantize(y), map) };
  });
}

/** Area of the room not covered by any plane, by coordinate compression. */
function uncoveredArea(room: Room, planes: FloorPlane[]): number {
  const xs = [room.x, room.x + room.w], ys = [room.y, room.y + room.h];
  for (const p of planes) { xs.push(p.x, p.x + p.w); ys.push(p.y, p.y + p.h); }
  const cx = [...new Set(xs.map((v) => Math.min(Math.max(v, room.x), room.x + room.w)))].sort((a, b) => a - b);
  const cy = [...new Set(ys.map((v) => Math.min(Math.max(v, room.y), room.y + room.h)))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i < cx.length - 1; i++) for (let j = 0; j < cy.length - 1; j++) {
    const mx = (cx[i] + cx[i + 1]) / 2, my = (cy[j] + cy[j + 1]) / 2;
    if (!planes.some((p) => inside(p, mx, my))) area += (cx[i + 1] - cx[i]) * (cy[j + 1] - cy[j]);
  }
  return area;
}

const overlapArea = (a: FloorPlane, b: FloorPlane) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** The shared edge of two touching rectangles, or null. */
function sharedEdge(a: FloorPlane, b: FloorPlane): [Pt, Pt] | null {
  const tol = 1e-6;
  const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
  const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
  if (Math.abs(a.x + a.w - b.x) < tol || Math.abs(b.x + b.w - a.x) < tol) {
    const x = Math.abs(a.x + a.w - b.x) < tol ? b.x : a.x;
    if (y1 - y0 > tol) return [{ x, y: y0 }, { x, y: y1 }];
  }
  if (Math.abs(a.y + a.h - b.y) < tol || Math.abs(b.y + b.h - a.y) < tol) {
    const y = Math.abs(a.y + a.h - b.y) < tol ? b.y : a.y;
    if (x1 - x0 > tol) return [{ x: x0, y }, { x: x1, y }];
  }
  return null;
}

const mm = (m: number) => `${Math.round(m * 10000) / 10} mm`;

/** Problems in one room's drainage: geometry, gaps, unknown or contradictory levels. */
export function drainageProblems(room: Room): DrainProblem[] {
  const d = room.drainage;
  if (!d) return [];
  const out: DrainProblem[] = [];
  const add = (severity: DrainProblem["severity"], code: string, message: string) => out.push({ severity, code, message });
  const map = surfaces(d);
  const rx1 = room.x + room.w, ry1 = room.y + room.h;
  const onRoom = (x: number, y: number) => x >= room.x - EPS && x <= rx1 + EPS && y >= room.y - EPS && y <= ry1 + EPS;

  for (const w of d.wastes) {
    if (!onRoom(w.ax, w.ay) || !onRoom(w.bx, w.by)) add("error", "waste_outside_room", `Waste "${w.label}" lies outside the room.`);
  }
  for (const p of d.planes) {
    if (p.x < room.x - EPS || p.y < room.y - EPS || p.x + p.w > rx1 + EPS || p.y + p.h > ry1 + EPS) {
      add("error", "floor_plane_outside_room", `Plane "${p.label}" extends outside the room.`);
    }
    for (const c of p.controls) {
      if (!inside(p, c.x, c.y)) add("error", "floor_control_outside_plane", `Control "${c.label}" on plane "${p.label}" lies outside that plane.`);
    }
    const s = map.get(p.id)!;
    if (!s.resolved) {
      add("warning", "floor_fall_unresolved", `Plane "${p.label}" has no derived heights: ${s.unsupported ?? `unknown ${s.missing.join(", ")}`}.`);
      continue;
    }
    if (s.radial && s.fall !== undefined && s.fall <= 0) {
      add("error", "floor_fall_not_toward_waste", `Plane "${p.label}" ${s.fall === 0 ? "is flat" : "falls away from"} its waste (fall ${mm(s.fall)} per m): water will not drain.`);
    }
    // every entered control must agree with the derived surface
    const checked = s.method === "controls" ? p.controls.filter((c) => known(c.level)).slice(3) : p.controls.filter((c) => known(c.level)).slice(s.method === "waste+control" ? 1 : 0);
    for (const c of checked) {
      const z = s.level(c.x, c.y)!;
      if (Math.abs(z - c.level.value!) > LEVEL_TOL) {
        add("error", "floor_levels_contradict", `Control "${c.label}" on plane "${p.label}" is ${mm(c.level.value!)} but the other inputs give ${mm(z)} there.`);
      }
    }
  }
  const lvls = d.planes.flatMap((p) => p.controls.filter((c) => known(c.level)).map((c) => ({ p, c })));
  for (let i = 0; i < lvls.length; i++) for (let j = i + 1; j < lvls.length; j++) {
    const a = lvls[i].c, b = lvls[j].c;
    if (Math.hypot(a.x - b.x, a.y - b.y) < LEVEL_TOL && Math.abs(a.level.value! - b.level.value!) > LEVEL_TOL) {
      add("error", "floor_levels_contradict", `Controls "${a.label}" and "${b.label}" are at the same point with levels ${mm(a.level.value!)} and ${mm(b.level.value!)}.`);
    }
  }
  for (let i = 0; i < d.planes.length; i++) for (let j = i + 1; j < d.planes.length; j++) {
    const a = d.planes[i], b = d.planes[j];
    if (overlapArea(a, b) > 1e-6) { add("error", "floor_plane_overlap", `Planes "${a.label}" and "${b.label}" overlap.`); continue; }
    const edge = sharedEdge(a, b);
    const sa = map.get(a.id)!, sb = map.get(b.id)!;
    if (edge && sa.resolved && sb.resolved) {
      const pts = [edge[0], { x: (edge[0].x + edge[1].x) / 2, y: (edge[0].y + edge[1].y) / 2 }, edge[1]];
      const step = Math.max(...pts.map((p) => Math.abs(sa.level(p.x, p.y)! - sb.level(p.x, p.y)!)));
      if (step > LEVEL_TOL) add("warning", "floor_plane_step", `Floor steps by up to ${mm(step)} where "${a.label}" meets "${b.label}".`);
    }
  }
  if (d.planes.length) {
    const gap = uncoveredArea(room, d.planes);
    if (gap > 1e-4) add("warning", "floor_plane_gap", `${Math.round(gap * 10000) / 10000} m² of the floor is not covered by any plane, so it has no derived height.`);
  }
  return out;
}

export interface Threshold {
  openingId: string;
  wallId: string;
  /** the plan point just inside the room, at the doorway */
  x: number;
  y: number;
  level?: number;
  basis: ValueStatus | "unknown";
  /** derived floor level minus the finished level of the build-up; absent unless both resolve */
  stepToFinished?: number;
  reason?: string;
}

/** Door thresholds on this room's boundary: the derived level beside the finished floor level. */
export function thresholds(model: PlanModel, room: Room): Threshold[] {
  const finished = finishedLevel(room.floorBuildUp);
  const map = surfaces(room.drainage);
  const out: Threshold[] = [];
  for (const o of model.openings as Opening[]) {
    if (o.kind !== "door") continue;
    const w = model.walls.find((x: Wall) => x.id === o.wallId);
    if (!w) continue;
    const px = w.ax + (w.bx - w.ax) * o.t, py = w.ay + (w.by - w.ay) * o.t;
    const x = Math.min(Math.max(px, room.x), room.x + room.w), y = Math.min(Math.max(py, room.y), room.y + room.h);
    if (Math.hypot(px - x, py - y) > w.thickness / 2 + 0.05) continue; // not on this room's boundary
    const h = heightAt(room.drainage, quantize(x), quantize(y), map);
    out.push({
      openingId: o.id, wallId: w.id, x: h.x, y: h.y, ...(h.level !== undefined ? { level: h.level } : {}), basis: h.basis,
      ...(h.level !== undefined && finished.resolved ? { stepToFinished: quantize(h.level - finished.top!) } : {}),
      ...(h.reason ? { reason: h.reason } : {}),
    });
  }
  return out;
}
