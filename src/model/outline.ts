/**
 * Fixture plan outlines (#37). A kind can carry an outline: a start point and segments that
 * are straight or arcs through a named point, in the piece's own frame (x across its width,
 * y from its back at -d/2 to its front at +d/2), inside its w × d box. One sampled polygon then
 * drives the plan, the sheet, 3D, clash checks, clearances and face measurements, so a curved
 * bath is the same shape everywhere. A kind without an outline is its w × d rectangle.
 */

import type { CatalogEntry } from "./catalog";
import { catalogByKind } from "./catalog";
import type { Pt } from "./geometry";

export interface OutlineSegment {
  to: Pt;
  /** an arc from the previous point to `to`, passing through `via`; straight when absent */
  via?: Pt;
}

export interface Outline {
  start: Pt;
  /** the outline closes back to `start` after the last segment */
  segments: OutlineSegment[];
}

const ARC_STEPS = 24;

/** The circle through three points, or null when they are (nearly) in a line. */
function circleThrough(a: Pt, b: Pt, c: Pt): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) };
}

/** Points along the arc from p0 through via to p1, excluding p0, including p1. */
function arcPoints(p0: Pt, via: Pt, p1: Pt): Pt[] {
  const c = circleThrough(p0, via, p1);
  if (!c) return [p1];
  const ang = (p: Pt) => Math.atan2(p.y - c.cy, p.x - c.cx);
  const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const a0 = ang(p0);
  const sweepCcw = norm(ang(p1) - a0);
  // go the way that passes through `via`
  const sweep = norm(ang(via) - a0) <= sweepCcw ? sweepCcw : sweepCcw - 2 * Math.PI;
  const out: Pt[] = [];
  for (let i = 1; i <= ARC_STEPS; i++) {
    const a = a0 + (sweep * i) / ARC_STEPS;
    out.push(i === ARC_STEPS ? p1 : { x: c.cx + c.r * Math.cos(a), y: c.cy + c.r * Math.sin(a) });
  }
  return out;
}

/** The outline as a closed polygon (no repeated closing point), in the piece's frame. */
export function outlinePolygon(o: Outline): Pt[] {
  const pts: Pt[] = [o.start];
  let prev = o.start;
  for (const s of o.segments) {
    pts.push(...(s.via ? arcPoints(prev, s.via, s.to) : [s.to]));
    prev = s.to;
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(last.x - o.start.x, last.y - o.start.y) < 1e-9) pts.pop();
  return pts;
}

/** The footprint polygon of a kind in its own frame: its outline, or its w × d rectangle. */
export function kindPolygon(entry: Pick<CatalogEntry, "w" | "d"> & { outline?: Outline }): Pt[] {
  if (entry.outline) return outlinePolygon(entry.outline);
  const hw = entry.w / 2, hd = entry.d / 2;
  return [{ x: -hw, y: -hd }, { x: hw, y: -hd }, { x: hw, y: hd }, { x: -hw, y: hd }];
}

/** Local → plan, with the same rotation convention as the rest of the plan (rotation CCW, facing +y at 0). */
export function toWorld(local: Pt[], item: { x: number; y: number; rotation: number }): Pt[] {
  const rot = (-item.rotation * Math.PI) / 180;
  const c = Math.cos(rot), s = Math.sin(rot);
  return local.map((p) => ({ x: item.x + p.x * c - p.y * s, y: item.y + p.x * s + p.y * c }));
}

/** An item's footprint on the plan, or null for an unknown kind. */
export function itemPolygon(item: { kind: string; x: number; y: number; rotation: number }): Pt[] | null {
  const cat = catalogByKind(item.kind);
  return cat ? toWorld(kindPolygon(cat), item) : null;
}

/** Convex hull (monotone chain), counter-clockwise. */
export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length <= 2) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: Pt[] = [];
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Separating-axis test for two polygons (their convex hulls). They overlap only if they
 * overlap by more than `eps` on every axis, so touching, or leaning up to eps, is not a clash.
 */
export function polygonsOverlap(a: Pt[], b: Pt[], eps = 1e-9): boolean {
  const ha = convexHull(a), hb = convexHull(b);
  for (const poly of [ha, hb]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ax = { x: -(q.y - p.y), y: q.x - p.x };
      const len = Math.hypot(ax.x, ax.y);
      if (len < 1e-12) continue;
      const u = { x: ax.x / len, y: ax.y / len };
      const proj = (pts: Pt[]) => {
        let min = Infinity, max = -Infinity;
        for (const v of pts) { const d = v.x * u.x + v.y * u.y; if (d < min) min = d; if (d > max) max = d; }
        return [min, max];
      };
      const [amin, amax] = proj(ha), [bmin, bmax] = proj(hb);
      if (Math.min(amax, bmax) - Math.max(amin, bmin) <= eps) return false;
    }
  }
  return true;
}

/** The point of a polygon furthest along a direction. */
export function support(poly: Pt[], u: Pt): Pt {
  return poly.reduce((best, p) => (p.x * u.x + p.y * u.y > best.x * u.x + best.y * u.y ? p : best));
}

/** Problems with an outline for a w × d piece; empty when it is usable. */
export function outlineProblems(o: Outline, w: number, d: number): string[] {
  const out: string[] = [];
  if (!o || typeof o !== "object" || !o.start || !Array.isArray(o.segments)) return ["outline needs a start point and segments"];
  const finite = (p: Pt) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
  if (!finite(o.start) || !o.segments.every((s) => s && finite(s.to) && (s.via === undefined || finite(s.via)))) return ["every outline point needs finite x and y (metres)"];
  if (o.segments.length < 2) out.push("an outline needs at least two segments plus the closing edge");
  const pts = outlinePolygon(o);
  const tol = 0.001;
  if (pts.some((p) => Math.abs(p.x) > w / 2 + tol || Math.abs(p.y) > d / 2 + tol)) out.push(`the outline leaves its ${Math.round(w * 1000)} × ${Math.round(d * 1000)} mm box (x within ±w/2, y within ±d/2)`);
  if (Math.min(...pts.map((p) => p.y)) > -d / 2 + tol) out.push("the outline's back must touch the back of its box (y = -d/2), so set-out from a wall face is exact");
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p.x * q.y - q.x * p.y; }
  if (Math.abs(area) / 2 < 1e-4) out.push("the outline encloses no area");
  return out;
}

/** The furthest extents of an outline from its box's back-left and back-right corners, in metres. */
export function outlineExtents(o: Outline): { minX: number; maxX: number; minY: number; maxY: number } {
  const pts = outlinePolygon(o);
  return {
    minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)),
  };
}
