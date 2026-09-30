import { beforeEach, describe, expect, it } from "vitest";
import { categoryById, envelopeOf, roughInPoints, validateSubmission, type SpecSubmission } from "../src/model/products";
import { productStore, products } from "../src/model/productLibrary";

// Synthetic product and sources: the tests check the rules, not any real product's figures.
const sheet = { url: "https://example.com/toilet-spec.pdf", locator: "p. 2, fig. 1" };
const pub = (value: number | string) => ({ value, status: "published" as const, sources: [sheet] });

const toilet = (): SpecSubmission => ({
  manufacturer: "Example Co",
  model: "Test Pan",
  fields: {
    width: pub(0.38),
    depth: pub(0.64),
    height: pub(0.8),
    panType: pub("back-to-wall"),
    cistern: pub("close-coupled"),
    inletEntry: pub("bottom"),
    power: pub("not-required"),
    trap: pub("S"),
    sTrapSetoutMin: pub(0.14),
    sTrapSetoutMax: pub(0.2),
    inletHeight: { value: null, note: "Not on the spec sheet or installation guide." },
  },
});

const codes = (s: SpecSubmission) => validateSubmission(categoryById("toilet")!, s).map((p) => `${p.severity}:${p.code}`);

beforeEach(() => productStore.setState({ requests: [], products: [], selectedRequestId: null }));

describe("product spec validation (#30)", () => {
  it("accepts a sourced submission and reports a required unknown as a warning", () => {
    expect(codes(toilet())).toEqual(["warning:required_unknown"]);
  });

  it("refuses unsourced, out-of-range, wrong-unit and unexplained unknown values", () => {
    const s = toilet();
    s.fields.width = { value: 0.38, status: "published" };
    s.fields.depth = pub(640); // millimetres, not metres
    s.fields.inletHeight = { value: null };
    s.fields.trap = pub("Q");
    s.fields.height = { value: 0.8, status: "published", sources: [{ url: "javascript:alert(1)" }] };
    const c = codes(s);
    expect(c.filter((x) => x === "error:source_invalid")).toHaveLength(2); // width unsourced, height javascript:
    for (const code of ["error:source_invalid", "error:out_of_range", "error:unknown_without_note", "error:not_an_option"]) {
      expect(c).toContain(code);
    }
  });

  it("applies conditional fields and flags reference mismatches and disagreeing sources", () => {
    const s = toilet();
    delete s.fields.sTrapSetoutMin;
    expect(codes(s)).toContain("error:field_missing");
    s.fields.trap = pub("P");
    expect(codes(s)).toContain("error:field_missing"); // P-trap waste height now required
    s.fields.pTrapWasteHeight = { ...pub(0.18), reference: "frame" };
    s.fields.depth = { ...pub(0.64), alternatives: [{ value: 0.655, source: { url: "https://example.org/listing", locator: "dimensions table" } }] };
    const c = codes(s);
    expect(c).toContain("warning:reference_mismatch");
    expect(c).toContain("warning:sources_disagree");
    expect(c).toContain("warning:field_not_applicable"); // S-trap max no longer applies
  });

  it("takes only published figures, each with a located source (review on #33)", () => {
    const s = toilet();
    s.fields.width = { value: 0.38, status: "measured" }; // no source, claims a site measurement
    s.fields.depth = { value: 0.64, status: "published", sources: [{ url: "https://example.com/spec.pdf" }] }; // no locator
    const c = codes(s);
    expect(c).toContain("error:status_not_published");
    expect(c.filter((x) => x === "error:source_invalid")).toHaveLength(2);
  });

  it("validates alternatives like the value they challenge (review on #33)", () => {
    const withAlt = (alt: unknown) => {
      const s = toilet();
      s.fields.width = { ...pub(0.38), alternatives: [alt as never] };
      return codes(s);
    };
    expect(withAlt({ value: 0.4, source: { url: "javascript:alert(1)", locator: "x" } })).toContain("error:alternative_invalid");
    expect(withAlt({ value: 10, source: { url: "https://example.org/a", locator: "p. 1" } })).toContain("error:alternative_invalid");
    expect(withAlt({ value: 0.4, source: { url: "https://example.org/a" } })).toContain("error:alternative_invalid");
    expect(withAlt({ value: 0.4, source: { url: "https://example.org/a", locator: "p. 1" } })).toEqual(["warning:sources_disagree", "warning:required_unknown"]);
  });

  it("asks an inset or back-to-wall bath for its hob or surround (review on #33)", () => {
    const bath = (installation: string): SpecSubmission => ({ manufacturer: "Example Co", model: "Test Bath", fields: {
      length: pub(1.675), width: pub(0.75), height: pub(0.45), installation: pub(installation),
      wasteFromEnd: pub(0.2), wasteFromSide: pub(0.375),
    } });
    const cat = categoryById("bath")!;
    expect(validateSubmission(cat, bath("freestanding"))).toEqual([]);
    expect(validateSubmission(cat, bath("inset")).map((p) => p.field)).toEqual(["surround"]);
    const withHob = bath("inset");
    withHob.fields.surround = pub("hob");
    expect(validateSubmission(cat, withHob)).toEqual([]);
  });

  it("asks an electric-seat suite for its power outlet and adds it as a service point", () => {
    const s = toilet();
    s.fields.power = pub("required");
    expect(validateSubmission(categoryById("toilet")!, s).filter((p) => p.severity === "error").map((p) => p.field)).toEqual(["powerOutletHeight"]);
    s.fields.powerOutletHeight = pub(0.3);
    const power = roughInPoints(categoryById("toilet")!, s.fields).find((p) => p.id === "power")!;
    expect(power).toMatchObject({ service: "power", up: { from: "finished-floor", value: 0.3 }, resolved: false, missing: ["powerOutletOffset"] });
  });

  it("derives rough-in points whose axes name their datum, leaving unknowns unknown", () => {
    const points = roughInPoints(categoryById("toilet")!, toilet().fields);
    expect(points.map((p) => p.id)).toEqual(["waste-s", "inlet"]);
    expect(points[0]).toMatchObject({ resolved: true, out: { from: "finished-wall", min: 0.14, max: 0.2 }, up: { from: "finished-floor", value: 0 } });
    expect(points[1]).toMatchObject({ resolved: false, missing: ["inletOffset", "inletHeight"], up: { from: "finished-floor", field: "inletHeight" } });
    expect(points[1].up!.value).toBeUndefined();
  });

  it("builds an envelope only from known dimensions", () => {
    const cat = categoryById("toilet")!;
    expect(envelopeOf(cat, toilet().fields)).toEqual({ w: 0.38, d: 0.64, h: 0.8 });
    expect(envelopeOf(cat, { ...toilet().fields, height: { value: null, note: "n/a" } })).toBeNull();
  });
});

describe("product library flow (#30)", () => {
  it("goes request → rejected submission → submission → review → accept", () => {
    expect(products.request("toilet", {}).ok).toBe(false);
    const req = products.request("toilet", { brand: "Example Co", model: "Test Pan" });
    const id = req.requestId as string;

    const bad = toilet();
    bad.fields.depth = pub(640);
    expect(products.submit(id, bad).ok).toBe(false);
    expect(productStore.getState().requests[0].status).toBe("open");

    expect(products.submit(id, toilet()).ok).toBe(true);
    expect(products.submit(id, toilet()).ok).toBe(false); // already submitted
    expect(products.accept(id).ok).toBe(false); // nothing reviewed yet

    expect(products.review(id, "depth", "rejected").ok).toBe(false); // needs a reason
    expect(products.review(id, "depth", "rejected", "Sheet shows 655 on p. 3").ok).toBe(true);
    expect(products.returnToAgent(id, "").ok).toBe(true);
    const back = productStore.getState().requests[0];
    expect(back.status).toBe("open");
    expect(back.feedback).toMatch(/depth: Sheet shows 655/);

    expect(products.submit(id, toilet()).ok).toBe(true);
    for (const key of Object.keys(toilet().fields)) products.review(id, key, "accepted");
    const accepted = products.accept(id);
    expect(accepted.ok).toBe(true);
    const { products: lib, requests } = productStore.getState();
    expect(lib).toHaveLength(1);
    expect(lib[0]).toMatchObject({ manufacturer: "Example Co", model: "Test Pan", category: "toilet", requestId: id });
    expect(lib[0].fields.depth.status).toBe("published");
    expect(lib[0].fields.inletHeight.value).toBeNull();
    expect(lib[0].roughIn.map((p) => [p.id, p.resolved])).toEqual([["waste-s", true], ["inlet", false]]);
    expect(requests[0]).toMatchObject({ status: "accepted", productId: accepted.productId });
  });
});
