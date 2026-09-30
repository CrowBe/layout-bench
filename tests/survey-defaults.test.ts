import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { emptyModel } from "../src/model/types";
import { checkModel } from "../src/model/issues";
import { demoProject, parseImport } from "../src/model/projects";

beforeEach(() => store.setState({ model: emptyModel(), undoStack: [] }));

describe("survey dimension defaults", () => {
  it("tracks each omitted field independently through edits and project JSON", () => {
    const wall = actions.addWall(0, 0, 4, 0);
    expect(wall.ok).toBe(true);
    const wallId = wall.id as string;
    const door = actions.addOpening("door", wallId, { centre: 1 }, { height: 2.05 });
    const window = actions.addOpening("window", wallId, { centre: 3 }, { width: 0.8, height: 1.1 });
    expect(door.ok && window.ok).toBe(true);
    expect(store.getState().model.walls[0]).toMatchObject({ thicknessDefaulted: true, heightDefaulted: true });
    expect(store.getState().model.openings).toMatchObject([
      { widthDefaulted: true, heightDefaulted: false },
      { widthDefaulted: false, sillDefaulted: true, heightDefaulted: false },
    ]);
    const codes = () => checkModel(store.getState().model).map((i) => i.code);
    expect(codes()).toContain("wall_thickness_default");
    expect(codes()).toContain("wall_height_default");
    expect(codes()).toContain("opening_width_default");
    expect(codes()).toContain("opening_sill_default");
    expect(codes()).not.toContain("opening_height_default");

    expect(actions.editWall(wallId, { thickness: 0.15 }).ok).toBe(true);
    expect(actions.editOpening(window.id as string, { sill: 0.9 }).ok).toBe(true);
    expect(codes()).not.toContain("wall_thickness_default");
    expect(codes()).not.toContain("opening_sill_default");
    expect(codes()).toContain("wall_height_default");
    expect(codes()).toContain("opening_width_default");

    const raw = JSON.stringify({ ...demoProject(), model: store.getState().model });
    expect(parseImport(raw).model.walls[0].thicknessDefaulted).toBe(false);
    expect(parseImport(raw).model.walls[0].heightDefaulted).toBe(true);
    expect(parseImport(raw).model.openings[1].sillDefaulted).toBe(false);
  });

  it("reports older saved dimensions as unknown until separately entered", () => {
    const model = emptyModel();
    model.walls.push({ id: "legacy", ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.1, height: 2.4 });
    store.setState({ model });
    expect(model.walls[0].thicknessDefaulted).toBeUndefined();
    expect(model.walls[0].heightDefaulted).toBeUndefined();
    actions.editWall("legacy", { height: 2.4 });
    expect(store.getState().model.walls[0].thicknessDefaulted).toBeUndefined();
    expect(store.getState().model.walls[0].heightDefaulted).toBe(false);
  });
});
