/**
 * Geometry-changing tools must select an entity by exact id, or by a human name that
 * matches exactly one entity. add_door, edit_wall, update_room, move_item and the
 * other mutating tools pass that reference straight into these actions.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { actions, lookupWall, store, type RefCandidate } from "../src/model/store";
import { emptyModel, type Item, type Opening, type PlanModel, type Room, type Wall } from "../src/model/types";

function useModel(partial: Partial<PlanModel>) {
  store.setState({ model: { ...emptyModel(), ...partial }, undoStack: [] });
}

const wall = (id: string, height = 2.7): Wall => ({
  id, ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.15, height,
});
const room = (id: string, label: string, floor = "oak"): Room => ({
  id, x: 0, y: 0, w: 2, h: 2, label, floor,
});
const item = (id: string, kind: string, x = 1, y = 1): Item => ({ id, kind, x, y, rotation: 0 });
const door = (id: string, wallId: string): Opening => ({
  id, kind: "door", wallId, t: 0.5, width: 0.9, sill: 0, height: 2.1, hinge: "a", side: "right",
});

function snapshot(): PlanModel {
  return structuredClone(store.getState().model);
}

function expectUnchanged(before: PlanModel) {
  expect(store.getState().model).toEqual(before);
  expect(store.getState().undoStack).toHaveLength(0);
}

function expectCandidates(result: { ok: boolean; summary: string; candidates?: RefCandidate[] }, candidates: RefCandidate[]) {
  expect(result.ok).toBe(false);
  expect(result.summary).toMatch(/candidates:/i);
  expect(result.candidates).toEqual(candidates);
  for (const candidate of candidates) expect(result.summary).toContain(candidate.id);
}

beforeEach(() => {
  useModel({});
});

describe("wall references", () => {
  beforeEach(() => {
    useModel({ walls: [wall("wall_alpha"), wall("wall_beta")] });
  });

  it("add_door with wallId 'wall' fails, names the candidates, and adds no opening", () => {
    const before = snapshot();
    const result = actions.addOpening("door", "wall", { t: 0.5 });
    expectCandidates(result, [{ id: "wall_alpha" }, { id: "wall_beta" }]);
    expect(result.summary).toContain('"wall"');
    expectUnchanged(before);
  });

  it("edit_wall with id 'w' fails and does not change height", () => {
    const before = snapshot();
    const result = actions.editWall("w", { height: 2.4 });
    expectCandidates(result, [{ id: "wall_alpha" }, { id: "wall_beta" }]);
    expect(store.getState().model.walls.map((w) => w.height)).toEqual([2.7, 2.7]);
    expectUnchanged(before);
  });

  it("a substring that sits in exactly one wall id still fails and lists that wall", () => {
    const before = snapshot();
    const result = actions.editWall("alpha", { height: 2.4 });
    expectCandidates(result, [{ id: "wall_alpha" }]);
    expectUnchanged(before);
    const removed = actions.removeWall("alpha");
    expectCandidates(removed, [{ id: "wall_alpha" }]);
    expect(store.getState().model.walls).toHaveLength(2);
  });

  it("an exact wall id adds a door and edits that wall only", () => {
    const added = actions.addOpening("door", "wall_alpha", { t: 0.5 });
    expect(added.ok).toBe(true);
    expect(store.getState().model.openings).toEqual([
      expect.objectContaining({ kind: "door", wallId: "wall_alpha" }),
    ]);
    const edited = actions.editWall("wall_beta", { height: 2.4 });
    expect(edited.ok).toBe(true);
    expect(store.getState().model.walls.map((w) => [w.id, w.height])).toEqual([
      ["wall_alpha", 2.7],
      ["wall_beta", 2.4],
    ]);
  });

  it("measure's forgiving lookup takes the first substring and does not edit", () => {
    const before = snapshot();
    const partial = lookupWall("wall", true);
    expect(partial.ok).toBe(true);
    if (partial.ok) expect(partial.entity.id).toBe("wall_alpha");
    const exact = lookupWall("wall_beta", true);
    expect(exact.ok).toBe(true);
    if (exact.ok) expect(exact.entity.id).toBe("wall_beta");
    const missing = lookupWall("no-such-wall", true);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.summary).toBe('Wall "no-such-wall" not found.');
    expectUnchanged(before);
  });

  it("an exact id wins when another wall id merely contains it", () => {
    useModel({ walls: [wall("wall_alpha"), wall("wall_alpha_extra")] });
    const result = actions.editWall("wall_alpha", { height: 2.4 });
    expect(result.ok).toBe(true);
    expect(store.getState().model.walls.map((w) => [w.id, w.height])).toEqual([
      ["wall_alpha", 2.4],
      ["wall_alpha_extra", 2.7],
    ]);
  });

  it("an unknown wall is named and leaves the model alone", () => {
    const before = snapshot();
    const result = actions.editWall("no-such-wall", { height: 2.4 });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Wall "no-such-wall" not found.');
    expect(result.candidates).toEqual([]);
    expectUnchanged(before);
  });

  it("add_window rejects the same partial wall id", () => {
    const before = snapshot();
    const result = actions.addOpening("window", "wall", { t: 0.5 });
    expectCandidates(result, [{ id: "wall_alpha" }, { id: "wall_beta" }]);
    expectUnchanged(before);
  });
});

describe("opening references", () => {
  beforeEach(() => {
    useModel({
      walls: [wall("wall_alpha"), wall("wall_beta")],
      openings: [door("door_front", "wall_alpha"), door("door_back", "wall_beta")],
    });
  });

  it("a shared id prefix fails and edits, swings, or removes nothing", () => {
    const before = snapshot();
    expectCandidates(actions.editOpening("door", { width: 1.1 }), [
      { id: "door_front", kind: "door" },
      { id: "door_back", kind: "door" },
    ]);
    expectCandidates(actions.moveOpening("door", 0.2), [
      { id: "door_front", kind: "door" },
      { id: "door_back", kind: "door" },
    ]);
    expectCandidates(actions.setDoorSwing("door", "b", "left"), [
      { id: "door_front", kind: "door" },
      { id: "door_back", kind: "door" },
    ]);
    expectCandidates(actions.removeOpening("door"), [
      { id: "door_front", kind: "door" },
      { id: "door_back", kind: "door" },
    ]);
    expectUnchanged(before);
  });

  it("a unique id substring still fails instead of editing that opening", () => {
    const before = snapshot();
    expectCandidates(actions.removeOpening("front"), [{ id: "door_front", kind: "door" }]);
    expectUnchanged(before);
  });

  it("an exact opening id still edits that door", () => {
    const result = actions.editOpening("door_front", { width: 1.1 });
    expect(result.ok).toBe(true);
    const openings = store.getState().model.openings;
    expect(openings.find((o) => o.id === "door_front")?.width).toBe(1.1);
    expect(openings.find((o) => o.id === "door_back")?.width).toBe(0.9);
  });
});

describe("room references", () => {
  beforeEach(() => {
    useModel({
      rooms: [room("room_living", "Living Room"), room("room_dining", "Dining Room")],
    });
  });

  it("an exact unique label updates that room, including a different case", () => {
    expect(actions.updateRoom("Living Room", { floor: "tile" }).ok).toBe(true);
    expect(actions.updateRoom("dining room", { floor: "carpet" }).ok).toBe(true);
    expect(store.getState().model.rooms.map((r) => [r.id, r.floor])).toEqual([
      ["room_living", "tile"],
      ["room_dining", "carpet"],
    ]);
  });

  it("a shared substring does not change either room", () => {
    const before = snapshot();
    const result = actions.updateRoom("Room", { floor: "tile" });
    expectCandidates(result, [
      { id: "room_living", label: "Living Room" },
      { id: "room_dining", label: "Dining Room" },
    ]);
    expect(actions.removeRoom("Room").ok).toBe(false);
    expectUnchanged(before);
  });

  it("a substring of exactly one label does not change that room", () => {
    const before = snapshot();
    const result = actions.updateRoom("Living", { floor: "tile" });
    expectCandidates(result, [{ id: "room_living", label: "Living Room" }]);
    expectUnchanged(before);
  });

  it("an exact label wins even when another room id contains that string", () => {
    useModel({
      rooms: [room("study_nook", "Nook"), room("room_1", "Study")],
    });
    const result = actions.updateRoom("study", { floor: "tile" });
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ id: "room_1" });
    expect(store.getState().model.rooms.map((r) => [r.id, r.floor])).toEqual([
      ["study_nook", "oak"],
      ["room_1", "tile"],
    ]);
  });

  it("an exact id wins over another room's identical label", () => {
    useModel({
      rooms: [room("kitchen", "Bedroom"), room("room_2", "Kitchen")],
    });
    const result = actions.updateRoom("kitchen", { floor: "tile" });
    expect(result.ok).toBe(true);
    expect(store.getState().model.rooms.map((r) => [r.id, r.floor])).toEqual([
      ["kitchen", "tile"],
      ["room_2", "oak"],
    ]);
  });

  it("two rooms with the same label are ambiguous", () => {
    useModel({ rooms: [room("room_a", "Bath"), room("room_b", "bath")] });
    const before = snapshot();
    const result = actions.updateRoom("BATH", { floor: "tile" });
    expectCandidates(result, [
      { id: "room_a", label: "Bath" },
      { id: "room_b", label: "bath" },
    ]);
    expectUnchanged(before);
  });
});

describe("item references", () => {
  it("a unique exact kind works and does not pick a longer kind that merely contains it", () => {
    useModel({
      items: [item("item_long", "sofa_3", 1, 1), item("item_sofa", "sofa", 3, 3)],
    });
    const result = actions.moveItem("sofa", 9, 9);
    expect(result.ok).toBe(true);
    expect(store.getState().model.items.map((i) => [i.id, i.x, i.y])).toEqual([
      ["item_long", 1, 1],
      ["item_sofa", 9, 9],
    ]);
  });

  it("an exact catalogue label, in any case, selects that one item", () => {
    useModel({
      items: [item("item_long", "sofa_3", 1, 1), item("item_bed", "bed_double", 2, 2)],
    });
    const result = actions.moveItem("double bed", 6, 6);
    expect(result.ok).toBe(true);
    expect(store.getState().model.items.map((i) => [i.id, i.x])).toEqual([
      ["item_long", 1],
      ["item_bed", 6],
    ]);
  });

  it("kinds that share a substring fail with both candidates and move nothing", () => {
    useModel({
      items: [item("item_double", "bed_double", 1, 1), item("item_single", "bed_single", 4, 4)],
    });
    const before = snapshot();
    const result = actions.moveItem("bed", 9, 9);
    expectCandidates(result, [
      { id: "item_double", kind: "bed_double", label: "Double bed" },
      { id: "item_single", kind: "bed_single", label: "Single bed" },
    ]);
    expect(actions.removeItem("bed").ok).toBe(false);
    expectUnchanged(before);
  });

  it("an ambiguous kind fails with the candidates and moves nothing", () => {
    useModel({
      items: [item("item_a", "plant", 1, 2), item("item_b", "plant", 3, 4)],
    });
    const before = snapshot();
    const result = actions.moveItem("plant", 9, 9);
    expectCandidates(result, [
      { id: "item_a", kind: "plant", label: "Plant" },
      { id: "item_b", kind: "plant", label: "Plant" },
    ]);
    expectUnchanged(before);
  });

  it("an exact id wins over another item's kind", () => {
    useModel({
      items: [item("sofa", "plant", 1, 1), item("item_sofa", "sofa", 4, 4)],
    });
    const result = actions.moveItem("sofa", 8, 8);
    expect(result.ok).toBe(true);
    expect(store.getState().model.items.map((i) => [i.id, i.x])).toEqual([
      ["sofa", 8],
      ["item_sofa", 4],
    ]);
  });

  it("an unknown item is named and leaves the model alone", () => {
    useModel({ items: [item("item_sofa", "sofa")] });
    const before = snapshot();
    const result = actions.moveItem("lamp", 2, 2);
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Item "lamp" not found.');
    expect(result.candidates).toEqual([]);
    expectUnchanged(before);
  });
});
