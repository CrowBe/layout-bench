import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { checkModel } from "../src/model/issues";
import { demoProject, parseImport } from "../src/model/projects";
import { resetRuntimeCatalog } from "../src/model/catalog";
import { fittedPose } from "../src/model/fixtures";
import { itemPolygon, pointNearPolygon } from "../src/model/outline";
import { emptyModel } from "../src/model/types";

const load = () => {
  const doc = demoProject();
  store.setState({ model: doc.model, kinds: doc.kinds, notes: doc.notes, undoStack: [] });
  for (const k of doc.kinds) actions.defineItemKind({ ...k.entry, parts: k.parts });
};
const item = (id: string) => store.getState().model.items.find((i) => i.id === id)!;
const codes = () => checkModel(store.getState().model).map((i) => i.code);

beforeEach(() => { resetRuntimeCatalog(); store.setState({ model: emptyModel(), undoStack: [], kinds: [] }); });

describe("an accessory fitted inside a fixture (bath waste)", () => {
  it("sits inside the sample bath without an overlap, with its pose derived from the host", () => {
    load();
    const waste = item("bath_waste");
    expect(waste.fittedTo).toEqual({ hostId: "bath", across: 0.141, out: 0.368 });
    expect(pointNearPolygon({ x: waste.x, y: waste.y }, itemPolygon(item("bath"))!, 0)).toBe(true);
    expect(fittedPose(waste, item("bath"))).toMatchObject({ x: waste.x, y: waste.y, rotation: 0 });
    expect(codes()).not.toContain("items_overlap");
    expect(checkModel(store.getState().model).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("moves and turns with its host, and goes with it when removed (undo restores both)", () => {
    load();
    const before = { x: item("bath_waste").x, y: item("bath_waste").y };
    expect(actions.moveItem("bath", item("bath").x - 0.05, item("bath").y + 0.05).ok).toBe(true);
    expect(item("bath_waste").x).toBeCloseTo(before.x - 0.05, 4);
    expect(item("bath_waste").y).toBeCloseTo(before.y + 0.05, 4);
    expect(actions.moveItem("bath", undefined, undefined, 90).ok).toBe(true);
    expect(item("bath_waste").rotation).toBe(90);
    const removed = actions.removeItem("bath");
    expect(removed.summary).toMatch(/with 1 fitted inside/);
    expect(store.getState().model.items.some((i) => i.id === "bath_waste")).toBe(false);
    actions.undo();
    expect(item("bath_waste").fittedTo?.hostId).toBe("bath");
  });

  it("refuses to be moved on its own, anchored, chained, or fitted outside its host's real outline", () => {
    load();
    expect(actions.moveItem("bath_waste", 1, 1).ok).toBe(false);
    expect(actions.anchorFixture("bath_waste", { wallId: "wall_n", side: "right", face: "finished", from: "a", distance: 1, status: "proposed" } as never).ok).toBe(false);
    expect(actions.fitItem("bath_waste", "bath_waste", 0, 0.3).ok).toBe(false);
    expect(actions.fitItem("towel_rail", "bath_waste", 0, 0.03).ok).toBe(false); // a host cannot itself be fitted
    // inside the bath's 1 m box, but beyond the rounded hypotenuse: the front-left corner
    const outside = actions.fitItem("bath_waste", "bath", -0.45, 0.9);
    expect(outside.ok).toBe(false);
    expect(outside.summary).toMatch(/outside bath's footprint/);
    expect(item("bath_waste").fittedTo).toEqual({ hostId: "bath", across: 0.141, out: 0.368 });
  });

  it("fits at a new place, and releases where it stands", () => {
    load();
    expect(actions.fitItem("bath_waste", "bath", 0.2, 0.2).ok).toBe(true);
    expect(item("bath_waste").fittedTo).toMatchObject({ across: 0.2, out: 0.2 });
    const at = { x: item("bath_waste").x, y: item("bath_waste").y };
    expect(actions.fitItem("bath_waste", null).ok).toBe(true);
    expect(item("bath_waste").fittedTo).toBeUndefined();
    expect({ x: item("bath_waste").x, y: item("bath_waste").y }).toEqual(at);
    expect(codes()).toContain("items_overlap"); // now just a small item sitting in the bath
    expect(actions.fitItem("bath_waste", null).ok).toBe(false);
  });

  it("warns when its host is gone or its place is outside the host", () => {
    load();
    const model = store.getState().model;
    store.setState({ model: { ...model, items: model.items.filter((i) => i.id !== "bath") } });
    expect(codes()).toContain("accessory_host_missing");
    load();
    const m = store.getState().model;
    store.setState({ model: { ...m, items: m.items.map((i) => (i.id === "bath_waste" ? { ...i, x: 1.15, y: 0.95 } : i)) } });
    expect(codes()).toContain("accessory_outside_host");
  });

  it("round-trips through a project export and rejects a malformed field", () => {
    const doc = demoProject();
    expect(parseImport(JSON.stringify(doc)).model.items.find((i) => i.id === "bath_waste")?.fittedTo).toEqual({ hostId: "bath", across: 0.141, out: 0.368 });
    const bad = structuredClone(doc);
    (bad.model.items.find((i) => i.id === "bath_waste") as { fittedTo: unknown }).fittedTo = { hostId: "bath", across: "x", out: 0.3 };
    expect(() => parseImport(JSON.stringify(bad))).toThrow();
  });
});
