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
import { floorFill, floorLevels } from "../src/model/floor";
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
      // frame 5 + Villaboard 6 + adhesive 4 + tile 10, all from estimates or proposals
      expect(resolveFace(side, "finished")).toMatchObject({ resolved: true, offset: 0.025, basis: "estimated" });
    }
    const floor = m.rooms[0].floorBuildUp!;
    expect(floor.substrate).toMatch(/concrete slab/);
    expect(floor.substrateTop).toMatchObject({ value: -0.12, status: "estimated" });
    expect(floor.finishedTarget).toMatchObject({ value: 0, status: "proposed" });
    expect(floor.layers.map((l) => l.kind)).toEqual(["waterproofing", "screed", "adhesive", "tile"]);
    // the tiler's screed and adhesive, and the membrane, stay unknown: only the target is set
    expect(floor.layers.map((l) => l.thickness.value)).toEqual([undefined, undefined, undefined, 0.01]);
    expect(floorFill(floor)).toMatchObject({ thickness: 0.11, layers: ["Waterproofing on the slab", "Tiler's screed (heating cable inside)", "Tiler's adhesive"] });
    const levels = floorLevels(floor);
    expect(levels.at(-1)).toMatchObject({ top: 0, fromTarget: true, resolved: true });
    expect(levels.at(-2)).toMatchObject({ top: -0.01, fromTarget: true }); // adhesive top = target − tile
    expect(levels[1].resolved).toBe(false); // membrane top: neither way reaches it
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
    // the courses start from the target: the finished floor is known without the tiler's thicknesses
    expect(tilingLayout(m, wall(m, "wall_e"), "right").band).toEqual({ z0: 0, z1: 2.416 });
  });

  it("gives four full courses and full tiles at the door end from the estimates and the target", () => {
    const m = sample();
    // about 2700 mm to the cornice: four courses clear it, leaving about 284 mm for the timber trim
    for (const w of m.walls) {
      expect(tilingLayout(m, w, "right").problems.map((p) => p.code), w.id).not.toContain("tiling_above_wall");
      expect(Math.round((w.height - tilingLayout(m, w, "right").band!.z1) * 1000)).toBe(284);
    }
    for (const w of m.walls) {
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
