import { afterEach, describe, expect, it } from "vitest";
import { parseProject } from "../src/model/projects";
import { actions, store } from "../src/model/store";
import { emptyModel } from "../src/model/types";

const modelWithOpening = (anchorEnd: "a" | "b" = "a") => {
  const model = emptyModel();
  model.walls.push({ id: "w", ax: 0, ay: 0, bx: 3, by: 0, thickness: 0.15, height: 2.7 });
  model.openings.push({
    id: "o", kind: "window", wallId: "w", t: 0.5, anchorEnd, anchorDistance: 1.5,
    width: 0.6, sill: 0.9, height: 1.2,
  });
  return model;
};

afterEach(() => store.setState({ model: emptyModel(), undoStack: [] }));

describe("surveyed opening anchors", () => {
  it("keeps an end A distance fixed when end B moves", () => {
    store.setState({ model: modelWithOpening("a") });
    const result = actions.editWall("w", { bx: 4 });
    const opening = store.getState().model.openings[0];
    expect(result.ok).toBe(true);
    expect(opening.anchorDistance).toBe(1.5);
    expect(opening.t).toBeCloseTo(1.5 / 4);
  });

  it("keeps an end B distance fixed when end A moves", () => {
    store.setState({ model: modelWithOpening("b") });
    const result = actions.editWall("w", { ax: -1 });
    const opening = store.getState().model.openings[0];
    expect(result.ok).toBe(true);
    expect(opening.anchorDistance).toBe(1.5);
    expect(opening.t).toBeCloseTo(1 - 1.5 / 4);
  });

  it("rejects a wall edit that makes an anchored opening no longer fit", () => {
    store.setState({ model: modelWithOpening("a") });
    const result = actions.editWall("w", { bx: 1.7 });
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/opening o no longer fits/i);
    expect(store.getState().model.walls[0].bx).toBe(3);
  });

  it("migrates saved t-only projects to an end A distance", () => {
    const project = parseProject({
      version: 1,
      id: "legacy",
      model: {
        ...modelWithOpening(),
        openings: [{ id: "legacy-window", kind: "window", wallId: "w", t: 0.25, width: 0.6, sill: 0.9, height: 1.2 }],
      },
      notes: [],
      kinds: [],
    });
    expect(project.model.openings[0].anchorEnd).toBe("a");
    expect(project.model.openings[0].anchorDistance).toBe(0.75);
    expect(project.model.openings[0].t).toBe(0.25);
  });
});
