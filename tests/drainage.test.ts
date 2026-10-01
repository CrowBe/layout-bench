import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { emptyModel } from "../src/model/types";
import { checkModel } from "../src/model/issues";
import { drainageProblems, heightAt, sectionAlong, thresholds } from "../src/model/drainage";
import { demoProject, parseImport } from "../src/model/projects";

beforeEach(() => store.setState({ model: emptyModel(), undoStack: [] }));

const room = () => store.getState().model.rooms[0];
const proposed = (value: number) => ({ value, status: "proposed" as const });
const setup = () => { actions.addRoom(0, 0, 2.11, 3.02, "Bathroom", "tile"); };
/** A linear waste along the back wall (y = 0.1), one plane over the whole room. */
const basic = (extra: Record<string, unknown> = {}) =>
  actions.setRoomDrainage("Bathroom", {
    wastes: [{ id: "w1", label: "Shower channel", kind: "linear", x: 0.2, y: 0.1, x2: 1.9, y2: 0.1, level: proposed(0) }],
    planes: [{ id: "p1", label: "Main floor", x: 0, y: 0, w: 2.11, h: 3.02, waste: "w1", controls: [{ id: "c1", label: "Door edge", x: 1, y: 3.02, level: proposed(0.0292) }], ...extra }],
  });
const codes = () => drainageProblems(room()).map((p) => p.code);

describe("drainage falls (#7)", () => {
  it("derives heights from a waste level and one control level, and updates when either moves", () => {
    setup();
    expect(basic().ok).toBe(true);
    // fall = 0.0292 / 2.92 m = 1:100
    expect(heightAt(room().drainage, 1, 3.02).level).toBeCloseTo(0.0292, 6);
    expect(heightAt(room().drainage, 1, 0.1).level).toBeCloseTo(0, 6);
    expect(heightAt(room().drainage, 1, 1.1).level).toBeCloseTo(0.01, 6);
    expect(heightAt(room().drainage, 1, 1.1).basis).toBe("proposed");
    const w = room().drainage!.wastes[0];
    actions.setRoomDrainage("Bathroom", { wastes: [{ id: w.id, kind: "linear", label: w.label, x: 0.2, y: 0.1, x2: 1.9, y2: 0.1, level: proposed(-0.01) }] });
    expect(heightAt(room().drainage, 1, 3.02).level).toBeCloseTo(0.0292, 6);
    expect(heightAt(room().drainage, 1, 0.1).level).toBeCloseTo(-0.01, 6);
    // moving the waste changes the heights
    actions.setRoomDrainage("Bathroom", { wastes: [{ id: w.id, kind: "linear", x: 0.2, y: 1.1, x2: 1.9, y2: 1.1, level: proposed(0) }] });
    expect(heightAt(room().drainage, 1, 1.1).level).toBeCloseTo(0, 6);
    expect(heightAt(room().drainage, 1, 0.1).level).toBeGreaterThan(0);
  });

  it("uses an entered fall, and a plane from three controls", () => {
    setup();
    basic({ controls: [], fall: proposed(0.02) });
    expect(heightAt(room().drainage, 1, 0.6).level).toBeCloseTo(0.01, 6);
    actions.setRoomDrainage("Bathroom", { planes: [{ x: 0, y: 0, w: 2.11, h: 3.02, controls: [
      { x: 0, y: 0, level: proposed(0.02) }, { x: 2, y: 0, level: proposed(0.02) }, { x: 0, y: 2, level: proposed(0) }] }] });
    expect(heightAt(room().drainage, 1, 1).level).toBeCloseTo(0.01, 6);
  });

  it("leaves unknown inputs unresolved instead of assuming a fall", () => {
    setup();
    basic({ controls: [] });
    const h = heightAt(room().drainage, 1, 1);
    expect(h.level).toBeUndefined();
    expect(h.reason).toMatch(/unresolved/);
    expect(codes()).toContain("floor_fall_unresolved");
    expect(actions.setRoomDrainage("Bathroom", { wastes: [{ id: "w1", kind: "linear", x: 0.2, y: 0.1, x2: 1.9, y2: 0.1 }] }).ok).toBe(true);
    expect(room().drainage!.wastes[0].level).toBeUndefined();
    expect(checkModel(store.getState().model).some((i) => i.code === "floor_fall_unresolved")).toBe(true);
  });

  it("flags contradictory levels, falls away from the waste, overlaps, gaps and steps", () => {
    setup();
    basic({ fall: proposed(0.01) }); // fall 1:100 but control says 29.2 mm over 2.92 m = ok? 0.0292 vs 0.0292
    expect(codes()).not.toContain("floor_levels_contradict");
    basic({ fall: proposed(0.01), controls: [{ x: 1, y: 3.02, level: proposed(0.05) }] });
    expect(codes()).toContain("floor_levels_contradict");
    basic({ fall: proposed(-0.01), controls: [] });
    expect(codes()).toContain("floor_fall_not_toward_waste");
    // two planes: gap, then overlap, then step
    const waste = { wastes: [{ id: "w1", kind: "linear" as const, label: "Channel", x: 0.2, y: 0.1, x2: 1.9, y2: 0.1, level: proposed(0) }] };
    actions.setRoomDrainage("Bathroom", { ...waste, planes: [{ id: "a", label: "Shower", x: 0, y: 0, w: 2.11, h: 1, waste: "w1", fall: proposed(0.015) }] });
    expect(codes()).toContain("floor_plane_gap");
    actions.setRoomDrainage("Bathroom", { planes: [
      { id: "a", label: "Shower", x: 0, y: 0, w: 2.11, h: 1.5, waste: "w1", fall: proposed(0.015) },
      { id: "b", label: "Main", x: 0, y: 1, w: 2.11, h: 2.02, waste: "w1", fall: proposed(0.015) }] });
    expect(codes()).toContain("floor_plane_overlap");
    actions.setRoomDrainage("Bathroom", { planes: [
      { id: "a", label: "Shower", x: 0, y: 0, w: 2.11, h: 1, waste: "w1", fall: proposed(0.015) },
      { id: "b", label: "Main", x: 0, y: 1, w: 2.11, h: 2.02, waste: "w1", fall: proposed(0.02) }] });
    expect(codes()).toContain("floor_plane_step");
    expect(codes()).not.toContain("floor_plane_gap");
  });

  it("rejects bad input and changes nothing", () => {
    setup();
    expect(actions.setRoomDrainage("Bathroom", { wastes: [{ kind: "point", x: 1, y: 1, level: { value: 0.01 } }] }).ok).toBe(false); // no status
    expect(actions.setRoomDrainage("Bathroom", { planes: [{ x: 0, y: 0, w: 0, h: 1 }] }).ok).toBe(false);
    expect(actions.setRoomDrainage("Bathroom", { planes: [{ x: 0, y: 0, w: 1, h: 1, waste: "nope" }] }).ok).toBe(false);
    expect(actions.setRoomDrainage("Bathroom", { wastes: [{ kind: "linear", x: 1, y: 1, x2: 1, y2: 1 }] }).ok).toBe(false);
    expect(actions.setRoomDrainage("Nowhere", {}).ok).toBe(false);
    expect(room().drainage).toBeUndefined();
  });

  it("samples a section and reports the door threshold against the finished level", () => {
    setup();
    actions.addWall(0, 3.02, 2.11, 3.02);
    const wall = store.getState().model.walls[0];
    actions.addOpening("door", wall.id, { t: 0.5 });
    basic();
    actions.setRoomFloor("Bathroom", { substrateTop: { value: -0.04, status: "measured" }, layers: [{ kind: "screed", thickness: proposed(0.07) }] });
    const s = sectionAlong(room().drainage, { x: 1, y: 0.1 }, { x: 1, y: 3.02 }, 5);
    expect(s).toHaveLength(5);
    expect(s[0].level).toBeCloseTo(0, 6);
    expect(s[4].level).toBeCloseTo(0.0292, 6);
    const t = thresholds(store.getState().model, room());
    expect(t).toHaveLength(1);
    expect(t[0].level).toBeCloseTo(0.0292, 3);
    expect(t[0].stepToFinished).toBeCloseTo(0.0292 - 0.03, 3);
  });

  it("survives a save round-trip and rejects an invalid document", () => {
    setup();
    basic();
    const saved = { ...demoProject(), model: store.getState().model };
    expect(parseImport(JSON.stringify(saved)).model.rooms[0].drainage).toEqual(room().drainage);
    const bad = JSON.parse(JSON.stringify(saved));
    bad.model.rooms[0].drainage.planes = "nope";
    expect(() => parseImport(JSON.stringify(bad))).toThrow();
  });
});
