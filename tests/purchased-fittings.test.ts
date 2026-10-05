import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { checkModel } from "../src/model/issues";
import { demoProject, parseImport } from "../src/model/projects";
import { catalogByKind, resetRuntimeCatalog } from "../src/model/catalog";
import { purchasedFittings, stillNeedsCaptainsMeasurement, specOf } from "../src/model/seed-bathroom";
import { buildFurniture, hasCustomKind } from "../src/three/furniture";
import { emptyModel } from "../src/model/types";
import { categoryById, checkValue, envelopeOf, validateSubmission, REFERENCES, type FieldValue } from "../src/model/products";
import { isProductSpecification, unknownMeasurementFields, validateMeasurementFields } from "../src/model/productMeasurements";

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
    expect(back.kinds.find((k) => k.entry.kind === "towel_rail_vs900hbn")?.entry.elevation).toBe(0.75);
  });

  it("places every fitting with a printed code, marked purchased", () => {
    const { model } = demoProject();
    for (const f of purchasedFittings.filter((x) => x.placement)) {
      const it = model.items.find((i) => i.id === f.placement!.id)!;
      expect(it.selectionStatus).toBe("purchased");
      expect(it.productIdentity?.code).toBe(f.product.code);
    }
    expect(model.items.some((i) => i.kind === "thermostat_mwd5_1999_cbp3")).toBe(false); // hallway wall, outside this plan
  });

  it("carries both purchased towel rails and the owner's 900 × 2000 fixed screen", () => {
    const { model, kinds } = demoProject();
    const rails = model.items.filter((i) => i.kind === "towel_rail_vs900hbn");
    expect(rails.map((r) => r.id)).toEqual(["towel_rail", "towel_rail_2"]);
    expect(rails.every((r) => r.selectionStatus === "purchased" && r.productIdentity?.code === "VS900HBN")).toBe(true);
    const screen = kinds.find((k) => k.entry.kind === "screen_proposed")!.entry;
    expect([screen.w, screen.h]).toEqual([0.9, 2]);
    expect(model.items.find((i) => i.id === "screen")!.y).toBe(1.2);
  });

  it("draws the reused vanity and shaving cabinet at the owner's sizes, the cabinet above the basin", () => {
    load();
    const vanity = catalogByKind("vanity_recorded")!, cabinet = catalogByKind("shaving_cabinet_recorded")!;
    expect([vanity.w, vanity.h, vanity.d]).toEqual([0.91, 0.85, 0.465]);
    expect([cabinet.w, cabinet.h, cabinet.d]).toEqual([0.75, 0.62, 0.16]);
    expect(cabinet.elevation).toBe(1.2); // owner: bottom edge as now, to clear the tap
    expect(cabinet.elevation).toBeGreaterThan(vanity.h + 0.148); // clear of the basin mixer (K1110: 148 mm from the deck)
    const items = store.getState().model.items.filter((i) => i.id === "vanity" || i.id === "shaving_cabinet");
    expect(items.map((i) => i.selectionStatus)).toEqual(["reused", "reused"]);
    expect(buildFurniture("vanity_recorded")!.children.length).toBeGreaterThan(5); // doors, drawers, top
    expect(hasCustomKind("shaving_cabinet_recorded")).toBe(true);
  });

  it("copies printed dimensions only where a label gives them", () => {
    const rail = purchasedFittings.find((f) => f.kind === "towel_rail_vs900hbn")!.size;
    expect([rail.w, rail.d, rail.h]).toEqual([0.142, 0.1, 0.9]);
    const shower = purchasedFittings.find((f) => f.kind === "shower_y1173_31_11_250")!.size;
    expect(shower.printed).toEqual(["w"]);
    expect(purchasedFittings.filter((f) => f.size.printed.length === 0).every((f) => f.size.caveat)).toBe(true);
  });

  it("records manufacturer-sheet sizes with a source URL, and keeps unsourced figures labelled", () => {
    const byKind = Object.fromEntries(purchasedFittings.map((f) => [f.kind, f]));
    expect(byKind.mixer_k1132_31.size.w).toBe(0.065);
    expect(byKind.mixer_k1132_31.size.d).toBe(0.061);
    expect(byKind.mixer_k1132_31.size.h).toBeCloseTo(0.117, 4);
    expect(byKind.mixer_k1132_31.size.elevation).toBeCloseTo(0.748, 4);
    expect(byKind.spout_k1150_31_0_150.size).toMatchObject({ w: 0.065, d: 0.15, elevation: 0.8 });
    expect(byKind.mixer_k1110_31.size).toMatchObject({ h: 0.148, elevation: 0.85 });
    expect(byKind.shower_y1173_31_11_250.size).toMatchObject({ w: 0.25, d: 0.552, h: 0.981, elevation: 0.4 });
    expect(byKind.towel_rail_vs900hbn.size).toMatchObject({ w: 0.142, d: 0.1, h: 0.9, elevation: 0.75 });
    expect(byKind.thermostat_mwd5_1999_cbp3.size.caveat).toMatch(/stand-in/);
    expect(byKind.waste_sdp40bn.size.caveat).toMatch(/stand-in/);
    const wasteConnection = byKind.waste_sdp40bn.measures.find((m) => m.key === "connection")!;
    expect(wasteConnection).toMatchObject({ value: 0.04, status: "measured", source: "carton label" });
    expect(wasteConnection.measurement?.evidence).toMatch(/carton/);
    const handle = byKind.mixer_k1132_31.measures.find((m) => m.key === "handleDrop")!;
    expect(handle.note).toMatch(/top of the Ø42 hub/);
    expect(handle.note).not.toMatch(/plate centre down/);
    const arm = byKind.shower_y1173_31_11_250.measures.find((m) => m.key === "armReach")!;
    expect(arm).toMatchObject({ value: 0.427, reference: "fixture-side" });
    expect(arm.note).toMatch(/mounting\/wall face/);
    expect(arm.note).not.toMatch(/Not from the wall/);
    expect(byKind.shower_y1173_31_11_250.measures.find((m) => m.key === "handpieceLength")).toMatchObject({ value: 0.2463 });
    expect(byKind.shower_y1173_31_11_250.measures.find((m) => m.key === "handpieceDiameter")).toMatchObject({ value: 0.105 });
    expect(byKind.mixer_k1110_31.measures.find((m) => m.key === "elevation")?.status).toBe("proposed");
    expect(byKind.mixer_k1132_31.measures.find((m) => m.key === "elevation")).toMatchObject({ value: null });
    expect(byKind.mixer_k1132_31.measures.find((m) => m.key === "elevation")?.note).toMatch(/Unsourced/);
    expect(byKind.mixer_k1132_31.measures.find((m) => m.key === "elevation")?.status).toBeUndefined();
    expect(byKind.shower_y1173_31_11_250.measures.find((m) => m.key === "envelopeDepth")).toBeUndefined();
    expect(byKind.mixer_k1132_31.measures.find((m) => m.key === "bodyProjection")?.note).toMatch(/wall-side face/);
    for (const f of purchasedFittings) {
      expect(f.measures.length).toBeGreaterThan(0);
      for (const m of f.measures.filter((x) => x.status === "published")) {
        expect(m.reference).toBeDefined();
        if (m.source) {
          expect(m.sources).toBeUndefined();
          expect(m.source.length).toBeGreaterThan(0);
        } else {
          expect(m.sources?.[0]?.url).toMatch(/^https:\/\//);
        }
      }
      for (const m of f.measures.filter((x) => x.value === null)) {
        expect(m.note).toBeTruthy();
        expect(m.status).not.toBe("proposed");
      }
    }
  });

  it("carries measure status, reference and source on the project item and through JSON export", () => {
    const doc = demoProject();
    const back = parseImport(JSON.stringify(doc));
    const shower = back.model.items.find((i) => i.id === "shower_system")!;
    expect(shower.productSpecification?.category).toBe("shower-fittings");
    expect(shower.productSpecification?.fields.armProjection).toMatchObject({ value: 0.427, status: "published", reference: "fixture-side" });
    expect(shower.productSpecification?.fields.railLength).toMatchObject({ value: 0.981 });
    expect(shower.productSpecification?.fields.headWidth).toMatchObject({ value: 0.25 });
    expect(shower.productSpecification?.fields.depth).toMatchObject({ value: 0.552, status: "published" });
    expect(shower.productSpecification?.fields.armReach).toBeUndefined();
    expect(shower.productSpecification?.fields.envelopeDepth).toBeUndefined();
    const waste = back.model.items.find((i) => i.id === "bath_waste")!;
    expect(waste.productSpecification?.fields.outletDiameter).toMatchObject({ value: 0.04, status: "measured" });
    expect(waste.productSpecification?.fields.outletDiameter.measurement?.evidence).toMatch(/carton/);
    expect(waste.productSpecification?.fields.connection).toBeUndefined();
    const basin = back.model.items.find((i) => i.id === "basin_mixer")!;
    expect(basin.productSpecification?.fields.elevation).toBeUndefined();
    expect(basin.productSpecification?.fields.height).toMatchObject({ value: 0.148, status: "published" });
    const mixer = back.model.items.find((i) => i.id === "bath_mixer")!;
    expect(mixer.productSpecification?.fields.handleDrop).toBeUndefined();
    expect(mixer.productSpecification?.fields.depth).toMatchObject({ value: 0.061 });
    expect(mixer.productSpecification?.fields.height?.value).toBeCloseTo(0.117, 4);
    const captain = back.notes.find((n) => n.id === "note-captain")!;
    expect(captain.text).toMatch(/Still needs the captain's measurement/);
    expect(captain.text).not.toMatch(/stillNeedsCaptainsMeasurement/);
    expect(captain.text).toMatch(/590/);
    expect(captain.text).toMatch(/K1110-31/);
    expect(captain.text).toMatch(/60 mm/);
    expect(back.notes.find((n) => n.id === "note-purchased")!.text).toMatch(/246\.3/);
    expect(back.notes.find((n) => n.id === "note-purchased")!.text).toMatch(/mounting\/wall face/);
    expect(back.notes.find((n) => n.id === "note-purchased")!.text).not.toMatch(/210\.3/);
  });

  it("does not give wall fittings #60 installation: no wall anchor and no surveyed finished face", () => {
    const { model, kinds } = demoProject();
    for (const it of model.items.filter((i) => i.selectionStatus === "purchased")) {
      expect(it.anchor).toBeUndefined();
      expect(it.installation).toBeUndefined();
    }
    expect(kinds.find((k) => k.entry.kind === "mixer_k1132_31")!.entry.elevation).toBe(0.748);
    expect(kinds.find((k) => k.entry.kind === "shower_y1173_31_11_250")!.entry.elevation).toBe(0.4);
  });

  it("lists every remaining placeholder for the captain to measure", () => {
    expect(stillNeedsCaptainsMeasurement.length).toBeGreaterThan(5);
    expect(stillNeedsCaptainsMeasurement.every((e) => e.fitting && e.what && e.from)).toBe(true);
    const text = stillNeedsCaptainsMeasurement.map((e) => `${e.fitting} ${e.what}`).join(" ");
    expect(text).toMatch(/SDP-40BN/);
    expect(text).toMatch(/MWD5-1999-CBP3/);
    expect(text).toMatch(/590/);
    expect(text).toMatch(/K1110-31/);
    expect(text).toMatch(/slider\/holder/);
    expect(text).toMatch(/handpiece/);
    expect(text).toMatch(/60 mm/);
    expect(text).not.toMatch(/400 mm placeholder/);
    expect(stillNeedsCaptainsMeasurement.some((e) => /finished \(tile\) face/i.test(e.from))).toBe(true);
    const { notes } = demoProject();
    expect(notes.find((n) => n.id === "note-captain")!.text).toMatch(/Still needs the captain's measurement/);
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

  it("keeps drawn parts inside the kind envelope", () => {
    const eps = 1e-6;
    for (const f of purchasedFittings.filter((x) => x.parts.length)) {
      const { w, d, h, elevation = 0 } = f.size;
      for (const p of f.parts) {
        const pw = p.w ?? 0.3, ph = p.h ?? 0.3, pd = p.d ?? 0.3;
        const x = p.x ?? 0, y = p.y ?? 0, z = p.z ?? 0;
        expect(x - pw / 2, `${f.kind} ${p.shape ?? "box"} x-`).toBeGreaterThanOrEqual(-w / 2 - eps);
        expect(x + pw / 2, `${f.kind} ${p.shape ?? "box"} x+`).toBeLessThanOrEqual(w / 2 + eps);
        expect(z - pd / 2, `${f.kind} ${p.shape ?? "box"} z-`).toBeGreaterThanOrEqual(-d / 2 - eps);
        expect(z + pd / 2, `${f.kind} ${p.shape ?? "box"} z+`).toBeLessThanOrEqual(d / 2 + eps);
        expect(y, `${f.kind} ${p.shape ?? "box"} y-`).toBeGreaterThanOrEqual(elevation - eps);
        expect(y + ph, `${f.kind} ${p.shape ?? "box"} y+`).toBeLessThanOrEqual(elevation + h + 1e-4);
      }
    }
  });

  it("writes productSpecification on canonical brief keys and passes measurement validation", () => {
    const { model } = demoProject();
    for (const f of purchasedFittings) {
      const spec = f.placement
        ? model.items.find((i) => i.id === f.placement!.id)!.productSpecification!
        : specOf(f);
      expect(isProductSpecification(spec)).toBe(true);
      const cat = categoryById(spec.category)!;
      const problems = validateMeasurementFields(cat, spec.fields);
      expect(problems.filter((p) => p.severity === "error"), `${f.kind}: ${problems.filter((p) => p.severity === "error").map((p) => `${p.code}:${p.field}`).join(", ")}`).toEqual([]);
      expect(Object.keys(spec.fields).every((k) => cat.fields.some((field) => field.key === k) || k.startsWith("service."))).toBe(true);
      expect(spec.fields.elevation).toBeUndefined();
      expect(spec.acceptedAt).toBeGreaterThan(0);
    }
    const shower = model.items.find((i) => i.id === "shower_system")!.productSpecification!;
    expect(shower.fields.armProjection?.value).toBe(0.427);
    expect(shower.fields.width?.value).toBe(0.25);
    const waste = model.items.find((i) => i.id === "bath_waste")!.productSpecification!;
    expect(waste.fields.outletDiameter?.status).toBe("measured");
    expect(waste.fields.outletDiameter?.measurement?.evidence).toMatch(/carton/);
  });

  it("draws the corner bath as a right-angle triangle with a rounded hypotenuse", () => {
    load();
    const entry = catalogByKind("bath_sb184_1000gw")!;
    expect(entry.outline?.segments).toHaveLength(3);
    const arc = entry.outline!.segments.find((seg) => seg.via)!;
    expect(arc).toBeDefined();
    // right angle at the back-right; the drawing's front is 1090 mm from the corner on the bisector
    // the box is the curve's own extent, a little over 1 m: the sides stay 1000 mm
    expect(entry.w).toBeGreaterThan(1);
    expect(entry.w).toBeLessThan(1.02);
    expect(arc.via!.x).toBeCloseTo(entry.w / 2 - 1.09 / Math.SQRT2, 3);
    expect(arc.via!.y).toBeCloseTo(-entry.d / 2 + 1.09 / Math.SQRT2, 3);
    expect(buildFurniture("bath_sb184_1000gw")!.children.length).toBeGreaterThan(0);
    const errors = checkModel(store.getState().model).filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  it("rejects a negative elevation", () => {
    expect(actions.defineItemKind({ kind: "x_rail", label: "x", w: 1, d: 1, h: 1, elevation: -1 }).ok).toBe(false);
  });
});

// ---- spec capture: what the labels needed that the briefs could not say ----------------------
import { products, productStore } from "../src/model/productLibrary";

const label = (value: number | string, unit: string, reference?: FieldValue["reference"]): FieldValue => ({
  value, status: "measured", ...(reference ? { reference } : {}),
  measurement: { unit, date: "2026-10-03", evidence: "Printed label on the cable drum, photographed", recordedBy: "human" },
});

describe("capturing a label's electrical figures", () => {
  const cable = categoryById("heating-cable")!;
  it("checks a quantity against its own unit and range", () => {
    const watts = cable.fields.find((f) => f.key === "outputPerMetre")!;
    expect(checkValue(watts, 18)).toBeNull();
    expect(checkValue(watts, 765)?.code).toBe("out_of_range"); // total power typed into W/m
    expect(checkValue(watts, "18")?.code).toBe("not_a_quantity");
  });

  it("holds the SCK0765L label as a human record, with units", () => {
    const fields = {
      ...unknownMeasurementFields(cable),
      cableLength: label(42.5, "metres", "fixture-end"), outputPerMetre: label(18, "W/m"), totalPower: label(765, "W"),
      ratedVoltage: label(240, "V"), ratedCurrent: label(3.2, "A"), resistance: label(75.3, "Ω"),
      coverageAreaMin: label(3.7, "m²"), coverageAreaMax: label(5.1, "m²"), cableType: label("in-screed", "choice"),
    };
    expect(validateMeasurementFields(cable, fields).filter((p) => p.severity === "error")).toEqual([]);
    expect(validateMeasurementFields(cable, { ...fields, totalPower: label(765, "kW") }).some((p) => p.code === "measurement_provenance")).toBe(true);
    const id = products.openMeasurements("heating-cable", { label: "In-screed heater SCK0765L" }, fields).requestId as string;
    expect(products.submitMeasurements(id)).toMatchObject({ ok: true });
    productStore.setState({ requests: [], products: [] });
  });

  it("refuses a reversed range, and keeps the cable out of the placement path", () => {
    const fields = { ...unknownMeasurementFields(cable), coverageAreaMin: label(5.1, "m²"), coverageAreaMax: label(3.7, "m²") };
    expect(validateMeasurementFields(cable, fields).some((p) => p.code === "range_reversed")).toBe(true);
    expect(cable.placement?.supportedWhen).toEqual([]);
  });

  it("offers a packaging datum so a carton size is never taken as the product's", () => {
    expect(REFERENCES.packaging).toMatch(/carton/);
    const bath = categoryById("bath")!;
    const carton = { ...unknownMeasurementFields(bath), length: label(1, "metres", "packaging"), width: label(1, "metres", "packaging"), height: label(0.63, "metres", "packaging") };
    expect(validateMeasurementFields(bath, carton).filter((p) => p.severity === "error")).toEqual([]);
    expect(envelopeOf(bath, carton)).toBeNull(); // recorded, but never placed as the bath
    const own = { ...carton, length: label(1, "metres", "fixture-end"), width: label(1, "metres", "fixture-side"), height: label(0.63, "metres", "fixture-bottom") };
    expect(envelopeOf(bath, own)).toEqual({ w: 1, d: 1, h: 0.63 });
  });

  it("has the thermostat and waste briefs the labels called for", () => {
    expect(categoryById("thermostat")!.fields.map((f) => f.key)).toEqual(expect.arrayContaining(["ingressProtection", "ratedVoltageMin", "floorSensor"]));
    expect(categoryById("waste")!.fields.map((f) => f.key)).toContain("outletDiameter");
    expect(validateSubmission(categoryById("waste")!, { manufacturer: "Ahrok", model: "SDP-40BN", fields: {} }).some((p) => p.code === "field_missing")).toBe(true);
  });
});

// ---- a corner bath whose curved front depth is unknown ---------------------------------------
import { cornerBathLimitation, cornerBathOutline, roughInPoints } from "../src/model/products";
import { placementLimitations } from "../src/model/fixtures";
import { itemPolygon } from "../src/model/outline";
import type { LibraryProduct } from "../src/model/productLibrary";

describe("corner bath with unknown front depth", () => {
  const src = [{ url: "https://example.com/angie", locator: "drawing" }];
  const pub = (value: number | string): FieldValue => ({ value, status: "published", sources: src });
  const unknownDepth = (note = "Not on the carton label."): Record<string, FieldValue> => ({
    length: pub(1), width: pub(1), height: pub(0.63), installation: pub("corner"), shape: pub("corner-round"),
    frontWidth: { value: null, note }, frontProjection: { value: null, note },
    wasteFromEnd: { value: null, note }, wasteFromSide: { value: null, note }, surround: { value: null, note },
  });
  const product = (fields: Record<string, FieldValue>): LibraryProduct =>
    ({ id: "angie", category: "bath", manufacturer: "", model: "Angie Corner 1000", fields, roughIn: roughInPoints(categoryById("bath")!, fields), requestId: "r", acceptedAt: 0 });
  const room = () => {
    const ids = [[0, 0, 2.11, 0], [2.11, 0, 2.11, 3.02], [2.11, 3.02, 0, 3.02], [0, 3.02, 0, 0]].map(([a, b, c, d]) => actions.addWall(a, b, c, d, 0.1, 2.4).id as string);
    actions.addRoom(0, 0, 2.11, 3.02, "Bathroom", "tile");
    actions.setWallSide(ids[0], "right", { existing: { value: 0, status: "measured" }, frame: { value: -0.045, status: "site-confirmed" }, layers: [] });
    return ids[0];
  };

  it("says why it is drawn as a box, and only while the depth is unknown", () => {
    expect(cornerBathLimitation(unknownDepth())).toMatch(/Curved front depth unknown.*width across the front and the projection/);
    expect(cornerBathLimitation({ ...unknownDepth(), frontWidth: pub(1.414), frontProjection: pub(0.83) })).toBeNull();
    expect(cornerBathLimitation({ ...unknownDepth(), shape: pub("rectangular") })).toBeNull();
    expect(cornerBathLimitation({ ...unknownDepth(), width: pub(1.2) })).toMatch(/Offset corner bath/);
  });

  it("warns on the brief and does not draw a curve by eye", () => {
    const problems = validateSubmission(categoryById("bath")!, { manufacturer: "x", model: "y", fields: unknownDepth() });
    expect(problems.find((p) => p.code === "front_depth_unknown")?.severity).toBe("warning");
    expect(cornerBathOutline(unknownDepth(), 1, 1, "left")).toBeNull();
  });

  it("places as its box with the limitation shown, then drops it once the depth is recorded", () => {
    const back = room();
    const placed = actions.placeProduct(product(unknownDepth()), { wallId: back, side: "right", face: "finished", distance: 0.55, status: "proposed" });
    expect(placed.ok).toBe(true);
    expect(placed.summary).toMatch(/Limitation: Curved front depth unknown/);
    const bath = store.getState().model.items.find((i) => i.id === placed.id)!;
    expect(catalogByKind(bath.kind)!.outline).toBeUndefined();
    expect(itemPolygon(bath)).toHaveLength(4); // the box
    expect(placementLimitations(bath)).toHaveLength(1);
    // the same exact product with its depth recorded gets the arc and no limitation
    store.setState({ model: emptyModel(), undoStack: [], kinds: [] }); resetRuntimeCatalog();
    const back2 = room();
    const known = actions.placeProduct(product({ ...unknownDepth(), frontWidth: pub(1.414), frontProjection: pub(0.83) }), { wallId: back2, side: "right", face: "finished", distance: 0.55, status: "proposed" });
    const withArc = store.getState().model.items.find((i) => i.id === known.id)!;
    expect(catalogByKind(withArc.kind)!.outline!.segments.some((seg) => seg.via)).toBe(true);
    expect(placementLimitations(withArc)).toEqual([]);
  });

  it("records a carton size on the packaging datum and refuses to place it as the bath", () => {
    const fields = { ...unknownDepth(), length: label(1, "metres", "packaging"), width: label(1, "metres", "packaging"), height: label(0.63, "metres", "packaging") };
    const back = room();
    const placed = actions.placeProduct(product(fields), { wallId: back, side: "right", face: "finished", distance: 0.55, status: "proposed" });
    expect(placed.ok).toBe(false);
    expect(store.getState().model.items).toHaveLength(0);
  });
});
