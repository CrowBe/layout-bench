import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { emptyModel } from "../src/model/types";
import { floorTileLayout } from "../src/model/floorTiling";
import {
  renderFloorTilingSheet,
  floorTilingPrintHtml,
} from "../src/sheets/floorTiling";
import { demoProject, parseImport } from "../src/model/projects";
const P = (value: number) => ({ value, status: "proposed" as const });
const model = () => store.getState().model;
const room = () => model().rooms[0];
const layout = () => floorTileLayout(model(), room());
const ids: Record<string, string> = {};
beforeEach(() => store.setState({ model: emptyModel(), undoStack: [] }));
function setup() {
  for (const [name, ax, ay, bx, by] of [
    ["north", 0, 0, 2.11, 0],
    ["east", 2.11, 0, 2.11, 3.02],
    ["south", 2.11, 3.02, 0, 3.02],
    ["west", 0, 3.02, 0, 0],
  ] as const) {
    ids[name] = actions.addWall(ax, ay, bx, by, 0.1, 2.4).id as string;
    actions.setWallSide(ids[name], "right", {
      frame: { value: 0, status: "measured" },
      layers: [
        { kind: "board", thickness: P(0.01) },
        { kind: "tile", thickness: P(0.015) },
      ],
    });
  }
  actions.addRoom(0, 0, 2.11, 3.02, "Bathroom", "tile");
}
function pattern() {
  return actions.setFloorTiling("Bathroom", {
    tileLength: P(0.6),
    tileWidth: P(0.3),
    joint: P(0.002),
    axis: "x",
    zone: "room",
    originX: P(0),
    originY: P(0),
  });
}
function drainage() {
  actions.setRoomDrainage("Bathroom", {
    wastes: [
      {
        id: "w",
        kind: "linear",
        label: "Channel",
        x: 0.1,
        y: 0.1,
        x2: 1.9,
        y2: 0.1,
        level: P(0),
      },
    ],
    planes: [
      {
        id: "shower",
        label: "Shower",
        x: 0,
        y: 0,
        w: 2.11,
        h: 1,
        waste: "w",
        fall: P(0.01),
      },
      {
        id: "main",
        label: "Main",
        x: 0,
        y: 1,
        w: 2.11,
        h: 2.02,
        waste: "w",
        fall: P(0.01),
      },
    ],
  });
}
describe("proposed floor tile set-out", () => {
  it("clips pieces at finished faces and recalculates visible and exported cuts after 10 mm shift", () => {
    setup();
    expect(pattern().ok).toBe(true);
    const b = layout();
    expect(b.bounds).toEqual({ x0: 0.025, x1: 2.085, y0: 0.025, y1: 2.995 });
    expect(b.cuts?.east.size).toBe(0.254);
    expect(b.cuts?.west.size).toBe(0.6);
    expect(
      b.pieces.every(
        (p) => p.x0 >= 0.025 && p.x1 <= 2.085 && p.y0 >= 0.025 && p.y1 <= 2.995,
      ),
    ).toBe(true);
    const before = renderFloorTilingSheet(model(), room());
    actions.setFloorTiling("Bathroom", { originX: P(0.01) });
    const after = layout();
    expect(after.origin?.x).toBe(0.035);
    expect(after.cuts?.west.size).toBe(0.008);
    expect(after.cuts?.east.size).toBe(0.244);
    expect(after.problems.some((p) => p.code === "floor_tiling_sliver")).toBe(
      true,
    );
    expect(renderFloorTilingSheet(model(), room())).not.toBe(before);
    expect(renderFloorTilingSheet(model(), room())).toContain("west cut: 8");
    expect(after.resolved).toBe(false);
    expect(after.missing).toContain(
      "drain position not recorded; waste cuts unresolved",
    );
  });
  it.each([
    { origin: 0, start: 0.025, end: 0.425, first: 0.4, last: 0.4, gap: undefined },
    { origin: -0.05, start: 0.025, end: 0.425, first: 0.4, last: 0.4, gap: undefined },
    {
      origin: 0.01,
      start: 0.025,
      end: 0.425,
      first: 0.008,
      last: 0.39,
      gap: undefined,
    },
    { origin: 0, start: 0.626, end: 0.827, first: 0.2, last: 0.2, gap: 0.001 },
    { origin: 0, start: 0.225, end: 0.626, first: 0.4, last: 0.4, gap: undefined },
    { origin: 0, start: 0.626, end: 0.6265, first: 0, last: 0, gap: 0.0005 },
  ])(
    "clips both perimeter ends to the bounded tile pieces: $origin / $start–$end",
    ({ origin, start, end, first, last, gap }) => {
      setup();
      pattern();
      actions.setRoomDrainage("Bathroom", {
        planes: [
          {
            id: "small",
            label: "Narrow zone",
            x: start,
            y: start,
            w: end - start,
            h: end - start,
          },
        ],
      });
      actions.setFloorTiling("Bathroom", {
        tileLength: P(0.6),
        tileWidth: P(0.6),
        zone: "small",
        originX: P(origin),
        originY: P(origin),
      });
      const l = layout();
      expect(l.cuts?.west).toMatchObject({ size: first, full: false });
      expect(l.cuts?.north).toMatchObject({ size: first, full: false });
      expect(l.cuts?.east).toMatchObject({ size: last, full: false });
      expect(l.cuts?.south).toMatchObject({ size: last, full: false });
      expect(l.cuts?.north.gap).toBe(gap);
      if (first > 0) {
        expect(l.pieces[0].y1 - l.pieces[0].y0).toBeCloseTo(first, 5);
        expect(l.pieces.at(-1)!.y1 - l.pieces.at(-1)!.y0).toBeCloseTo(last, 5);
      } else expect(l.pieces).toEqual([]);
      expect(renderFloorTilingSheet(model(), room())).toContain(
        `north cut: ${first * 1000}`,
      );
    },
  );

  it("follows build-up changes, withholds grid for missing, ambiguous and skew faces", () => {
    setup();
    pattern();
    actions.setWallSide(ids.west, "right", { frame: P(0.005) });
    expect(layout().bounds?.x0).toBe(0.03);
    expect(layout().cuts?.east.size).toBe(0.249);
    actions.setWallSide(ids.west, "right", { frame: null });
    expect(layout().cuts).toBeUndefined();
    expect(layout().missing.join()).toContain("frame face position");
    actions.setWallSide(ids.west, "right", { frame: P(0) });
    actions.addWall(0, 0, 0, 3.02, 0.1, 2.4);
    expect(layout().missing.join()).toContain("more than one wall");
    const clean = model()
      .walls.filter((w) => w.id !== model().walls.at(-1)!.id)
      .map((w) => (w.id === ids.west ? { ...w, bx: 0.01 } : w));
    store.setState({ model: { ...model(), walls: clean } });
    expect(layout().missing.join()).toContain("skew wall");
    expect(layout().pieces).toEqual([]);
  });
  it("shows canonical waste and floor boundaries and flags crossing pieces; recalculates moved waste", () => {
    setup();
    pattern();
    drainage();
    let l = layout();
    expect(l.planes).toHaveLength(2);
    expect(l.problems.some((p) => p.code === "floor_tiling_slope_break")).toBe(
      true,
    );
    expect(l.missing.join()).toContain("aperture");
    const rel = l.wastes[0].relation;
    actions.setRoomDrainage("Bathroom", {
      wastes: [
        {
          id: "w",
          kind: "linear",
          x: 0.2,
          y: 0.1,
          x2: 1.9,
          y2: 0.1,
          level: P(0),
        },
      ],
    });
    l = layout();
    expect(l.wastes[0].relation).not.toBe(rel);
    const svg = renderFloorTilingSheet(model(), room());
    expect(svg).toContain('data-waste="w"');
    expect(svg).toContain('data-plane="shower"');
    actions.setFloorTiling("Bathroom", { zone: "shower", axis: "y" });
    expect(layout().bounds?.y1).toBe(1);
    expect(layout().tile).toEqual({ x: 0.3, y: 0.6 });
    actions.setRoomDrainage("Bathroom", { planes: [] });
    expect(layout().missing.join()).toContain("no longer exists");
    expect(layout().cuts).toBeUndefined();
  });
  it("shows doorway transitions and preserves unresolved placeholder widths", () => {
    setup();
    pattern();
    const d = actions.addOpening(
      "door",
      ids.south,
      { t: 0.5 },
      { width: 0.8, height: 2 },
    ).id as string;
    expect(layout().doors[0]).toMatchObject({ id: d, unresolved: false });
    expect(renderFloorTilingSheet(model(), room())).toContain(
      `data-door="${d}"`,
    );
    store.setState({
      model: {
        ...model(),
        openings: model().openings.map((o) => ({ ...o, widthDefaulted: true })),
      },
    });
    expect(layout().missing.join()).toContain("real clear width unresolved");
  });
  it("prints every unresolved note on distinct A3 pages and escapes field text", () => {
    setup();
    pattern();
    store.setState({
      model: {
        ...model(),
        rooms: [
          {
            ...room(),
            floorTiling: {
              ...room().floorTiling,
              note:
                "<script>unsafe</script> " + "long field note ".repeat(1000),
            },
          },
        ],
      },
    });
    const svg = renderFloorTilingSheet(model(), room());
    expect(svg).toContain("&lt;script&gt;");
    const html = floorTilingPrintHtml(svg);
    const height = Number(svg.match(/height="(\d+)mm"/)![1]);
    expect(height).toBeGreaterThan(297);
    expect((html.match(/class="sheet"/g) ?? []).length).toBe(height / 297);
    expect(html).toContain('viewBox="0 297 420 297"');
    expect(html).not.toContain("<script>");
  });

  it("bounds tiny grid density, rejects invalid inputs atomically, supports undo and import", () => {
    setup();
    pattern();
    const b = structuredClone(model());
    expect(
      actions.setFloorTiling("Bathroom", {
        originX: P(1),
        tileWidth: { value: 0.1 },
      }).ok,
    ).toBe(false);
    expect(model()).toEqual(b);
    expect(
      actions.setFloorTiling("Bathroom", { tileWidth: P(0), joint: P(-1) }).ok,
    ).toBe(false);
    actions.setFloorTiling("Bathroom", {
      tileLength: P(0.0001),
      tileWidth: P(0.0001),
      joint: P(0),
    });
    expect(layout().pieces).toEqual([]);
    expect(
      layout().problems.some((p) => p.code === "floor_tiling_density"),
    ).toBe(true);
    actions.undo();
    expect(model()).toEqual(b);
    const doc = { ...demoProject(), model: model() };
    expect(parseImport(JSON.stringify(doc)).model.rooms[0].floorTiling).toEqual(
      room().floorTiling,
    );
    expect(() =>
      parseImport(
        JSON.stringify({
          ...doc,
          model: {
            ...model(),
            rooms: [{ ...room(), floorTiling: { axis: "diagonal" } }],
          },
        }),
      ),
    ).toThrow();
    actions.setFloorTiling("Bathroom", { clear: true });
    expect(room().floorTiling).toBeUndefined();
  });
});
