import { describe, expect, it } from "vitest";
import { categoryById, checkValue, conservativeLimit, envelopeOf, validateSubmission, REFERENCES, type FieldValue } from "../src/model/products";
import { unknownMeasurementFields, validateMeasurementFields } from "../src/model/productMeasurements";
import { demoProject, parseImport } from "../src/model/projects";

const src = { url: "https://example.com/sheet", locator: "p. 1" };
const pub = (value: number | string, extra: Partial<FieldValue> = {}): FieldValue => ({ value, status: "published", sources: [src], ...extra });
const tapware = categoryById("tapware")!;
const baseTap = (): Record<string, FieldValue> => ({
  width: pub(0.15, { reference: "fixture-end" }), depth: pub(0.12, { reference: "fixture-side" }), height: pub(0.13, { reference: "fixture-bottom" }),
  mounting: pub("deck"), tapHoles: pub(1), holeLayout: pub("one 35 mm hole"), fixingLayout: pub("nut and washer from below"),
  inletMode: pub("single"), waterConnection: pub("flexible hoses, G3/8"), inletOffset: pub(0, { reference: "fixture-centreline" }),
  inletDepth: pub(0, { reference: "fixture-side" }), inletHeight: pub(0.05, { reference: "fixture-bottom" }),
});

describe("working limits and conflicting sources", () => {
  it("has optional pressure and temperature limits on tapware and shower fittings, in stated units", () => {
    for (const id of ["tapware", "shower-fittings"]) {
      const fields = categoryById(id)!.fields;
      for (const [key, unit] of [["pressureMin", "kPa"], ["pressureMax", "kPa"], ["temperatureMax", "°C"]] as const) {
        const f = fields.find((x) => x.key === key)!;
        expect(f).toMatchObject({ type: "quantity", unit, required: false });
      }
    }
    // a limit left out entirely is not an error
    const problems = validateSubmission(tapware, { manufacturer: "Enflair", model: "K1110-31", fields: baseTap() });
    expect(problems.filter((p) => p.severity === "error")).toEqual([]);
  });

  it("flags 500 kPa against 1 MPa and uses the lower figure", () => {
    const fields = { ...baseTap(), pressureMax: pub(500, { alternatives: [{ value: 1000, source: { url: "https://example.com/instruction-sheet", locator: "p. 1, scope of use" } }] }) };
    const problems = validateSubmission(tapware, { manufacturer: "Enflair", model: "K1110-31", fields });
    expect(problems.find((p) => p.code === "sources_disagree")?.message).toMatch(/1000 kPa, not 500 kPa/);
    expect(conservativeLimit(fields.pressureMax, "max")).toEqual({ value: 500, sources: 2 });
    expect(conservativeLimit(pub(0.05 * 1000, { alternatives: [{ value: 100, source: src }] }), "min")).toEqual({ value: 100, sources: 2 });
    expect(conservativeLimit({ value: null, note: "not published" }, "max")).toBeNull();
  });

  it("refuses an out-of-range or wrong-type limit", () => {
    const f = tapware.fields.find((x) => x.key === "pressureMax")!;
    expect(checkValue(f, 1_000_000)?.code).toBe("out_of_range"); // pascals typed as kPa
    expect(checkValue(f, "500 kPa")?.code).toBe("not_a_quantity");
  });
});

describe("a figure whose datum the source does not make clear", () => {
  const bath = categoryById("bath")!;
  it("has an unresolved datum that needs an explanation and is never a dimension", () => {
    expect(REFERENCES.unresolved).toMatch(/does not make clear/);
    const unexplained = { ...baseTap(), inletDepth: pub(0.045, { reference: "unresolved" }) };
    expect(validateSubmission(tapware, { manufacturer: "x", model: "y", fields: unexplained }).some((p) => p.code === "datum_unresolved_without_note")).toBe(true);
    const explained = { ...baseTap(), inletDepth: pub(0.045, { reference: "unresolved", note: "Instruction sheet figure 1 shows 45 mm and 60 mm with no named datum." }) };
    const ok = validateSubmission(tapware, { manufacturer: "x", model: "y", fields: explained });
    expect(ok.some((p) => p.code === "datum_unresolved_without_note")).toBe(false);
    expect(ok.some((p) => p.code === "reference_mismatch")).toBe(true);
  });

  it("is not used as an envelope dimension", () => {
    const label = (value: number, reference: FieldValue["reference"], note?: string): FieldValue => ({
      value, status: "measured", reference, ...(note ? { note } : {}),
      measurement: { unit: "metres", date: "2026-10-03", evidence: "Printed on the instruction sheet, photographed", recordedBy: "human" },
    });
    const fields = { ...unknownMeasurementFields(bath), length: label(1, "unresolved", "Sheet gives 1000 mm, no datum."), width: label(1, "fixture-side"), height: label(0.63, "fixture-bottom") };
    expect(envelopeOf(bath, fields)).toBeNull();
    expect(validateMeasurementFields(bath, fields).filter((p) => p.severity === "error")).toEqual([]);
    const silent = { ...fields, length: label(1, "unresolved") };
    expect(validateMeasurementFields(bath, silent).some((p) => p.code === "measurement_datum")).toBe(true);
  });
});

describe("a set with a part that was not seen", () => {
  it("states each part and keeps an unseen one unresolved in the sample", () => {
    const doc = parseImport(JSON.stringify(demoProject()));
    const shower = doc.model.items.find((i) => i.id === "shower_system")!.productIdentity!;
    expect(shower.componentsStatus).toBe("documented");
    const inner = shower.components!.find((c) => /inner part/.test(c.name))!;
    expect(inner).toMatchObject({ provision: "unresolved", quantity: null, code: { state: "unknown", value: null } });
    expect(shower.components!.map((c) => c.provision)).toEqual(["unresolved"]);
    // the K1130 trim is drawn from its own drawing now, as the shower mixer item
    expect(doc.model.items.find((i) => i.id === "shower_mixer")!.productIdentity!.code).toBe("K1130-31");
    const mixer = doc.model.items.find((i) => i.id === "bath_mixer")!.productIdentity!;
    expect(mixer.components![0].name).toMatch(/K1132 inner part/);
  });
});
