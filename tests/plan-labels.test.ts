import { describe, expect, it } from "vitest";
import type { Room, Wall } from "../src/model/types";
import {
  boxesOverlap,
  dimensionFontPx,
  dimensionInk,
  layoutRoomLabel,
  textWidthPx,
} from "../src/editor/planLabels";

const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({
  id, ax, ay, bx, by, thickness: 0.15, height: 2.7,
});

/** 2110 × 3020 mm bathroom, origin at the back-left corner. */
function bathroom(): { room: Room; walls: Wall[] } {
  const w = 2.11;
  const d = 3.02;
  return {
    room: { id: "room_bath", x: 0, y: 0, w, h: d, label: "Bathroom", floor: "tile" },
    walls: [
      wall("back", 0, 0, w, 0),
      wall("right", w, 0, w, d),
      wall("front", w, d, 0, d),
      wall("left", 0, d, 0, 0),
    ],
  };
}

function inside(inner: { x: number; y: number; w: number; h: number }, outer: { x: number; y: number; w: number; h: number }) {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 0.5);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y - 0.5);
  expect(inner.x + inner.w).toBeLessThanOrEqual(outer.x + outer.w + 0.5);
  expect(inner.y + inner.h).toBeLessThanOrEqual(outer.y + outer.h + 0.5);
}

describe("plan label fonts", () => {
  it("caps dimension text once the plan is zoomed in, and keeps a floor when zoomed out", () => {
    expect(dimensionFontPx(156.9)).toBe(18);
    expect(dimensionFontPx(95.4)).toBe(18);
    expect(dimensionFontPx(15)).toBe(9);
  });

  it("measures text without a canvas", () => {
    expect(textWidthPx("Bathroom", 10, "Inter, sans-serif")).toBeCloseTo("Bathroom".length * 10 * 0.56);
  });
});

describe("room labels", () => {
  it("keeps the bathroom name inside the room and clear of wall dimensions at auto-fit scale", () => {
    const { room, walls } = bathroom();
    const scale = 156.9;
    const label = layoutRoomLabel(room, walls, scale);
    expect(label.fontSize).toBeLessThanOrEqual(24);
    expect(label.fontSize).toBeGreaterThanOrEqual(10);
    const roomBox = { x: room.x * scale, y: room.y * scale, w: room.w * scale, h: room.h * scale };
    inside(label.box, roomBox);
    const dimFont = dimensionFontPx(scale);
    for (const next of walls) {
      const ink = dimensionInk(next, scale, dimFont);
      expect(ink).not.toBeNull();
      if (ink) expect(boxesOverlap(label.box, ink, 0)).toBe(false);
    }
  });

  it("stays inside a wide room and remains at least 10px when zoomed out", () => {
    const room: Room = { id: "room_loft", x: 0, y: 0, w: 8, h: 6, label: "Living", floor: "oak" };
    const walls = [
      wall("n", 0, 0, 8, 0),
      wall("e", 8, 0, 8, 6),
      wall("s", 8, 6, 0, 6),
      wall("w", 0, 6, 0, 0),
    ];
    const fitted = layoutRoomLabel(room, walls, 95.4);
    expect(fitted.fontSize).toBe(24);
    inside(fitted.box, { x: 0, y: 0, w: 8 * 95.4, h: 6 * 95.4 });

    const zoomedOut = layoutRoomLabel(room, walls, 15);
    expect(zoomedOut.fontSize).toBeGreaterThanOrEqual(10);
    inside(zoomedOut.box, { x: 0, y: 0, w: 8 * 15, h: 6 * 15 });
  });
});

import { labelFits } from "../src/editor/planLabels";
describe("fixture labels", () => {
  it("draws a name only where its footprint holds it", () => {
    expect(labelFits("Bath mixer", 400, 300, 12)).toBe(true);
    expect(labelFits("Bath mixer", 40, 300, 12)).toBe(false); // narrow wall fitting
    expect(labelFits("Bath mixer", 400, 8, 12)).toBe(false); // thin screen
  });
});
