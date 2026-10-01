import { describe, expect, it } from "vitest";
import { outlinePolygon, outlineProblems, polygonsOverlap } from "../src/model/outline";
import { rectCorners, satRectRect, type ORect } from "../src/model/geometry";

describe("outlines (#37)", () => {
  it("clashes rectangles exactly as the old rectangle test did", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 400; i++) {
      const r = (): ORect => ({ cx: rnd() * 2, cy: rnd() * 2, hw: 0.1 + rnd() * 0.6, hd: 0.1 + rnd() * 0.6, rot: rnd() * Math.PI });
      const a = r(), b = r();
      for (const eps of [1e-9, 0.01, 0.02]) expect(polygonsOverlap(rectCorners(a), rectCorners(b), eps)).toBe(satRectRect(a, b, eps));
    }
  });

  it("samples an arc through its via point, the short way", () => {
    const o = { start: { x: -0.5, y: -0.5 }, segments: [{ to: { x: 0.5, y: -0.5 } }, { to: { x: -0.5, y: 0.5 }, via: { x: 0.2, y: 0.2 } }] };
    const pts = outlinePolygon(o);
    expect(pts.length).toBeGreaterThan(20);
    expect(pts.every((p) => p.x >= -0.5 - 1e-9 && p.y >= -0.5 - 1e-9)).toBe(true); // never swings behind the corner
    expect(pts.some((p) => Math.hypot(p.x - 0.2, p.y - 0.2) < 0.02)).toBe(true);
  });

  it("refuses an outline outside its box or off its back edge", () => {
    const inBox = { start: { x: -0.5, y: -0.5 }, segments: [{ to: { x: 0.5, y: -0.5 } }, { to: { x: 0, y: 0.5 } }] };
    expect(outlineProblems(inBox, 1, 1)).toEqual([]);
    expect(outlineProblems(inBox, 0.8, 1).join()).toMatch(/leaves its 800 × 1000 mm box/);
    const floating = { start: { x: -0.5, y: -0.4 }, segments: [{ to: { x: 0.5, y: -0.4 } }, { to: { x: 0, y: 0.5 } }] };
    expect(outlineProblems(floating, 1, 1).join()).toMatch(/back must touch/);
  });
});
