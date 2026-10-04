/** Tile origins at a door: a wall set-out from an opening's jamb, a floor set-out from the south or east face. */
import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { emptyModel } from "../src/model/types";
import { tilingLayout } from "../src/model/tiling";
import { floorTileLayout } from "../src/model/floorTiling";

const P = (value: number) => ({ value, status: "proposed" as const });
const model = () => store.getState().model;
beforeEach(() => store.setState({ model: emptyModel(), undoStack: [], kinds: [] }));

function room() {
  const c = [[0, 0], [2, 0], [2, 3], [0, 3]];
  const walls = c.map(([ax, ay], i) => actions.addWall(ax, ay, c[(i + 1) % 4][0], c[(i + 1) % 4][1], 0.1, 2.6).id as string);
  for (const w of walls) actions.setWallSide(w, "right", { existing: { value: 0, status: "measured" }, frame: { value: 0, status: "measured" }, layers: [{ kind: "tile", name: "Tile", thickness: P(0.01) }] });
  actions.addRoom(0, 0, 2, 3, "Bath", "tile");
  actions.setRoomFloor("Bath", { substrateTop: P(0), layers: [{ kind: "tile", thickness: P(0.01) }] });
  // door on the south wall (A at x = 2, B at x = 0): jambs at x 0.92 and 0.12
  const door = actions.addOpening("door", walls[2], { centre: 0.52, from: "b" }, { width: 0.8, height: 2.04 }).id as string;
  return { walls, door };
}
const base = { tileLength: P(0.6), tileWidth: P(0.6), orientation: "landscape" as const, joint: P(0.004), reference: "finished" as const, floor: "finished" as const, originAlong: P(0), originUp: P(0), tiledHeight: P(2.4) };

describe("tile origins at a door", () => {
  it("starts a wall's full tiles at an opening's jamb, running away from it", () => {
    const { walls, door } = room();
    expect(actions.setWallTiling(walls[2], "right", { ...base, originFrom: "jamb-a", originOpening: door }).ok).toBe(true);
    const l = tilingLayout(model(), model().walls[2], "right");
    // the jamb nearer A is 2 − 0.92 = 1.08 along the drawn line; the origin tile ends there
    expect(l.origin!.s).toBeCloseTo(1.08 - 0.6, 6);
    expect(l.openings[0].jambA!.full).toBe(true);
    expect(actions.setWallTiling(walls[2], "right", { originFrom: "jamb-b" }).ok).toBe(true);
    expect(tilingLayout(model(), model().walls[2], "right").origin!.s).toBeCloseTo(1.88, 6);
  });

  it("refuses a jamb origin without an opening on that wall", () => {
    const { walls, door } = room();
    expect(actions.setWallTiling(walls[0], "right", { ...base, originFrom: "jamb-a" }).ok).toBe(false);
    expect(actions.setWallTiling(walls[0], "right", { ...base, originFrom: "jamb-a", originOpening: door }).ok).toBe(false);
    expect(model().walls[0].tiling).toBeUndefined();
  });

  it("starts the floor at the south and east faces when asked", () => {
    room();
    expect(actions.setFloorTiling("Bath", { tileLength: P(0.6), tileWidth: P(0.3), joint: P(0.004), axis: "y", zone: "room", originX: P(0), originY: P(0), originXFrom: "east", originYFrom: "south" }).ok).toBe(true);
    const l = floorTileLayout(model(), model().rooms[0]);
    expect(l.cuts!.south.full && l.cuts!.east.full).toBe(true);
    expect(l.origin).toEqual({ x: 2 - 0.01 - 0.3, y: 3 - 0.01 - 0.6 });
    expect(actions.setFloorTiling("Bath", { originYFrom: "up" as never }).ok).toBe(false);
  });
});
