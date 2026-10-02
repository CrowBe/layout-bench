import { beforeEach, describe, expect, it } from "vitest";
import { categoryById, envelopeOf, roughInPoints, productPlacementProblem, validateSubmission, type SpecSubmission } from "../src/model/products";
import { productStore, products, configureProductStorage, initializeProductLibrary, PRODUCTS_KEY } from "../src/model/productLibrary";
import { actions, store } from "../src/model/store";
import { emptyModel } from "../src/model/types";
import { catalogue, specRows, renderStageDiagram } from "../src/sheets/stageView";
import { fittingCases, pub, unknown, powered } from "./bathroom-products-fixtures.mjs";

const submission = (fields: SpecSubmission["fields"]): SpecSubmission => ({ manufacturer: "Synthetic Co", model: "Synthetic fitting", fields });
const problems = (category: string, fields: SpecSubmission["fields"]) => validateSubmission(categoryById(category)!, submission(fields));

beforeEach(() => {
  productStore.setState({ requests: [], products: [], selectedRequestId: null });
  store.setState({ model: emptyModel(), undoStack: [], kinds: [] });
});

describe("bounded bathroom fitting briefs (#50)", () => {
  for (const c of fittingCases) {
    it(`${c.category}: validates, human accepts, persists, and places or explicitly refuses`, () => {
      const cat = categoryById(c.category)!;
      expect(problems(c.category, c.fields)).toEqual([]);
      // Every spatial field defines its own datum; no project mounting height in the brief.
      expect(cat.fields.filter((f) => f.type === "length").every((f) => f.reference)).toBe(true);
      const fields = { ...c.fields, [c.unknownKey]: unknown() };
      expect(problems(c.category, fields).map((p) => p.code)).toEqual(["required_unknown"]);
      const memory = new Map<string, string>();
      const prev = configureProductStorage({ local: () => ({ getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => { memory.set(k, v); } }) });
      try {
        initializeProductLibrary(true);
        const id = products.request(c.category, { brand: "Synthetic Co", model: "Synthetic fitting" }).requestId as string;
        expect(products.submit(id, submission(fields)).ok).toBe(true);
        expect(products.accept(id).ok).toBe(false);
        for (const key of Object.keys(fields)) expect(products.review(id, key, "accepted").ok).toBe(true);
        expect(products.accept(id).ok).toBe(true);
        const saved = memory.get(PRODUCTS_KEY)!;
        expect(JSON.parse(saved).products[0].fields[c.unknownKey].value).toBeNull();
        productStore.setState({ requests: [], products: [] });
        // Resetting test state writes it, so restore the accepted record for a reload.
        memory.set(PRODUCTS_KEY, saved);
        initializeProductLibrary(true);
        const product = productStore.getState().products[0];
        expect(product.fields[c.unknownKey].value).toBeNull();
        const wall = actions.addWall(0, 0, 3, 0, 0.1, 2.4).id as string;
        actions.setWallSide(wall, "right", { existing: { value: 0, status: "measured" }, frame: { value: 0, status: "measured" }, layers: [{ kind: "tile", thickness: { value: 0.01, status: "proposed" } }] });
        const before = JSON.stringify(store.getState().model);
        const result = actions.placeProduct(product, { wallId: wall, side: "right", face: "finished", distance: 1, status: "proposed" });
        expect(result.ok).toBe(c.supported);
        if (!c.supported) {
          expect(result.summary).toMatch(/Unsupported product placement.*#51/);
          expect(JSON.stringify(store.getState().model)).toBe(before);
          expect(store.getState().kinds).toEqual([]);
        } else {
          const model = store.getState().model;
          const el = catalogue(model).elements.find((e) => e.type === "fixture")!;
          const rows = specRows(model, el, [product]);
          expect(rows.find((r) => r.property === "width")).toMatchObject({ status: "published", datum: "fixture-end" });
          expect(rows.find((r) => r.property === c.unknownKey)).toMatchObject({ value: "?", status: "unknown" });
          expect(renderStageDiagram(model, [el], { label: "Synthetic fittings", products: [product], findings: [] })).toContain("Synthetic fitting");
          if (c.category === "tapware") {
            expect(model.items[0].servicePoints![0].up).toBeUndefined();
            expect(model.items[0].servicePoints![0].source).toContain("up from fixture-bottom");
          }
        }
      } finally { configureProductStorage(prev); }
    });
  }

  it("requires concealed/deck tap layouts and rejects reversed body-depth ranges", () => {
    const fields = { ...fittingCases[0].fields, mounting: pub("wall-concealed") };
    expect(problems("tapware", fields).filter((p) => p.severity === "error").map((p) => p.field)).toEqual(["concealedDepthMin", "concealedDepthMax"]);
    expect(problems("tapware", { ...fields, concealedDepthMin: pub(0.1), concealedDepthMax: pub(0.05) }).map((p) => p.code)).toContain("range_reversed");
    expect(problems("tapware", { ...fields, mounting: pub("deck") }).filter((p) => p.severity === "error").map((p) => p.field)).toEqual(["tapHoles", "holeLayout"]);
    expect(productPlacementProblem(categoryById("tapware")!, { ...fields, mounting: unknown() })).toMatch(/Unsupported/);
  });

  it.each([
    ["tapware", "concealedDepthMin", "concealedDepthMax", "finished-wall", "frame"],
    ["shower-fittings", "adjustmentMin", "adjustmentMax", "fixture-bottom", "finished-floor"],
  ] as const)("%s: retains differently referenced range endpoints for human review", (category, minKey, maxKey, minDatum, maxDatum) => {
    const original = fittingCases.find((c) => c.category === category)!;
    const fields: SpecSubmission["fields"] = {
      ...original.fields,
      ...(category === "tapware" ? { mounting: pub("wall-concealed") } : {}),
      [minKey]: { ...pub(0.1), reference: minDatum },
      [maxKey]: { ...pub(0.05), reference: maxDatum, note: "Synthetic source names a different datum. No conversion is possible from supplied evidence." },
    };
    const findings = problems(category, fields);
    expect(findings.filter((p) => p.severity === "error")).toEqual([]);
    expect(findings.some((p) => p.code === "reference_mismatch" && p.field === maxKey)).toBe(true);
    const request = products.request(category, { brand: "Synthetic Co" }).requestId as string;
    expect(products.submit(request, submission(fields)).ok).toBe(true);
    const stored = productStore.getState().requests[0];
    expect(stored.status).toBe("submitted");
    expect(stored.submission!.fields[maxKey]).toEqual(fields[maxKey]);
    expect(stored.reviews).toEqual({});
    // Values on a common datum still have a meaningful numerical order.
    const sharedDatum = { ...fields, [maxKey]: { ...fields[maxKey], reference: minDatum } };
    expect(problems(category, sharedDatum).some((p) => p.code === "range_reversed")).toBe(true);
  });

  it("requires opening and swing requirements for hinged screens, never uses fixed-screen placement", () => {
    const fields = { ...fittingCases[2].fields, opening: pub("hinged") };
    expect(problems("shower-screen", fields).map((p) => p.field)).toEqual(["openingWidth", "openingLayout"]);
    const full = { ...fields, openingWidth: pub(0.7), openingLayout: pub("Synthetic: left hinge, outward swing 0–90 degrees from closed panel plane.") };
    expect(problems("shower-screen", full)).toEqual([]);
    expect(productPlacementProblem(categoryById("shower-screen")!, full)).toMatch(/Unsupported/);
  });

  it("distinguishes unpowered, powered, hydronic and recessed variants", () => {
    const mirror = fittingCases[5].fields;
    expect(problems("mirror", { ...mirror, power: pub("required") }).filter((p) => p.severity === "error")).toHaveLength(5);
    expect(problems("mirror", { ...mirror, ...powered, mounting: pub("recessed"), recessDepth: pub(0.12), recessOpening: pub("Synthetic: 600 × 800 mm opening at finished wall plane.") })).toEqual([]);
    const rail = { ...fittingCases[4].fields };
    for (const key of ["powerConnection", "powerRequirements", "powerOffset", "powerHeight", "powerDepth"]) delete rail[key];
    expect(problems("towel-rail", { ...rail, heating: pub("unheated"), power: pub("not-required") })).toEqual([]);
    expect(problems("towel-rail", { ...rail, heating: pub("electric"), power: pub("not-required") }).map((p) => p.code)).toContain("power_mode_conflict");
    expect(problems("towel-rail", { ...rail, heating: pub("electric"), power: unknown() }).filter((p) => p.code === "field_missing")).toHaveLength(5);
    expect(problems("towel-rail", { ...rail, heating: pub("hydronic"), power: pub("not-required") }).map((p) => p.field)).toEqual(["waterConnection"]);
  });

  it("preserves alternate datums and refuses unsupported envelope datums or unknown dimensions", () => {
    const cat = categoryById("tapware")!;
    const fields = { ...fittingCases[0].fields, inletHeight: { ...pub(0.2), reference: "other" as const } };
    expect(roughInPoints(cat, fields)[0].up).toMatchObject({ from: "other", value: 0.2 });
    expect(envelopeOf(cat, { ...fields, depth: { ...pub(0.25), reference: "frame" } })).toBeNull();
    expect(envelopeOf(cat, { ...fields, height: unknown() })).toBeNull();
    expect(roughInPoints(cat, { ...fields, inletOffset: unknown() })[0]).toMatchObject({ resolved: false, missing: ["inletOffset"] });
  });

  it("does not invent water entries for a bare shower rail", () => {
    const fields: SpecSubmission["fields"] = { ...fittingCases[1].fields, fittingType: pub("rail"), waterEntry: pub("none"), adjustment: pub("fixed") };
    for (const key of ["headWidth", "armProjection", "waterConnection", "inletOffset", "inletDepth", "inletHeight", "adjustmentMin", "adjustmentMax"]) delete fields[key];
    expect(problems("shower-fittings", fields)).toEqual([]);
    expect(roughInPoints(categoryById("shower-fittings")!, fields)).toEqual([]);
  });
});
