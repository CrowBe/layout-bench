import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { checkModel } from "../src/model/issues";
import { demoProject } from "../src/model/projects";
import { catalogByKind, resetRuntimeCatalog } from "../src/model/catalog";
import { purchasedFittings } from "../src/model/seed-bathroom";
import { emptyModel, type PlanModel } from "../src/model/types";
import { buildFurniture } from "../src/three/furniture";
import { catalogue, renderStageDiagram, resolveVisible, specRows } from "../src/sheets/stageView";
import { renderFloorPlan } from "../src/sheets/floorPlan";
import { roughIn } from "../src/model/fixtures";
import { toWorld } from "../src/model/outline";
import { PRECISION, quantize } from "../src/model/geometry";
import {
  FITTED_WASTE_OFFSET_TOLERANCE_M,
  FITTED_WASTE_SIZE_EPSILON_M,
  accessoryOutletDiameter,
  cornerBisectorToHostFrame,
  diametersAreLikeForLike,
  fittedWasteProblems,
  hostWasteInHostFrame,
  isDerivedServicePoint,
  CORNER_HAND_REANCHOR,
} from "../src/model/fittedWaste";
import { categoryById, roughInPoints, validateSubmission, axisDisplayText, type FieldValue, type SpecSubmission } from "../src/model/products";
import { previewProductUpdate } from "../src/model/productUpdates";
import type { PartSpec } from "../src/three/furniture";
import type { LibraryProduct } from "../src/model/productLibrary";

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
    expect(FITTED_WASTE_SIZE_EPSILON_M).toBe(0.0005);
  });

  it("converts the sheet's 520 mm on the bisector as 520/√2 along each wall and labels the host-frame result derived", () => {
    load();
    const cat = catalogByKind("bath_sb184_1000gw")!;
    const exactAcross = cat.w / 2 - 0.52 / Math.SQRT2;
    const exactOut = 0.52 / Math.SQRT2;
    const converted = cornerBisectorToHostFrame(0.52, cat.w, "right");
    expect(converted.alongEachWall).toBeCloseTo(0.52 / Math.SQRT2, 10);
    expect(converted.out).toBeCloseTo(exactOut, 10);
    expect(converted.across).toBeCloseTo(exactAcross, 10);
    expect(converted.across).toBeCloseTo(+(cat.w / 2 - 0.52 / Math.SQRT2), 10);
    const hostPt = hostWasteInHostFrame(item("bath"));
    expect(hostPt.resolved).toBe(true);
    expect(hostPt.basis).toBe("derived");
    expect(hostPt.basis).not.toBe("published");
    expect(hostPt.across).toBe(quantize(exactAcross));
    expect(hostPt.out).toBe(quantize(exactOut));
    expect(PRECISION).toBe(1e-4);
    expect(Math.abs(item("bath_waste").fittedTo!.across - exactAcross)).toBeLessThanOrEqual(PRECISION);
    expect(Math.abs(item("bath_waste").fittedTo!.out - exactOut)).toBeLessThanOrEqual(PRECISION);
    const [cornerWorld] = toWorld([cat.outline!.start], item("bath"));
    const waste = item("bath_waste");
    expect(Math.hypot(waste.x - cornerWorld.x, waste.y - cornerWorld.y)).toBeCloseTo(0.52, 3);
    expect(waste.x - cornerWorld.x).toBeCloseTo(-exactOut, 3);
    expect(waste.y - cornerWorld.y).toBeCloseTo(exactOut, 3);
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
    expect(item("bath_waste").productSpecification?.fields.outletSizeKind).toMatchObject({
      value: "connection", status: "published", source: "carton label",
    });
    expect(item("bath_waste").productSpecification?.fields.outletSizeKind?.status).not.toBe("measured");
  });

  it("names a carton-label source on an SDP-40BN size warning", () => {
    load();
    const wasteFields = {
      ...item("bath_waste").productSpecification!.fields,
      outletDiameter: {
        value: 0.04,
        status: "published" as const,
        source: "carton label",
        reference: "fixture-centreline" as const,
        note: "Photographed carton: Dome Pop Short Bath Waste 40mm",
      },
      outletSizeKind: {
        value: "connection" as const,
        status: "published" as const,
        source: "carton label",
        note: "Photographed carton: 40 mm is the pipe connection",
      },
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
    expect(warn.message).toMatch(/carton label/);
    expect(warn.message).toMatch(/40 mm/);
    expect(warn.message).toMatch(/connection/);
  });

  it("requires wasteFromCorner for a corner-round bath and does not require end/side", () => {
    const cat = categoryById("bath")!;
    const corner: SpecSubmission = {
      manufacturer: "Example Co", model: "Corner",
      fields: {
        length: pub(1), width: pub(1), height: pub(0.5), installation: pub("corner"), shape: pub("corner-round"),
        frontWidth: pub(1.178), frontProjection: pub(1.09), wasteFromCorner: pub(0.52), surround: pub("none-required"),
      },
    };
    const problems = validateSubmission(cat, corner);
    expect(problems.filter((p) => p.field === "wasteFromEnd" || p.field === "wasteFromSide")).toEqual([]);
    expect(problems.some((p) => p.field === "wasteFromCorner")).toBe(false);
    const points = roughInPoints(cat, corner.fields);
    expect(points[0]).toMatchObject({ resolved: true, missing: [] });
    expect(points[0].across).toMatchObject({ field: "wasteFromCorner", basis: "derived", from: "fixture-end" });
    expect(points[0].out).toMatchObject({ field: "wasteFromCorner", basis: "derived", from: "fixture-side" });
    expect(points[0].across!.value).toBeCloseTo(0.52 / Math.SQRT2, 10);
    expect(points[0].out!.value).toBeCloseTo(0.52 / Math.SQRT2, 10);
    expect(points[0].across!.basis).not.toBe("published");
    expect(points[0].across!.evidence).toMatchObject({ value: 0.52, status: "published" });
    expect(axisDisplayText(points[0].across)).toMatch(/along each wall from the right-angle corner, derived/);
    expect(axisDisplayText(points[0].out)).toMatch(/along each wall from the right-angle corner, derived/);
    expect(axisDisplayText(points[0].across)).not.toMatch(/from fixture end/);
    expect(axisDisplayText(points[0].out)).not.toMatch(/from fixture side/);
    const missingCorner = { ...corner, fields: { ...corner.fields } };
    delete missingCorner.fields.wasteFromCorner;
    expect(validateSubmission(cat, missingCorner).some((p) => p.field === "wasteFromCorner" && p.code === "field_missing")).toBe(true);
  });

  it("requires wasteFromEnd/wasteFromSide when shape is unknown, as required_unknown", () => {
    const cat = categoryById("bath")!;
    const unknownShape: SpecSubmission = {
      manufacturer: "Example Co", model: "Unknown shape",
      fields: {
        length: pub(1.675), width: pub(0.75), height: pub(0.45), installation: pub("freestanding"),
        shape: { value: null, note: "Sheet does not name the plan shape." },
        wasteFromEnd: { value: null, note: "Unknown because the plan shape is unknown." },
        wasteFromSide: { value: null, note: "Unknown because the plan shape is unknown." },
      },
    };
    const problems = validateSubmission(cat, unknownShape);
    expect(problems.some((p) => p.field === "wasteFromEnd" && p.code === "required_unknown")).toBe(true);
    expect(problems.some((p) => p.field === "wasteFromSide" && p.code === "required_unknown")).toBe(true);
    expect(problems.some((p) => p.field === "wasteFromCorner" && (p.code === "required_unknown" || p.code === "field_missing"))).toBe(false);
  });

  it("requires wasteFromEnd/wasteFromSide for a rectangular bath and not wasteFromCorner", () => {
    const cat = categoryById("bath")!;
    const rect: SpecSubmission = {
      manufacturer: "Example Co", model: "Rect",
      fields: {
        length: pub(1.675), width: pub(0.75), height: pub(0.45), installation: pub("freestanding"), shape: pub("rectangular"),
        wasteFromEnd: pub(0.2), wasteFromSide: pub(0.375),
      },
    };
    expect(validateSubmission(cat, rect).filter((p) => p.field === "wasteFromCorner")).toEqual([]);
    expect(validateSubmission(cat, rect)).toEqual([]);
    const points = roughInPoints(cat, rect.fields);
    expect(points[0]).toMatchObject({ resolved: true });
    expect(points[0].across).toMatchObject({ field: "wasteFromEnd", value: 0.2 });
    expect(axisDisplayText(points[0].across)).toMatch(/from fixture end/);
    expect(axisDisplayText(points[0].across)).not.toMatch(/along each wall/);
    expect(points[0].across?.basis).not.toBe("derived");
    const missingEnd = { ...rect, fields: { ...rect.fields } };
    delete missingEnd.fields.wasteFromEnd;
    delete missingEnd.fields.wasteFromSide;
    const codes = validateSubmission(cat, missingEnd);
    expect(codes.some((p) => p.field === "wasteFromEnd" && p.code === "field_missing")).toBe(true);
    expect(codes.some((p) => p.field === "wasteFromSide" && p.code === "field_missing")).toBe(true);
    expect(codes.some((p) => p.field === "wasteFromCorner")).toBe(false);
  });

  it("places a library corner bath with a resolved waste point from wasteFromCorner", () => {
    const wall = actions.addWall(0, 0, 2.11, 0, 0.1, 2.4).id as string;
    actions.setWallSide(wall, "right", { existing: { value: 0, status: "measured" }, layers: [] });
    const fields = {
      length: pub(1), width: pub(1), height: pub(0.63), installation: pub("corner"), shape: pub("corner-round"),
      frontWidth: pub(1.178), frontProjection: pub(1.09), wasteFromCorner: pub(0.52), surround: pub("none-required"),
    };
    const product: LibraryProduct = {
      id: "angie-corner-waste", category: "bath", manufacturer: "Example Co", model: "Corner",
      fields, roughIn: roughInPoints(categoryById("bath")!, fields), requestId: "r", acceptedAt: 0,
    };
    expect(product.roughIn[0].resolved).toBe(true);
    expect(product.roughIn[0].across?.basis).toBe("derived");
    const placed = actions.placeProduct(product, { wallId: wall, side: "right", face: "existing", distance: 0.55, status: "proposed" });
    expect(placed.ok).toBe(true);
    const bath = item(placed.id as string);
    const sp = bath.servicePoints?.find((p) => p.id === "waste");
    expect(sp?.across).toBeDefined();
    expect(sp?.out).toBeDefined();
    const hostPt = hostWasteInHostFrame(bath);
    expect(hostPt.resolved).toBe(true);
    expect(hostPt.across).toBeCloseTo(sp!.across!, 4);
    expect(hostPt.out).toBeCloseTo(sp!.out! - 0, 3);
    expect(sp!.source).toMatch(/derived from wasteFromCorner/);
    expect(sp!.source).toMatch(/not published/);
    expect(sp!.status).toBe("derived");
    expect(sp!.status).not.toBe("published");
    expect(sp!.basis).toBe("derived");
    expect(sp!.axisEvidence?.across?.status).toBe("published");
    expect(sp!.axisEvidence?.out?.status).toBe("published");
    const model = store.getState().model;
    expect(roughIn(model, bath).find((r) => r.pointId === "waste")?.status).toBe("derived");
    const rows = specRows(model, {
      id: `rough-in:${bath.id}:${sp!.id}`, layer: "services-waste", type: "service-point",
      ref: bath.id, sub: sp!.id, label: "Bath waste",
    });
    expect(rows.find((r) => r.property.startsWith("out from"))).toMatchObject({ status: "derived" });
    expect(rows.find((r) => r.property.startsWith("across"))).toMatchObject({ status: "derived" });
    expect(rows.find((r) => r.property === "across source evidence")).toMatchObject({ status: "published" });
    expect(rows.find((r) => r.property === "out source evidence")).toMatchObject({ status: "published" });
    const floor = renderFloorPlan(model, { sheet: "floor-plan", findings: [], revision: null });
    expect(floor).toMatch(/Bath waste:[^<\n]* DER/);
    expect(floor).not.toMatch(/Bath waste:[^<\n]* PUB/);
    expect(floor).toMatch(/DER derived/);
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

  it("compares a rectangular bath via end/side even when a leftover wasteFromCorner is present", () => {
    const wall = actions.addWall(0, 0, 3, 0, 0.1, 2.4).id as string;
    actions.setWallSide(wall, "right", { existing: { value: 0, status: "measured" }, layers: [] });
    const fields = {
      length: pub(1.675), width: pub(0.75), height: pub(0.45), installation: pub("freestanding"), shape: pub("rectangular"),
      wasteFromEnd: pub(0.2), wasteEnd: pub("right"), wasteFromSide: pub(0.375),
      wasteFromCorner: pub(0.52),
    };
    const product: LibraryProduct = {
      id: "rect-leftover-corner", category: "bath", manufacturer: "Example Co", model: "Rect leftover",
      fields, roughIn: roughInPoints(categoryById("bath")!, fields), requestId: "r", acceptedAt: 0,
    };
    const placed = actions.placeProduct(product, { wallId: wall, side: "right", face: "existing", distance: 1, status: "proposed" });
    expect(placed.ok).toBe(true);
    const bath = item(placed.id as string);
    const hostPt = hostWasteInHostFrame(bath, catalogByKind, store.getState().model);
    expect(hostPt.resolved).toBe(true);
    expect(hostPt.fromCorner).toBeUndefined();
    expect(hostPt.out).toBeCloseTo(0.375, 4);
    expect(hostPt.across).toBeCloseTo(1.675 / 2 - 0.2, 4);
    expect(hostPt.datum).toMatch(/wasteFromEnd/);
    expect(hostPt.datum).not.toMatch(/bisector/);
    const sp = bath.servicePoints?.find((p) => p.id === "waste");
    expect(sp?.status).toBe("derived");
    expect(sp?.status).not.toBe("published");
    expect(sp?.basis).toBe("derived");
    expect(sp?.across).toBe(hostPt.across);
    expect(sp?.axisEvidence?.across?.status).toBe("published");
    expect(sp?.axisEvidence?.out?.status).toBe("published");
    actions.defineItemKind({ kind: "test_waste", label: "Test waste", w: 0.05, d: 0.05, h: 0.02 });
    const wasteId = actions.placeItem("test_waste", 0, 0).id as string;
    store.setState({
      model: {
        ...store.getState().model,
        items: store.getState().model.items.map((i) => i.id === wasteId ? { ...i, productSpecification: { category: "waste", fields: {}, acceptedAt: 1 } } : i),
      },
    });
    expect(actions.fitItem(wasteId, bath.id, hostPt.across! + 0.15, hostPt.out!).ok).toBe(true);
    expect(fittedWasteProblems(store.getState().model).some((i) => i.code === "fitted_waste_offset")).toBe(true);
    expect(actions.fitItem(wasteId, bath.id, hostPt.across, hostPt.out).ok).toBe(true);
    expect(fittedWasteProblems(store.getState().model).some((i) => i.code === "fitted_waste_offset")).toBe(false);
  });

  it("does not lock incomplete end/side waste as a derived conversion", () => {
    const wall = actions.addWall(0, 0, 3, 0, 0.1, 2.4).id as string;
    actions.setWallSide(wall, "right", { existing: { value: 0, status: "measured" }, layers: [] });
    const fields = {
      length: pub(1.675), width: pub(0.75), height: pub(0.45), installation: pub("freestanding"), shape: pub("rectangular"),
      wasteFromEnd: pub(0.2), wasteFromSide: pub(0.375),
    };
    const product: LibraryProduct = {
      id: "incomplete-end-side", category: "bath", manufacturer: "Example Co", model: "Incomplete waste",
      fields, roughIn: roughInPoints(categoryById("bath")!, fields), requestId: "r", acceptedAt: 0,
    };
    const placed = actions.placeProduct(product, { wallId: wall, side: "right", face: "existing", distance: 1, status: "proposed" });
    expect(placed.ok).toBe(true);
    const bath = item(placed.id as string);
    const sp = bath.servicePoints?.find((p) => p.id === "waste");
    expect(sp?.across).toBeUndefined();
    expect(sp?.out).toBeUndefined();
    expect(sp?.status).not.toBe("published");
    expect(sp?.status).not.toBe("derived");
    expect(sp?.basis).not.toBe("derived");
    if (sp) expect(isDerivedServicePoint(sp)).toBe(false);
    expect(hostWasteInHostFrame(bath, catalogByKind, store.getState().model).resolved).toBe(false);
    const written = actions.setServicePoint(bath.id, {
      id: "waste", label: "Bath waste", service: "waste", face: "existing",
      across: 0.1, out: 0.375, status: "proposed",
    });
    expect(written.ok).toBe(true);
    expect(item(bath.id).servicePoints!.find((p) => p.id === "waste")).toMatchObject({
      across: 0.1, out: 0.375, status: "proposed",
    });
    expect(actions.removeServicePoint(bath.id, "waste").ok).toBe(true);
    expect(item(bath.id).servicePoints?.find((p) => p.id === "waste")).toBeUndefined();
    const completeFields = { ...fields, wasteEnd: pub("right") };
    const target = {
      ...structuredClone(product),
      id: "incomplete-end-side-v2",
      revision: { seriesId: product.id, number: 2, parentProductId: product.id },
      fields: completeFields,
      roughIn: roughInPoints(categoryById("bath")!, completeFields),
    };
    const preview = previewProductUpdate(store.getState().model, target, [bath.id], [product, target]);
    expect(preview.rows[0].blocked).toBeUndefined();
    const after = preview.rows[0].after!.servicePoints!.find((p) => p.id === "waste");
    expect(after?.across).toBeDefined();
    expect(after?.out).toBeDefined();
    expect(after?.status).toBe("derived");
    expect(after?.basis).toBe("derived");
  });

  it("resolves a corner-round bath drawn as a box from the wall corner, and placeProduct agrees with fittedWasteProblems", () => {
    const wall = actions.addWall(0, 0, 2.11, 0, 0.1, 2.4).id as string;
    actions.setWallSide(wall, "right", { existing: { value: 0, status: "measured" }, layers: [] });
    const fields = {
      length: pub(1), width: pub(1), height: pub(0.63), installation: pub("corner"), shape: pub("corner-round"),
      frontWidth: { value: null, note: "Not on this sheet; drawn as its box." },
      frontProjection: { value: null, note: "Not on this sheet; drawn as its box." },
      wasteFromCorner: pub(0.52), surround: pub("none-required"),
    };
    const product: LibraryProduct = {
      id: "box-corner-waste", category: "bath", manufacturer: "Example Co", model: "Box corner",
      fields, roughIn: roughInPoints(categoryById("bath")!, fields), requestId: "r", acceptedAt: 0,
    };
    const placed = actions.placeProduct(product, { wallId: wall, side: "right", face: "existing", distance: 0.55, status: "proposed" });
    expect(placed.ok).toBe(true);
    const bath = item(placed.id as string);
    expect(bath.corner?.side).toBeDefined();
    expect(catalogByKind(bath.kind)?.outline).toBeUndefined();
    const sp = bath.servicePoints?.find((p) => p.id === "waste");
    const hostPt = hostWasteInHostFrame(bath, catalogByKind, store.getState().model);
    expect(hostPt.resolved).toBe(true);
    expect(hostPt.fromCorner).toBe(0.52);
    expect(hostPt.basis).toBe("derived");
    expect(sp?.status).toBe("derived");
    expect(hostPt.across).toBeCloseTo(sp!.across!, 4);
    expect(hostPt.out).toBeCloseTo(sp!.out! - (bath.anchor?.gap ?? 0), 4);
    expect(hostWasteInHostFrame(bath).resolved).toBe(true);
    actions.defineItemKind({ kind: "test_waste", label: "Test waste", w: 0.05, d: 0.05, h: 0.02 });
    const wasteId = actions.placeItem("test_waste", 0, 0).id as string;
    store.setState({
      model: {
        ...store.getState().model,
        items: store.getState().model.items.map((i) => i.id === wasteId ? { ...i, productSpecification: { category: "waste", fields: {}, acceptedAt: 1 } } : i),
      },
    });
    expect(actions.fitItem(wasteId, bath.id, hostPt.across! + 0.15, hostPt.out!).ok).toBe(true);
    expect(fittedWasteProblems(store.getState().model).some((i) => i.code === "fitted_waste_offset")).toBe(true);
    const atPoint = actions.fitItem(wasteId, bath.id, undefined, undefined, true);
    expect(atPoint.ok).toBe(true);
    expect(fittedWasteProblems(store.getState().model).some((i) => i.code === "fitted_waste_offset")).toBe(false);
  });

  it("treats a derived waste point as read-only except a sourced measured or site-confirmed replacement", () => {
    const wall = actions.addWall(0, 0, 2.11, 0, 0.1, 2.4).id as string;
    actions.setWallSide(wall, "right", { existing: { value: 0, status: "measured" }, layers: [] });
    const fields = {
      length: pub(1), width: pub(1), height: pub(0.63), installation: pub("corner"), shape: pub("corner-round"),
      frontWidth: pub(1.178), frontProjection: pub(1.09), wasteFromCorner: pub(0.52), surround: pub("none-required"),
    };
    const product: LibraryProduct = {
      id: "derived-point-guard", category: "bath", manufacturer: "Example Co", model: "Corner",
      fields, roughIn: roughInPoints(categoryById("bath")!, fields), requestId: "r", acceptedAt: 0,
    };
    const placed = actions.placeProduct(product, { wallId: wall, side: "right", face: "existing", distance: 0.55, status: "proposed" });
    expect(placed.ok).toBe(true);
    const bath = item(placed.id as string);
    const sp = bath.servicePoints!.find((p) => p.id === "waste")!;
    expect(sp.status).toBe("derived");
    const published = actions.setServicePoint(bath.id, {
      id: "waste", label: sp.label, service: "waste", face: sp.face,
      across: sp.across, out: sp.out, status: "published",
    });
    expect(published.ok).toBe(false);
    expect(published.summary).toMatch(/read-only/i);
    expect(published.summary).toMatch(/published/i);
    const removed = actions.removeServicePoint(bath.id, "waste");
    expect(removed.ok).toBe(false);
    expect(removed.summary).toMatch(/read-only/i);
    expect(removed.summary).toMatch(/measured or site-confirmed/);
    expect(removed.summary).toMatch(/source/);
    expect(item(bath.id).servicePoints!.find((p) => p.id === "waste")?.status).toBe("derived");
    expect(item(bath.id).servicePoints!.find((p) => p.id === "waste")?.across).toBe(sp.across);
    const proposed = actions.setServicePoint(bath.id, {
      id: "waste", label: sp.label, service: "waste", face: sp.face,
      across: 0.5, out: sp.out, status: "proposed",
    });
    expect(proposed.ok).toBe(false);
    expect(proposed.summary).toMatch(/read-only/i);
    expect(proposed.summary).toMatch(/proposed/i);
    expect(item(bath.id).servicePoints!.find((p) => p.id === "waste")?.across).toBe(sp.across);
    expect(item(bath.id).servicePoints!.find((p) => p.id === "waste")?.status).toBe("derived");
    const estimated = actions.setServicePoint(bath.id, {
      id: "waste", label: sp.label, service: "waste", face: sp.face,
      across: sp.across, out: sp.out, status: "estimated",
    });
    expect(estimated.ok).toBe(false);
    const noSource = actions.setServicePoint(bath.id, {
      id: "waste", label: sp.label, service: "waste", face: sp.face,
      across: sp.across, out: sp.out, status: "measured",
    });
    expect(noSource.ok).toBe(false);
    expect(noSource.summary).toMatch(/source/i);
    expect(item(bath.id).servicePoints!.find((p) => p.id === "waste")?.status).toBe("derived");
    const measured = actions.setServicePoint(bath.id, {
      id: "waste", label: sp.label, service: "waste", face: sp.face,
      across: sp.across, out: sp.out, status: "measured", source: "tape from the finished wall face",
    });
    expect(measured.ok).toBe(true);
    expect(measured.summary).toMatch(/measured/);
    const next = item(bath.id).servicePoints!.find((p) => p.id === "waste")!;
    expect(next.status).toBe("measured");
    expect(next.basis).toBeUndefined();
    expect(next.axisEvidence).toBeUndefined();
    expect(next.source).toMatch(/tape from the finished wall face/);
  });

  it("leaves corner hand, outline, kind and service points untouched when a wall edit flips the nearer end", () => {
    const wall = actions.addWall(0, 0, 2.11, 0, 0.1, 2.4).id as string;
    actions.setWallSide(wall, "right", { existing: { value: 0, status: "measured" }, layers: [] });
    const fields = {
      length: pub(1), width: pub(1), height: pub(0.63), installation: pub("corner"), shape: pub("corner-round"),
      frontWidth: pub(1.178), frontProjection: pub(1.09), wasteFromCorner: pub(0.52), surround: pub("none-required"),
    };
    const product: LibraryProduct = {
      id: "wall-flip-corner", category: "bath", manufacturer: "Example Co", model: "Corner",
      fields, roughIn: roughInPoints(categoryById("bath")!, fields), requestId: "r", acceptedAt: 0,
    };
    const placed = actions.placeProduct(product, { wallId: wall, side: "right", face: "existing", distance: 0.55, status: "proposed" });
    expect(placed.ok).toBe(true);
    const bathId = placed.id as string;
    const before = structuredClone(item(bathId));
    const beforePt = hostWasteInHostFrame(before, catalogByKind, store.getState().model);
    expect(beforePt.resolved).toBe(true);
    actions.defineItemKind({ kind: "test_waste", label: "Test waste", w: 0.05, d: 0.05, h: 0.02 });
    const wasteId = actions.placeItem("test_waste", 0, 0).id as string;
    store.setState({
      model: {
        ...store.getState().model,
        items: store.getState().model.items.map((i) => i.id === wasteId ? { ...i, productSpecification: { category: "waste", fields: {}, acceptedAt: 1 } } : i),
      },
    });
    expect(actions.fitItem(wasteId, bathId, undefined, undefined, true).ok).toBe(true);
    expect(fittedWasteProblems(store.getState().model).some((i) => i.code === "fitted_waste_offset")).toBe(false);
    expect(actions.editWall(wall, { bx: 1.0 }).ok).toBe(true);
    const after = item(bathId);
    expect(after.corner).toEqual(before.corner);
    expect(after.kind).toBe(before.kind);
    expect(after.productGeometry?.outline).toEqual(before.productGeometry?.outline);
    expect(after.servicePoints).toEqual(before.servicePoints);
    expect(hostWasteInHostFrame(after, catalogByKind, store.getState().model).resolved).toBe(false);
    expect(fittedWasteProblems(store.getState().model).some((i) => i.code === "fitted_waste_offset")).toBe(false);
    const review = issues().find((i) => i.code === "fixture_corner_hand_review");
    expect(review).toBeDefined();
    expect(review!.message).toMatch(CORNER_HAND_REANCHOR);
    expect(review!.message).not.toMatch(/Re-anchor the fixture/);
    expect(review!.message).toMatch(/not a manufacturer figure/);
    expect(review!.message).toMatch(/compliance/);
  });

  it("refuses re-anchor of a derived corner waste and leaves the fixture unchanged", () => {
    const wall = actions.addWall(0, 0, 2.11, 0, 0.1, 2.4).id as string;
    actions.setWallSide(wall, "right", { existing: { value: 0, status: "measured" }, layers: [] });
    const fields = {
      length: pub(1), width: pub(1), height: pub(0.63), installation: pub("corner"), shape: pub("corner-round"),
      frontWidth: pub(1.178), frontProjection: pub(1.09), wasteFromCorner: pub(0.52), surround: pub("none-required"),
    };
    const product: LibraryProduct = {
      id: "derived-reanchor-cut", category: "bath", manufacturer: "Example Co", model: "Corner",
      fields, roughIn: roughInPoints(categoryById("bath")!, fields), requestId: "r", acceptedAt: 0,
    };
    const placed = actions.placeProduct(product, { wallId: wall, side: "right", face: "existing", distance: 0.55, status: "proposed" });
    expect(placed.ok).toBe(true);
    const bathId = placed.id as string;
    expect(item(bathId).servicePoints!.find((p) => p.id === "waste")?.status).toBe("derived");
    expect(actions.editWall(wall, { bx: 1.0 }).ok).toBe(true);
    const before = structuredClone(item(bathId));
    const review = issues().find((i) => i.code === "fixture_corner_hand_review");
    expect(review).toBeDefined();
    expect(review!.message).toMatch(CORNER_HAND_REANCHOR);
    expect(review!.message).not.toMatch(/Re-anchor the fixture/);
    const re = actions.anchorFixture(bathId, { wallId: wall, side: "right", face: "existing", distance: 0.55, status: "proposed" });
    expect(re.ok).toBe(false);
    expect(re.summary).toBe(CORNER_HAND_REANCHOR);
    expect(item(bathId).corner).toEqual(before.corner);
    expect(item(bathId).kind).toBe(before.kind);
    expect(item(bathId).productGeometry?.outline).toEqual(before.productGeometry?.outline);
    expect(item(bathId).servicePoints).toEqual(before.servicePoints);
    expect(issues().some((i) => i.code === "fixture_corner_hand_review")).toBe(true);
  });

  it("does not mutate a known-hand product, sourced installationGeometry, or a sourced site waste when a wall edit flips the nearer end", () => {
    const wall = actions.addWall(0, 0, 2.11, 0, 0.1, 2.4).id as string;
    actions.setWallSide(wall, "right", { existing: { value: 0, status: "measured" }, layers: [] });
    const fields = {
      length: pub(1), width: pub(1), height: pub(0.63), installation: pub("corner"), shape: pub("corner-round"),
      frontWidth: pub(1.178), frontProjection: pub(1.09), wasteFromCorner: pub(0.52), surround: pub("none-required"),
    };
    const geomSrc = [{ url: "https://example.com/synthetic.pdf", locator: "p. 1, synthetic" }];
    const handed: LibraryProduct = {
      id: "known-hand-bath", category: "bath", manufacturer: "Example Co", model: "Left corner",
      fields, roughIn: roughInPoints(categoryById("bath")!, fields), requestId: "r", acceptedAt: 0,
      identity: {
        code: { state: "unknown", value: null },
        finish: { state: "unknown", value: null },
        configuration: { state: "unknown", value: null },
        handedness: { state: "known", value: "left", sources: geomSrc },
      },
    };
    const placedHand = actions.placeProduct(handed, { wallId: wall, side: "right", face: "existing", distance: 0.55, status: "proposed" });
    expect(placedHand.ok).toBe(true);
    const handId = placedHand.id as string;
    const beforeHand = structuredClone(item(handId));
    expect(actions.editWall(wall, { bx: 1.0 }).ok).toBe(true);
    expect(item(handId).kind).toBe(beforeHand.kind);
    expect(item(handId).corner).toEqual(beforeHand.corner);
    expect(item(handId).productGeometry?.outline).toEqual(beforeHand.productGeometry?.outline);
    expect(item(handId).servicePoints).toEqual(beforeHand.servicePoints);
    expect(issues().some((i) => i.code === "fixture_corner_hand_review" && i.refs.includes(handId))).toBe(true);
    expect(actions.editWall(wall, { bx: 2.11 }).ok).toBe(true);

    const withGeom: LibraryProduct = {
      id: "geom-corner-bath", category: "bath", manufacturer: "Example Co", model: "With geometry",
      fields, roughIn: roughInPoints(categoryById("bath")!, fields), requestId: "r2", acceptedAt: 0,
    };
    const placedGeom = actions.placeProduct(withGeom, { wallId: wall, side: "right", face: "existing", distance: 0.55, status: "proposed" });
    expect(placedGeom.ok).toBe(true);
    const geomId = placedGeom.id as string;
    const installationGeometry = {
      status: "published" as const, sources: geomSrc,
      datum: { across: "fixture-centreline" as const, out: "fixture-back" as const, up: "fixture-bottom" as const },
      handedness: "reversible" as const,
      fixings: [{ id: "bracket", label: "Bracket", x: 0.2, y: 0, z: 0.3, status: "published" as const, sources: geomSrc }],
      clearances: [{ id: "lift", label: "Lift", direction: "above" as const, distance: 0.05, status: "published" as const, sources: geomSrc }],
      outline: { status: "published" as const, sources: geomSrc, datum: { across: "fixture-centreline" as const, out: "footprint-centre" as const }, limitation: "Envelope only." },
    };
    store.setState({
      model: {
        ...store.getState().model,
        items: store.getState().model.items.map((i) => i.id === geomId ? { ...i, installationGeometry: structuredClone(installationGeometry) } : i),
      },
    });
    const beforeGeom = structuredClone(item(geomId));
    expect(actions.editWall(wall, { bx: 1.0 }).ok).toBe(true);
    expect(item(geomId).installationGeometry).toEqual(beforeGeom.installationGeometry);
    expect(item(geomId).corner).toEqual(beforeGeom.corner);
    expect(item(geomId).kind).toBe(beforeGeom.kind);
    expect(item(geomId).servicePoints).toEqual(beforeGeom.servicePoints);
    expect(actions.editWall(wall, { bx: 2.11 }).ok).toBe(true);

    const measuredProd: LibraryProduct = {
      id: "measured-waste-bath", category: "bath", manufacturer: "Example Co", model: "Measured",
      fields, roughIn: roughInPoints(categoryById("bath")!, fields), requestId: "r3", acceptedAt: 0,
    };
    const placedM = actions.placeProduct(measuredProd, { wallId: wall, side: "right", face: "existing", distance: 0.55, status: "proposed" });
    expect(placedM.ok).toBe(true);
    const mId = placedM.id as string;
    const sp = item(mId).servicePoints!.find((p) => p.id === "waste")!;
    expect(actions.setServicePoint(mId, {
      id: "waste", label: sp.label, service: "waste", face: sp.face,
      across: sp.across, out: sp.out, status: "measured", source: "tape from the finished wall face",
    }).ok).toBe(true);
    const beforeMeasured = structuredClone(item(mId));
    expect(actions.editWall(wall, { bx: 1.0 }).ok).toBe(true);
    const afterMeasured = item(mId);
    expect(afterMeasured.servicePoints).toEqual(beforeMeasured.servicePoints);
    expect(afterMeasured.servicePoints!.find((p) => p.id === "waste")?.status).toBe("measured");
    expect(afterMeasured.corner).toEqual(beforeMeasured.corner);
    expect(afterMeasured.kind).toBe(beforeMeasured.kind);
    expect(afterMeasured.productGeometry?.outline).toEqual(beforeMeasured.productGeometry?.outline);
  });

  it("fitted check reads productSpecification fields, not a diverging snapshot", () => {
    const wall = actions.addWall(0, 0, 2.11, 0, 0.1, 2.4).id as string;
    actions.setWallSide(wall, "right", { existing: { value: 0, status: "measured" }, layers: [] });
    const fields = {
      length: pub(1), width: pub(1), height: pub(0.63), installation: pub("corner"), shape: pub("corner-round"),
      frontWidth: pub(1.178), frontProjection: pub(1.09), wasteFromCorner: pub(0.52), surround: pub("none-required"),
    };
    const product: LibraryProduct = {
      id: "spec-vs-snapshot", category: "bath", manufacturer: "Example Co", model: "Corner",
      fields, roughIn: roughInPoints(categoryById("bath")!, fields), requestId: "r", acceptedAt: 0,
    };
    const placed = actions.placeProduct(product, { wallId: wall, side: "right", face: "existing", distance: 0.55, status: "proposed" });
    expect(placed.ok).toBe(true);
    const bathId = placed.id as string;
    store.setState({
      model: {
        ...store.getState().model,
        items: store.getState().model.items.map((i) => {
          if (i.id !== bathId || !i.productSnapshot) return i;
          return {
            ...i,
            productSnapshot: {
              ...i.productSnapshot,
              fields: { ...i.productSnapshot.fields, wasteFromCorner: pub(0.8) },
            },
          };
        }),
      },
    });
    expect(item(bathId).productSpecification!.fields.wasteFromCorner!.value).toBe(0.52);
    expect(item(bathId).productSnapshot!.fields.wasteFromCorner!.value).toBe(0.8);
    const bath = item(bathId);
    const checkPt = hostWasteInHostFrame(bath, catalogByKind, store.getState().model);
    expect(checkPt.resolved).toBe(true);
    expect(checkPt.fromCorner).toBe(0.52);
    const cat = catalogByKind(bath.kind)!;
    const fromSnapshot = cornerBisectorToHostFrame(0.8, cat.w, bath.corner!.side);
    expect(checkPt.across).not.toBe(quantize(fromSnapshot.across));
    actions.defineItemKind({ kind: "test_waste", label: "Test waste", w: 0.05, d: 0.05, h: 0.02 });
    const wasteId = actions.placeItem("test_waste", 0, 0).id as string;
    store.setState({
      model: {
        ...store.getState().model,
        items: store.getState().model.items.map((i) => i.id === wasteId ? { ...i, productSpecification: { category: "waste", fields: {}, acceptedAt: 1 } } : i),
      },
    });
    expect(actions.fitItem(wasteId, bath.id, undefined, undefined, true).ok).toBe(true);
    expect(item(wasteId).fittedTo).toMatchObject({ hostId: bath.id, across: checkPt.across, out: checkPt.out });
    expect(fittedWasteProblems(store.getState().model).some((i) => i.code === "fitted_waste_offset")).toBe(false);
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
