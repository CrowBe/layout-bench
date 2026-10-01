import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { emptyModel } from "../src/model/types";
import { checkModel } from "../src/model/issues";
import { finishedLevel, floorLevels } from "../src/model/floor";
import { demoProject, parseImport } from "../src/model/projects";

beforeEach(() => store.setState({ model: emptyModel(), undoStack: [] }));

const room = () => store.getState().model.rooms[0];
const setup = () => { actions.addRoom(0, 0, 2.11, 3.02, "Bathroom", "tile"); };
const stack = (tileMm = 10) => [
  { kind: "waterproofing" as const, thickness: { value: 0.001, status: "proposed" as const } },
  { kind: "screed" as const, name: "Screed", thickness: { value: 0.04, status: "proposed" as const } },
  { kind: "adhesive" as const, thickness: { value: 0.004, status: "estimated" as const } },
  { kind: "tile" as const, thickness: { value: tileMm / 1000, status: "proposed" as const } },
];
const tops = () => Object.fromEntries(floorLevels(room().floorBuildUp).map((l) => [l.kind, l.top]));

describe("floor assembly and datums (#6)", () => {
  it("computes layer tops from a confirmed substrate and changes only the tile top", () => {
    setup();
    expect(actions.setRoomFloor("Bathroom", { substrateTop: { value: -0.012, status: "site-confirmed" }, layers: stack() }).ok).toBe(true);
    expect(tops().substrate).toBeCloseTo(-0.012, 6);
    expect(tops().screed).toBeCloseTo(0.029, 6);
    expect(tops().tile).toBeCloseTo(0.043, 6);
    const before = tops();
    const layers = room().floorBuildUp!.layers.map((l) => ({ id: l.id, kind: l.kind, name: l.name, thickness: l.kind === "tile" ? { value: 0.012, status: "proposed" as const } : l.thickness }));
    actions.setRoomFloor("Bathroom", { layers });
    expect(tops().tile).toBeCloseTo(0.045, 6);
    expect(tops().screed).toBe(before.screed);
    expect(tops().substrate).toBe(before.substrate);
    expect(finishedLevel(room().floorBuildUp).basis).toBe("estimated");
  });

  it("leaves levels unresolved instead of using zero", () => {
    setup();
    actions.setRoomFloor("Bathroom", { layers: stack() });
    expect(finishedLevel(room().floorBuildUp).resolved).toBe(false);
    expect(finishedLevel(room().floorBuildUp).missing).toEqual(["substrate top"]);
    expect(checkModel(store.getState().model).some((i) => i.code === "floor_level_unresolved")).toBe(true);
    actions.setRoomFloor("Bathroom", { substrateTop: { value: 0, status: "measured" }, layers: [{ kind: "tile" }] });
    expect(floorLevels(room().floorBuildUp)[1].missing).toEqual(["Tile thickness"]);
  });

  it("rejects bad input and changes nothing", () => {
    setup();
    expect(actions.setRoomFloor("Bathroom", { substrateTop: { value: 0.01 } }).ok).toBe(false); // no status
    expect(actions.setRoomFloor("Bathroom", { layers: [{ kind: "tile" }, { kind: "screed" }] }).ok).toBe(false);
    expect(actions.setRoomFloor("Bathroom", { layers: [{ kind: "tile", thickness: { value: -0.01, status: "proposed" } }] }).ok).toBe(false);
    expect(actions.setRoomFloor("Nowhere", {}).ok).toBe(false);
    expect(room().floorBuildUp).toBeUndefined();
  });

  it("accepts waterproofing above screed", () => {
    setup();
    expect(actions.setRoomFloor("Bathroom", { layers: [{ kind: "screed" }, { kind: "waterproofing" }, { kind: "tile" }] }).ok).toBe(true);
  });

  it("survives a save round-trip and rejects an invalid document", () => {
    setup();
    actions.setRoomFloor("Bathroom", { datum: "finished hall floor", substrate: "concrete slab", substrateTop: { value: -0.02, status: "measured" }, layers: stack() });
    const doc = demoProject();
    const saved = { ...doc, model: store.getState().model };
    const back = parseImport(JSON.stringify(saved));
    expect(back.model.rooms[0].floorBuildUp).toEqual(room().floorBuildUp);
    const bad = JSON.parse(JSON.stringify(saved));
    bad.model.rooms[0].floorBuildUp.layers = "nope";
    expect(() => parseImport(JSON.stringify(bad))).toThrow();
  });
});
