import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { actions, store } from "../src/model/store";
import { emptyModel } from "../src/model/types";
import { checkModel } from "../src/model/issues";
import { distanceToFace, resolveFace, roomOnSide, wallBody } from "../src/model/faces";
import { demoProject, parseImport } from "../src/model/projects";
import { buildPlan } from "../src/three/build";

beforeEach(() => store.setState({ model: emptyModel(), undoStack: [] }));

const wall = () => store.getState().model.walls[0];

/** Back wall of the surveyed bathroom, drawn on the existing surface; the room lies on its right side. */
function surveyedWall(): string {
  const r = actions.addWall(0, 0, 2.11, 0, 0.1, 2.4);
  expect(r.ok).toBe(true);
  actions.addRoom(0, 0, 2.11, 3.02, "Bathroom", "tile");
  return r.id as string;
}

const buildUp = (boardMm = 6) => [
  { kind: "board" as const, name: "Villaboard", thickness: { value: boardMm / 1000, status: "proposed" as const } },
  { kind: "waterproofing" as const, thickness: { value: 0.001, status: "proposed" as const } },
  { kind: "adhesive" as const, thickness: { value: 0.004, status: "estimated" as const } },
  { kind: "tile" as const, thickness: { value: 0.01, status: "proposed" as const } },
];

describe("wall reference faces (#4)", () => {
  it("measures one point from frame, board and finished faces, and tracks a board change", () => {
    const id = surveyedWall();
    expect(roomOnSide(wall(), "right", store.getState().model.rooms)).toBe("Bathroom");
    const set = actions.setWallSide(id, "right", {
      existing: { value: 0, status: "measured", source: "survey 2,110 mm between existing surfaces" },
      frame: { value: -0.045, status: "site-confirmed" },
      layers: buildUp(),
    });
    expect(set.ok).toBe(true);
    const p = { x: 1, y: 0.1 }; // 100 mm off the existing surface
    const at = (face: string) => distanceToFace(wall(), "right", face, p);
    expect(at("existing").distance).toBe(0.1);
    expect(at("frame").distance).toBe(0.145);
    expect(at("board").distance).toBe(0.139);
    expect(at("finished").distance).toBe(0.124);
    expect(at("board").face.basis).toBe("proposed");
    expect(at("finished").face.basis).toBe("estimated");

    const layers = wall().sides!.right!.layers;
    actions.setWallSide(id, "right", { layers: layers.map((l, i) => ({ ...l, thickness: i === 0 ? { value: 0.01, status: "proposed" } : l.thickness })) });
    expect(at("frame").distance).toBe(0.145); // the entered reference does not move
    expect(at("board").distance).toBe(0.135);
    expect(at("finished").distance).toBe(0.12);
    expect(wall().sides!.right!.layers.map((l) => l.id)).toEqual(layers.map((l) => l.id));
  });

  it("keeps unknown values unknown: no frame from the existing surface, no default thickness", () => {
    const id = surveyedWall();
    actions.setWallSide(id, "right", { existing: { value: 0, status: "measured" } });
    const frame = resolveFace(wall().sides!.right, "frame");
    expect(frame.resolved).toBe(false);
    expect(frame.offset).toBeUndefined();
    expect(frame.missing).toEqual(["frame face position"]);

    const layers = buildUp();
    delete (layers[2] as { thickness?: unknown }).thickness;
    actions.setWallSide(id, "right", { frame: { value: -0.045, status: "estimated" }, layers });
    expect(resolveFace(wall().sides!.right, "board").resolved).toBe(true);
    const finished = distanceToFace(wall(), "right", "finished", { x: 1, y: 0.1 });
    expect(finished.resolved).toBe(false);
    expect(finished.distance).toBeUndefined();
    expect(finished.face.missing).toEqual(["Tile adhesive thickness"]);
    expect(checkModel(store.getState().model).map((i) => i.code)).toContain("wall_face_unresolved");
  });

  it("rejects bad input atomically", () => {
    const id = surveyedWall();
    const before = structuredClone(store.getState().model);
    expect(actions.setWallSide(id, "right", { frame: { value: -0.045 } }).ok).toBe(false); // no status
    expect(actions.setWallSide(id, "right", { layers: [{ kind: "tile" }, { kind: "board" }] }).ok).toBe(false);
    expect(actions.setWallSide(id, "right", { layers: [{ kind: "board", thickness: { value: -0.006, status: "proposed" } }] }).ok).toBe(false);
    expect(actions.setWallSide(id, "up" as never, {}).ok).toBe(false);
    expect(actions.setWallSide("wall", "right", {}).ok).toBe(false); // partial id
    expect(store.getState().model).toEqual(before);
  });

  it("flags a frame recorded in front of the existing surface and a legacy out-of-order build-up", () => {
    const id = surveyedWall();
    actions.setWallSide(id, "right", { existing: { value: 0, status: "measured" }, frame: { value: 0.01, status: "estimated" } });
    const model = store.getState().model;
    model.walls[0].sides!.right!.layers = [
      { id: "t", kind: "tile", name: "", thickness: { value: 0.01, status: "proposed" } },
      { id: "b", kind: "board", name: "", thickness: { value: 0.006, status: "proposed" } },
    ];
    const codes = checkModel(model).map((i) => i.code);
    expect(codes).toContain("wall_frame_proud");
    expect(codes).toContain("wall_layer_order");
  });

  it("survives project JSON", () => {
    const id = surveyedWall();
    expect(actions.setWallSide(id, "right", { frame: { value: -0.045, status: "site-confirmed" }, layers: buildUp() }).ok).toBe(true);
    const doc = { ...demoProject(), id: "bath", model: store.getState().model };
    const loaded = parseImport(JSON.stringify(doc));
    expect(loaded.model.walls[0].sides).toEqual(wall().sides);
    expect(() => parseImport(JSON.stringify({ ...doc, model: { ...doc.model, walls: [{ ...wall(), sides: { right: { layers: "none" } } }] } }))).toThrow();
  });

  it("builds the frame-faced body and one slab per resolved layer in 3D", () => {
    const id = surveyedWall();
    expect(wallBody(wall())).toEqual({ z: 0, depth: 0.1 });
    const layers = buildUp();
    delete (layers[3] as { thickness?: unknown }).thickness; // tile unknown: no slab
    actions.setWallSide(id, "right", { frame: { value: -0.045, status: "site-confirmed" }, layers });
    const body = wallBody(wall());
    expect(body.z).toBeCloseTo(-0.095);
    expect(body.depth).toBeCloseTo(0.1);
    const names: string[] = [];
    buildPlan(store.getState().model, "planning").group.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name.includes(":right:")) names.push(o.name); });
    const slabs = new Set(names.map((n) => n.split(":")[2]));
    expect(slabs.size).toBe(3);
    expect([...slabs]).toEqual(wall().sides!.right!.layers.slice(0, 3).map((l) => l.id));
  });
});
