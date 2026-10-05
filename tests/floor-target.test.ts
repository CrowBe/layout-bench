/** A finished-level target: the trade fills to it, and levels are read down from it. */
import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { emptyModel } from "../src/model/types";
import { floorFill, floorLevels, floorProblems, finishedLevel } from "../src/model/floor";
import { demoProject, parseImport } from "../src/model/projects";

const P = (value: number) => ({ value, status: "proposed" as const });
const E = (value: number) => ({ value, status: "estimated" as const });
const room = () => store.getState().model.rooms[0];
beforeEach(() => { store.setState({ model: emptyModel(), undoStack: [], kinds: [] }); actions.addRoom(0, 0, 2, 3, "Bath", "tile"); });
const stack = () => [{ kind: "waterproofing" as const }, { kind: "screed" as const }, { kind: "adhesive" as const }, { kind: "tile" as const, thickness: E(0.01) }];

describe("finished-level target", () => {
  it("reads levels down from the target and reports what the unknown layers fill", () => {
    expect(actions.setRoomFloor("Bath", { substrateTop: E(-0.12), finishedTarget: P(0), layers: stack() }).ok).toBe(true);
    const fb = room().floorBuildUp!;
    expect(finishedLevel(fb)).toMatchObject({ top: 0, resolved: true, basis: "proposed", fromTarget: true });
    expect(floorLevels(fb)[3]).toMatchObject({ top: -0.01, basis: "estimated", fromTarget: true });
    expect(floorLevels(fb)[1].resolved).toBe(false);
    expect(floorFill(fb)).toMatchObject({ thickness: 0.11, basis: "estimated" });
  });

  it("keeps levels built up from the substrate, and warns when they miss the target", () => {
    actions.setRoomFloor("Bath", { substrateTop: E(-0.05), finishedTarget: P(0), layers: [{ kind: "screed", thickness: P(0.03) }, { kind: "tile", thickness: P(0.01) }] });
    const fb = room().floorBuildUp!;
    expect(finishedLevel(fb)).toMatchObject({ top: -0.01 });
    expect(finishedLevel(fb).fromTarget).toBeUndefined();
    expect(floorProblems(fb).map((p) => p.code)).toContain("floor_target_mismatch");
  });

  it("flags a target below what the known layers already reach", () => {
    actions.setRoomFloor("Bath", { substrateTop: E(0), finishedTarget: P(0.005), layers: [{ kind: "screed" }, { kind: "tile", thickness: P(0.01) }] });
    expect(floorProblems(room().floorBuildUp!).map((p) => p.code)).toContain("floor_target_below");
  });

  it("clears with null and survives a project round trip", () => {
    actions.setRoomFloor("Bath", { substrateTop: E(-0.12), finishedTarget: P(0), layers: stack() });
    const back = parseImport(JSON.stringify({ ...demoProject(), model: store.getState().model }));
    expect(back.model.rooms[0].floorBuildUp!.finishedTarget).toEqual(P(0));
    actions.setRoomFloor("Bath", { finishedTarget: null });
    expect(room().floorBuildUp!.finishedTarget).toBeUndefined();
    expect(finishedLevel(room().floorBuildUp).resolved).toBe(false);
  });
});
