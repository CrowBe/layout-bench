import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { checkModel } from "../src/model/issues";
import { demoProject, parseImport } from "../src/model/projects";
import { catalogByKind, resetRuntimeCatalog } from "../src/model/catalog";
import { purchasedFittings } from "../src/model/seed-bathroom";
import { buildFurniture, hasCustomKind } from "../src/three/furniture";
import { emptyModel } from "../src/model/types";

const load = () => {
  const doc = demoProject();
  store.setState({ model: doc.model, kinds: doc.kinds, notes: doc.notes, undoStack: [] });
  // the same path a project switch takes: kinds register their catalogue entry and 3D parts
  for (const k of doc.kinds) {
    actions.defineItemKind({ ...k.entry, parts: k.parts });
  }
  return doc;
};

beforeEach(() => { resetRuntimeCatalog(); store.setState({ model: emptyModel(), undoStack: [], kinds: [] }); });

describe("purchased fittings in the sample project", () => {
  it("round-trips through a project export", () => {
    const doc = demoProject();
    const back = parseImport(JSON.stringify(doc));
    expect(back.model.items.map((i) => i.id).sort()).toEqual(doc.model.items.map((i) => i.id).sort());
    expect(back.kinds.find((k) => k.entry.kind === "towel_rail_vs900hbn")?.entry.elevation).toBe(0.5);
  });

  it("places every fitting with a printed code, marked purchased", () => {
    const { model } = demoProject();
    for (const f of purchasedFittings.filter((x) => x.placement)) {
      const it = model.items.find((i) => i.id === f.placement!.id)!;
      expect(it.selectionStatus).toBe("purchased");
      expect(it.productIdentity?.code).toBe(f.product.code);
    }
    expect(model.items.some((i) => i.id === "thermostat")).toBe(true);
  });

  it("copies printed dimensions only where a label gives them", () => {
    const rail = purchasedFittings.find((f) => f.kind === "towel_rail_vs900hbn")!.size;
    expect([rail.w, rail.d, rail.h]).toEqual([0.142, 0.1, 0.9]);
    const shower = purchasedFittings.find((f) => f.kind === "shower_y1173_31_11_250")!.size;
    expect(shower.printed).toEqual(["w"]);
    expect(purchasedFittings.filter((f) => f.size.printed.length === 0).every((f) => f.size.caveat)).toBe(true);
  });

  it("raises no errors: mounted pieces share a footprint with what is below them", () => {
    load();
    const errors = checkModel(store.getState().model).filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  it("flags an overlap once heights meet", () => {
    load();
    // drop the bath mixer to bath-rim height: it now occupies the same volume as the bath
    actions.defineItemKind({ ...catalogByKind("mixer_k1132_31")!, elevation: undefined, parts: undefined });
    const codes = checkModel(store.getState().model).map((i) => i.code);
    expect(codes).toContain("items_overlap");
  });

  it("registers a 3D model for every kind", () => {
    load();
    for (const f of purchasedFittings.filter((x) => x.parts.length)) {
      expect(hasCustomKind(f.kind)).toBe(true);
      expect(buildFurniture(f.kind)!.children.length).toBe(f.parts.length);
    }
  });

  it("draws the corner bath as a right-angle triangle with a rounded hypotenuse", () => {
    load();
    const entry = catalogByKind("bath_sb184_1000gw")!;
    expect(entry.outline?.segments).toHaveLength(3);
    expect(entry.outline?.segments[2].via).toBeDefined(); // the arc
    expect(buildFurniture("bath_sb184_1000gw")!.children.length).toBeGreaterThan(0);
    const errors = checkModel(store.getState().model).filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  it("rejects a negative elevation", () => {
    expect(actions.defineItemKind({ kind: "x_rail", label: "x", w: 1, d: 1, h: 1, elevation: -1 }).ok).toBe(false);
  });
});
