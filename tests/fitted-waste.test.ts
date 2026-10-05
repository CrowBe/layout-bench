import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { checkModel } from "../src/model/issues";
import { demoProject } from "../src/model/projects";
import { catalogByKind, resetRuntimeCatalog } from "../src/model/catalog";
import { purchasedFittings } from "../src/model/seed-bathroom";
import { emptyModel, type PlanModel } from "../src/model/types";
import { buildFurniture } from "../src/three/furniture";
import { catalogue, renderStageDiagram, resolveVisible } from "../src/sheets/stageView";
import { renderFloorPlan } from "../src/sheets/floorPlan";
import {
  FITTED_WASTE_OFFSET_TOLERANCE_M,
  accessoryOutletDiameter,
  cornerBisectorToHostFrame,
  diametersAreLikeForLike,
  fittedWasteProblems,
  hostWasteInHostFrame,
} from "../src/model/fittedWaste";
import type { FieldValue } from "../src/model/products";
import type { PartSpec } from "../src/three/furniture";

const load = () => {
  const doc = demoProject();
  store.setState({ model: doc.model, kinds: doc.kinds, notes: doc.notes, undoStack: [] });
  for (const k of doc.kinds) actions.defineItemKind({ ...k.entry, parts: k.parts });
};
const item = (id: string) => store.getState().model.items.find((i) => i.id === id)!;
const issues = () => checkModel(store.getState().model);
const src = [{ url: "https://example.com/synthetic.pdf", locator: "p. 1, synthetic" }];
const pub = (value: number | string, extra: Partial<FieldValue> = {}): FieldValue =>
  ({ value, status: "published", sources: src, ...extra });

beforeEach(() => { resetRuntimeCatalog(); store.setState({ model: emptyModel(), undoStack: [], kinds: [] }); });

describe("fitted waste vs host waste point (#75)", () => {
  it("names the tolerance as a modelling constant, not a manufacturer or code figure", () => {
    expect(FITTED_WASTE_OFFSET_TOLERANCE_M).toBe(0.05);
    expect(FITTED_WASTE_OFFSET_TOLERANCE_M).not.toBe(0.15);
  });

  it("converts the sheet's 520 mm on the bisector as 520/√2 along each wall and labels the host-frame result derived", () => {
    load();
    const converted = cornerBisectorToHostFrame(0.52, catalogByKind("bath_sb184_1000gw")!.w, "right");
    expect(converted.alongEachWall).toBeCloseTo(0.52 / Math.SQRT2, 10);
    expect(converted.out).toBeCloseTo(0.52 / Math.SQRT2, 10);
    const hostPt = hostWasteInHostFrame(item("bath"));
    expect(hostPt.resolved).toBe(true);
    expect(hostPt.basis).toBe("derived");
    expect(hostPt.basis).not.toBe("published");
    expect(hostPt.datum).toMatch(/bisector/);
    expect(hostPt.datum).toMatch(/right-angle corner/);
    expect(hostPt.datum).toMatch(/not wasteFromEnd/);
    expect(hostPt.conversion).toMatch(/√2/);
    expect(hostPt.conversion).toMatch(/derived, not published/);
    expect(hostPt.source).toMatch(/published/);
    expect(item("bath").productSpecification?.fields.wasteFromCorner?.status).toBe("published");
    expect(item("bath").productSpecification?.fields.wasteFromEnd?.value).toBeNull();
    expect(item("bath").productSpecification?.fields.wasteFromSide?.value).toBeNull();
  });

  it("does not warn when the sample waste sits at the host waste point", () => {
    load();
    const hostPt = hostWasteInHostFrame(item("bath"));
    expect(item("bath_waste").fittedTo).toEqual({ hostId: "bath", across: hostPt.across, out: hostPt.out });
    expect(issues().map((i) => i.code)).not.toContain("fitted_waste_offset");
    expect(issues().map((i) => i.code)).not.toContain("fitted_waste_size");
    expect(fittedWasteProblems(store.getState().model)).toEqual([]);
  });

  it("warns at a 150 mm offset with both positions, their datums and sources", () => {
    load();
    const hostPt = hostWasteInHostFrame(item("bath"));
    expect(actions.fitItem("bath_waste", "bath", hostPt.across! + 0.15, hostPt.out!).ok).toBe(true);
    const warn = issues().find((i) => i.code === "fitted_waste_offset")!;
    expect(warn).toBeDefined();
    expect(warn.severity).toBe("warning");
    expect(warn.refs).toEqual(["bath_waste", "bath"]);
    expect(warn.message).toMatch(/150 mm/);
    expect(warn.message).toMatch(/FITTED_WASTE_OFFSET_TOLERANCE_M/);
    expect(warn.message).toMatch(/50 mm/);
    expect(warn.message).toMatch(/modelling\/set-out/);
    expect(warn.message).toMatch(/not a manufacturer figure/);
    expect(warn.message).toMatch(/across the host centreline/);
    expect(warn.message).toMatch(/back edge/);
    expect(warn.message).toMatch(/bisector/);
    expect(warn.message).toMatch(/right-angle corner/);
    expect(warn.message).toMatch(/derived/);
    expect(warn.message).toMatch(/enflair\.com/i);
    expect(warn.message).not.toMatch(/compli/i);
    expect(warn.message).not.toMatch(/approv/i);
    expect(warn.message).not.toMatch(/AS 3500/);
  });

  it("fits at the host waste point and then stays silent", () => {
    load();
    const at = item("bath_waste").fittedTo!;
    expect(actions.fitItem("bath_waste", "bath", at.across + 0.15, at.out).ok).toBe(true);
    expect(issues().some((i) => i.code === "fitted_waste_offset")).toBe(true);
    const r = actions.fitItem("bath_waste", "bath", undefined, undefined, true);
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/at its waste point/);
    const fitted = item("bath_waste").fittedTo!;
    const hostPt = hostWasteInHostFrame(item("bath"));
    expect(fitted.across).toBeCloseTo(hostPt.across!, 4);
    expect(fitted.out).toBeCloseTo(hostPt.out!, 4);
    expect(issues().map((i) => i.code)).not.toContain("fitted_waste_offset");
  });

  it("stays silent when the host waste point is unknown, and invents no figure", () => {
    load();
    const bath = item("bath");
    const fields = { ...bath.productSpecification!.fields, wasteFromCorner: { value: null, note: "Not on this sheet." }, wasteFromEnd: { value: null, note: "Unknown." }, wasteFromSide: { value: null, note: "Unknown." } };
    store.setState({ model: { ...store.getState().model, items: store.getState().model.items.map((i) => i.id === "bath" ? { ...i, productSpecification: { ...i.productSpecification!, fields } } : i) } });
    const hostPt = hostWasteInHostFrame(item("bath"));
    expect(hostPt.resolved).toBe(false);
    expect(hostPt.across).toBeUndefined();
    expect(hostPt.out).toBeUndefined();
    expect(fittedWasteProblems(store.getState().model).some((i) => i.code === "fitted_waste_offset")).toBe(false);
    const refused = actions.fitItem("bath_waste", "bath", undefined, undefined, true);
    expect(refused.ok).toBe(false);
    expect(refused.summary).toMatch(/No position is invented/);
  });

  it("does not compare a host waste hole with an accessory connection, even when both numbers are known", () => {
    load();
    expect(diametersAreLikeForLike("hole", "connection")).toBe(false);
    expect(diametersAreLikeForLike("outlet", "connection")).toBe(true);
    const waste = item("bath_waste");
    const fields = {
      ...waste.productSpecification!.fields,
      outletDiameter: pub(0.04, { reference: "fixture-centreline", note: "synthetic pipe connection" }),
      outletSizeKind: pub("connection"),
    };
    store.setState({ model: { ...store.getState().model, items: store.getState().model.items.map((i) => i.id === "bath_waste" ? { ...i, productSpecification: { ...i.productSpecification!, fields } } : i) } });
    expect(item("bath").productSpecification?.fields.wasteHoleDiameter?.value).toBe(0.05);
    expect(item("bath").productSpecification?.fields.wasteConnectionDiameter?.value).toBeNull();
    const acc = accessoryOutletDiameter(item("bath_waste"));
    expect(acc).toMatchObject({ known: true, kind: "connection", value: 0.04 });
    expect(fittedWasteProblems(store.getState().model).some((i) => i.code === "fitted_waste_size")).toBe(false);
  });

  it("warns on like-for-like pipe sizes when both are known, naming each kind", () => {
    load();
    const wasteFields = {
      ...item("bath_waste").productSpecification!.fields,
      outletDiameter: pub(0.04, { reference: "fixture-centreline" }),
      outletSizeKind: pub("outlet"),
    };
    const bathFields = {
      ...item("bath").productSpecification!.fields,
      wasteConnectionDiameter: pub(0.05, { reference: "fixture-centreline" }),
    };
    store.setState({
      model: {
        ...store.getState().model,
        items: store.getState().model.items.map((i) => {
          if (i.id === "bath_waste") return { ...i, productSpecification: { ...i.productSpecification!, fields: wasteFields } };
          if (i.id === "bath") return { ...i, productSpecification: { ...i.productSpecification!, fields: bathFields } };
          return i;
        }),
      },
    });
    const warn = fittedWasteProblems(store.getState().model).find((i) => i.code === "fitted_waste_size")!;
    expect(warn).toBeDefined();
    expect(warn.message).toMatch(/outlet/);
    expect(warn.message).toMatch(/connection/);
    expect(warn.message).toMatch(/40 mm/);
    expect(warn.message).toMatch(/50 mm/);
    expect(warn.message).toMatch(/published/);
    expect(warn.message).not.toMatch(/compli/i);
    expect(warn.message).not.toMatch(/approv/i);
  });

  it("stays silent when the accessory outlet size is unknown, and does not invent 40 mm from the carton onto the brief field", () => {
    load();
    expect(item("bath_waste").productSpecification?.fields.outletDiameter?.value).toBeNull();
    expect(accessoryOutletDiameter(item("bath_waste")).known).toBe(false);
    expect(fittedWasteProblems(store.getState().model).some((i) => i.code === "fitted_waste_size")).toBe(false);
    const carton = purchasedFittings.find((f) => f.kind === "waste_sdp40bn")!.measures.find((m) => m.key === "connection")!;
    expect(carton).toMatchObject({ value: 0.04, status: "published", source: "carton label" });
    expect(carton.status).not.toBe("measured");
  });

  it("skips a non-waste accessory fitted in the same host", () => {
    load();
    const mixer = item("bath_mixer");
    expect(mixer.productSpecification?.category).not.toBe("waste");
    const model: PlanModel = {
      ...store.getState().model,
      items: store.getState().model.items.map((i) => i.id === "bath_mixer" ? { ...i, fittedTo: { hostId: "bath", across: 0, out: 0.2 } } : i),
    };
    expect(fittedWasteProblems(model).some((i) => i.refs.includes("bath_mixer"))).toBe(false);
  });
});

describe("stopgap geometry is dashed from a flag, not from note text", () => {
  it("marks the sample waste parts stopgap and draws dashed edges", () => {
    load();
    const waste = purchasedFittings.find((f) => f.kind === "waste_sdp40bn")!;
    expect(waste.parts.every((p) => p.stopgap === true)).toBe(true);
    expect(catalogByKind("waste_sdp40bn")?.stopgap).toBe(true);
    const group = buildFurniture("waste_sdp40bn")!;
    expect(group.children.every((c) => c.userData.stopgap === true)).toBe(true);
    const notes = waste.measures.map((m) => m.note ?? "").join(" ");
    expect(notes).toMatch(/stand-in/);
  });

  it("does not dash a part whose note mentions a stand-in when the flag is off", () => {
    const parts: PartSpec[] = [{ shape: "box", w: 0.1, d: 0.1, h: 0.1, y: 0 }];
    expect(parts[0].stopgap).toBeUndefined();
    actions.defineItemKind({ kind: "solid_box", label: "Solid", w: 0.1, d: 0.1, h: 0.1, parts });
    const group = buildFurniture("solid_box")!;
    expect(group.children.some((c) => c.userData.stopgap)).toBe(false);
    expect(catalogByKind("solid_box")?.stopgap).toBeUndefined();
  });

  it("dashes the waste on the plan sheet from the stopgap flag", () => {
    load();
    const model = store.getState().model;
    const floor = renderFloorPlan(model, { sheet: "floor-plan", findings: [], revision: null });
    expect(floor).toMatch(/stroke-dasharray="1\.2 0\.6"[^>]*data-item="bath_waste"/);
    const vis = resolveVisible(model, catalogue(model).elements.map((e) => e.id));
    const stage = renderStageDiagram(model, vis.elements, { label: "Test", findings: [] });
    expect(stage).toMatch(/stroke-dasharray="1\.2 0\.6"[^>]*data-element="item:bath_waste"/);
    expect(stage).not.toMatch(/stroke-dasharray="1\.2 0\.6"[^>]*data-element="item:bath"/);
  });
});

describe("fitted waste parts stay inside the checked envelope", () => {
  it("keeps the SDP-40BN dome inside 70 × 70 × 20 mm at elevation 0.59", () => {
    const waste = purchasedFittings.find((f) => f.kind === "waste_sdp40bn")!;
    const { w, d, h, elevation = 0 } = waste.size;
    expect({ w, d, h, elevation }).toMatchObject({ w: 0.07, d: 0.07, h: 0.02, elevation: 0.59 });
    for (const p of waste.parts) {
      const pw = p.w ?? 0.3, ph = p.h ?? 0.3, pd = p.d ?? 0.3;
      expect((p.x ?? 0) - pw / 2).toBeGreaterThanOrEqual(-w / 2 - 1e-6);
      expect((p.x ?? 0) + pw / 2).toBeLessThanOrEqual(w / 2 + 1e-6);
      expect((p.z ?? 0) - pd / 2).toBeGreaterThanOrEqual(-d / 2 - 1e-6);
      expect((p.z ?? 0) + pd / 2).toBeLessThanOrEqual(d / 2 + 1e-6);
      expect(p.y ?? 0).toBeGreaterThanOrEqual(elevation - 1e-6);
      expect((p.y ?? 0) + ph).toBeLessThanOrEqual(elevation + h + 1e-4);
    }
  });
});
