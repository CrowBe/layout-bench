import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { emptyModel, type Heating } from "../src/model/types";
import { heatingProblems } from "../src/model/heating";
import { impliedSpacing, productChecks } from "../src/model/heatingProduct";
import { demoProject, parseImport } from "../src/model/projects";
import type { FieldValue } from "../src/model/products";
import type { LibraryProduct } from "../src/model/productLibrary";

// the printed SCK0765L and MWD5-1999-CBP3 labels, recorded as human evidence
const label = (value: number | string, unit: string): FieldValue => ({
  value, status: "measured", ...(typeof value === "number" && unit === "metres" ? { reference: "fixture-end" as const } : {}),
  measurement: { unit, date: "2026-10-03", evidence: "Printed label, photographed", recordedBy: "human" },
});
const unknown = (): FieldValue => ({ value: null, note: "Not printed." });
const cableFields = (over: Record<string, FieldValue> = {}): Record<string, FieldValue> => ({
  cableType: label("in-screed", "choice"), cableLength: label(42.5, "metres"), outputPerMetre: label(18, "W/m"), totalPower: label(765, "W"),
  ratedVoltage: label(240, "V"), ratedCurrent: label(3.2, "A"), resistance: label(75.3, "Ω"),
  coverageAreaMin: label(3.7, "m²"), coverageAreaMax: label(5.1, "m²"), coldTailLength: unknown(),
  installationRequirements: { value: "Cover and bend radius per the installation sheet.", status: "published", sources: [{ url: "https://example.com/sck", locator: "p. 1" }] }, ...over,
});
const thermostatFields = (over: Record<string, FieldValue> = {}): Record<string, FieldValue> => ({
  ratedVoltageMin: label(100, "V"), ratedVoltageMax: label(240, "V"), ratedCurrent: label(16, "A"), ingressProtection: label("IP21", "text"), ...over,
});
const product = (id: string, category: string, model: string, fields: Record<string, FieldValue>): LibraryProduct =>
  ({ id, category, manufacturer: category === "thermostat" ? "OJ Electronics" : "", model, fields, roughIn: [], requestId: "r", acceptedAt: 1 });
const cable = () => product("cable1", "heating-cable", "SCK0765L", cableFields());
const stat = () => product("stat1", "thermostat", "MWD5-1999-CBP3", thermostatFields());
const room = () => store.getState().model.rooms[0];
const codes = () => heatingProblems(room()).map((p) => p.code);

beforeEach(() => {
  store.setState({ model: emptyModel(), undoStack: [] });
  actions.addRoom(0, 0, 2, 3, "Bathroom", "tile");
  actions.setRoomHeating(room().id, { zoneIds: [room().id], path: [{ x: 0.2, y: 0.2 }, { x: 1.8, y: 0.2 }, { x: 1.8, y: 0.4 }] });
});

describe("a pinned heating-cable product", () => {
  it("fills the record's cable figures from reviewed evidence, each with its status and source", () => {
    const r = actions.setHeatingProduct(room().id, "cable", cable());
    expect(r.ok).toBe(true);
    const h = room().heating!;
    expect(h.length).toMatchObject({ value: 42.5, status: "measured" });
    expect(h.length!.source).toMatch(/Printed label/);
    expect(h.ratedOutput).toMatchObject({ value: 765, status: "measured" });
    expect(h.model).toBe("SCK0765L");
    expect(h.requirements).toMatch(/bend radius/);
    expect(h.cableProduct?.productId).toBe("cable1");
    expect(codes()).not.toContain("heating_length_unconfirmed"); // a measured length counts as confirmed
  });

  it("refuses the wrong category and leaves the record unchanged", () => {
    const before = structuredClone(room().heating);
    expect(actions.setHeatingProduct(room().id, "cable", stat()).ok).toBe(false);
    expect(actions.setHeatingProduct(room().id, "controller", cable()).ok).toBe(false);
    expect(room().heating).toEqual(before);
  });

  it("derives the pitch the label's coverage implies, about 87–120 mm for 42.5 m over 3.7–5.1 m²", () => {
    expect(impliedSpacing({ category: "heating-cable", fields: cableFields(), acceptedAt: 1 })).toEqual({ min: 0.0871, max: 0.12 });
    expect(impliedSpacing({ category: "heating-cable", fields: cableFields({ coverageAreaMax: unknown() }), acceptedAt: 1 })).toBeNull();
  });

  it("warns when the heated area or the drawn pitch is outside the label's range, and only then", () => {
    actions.setHeatingProduct(room().id, "cable", cable());
    expect(codes()).toContain("heating_coverage_outside_product_range"); // 6 m² zone against 3.7–5.1
    expect(codes()).toContain("heating_spacing_outside_product_range");
    const h = room().heating!;
    expect(productChecks(h, 4.5, 42.5)).toEqual([]); // about 106 mm: inside 87–120
    expect(productChecks(h, 4.5, 25).map((c) => c.code)).toEqual(["heating_spacing_outside_product_range"]);
  });

  it("makes no comparison when a figure is unknown", () => {
    actions.setHeatingProduct(room().id, "cable", product("c2", "heating-cable", "x", cableFields({ coverageAreaMin: unknown(), coverageAreaMax: unknown() })));
    expect(codes()).not.toContain("heating_coverage_outside_product_range");
    expect(codes()).not.toContain("heating_spacing_outside_product_range");
  });

  it("unpins without removing the figures already copied", () => {
    actions.setHeatingProduct(room().id, "cable", cable());
    expect(actions.setHeatingProduct(room().id, "cable", null).ok).toBe(true);
    expect(room().heating!.cableProduct).toBeUndefined();
    expect(room().heating!.length?.value).toBe(42.5);
  });
});

describe("a pinned controller", () => {
  it("always says its ingress rating and leaves the zone decision to the electrician", () => {
    actions.setHeatingProduct(room().id, "controller", stat());
    const p = heatingProblems(room()).find((x) => x.code === "heating_controller_ingress")!;
    expect(p.message).toMatch(/IP21/);
    expect(p.message).toMatch(/electrician/);
    expect(p.severity).toBe("warning");
  });

  it("accepts the SCK0765L on the OJ controller, and flags a voltage or current mismatch as an error", () => {
    actions.setHeatingProduct(room().id, "cable", cable());
    actions.setHeatingProduct(room().id, "controller", stat());
    expect(codes()).not.toContain("heating_controller_voltage");
    expect(codes()).not.toContain("heating_controller_current");
    actions.setHeatingProduct(room().id, "controller", product("s2", "thermostat", "small", thermostatFields({ ratedVoltageMax: label(120, "V"), ratedCurrent: label(2, "A") })));
    const errors = heatingProblems(room()).filter((p) => p.severity === "error").map((p) => p.code);
    expect(errors).toEqual(expect.arrayContaining(["heating_controller_voltage", "heating_controller_current"]));
  });
});

describe("persistence", () => {
  it("round-trips pinned products and rejects a snapshot of the wrong category", () => {
    actions.setHeatingProduct(room().id, "cable", cable());
    actions.setHeatingProduct(room().id, "controller", stat());
    const doc = { ...demoProject(), id: "h", model: store.getState().model };
    const back = parseImport(JSON.stringify(doc));
    expect(back.model.rooms[0].heating?.cableProduct?.specification.category).toBe("heating-cable");
    expect(back.model.rooms[0].heating?.controller?.model).toBe("MWD5-1999-CBP3");
    const bad = structuredClone(doc);
    (bad.model.rooms[0].heating as Heating).controller!.specification.category = "heating-cable";
    expect(() => parseImport(JSON.stringify(bad))).toThrow();
  });

  it("undoes a pin", () => {
    actions.setHeatingProduct(room().id, "cable", cable());
    actions.undo();
    expect(room().heating!.cableProduct).toBeUndefined();
  });
});
