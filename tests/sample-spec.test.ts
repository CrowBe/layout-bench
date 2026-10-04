/**
 * The owner's construction spec in the Bathroom Concept sample: build-ups, tile choices per
 * surface and four full 600 mm courses on every wall. Thicknesses nobody has supplied stay
 * unknown, so no cut is worked out until they arrive; with them, four full courses result.
 */
import { describe, expect, it } from "vitest";
import { demoProject, parseImport } from "../src/model/projects";
import { tilingLayout } from "../src/model/tiling";
import { floorTileLayout } from "../src/model/floorTiling";
import { resolveFace } from "../src/model/faces";
import type { PlanModel } from "../src/model/types";

const sample = () => demoProject().model;
const wall = (m: PlanModel, id: string) => m.walls.find((w) => w.id === id)!;

describe("owner's construction spec in the sample", () => {
  it("records the survey, Villaboard on the frame and no invented thicknesses", () => {
    const m = sample();
    expect(m.rooms[0]).toMatchObject({ w: 2.11, h: 3.02 });
    for (const w of m.walls) {
      const side = w.sides!.right!;
      expect(side.existing).toMatchObject({ value: 0.05, status: "measured" });
      expect(side.layers.map((l) => l.kind)).toEqual(["board", "adhesive", "tile"]);
      expect(side.layers[0].thickness).toMatchObject({ value: 0.006, status: "proposed" });
      expect(resolveFace(side, "board")).toMatchObject({ resolved: true, offset: 0.011, basis: "estimated" });
      expect(resolveFace(side, "finished").resolved).toBe(false);
    }
    const floor = m.rooms[0].floorBuildUp!;
    expect(floor.substrate).toMatch(/concrete/);
    expect(floor.layers.map((l) => l.kind)).toEqual(["waterproofing", "screed", "adhesive", "tile"]);
    expect(floor.layers.every((l) => l.thickness.value === undefined)).toBe(true);
    expect(m.rooms[0].heating).toMatchObject({ model: "SCK0765L", screedLayerId: "floor_screed", path: [] });
    expect(() => parseImport(JSON.stringify(demoProject()))).not.toThrow();
  });

  it("puts white 600 × 600 on three walls and the beige 300 × 600 floor tile up the window wall", () => {
    const m = sample();
    for (const id of ["wall_e", "wall_s", "wall_w"]) expect(wall(m, id).tiling!.right).toMatchObject({ tileLength: { value: 0.6 }, tileWidth: { value: 0.6 } });
    expect(wall(m, "wall_n").tiling!.right).toMatchObject({ tileLength: { value: 0.6 }, tileWidth: { value: 0.3 }, orientation: "portrait" });
    expect(m.rooms[0].floorTiling).toMatchObject({ tileLength: { value: 0.6 }, tileWidth: { value: 0.3 }, axis: "y", joint: { value: 0.004 } });
    // four full courses on a thin base joint
    for (const w of m.walls) expect([w.tiling!.right!.originUp!.value, w.tiling!.right!.tiledHeight!.value]).toEqual([0.004, 2.416]);
    // full tiles start at the door end
    expect(wall(m, "wall_s").tiling!.right).toMatchObject({ originFrom: "jamb-a", originOpening: "door_s" });
    expect(m.rooms[0].floorTiling).toMatchObject({ originXFrom: "west", originYFrom: "south" });
    // unknown floor and wall thicknesses: no courses or cuts are given yet
    expect(tilingLayout(m, wall(m, "wall_e"), "right").cuts).toBeUndefined();
    expect(floorTileLayout(m, m.rooms[0]).resolved).toBe(false);
  });

  it("gives four full courses and full tiles at the door end once the thicknesses are entered", () => {
    const m = sample();
    const t = (value: number) => ({ value, status: "proposed" as const, source: "test" });
    const fb = m.rooms[0].floorBuildUp!;
    fb.substrateTop = t(-0.04);
    fb.layers.forEach((l, i) => (l.thickness = t([0.001, 0.035, 0.004, 0.01][i])));
    for (const w of m.walls) w.sides!.right!.layers.forEach((l) => l.kind !== "board" && (l.thickness = t(l.kind === "adhesive" ? 0.004 : 0.01)));
    for (const w of m.walls) {
      w.height = 2.6; // a ceiling that clears four courses
      const l = tilingLayout(m, w, "right");
      expect(l.rows, w.id).toBe(4);
      expect(l.cuts!.bottom.full && l.cuts!.top.full, w.id).toBe(true);
    }
    // side walls: the full tile is at the door-wall corner, the cut at the window wall
    expect(tilingLayout(m, wall(m, "wall_w"), "right").cuts!.a.full).toBe(true);
    expect(tilingLayout(m, wall(m, "wall_e"), "right").cuts!.b.full).toBe(true);
    // door wall: a full tile stands against the door's jamb, on the far side from the corner
    const door = tilingLayout(m, wall(m, "wall_s"), "right").openings.find((o) => o.openingId === "door_s")!;
    expect(door.jambA!.full).toBe(true);
    // floor: full row at the doorway, full column along the left wall
    const floor = floorTileLayout(m, m.rooms[0]);
    expect(floor.cuts!.south.full && floor.cuts!.west.full).toBe(true);
  });
});
