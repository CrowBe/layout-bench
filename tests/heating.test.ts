import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { emptyModel, type Heating, type Room } from "../src/model/types";
import {
  CABLE_DEPTH_DATUM,
  WALL_SETBACK_DATUM,
  heatingEvidence,
  heatingProblems,
  heatingProductLocks,
  heatingProductWriteGuard,
  heatingSection,
  heatingShadowedRecordKeys,
  SPACING_FROM_COVERAGE_FORMULA,
  validHeating,
} from "../src/model/heating";
import { heatingCableFigures, heatingSnapshotProductId, PROJECT_SNAPSHOT_ORIGIN, resolveHeatingProduct, thermostatFigures } from "../src/model/heatingProduct";
import { checkModel } from "../src/model/issues";
import { demoProject, parseImport } from "../src/model/projects";
import {
  catalogue,
  renderStageDiagram,
  renderStageSpec,
  specRows,
} from "../src/sheets/stageView";
import { renderHeatingReview } from "../src/sheets/heating";
import { productStore, products, type LibraryProduct } from "../src/model/productLibrary";
import { requiredReviewKeys } from "../src/model/productReview";
import { categoryById } from "../src/model/products";
import { unknownMeasurementFields } from "../src/model/productMeasurements";
import type { FieldValue } from "../src/model/products";
import {
  heatingCableSpecification,
  proposedSck0765lPath,
  PROPOSED_CABLE_SPACING_M,
  SAMPLE_CABLE_PRODUCT_ID,
  SAMPLE_THERMOSTAT_PRODUCT_ID,
  thermostatSpecificationOf,
} from "../src/model/seed-bathroom";
import { CARTON_LABEL_SOURCE } from "../src/model/productMeasurements";

const proposed = (value: number) => ({
  value,
  status: "proposed" as const,
  source: "Synthetic test geometry, not a purchased product",
});
const published = (value: number) => ({
  value,
  status: "published" as const,
  source: "Synthetic specification used solely for tests",
});
const room = () => store.getState().model.rooms[0];
const codes = () => heatingProblems(room()).map((p) => p.code);
const path = [
  { x: 0.2, y: 0.2 },
  { x: 1.8, y: 0.2 },
  { x: 1.8, y: 0.4 },
  { x: 0.2, y: 0.4 },
];
const setup = () => {
  actions.addRoom(0, 0, 2, 3, "Synthetic bathroom", "tile");
  actions.setRoomFloor(room().id, {
    substrateTop: proposed(-0.05),
    layers: [
      { id: "screed", kind: "screed", thickness: proposed(0.04) },
      { kind: "tile", thickness: proposed(0.01) },
    ],
  });
  return actions.setRoomHeating(room().id, {
    zoneIds: [room().id],
    path,
    depthFromBottom: proposed(0.02),
  });
};
beforeEach(() => {
  store.setState({ model: emptyModel(), undoStack: [] });
  productStore.setState({ requests: [], products: [] });
});
describe("proposed heating (#8), synthetic evidence only", () => {
  it("keeps purchased metadata unknown and derives route length, actual zone union and clearances", () => {
    expect(setup().ok).toBe(true);
    const e = heatingEvidence(room());
    expect(e.planRouteLength).toBe(3.4);
    expect(e.routeLength).toBe(3.4);
    expect(e.minimumNonAdjacentSpacing).toBe(0.2);
    expect(e.selectedArea).toBe(6);
    expect(e.edgeDistance).toBe(0.2);
    expect(room().heating?.manufacturer).toBeUndefined();
    expect(room().heating?.length).toBeUndefined();
    expect(e.remainingProductLength).toBeUndefined();
    expect(codes()).toContain("heating_metadata_unknown");
    expect(codes()).toContain("heating_signoff");
    expect(heatingSection(room())[0].level).toBe(-0.03);
  });
  it("checks only confirmed cable length and rechecks screed thickness without changing cable inputs", () => {
    setup();
    actions.setRoomHeating(room().id, { length: proposed(3) });
    expect(codes()).toContain("heating_length_unconfirmed");
    expect(codes()).not.toContain("heating_length_exceeded");
    actions.setRoomHeating(room().id, { length: published(3) });
    expect(codes()).toContain("heating_length_exceeded");
    expect(heatingEvidence(room()).remainingProductLength).toBe(-0.4);
    const original = structuredClone(room().heating);
    actions.setRoomFloor(room().id, {
      layers: [
        { id: "screed", kind: "screed", thickness: proposed(0.015) },
        { kind: "tile", thickness: proposed(0.01) },
      ],
    });
    expect(codes()).toContain("heating_outside_screed");
    expect(room().heating).toEqual(original);
  });
  it("compares confirmed cable length against the spatial slope profile rather than its plan projection", () => {
    setup();
    actions.setRoomDrainage(room().id, { planes: [{ id: "slope", x: 0, y: 0, w: 2, h: 3, controls: [
      { x: 0, y: 0, level: proposed(0) },
      { x: 2, y: 0, level: proposed(.1) },
      { x: 0, y: 3, level: proposed(0) },
    ] }] });
    actions.setRoomHeating(room().id, { path: [{ x: .2, y: .2 }, { x: 1.2, y: .2 }], length: published(1.001) });
    const e = heatingEvidence(room());
    expect(e.routeLength).toBeCloseTo(Math.hypot(1, .05), 4);
    expect(e.planRouteLength).toBe(1);
    expect(e.remainingProductLength).toBe(-.0002);
    expect(codes()).toContain("heating_length_exceeded");
    expect(renderHeatingReview(room())).toContain("Plan route length: 1 m");
    expect(renderHeatingReview(room())).toContain("Spatial route length (sampled profile): 1.0012 m");
    const cable = catalogue(store.getState().model).elements.find(e => e.type === "heating")!;
    expect(specRows(store.getState().model, cable)).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: "plan route length (m)", value: "1" }),
      expect.objectContaining({ property: "spatial route length, sampled profile (m)", value: "1.0012" }),
      expect.objectContaining({ property: "remaining confirmed product length (m)", value: "-0.0002" }),
    ]));
  });
  it("withholds spatial length and confirmed balance when screed depth or floor surface is unknown", () => {
    setup();
    actions.setRoomHeating(room().id, { length: published(4), depthFromBottom: null });
    let e = heatingEvidence(room());
    expect(e.planRouteLength).toBe(3.4);
    expect(e.routeLength).toBeUndefined();
    expect(e.remainingProductLength).toBeUndefined();
    expect(codes()).toContain("heating_route_length_unknown");
    actions.setRoomHeating(room().id, { depthFromBottom: proposed(.02) });
    actions.setRoomDrainage(room().id, { planes: [{ id: "unknown", x: 0, y: 0, w: 2, h: 3 }] });
    e = heatingEvidence(room());
    expect(e.planRouteLength).toBe(3.4);
    expect(e.routeLength).toBeUndefined();
    expect(e.remainingProductLength).toBeUndefined();
    expect(codes()).not.toContain("heating_length_exceeded");
    expect(renderHeatingReview(room())).toContain("Spatial route length (sampled profile): unknown");
    expect(renderHeatingReview(room())).toContain("remaining confirmed cable length: unknown");
  });
  it("includes a continuous change of slope at a plane boundary even with level route endpoints", () => {
    setup();
    actions.setRoomDrainage(room().id, { planes: [
      { id: "up", x: 0, y: 0, w: 1, h: 3, controls: [{ x: 0, y: 0, level: proposed(0) }, { x: 1, y: 0, level: proposed(.05) }, { x: 0, y: 3, level: proposed(0) }] },
      { id: "down", x: 1, y: 0, w: 1, h: 3, controls: [{ x: 1, y: 0, level: proposed(.05) }, { x: 2, y: 0, level: proposed(0) }, { x: 1, y: 3, level: proposed(.05) }] },
    ] });
    actions.setRoomHeating(room().id, { path: [{ x: .5, y: 1 }, { x: 1.5, y: 1 }], length: published(1.001) });
    const e = heatingEvidence(room());
    expect(e.section[0].level).toBe(e.section.at(-1)!.level);
    expect(e.planRouteLength).toBe(1);
    expect(e.routeLength).toBeCloseTo(2 * Math.hypot(.5, .025), 4);
    expect(codes()).toContain("heating_length_exceeded");
  });
  it("detects intersections, coincident endpoints, adjacent backtracking and entered separation violations", () => {
    setup();
    actions.setRoomHeating(room().id, { minSpacing: published(0.25) });
    expect(codes()).toContain("heating_spacing");
    actions.setRoomHeating(room().id, {
      path: [
        { x: 0.1, y: 0.1 },
        { x: 1.9, y: 1.9 },
        { x: 0.1, y: 1.9 },
        { x: 1.9, y: 0.1 },
      ],
    });
    expect(codes()).toContain("heating_overlap");
    actions.setRoomHeating(room().id, {
      path: [
        { x: 0.1, y: 0.1 },
        { x: 1, y: 0.1 },
        { x: 0.5, y: 0.1 },
      ],
    });
    expect(codes()).toContain("heating_overlap");
    actions.setRoomHeating(room().id, {
      path: [
        { x: 0.1, y: 0.1 },
        { x: 1, y: 0.1 },
        { x: 1, y: 1 },
        { x: 0.1, y: 0.1 },
      ],
    });
    expect(codes()).toContain("heating_overlap");
    actions.setRoomHeating(room().id, {
      path: [
        { x: 0.1, y: 0.1 },
        { x: 0.1, y: 0.1 },
      ],
    });
    expect(codes()).toContain("heating_zero_segment");
  });
  it("checks whole segments through disjoint zones and narrow keep-outs, not just route vertices", () => {
    setup();
    actions.setRoomDrainage(room().id, {
      planes: [
        { id: "left", x: 0, y: 0, w: 0.8, h: 3 },
        { id: "right", x: 1.2, y: 0, w: 0.8, h: 3 },
      ],
    });
    actions.setRoomHeating(room().id, {
      zoneIds: ["left", "right"],
      path: [
        { x: 0.5, y: 1 },
        { x: 1.5, y: 1 },
      ],
    });
    expect(codes()).toContain("heating_outside_zone");
    actions.setRoomHeating(room().id, {
      zoneIds: [room().id],
      keepouts: [
        {
          id: "ex",
          label: "Synthetic exclusion",
          x: 0.9,
          y: 0.99,
          w: 0.01,
          h: 0.02,
        },
      ],
    });
    expect(codes()).toContain("heating_keepout");
    expect(heatingEvidence(room()).keepoutDistance).toBe(0);
    expect(heatingEvidence(room()).availableArea).toBe(5.9998);
    actions.setRoomHeating(room().id, {
      path: [
        { x: 0.5, y: 0.8 },
        { x: 1.5, y: 0.8 },
      ],
      edgeClearance: published(0.2),
    });
    expect(codes()).toContain("heating_clearance");
  });
  it("uses union boundary clearance across adjacent zones and exact union area for overlapping selections", () => {
    setup();
    actions.setRoomDrainage(room().id, {
      planes: [
        { id: "left", x: 0, y: 0, w: 1, h: 3 },
        { id: "right", x: 1, y: 0, w: 1, h: 3 },
      ],
    });
    actions.setRoomHeating(room().id, {
      zoneIds: ["left", "right"],
      path: [
        { x: 0.5, y: 1 },
        { x: 1.5, y: 1 },
      ],
      edgeClearance: published(0.2),
    });
    expect(codes()).not.toContain("heating_outside_zone");
    expect(codes()).not.toContain("heating_clearance");
    expect(heatingEvidence(room()).edgeDistance).toBe(0.5);
    actions.setRoomHeating(room().id, {
      zoneIds: [room().id, "left", "right"],
    });
    expect(heatingEvidence(room()).selectedArea).toBe(6);
  });
  it("samples every slope-zone boundary and detects small unresolved gaps along long route segments", () => {
    setup();
    actions.setRoomDrainage(room().id, {
      wastes: [{ id: "w", kind: "point", x: 0, y: 0, level: proposed(0.02) }],
      planes: [
        {
          id: "a",
          x: 0,
          y: 0,
          w: 0.41,
          h: 3,
          waste: "w",
          fall: proposed(0.01),
        },
        {
          id: "b",
          x: 0.42,
          y: 0,
          w: 1.58,
          h: 3,
          waste: "w",
          fall: proposed(0.02),
        },
      ],
    });
    actions.setRoomHeating(room().id, {
      path: [
        { x: 0.1, y: 0.1 },
        { x: 1.8, y: 0.1 },
      ],
    });
    const section = heatingSection(room());
    expect(
      section.some((p) => p.x > 0.41 && p.x < 0.42 && p.level === undefined),
    ).toBe(true);
    expect(section.some((p) => Math.abs(p.x - 0.42) < 1e-8)).toBe(true);
    expect(codes()).toContain("heating_depth_unknown");
    actions.setRoomHeating(room().id, { length: published(2) });
    expect(heatingEvidence(room()).planRouteLength).toBe(1.7);
    expect(heatingEvidence(room()).routeLength).toBeUndefined();
    expect(heatingEvidence(room()).remainingProductLength).toBeUndefined();
    expect(codes()).toContain("heating_route_length_unknown");
    const a = section[0];
    expect(a.level).toBeCloseTo(
      0.02 + Math.hypot(0.1, 0.1) * 0.01 - 0.01 - 0.04 + 0.02,
      4,
    );
  });
  it("refuses invalid edits atomically and imports only well-formed heating; undo and null preserve unknowns", () => {
    setup();
    const saved = structuredClone(room().heating);
    expect(
      actions.setRoomHeating(room().id, {
        length: { value: NaN, status: "published" },
      }).ok,
    ).toBe(false);
    expect(
      actions.setRoomHeating(room().id, { length: { value: 10 } }).ok,
    ).toBe(false);
    expect(
      actions.setRoomHeating(room().id, {
        keepouts: [{ id: "x", label: "x", x: 0, y: 0, w: 0.00001, h: 1 }],
      }).ok,
    ).toBe(false);
    expect(room().heating).toEqual(saved);
    actions.setRoomHeating(room().id, { length: published(10) });
    actions.undo();
    expect(room().heating).toEqual(saved);
    actions.setRoomHeating(room().id, { length: published(10) });
    actions.setRoomHeating(room().id, { length: null });
    expect(room().heating?.length).toBeUndefined();
    expect(
      actions.setRoomHeating(room().id, {
        length: { value: null, source: "Retained synthetic source" },
      }).ok,
    ).toBe(true);
    expect(room().heating?.length).toEqual({
      source: "Retained synthetic source",
    });
    const doc = { ...demoProject(), model: store.getState().model };
    expect(parseImport(JSON.stringify(doc)).model.rooms[0].heating).toEqual(
      room().heating,
    );
    (doc.model.rooms[0].heating as Heating).path = [{ x: NaN, y: 0 }];
    expect(() => parseImport(JSON.stringify(doc))).toThrow();
  });
  it("exposes one canonical model through tools, issue engine, print and selectively visible stage diagrams", async () => {
    setup();
    const cat = catalogue(store.getState().model),
      cable = cat.elements.find((e) => e.type === "heating")!;
    expect(cable).toBeDefined();
    expect(cat.notModelled.join(" ")).not.toContain("heating cable");
    const diagram = renderStageDiagram(store.getState().model, [cable], {
      label: "Cable only",
      findings: [],
    });
    expect(diagram).toContain("PROPOSED CABLE: route length along the drawn path in plan (XY projection) 3.4 m MOD; along the sampled cable profile 3.4 m MOD");
    expect(diagram).not.toContain("Not modelled, never drawn: in-screed heating cable");
    expect(renderStageSpec(store.getState().model, [cable], {
      label: "Cable only", findings: [],
    }).html).not.toContain("no cable record supplied");
    expect(
      renderStageDiagram(store.getState().model, [], {
        label: "No cable",
        findings: [],
      }),
    ).not.toContain("PROPOSED CABLE");
    expect(
      specRows(store.getState().model, cable).some(
        (r) => r.property === "manufacturer" && r.value === "?",
      ),
    ).toBe(true);
    expect(
      checkModel(store.getState().model).some(
        (p) => p.code === "heating_metadata_unknown",
      ),
    ).toBe(true);
    expect(renderHeatingReview(room())).toContain("manufacturer");
    expect(renderHeatingReview(room())).toContain("unknown");
    actions.setRoomHeating(room().id, {
      manufacturer: "<script>alert(1)</script>",
    });
    expect(renderHeatingReview(room())).not.toContain("<script>");
    actions.setRoomHeating(room().id, { clear: true });
    expect(catalogue(store.getState().model).notModelled.join(" ")).toContain(
      "heating cable",
    );
  });
});

const LABEL_LENGTH = 42.5;
const LABEL_OUTPUT = 765;
const LABEL_CURRENT = 3.2;
const LABEL_VOLTAGE = 240;
const LABEL_COVERAGE_MIN = 3.7;
const LABEL_COVERAGE_MAX = 5.1;
const LABEL_SPACING_MIN = 0.0871;
const LABEL_SPACING_MAX = 0.12;
const THERMO_CURRENT = 16;
const THERMO_VOLTAGE_MIN = 100;
const THERMO_VOLTAGE_MAX = 240;

const carton = (value: number | string, note: string, reference?: FieldValue["reference"]): FieldValue => ({
  value,
  status: "published",
  source: CARTON_LABEL_SOURCE,
  note: `SCK0765L in-screed heating cable carton: ${note}`,
  ...(reference ? { reference } : {}),
});

const libraryProduct = (
  category: "heating-cable" | "thermostat",
  fields: Record<string, FieldValue>,
  id = `lib-${category}`,
): LibraryProduct => ({
  id,
  category,
  manufacturer: category === "heating-cable" ? "Test Cable Co" : "OJ Electronics",
  model: category === "heating-cable" ? "SCK0765L" : "MWD5-1999-CBP3",
  fields,
  roughIn: [],
  requestId: "req",
  acceptedAt: 1,
});

describe("heating-cable brief as the single source of truth (#68)", () => {
  const attachCableSnapshot = (spec: ReturnType<typeof heatingCableSpecification>) => {
    const r = room();
    store.setState({
      model: {
        ...store.getState().model,
        rooms: store.getState().model.rooms.map((x) =>
          x.id === r.id ? { ...x, heating: { ...structuredClone(x.heating!), cableSpecification: spec } } : x,
        ),
      },
    });
  };
  const attachThermoSnapshot = (spec: ReturnType<typeof thermostatSpecificationOf>) => {
    const r = room();
    store.setState({
      model: {
        ...store.getState().model,
        rooms: store.getState().model.rooms.map((x) =>
          x.id === r.id ? { ...x, heating: { ...structuredClone(x.heating!), thermostatSpecification: spec } } : x,
        ),
      },
    });
  };
  const reviewAndAccept = (requestId: string) => {
    const req = productStore.getState().requests.find((r) => r.id === requestId)!;
    for (const key of requiredReviewKeys(req)) {
      expect(products.review(requestId, key, "accepted").ok).toBe(true);
    }
    const accepted = products.accept(requestId);
    expect(accepted.ok).toBe(true);
    return productStore.getState().products.find((p) => p.id === accepted.productId)!;
  };
  const acceptCable = (fields: Record<string, FieldValue>, label = "SCK0765L carton") => {
    const cat = categoryById("heating-cable")!;
    const id = products.openMeasurements("heating-cable", { label }, { ...unknownMeasurementFields(cat), ...fields }).requestId as string;
    const submitted = products.submitMeasurements(id);
    expect(submitted, submitted.summary).toMatchObject({ ok: true });
    return reviewAndAccept(id);
  };

  it("fills length, output and coverage from the recorded SCK0765L snapshot and does not copy them onto the heating record", () => {
    setup();
    const spec = heatingCableSpecification();
    expect(spec.fields.cableLength.value).toBe(LABEL_LENGTH);
    expect(spec.fields.totalPower.value).toBe(LABEL_OUTPUT);
    expect(spec.fields.coverageAreaMin.value).toBe(LABEL_COVERAGE_MIN);
    expect(spec.fields.coverageAreaMax.value).toBe(LABEL_COVERAGE_MAX);
    expect(actions.setRoomHeating(room().id, { cableSpecification: spec } as never).ok).toBe(false);
    attachCableSnapshot(spec);
    expect(room().heating?.length).toBeUndefined();
    expect(room().heating?.ratedOutput).toBeUndefined();
    const cable = heatingCableFigures(room().heating);
    expect(cable.length).toMatchObject({ value: LABEL_LENGTH, kind: "published", origin: PROJECT_SNAPSHOT_ORIGIN });
    expect(cable.ratedOutput).toMatchObject({ value: LABEL_OUTPUT, kind: "published" });
    expect(cable.spacingMin.value).toBe(0.0871);
    expect(cable.spacingMax.value).toBe(0.12);
    expect(cable.spacingMin.kind).toBe("derived");
    expect(cable.spacingMin.formula).toBe(SPACING_FROM_COVERAGE_FORMULA);
    expect(heatingEvidence(room()).cable.length.value).toBe(LABEL_LENGTH);
    expect(heatingEvidence(room()).figures.planRouteLength.kind).toBe("modelled");
    expect(renderHeatingReview(room())).toMatch(/42\.5 m · published/);
    expect(renderHeatingReview(room())).not.toMatch(/42\.5 m · modelled/);
  });

  it("writes the snapshot from an accepted product, refuses unknown or wrong-category ids, and flags dangling or mismatched refs", () => {
    setup();
    const fields = {
      cableLength: carton(LABEL_LENGTH, "heated length 42.5 m"),
      totalPower: carton(LABEL_OUTPUT, "765 W"),
      coverageAreaMin: carton(LABEL_COVERAGE_MIN, "coverage minimum"),
      coverageAreaMax: carton(LABEL_COVERAGE_MAX, "coverage maximum"),
    };
    productStore.setState({ products: [
      libraryProduct("heating-cable", fields, "live-cable"),
      libraryProduct("thermostat", { ratedCurrent: carton(THERMO_CURRENT, "16 A") }, "live-stat"),
    ] });
    expect(actions.setRoomHeating(room().id, { cableProductId: "no-such-product" }).ok).toBe(false);
    expect(actions.setRoomHeating(room().id, { cableProductId: "live-stat" }).ok).toBe(false);
    expect(actions.setRoomHeating(room().id, { thermostatProductId: "live-cable" }).ok).toBe(false);
    expect(actions.setRoomHeating(room().id, { cableProductId: "live-cable" }).ok).toBe(true);
    expect(room().heating?.cableProductId).toBe("live-cable");
    expect(room().heating?.cableSpecification?.fields.cableLength.value).toBe(LABEL_LENGTH);
    expect(room().heating?.cableSpecification?.fields.totalPower.value).toBe(LABEL_OUTPUT);
    expect(codes()).not.toContain("heating_product_unresolved");
    expect(codes()).not.toContain("heating_product_snapshot_mismatch");
    const heating = structuredClone(room().heating)!;
    heating.cableSpecification = { ...heating.cableSpecification!, fields: { ...heating.cableSpecification!.fields, cableLength: carton(3, "stale snapshot 3 m") } };
    store.setState({
      model: { ...store.getState().model, rooms: store.getState().model.rooms.map((x) => x.id === room().id ? { ...x, heating } : x) },
    });
    expect(heatingCableFigures(room().heating).length.value).toBe(LABEL_LENGTH);
    expect(codes()).toContain("heating_product_snapshot_mismatch");
    productStore.setState({ products: [] });
    expect(codes()).toContain("heating_product_unresolved");
    expect(heatingCableFigures(room().heating).length.value).toBe(3);
  });

  it("locks numeric length/output writes while the brief holds a number, but allows null-clear of a shadowed record value", () => {
    setup();
    productStore.setState({ products: [libraryProduct("heating-cable", {
      cableLength: carton(LABEL_LENGTH, "heated length 42.5 m"),
      totalPower: carton(LABEL_OUTPUT, "765 W"),
    }, "lock-cable")] });
    expect(actions.setRoomHeating(room().id, { cableProductId: "lock-cable" }).ok).toBe(true);
    const patch = { length: published(1) };
    const message = heatingProductWriteGuard(room().heating, patch);
    expect(message).toMatch(/length is locked/);
    const refused = actions.setRoomHeating(room().id, patch);
    expect(refused.ok).toBe(false);
    expect(refused.summary).toBe(message);
    expect(actions.setRoomHeating(room().id, { ratedOutput: published(100) }).ok).toBe(false);
    expect(heatingProductLocks(room().heating).length).toBe(true);
    expect(room().heating?.length).toBeUndefined();
    expect(actions.setRoomHeating(room().id, { length: null }).ok).toBe(true);
    expect(room().heating?.length).toBeUndefined();
  });

  it("refuses to attach a brief while the record holds a numeric length, and clears that value when asked", () => {
    setup();
    productStore.setState({ products: [libraryProduct("heating-cable", {
      cableLength: carton(LABEL_LENGTH, "heated length 42.5 m"),
      totalPower: carton(LABEL_OUTPUT, "765 W"),
    }, "attach-cable")] });
    expect(actions.setRoomHeating(room().id, { length: published(3) }).ok).toBe(true);
    const refused = actions.setRoomHeating(room().id, { cableProductId: "attach-cable" });
    expect(refused.ok).toBe(false);
    expect(refused.summary).toMatch(/numeric length/);
    expect(room().heating?.length?.value).toBe(3);
    expect(actions.setRoomHeating(room().id, { cableProductId: "attach-cable", length: null }).ok).toBe(true);
    expect(room().heating?.length).toBeUndefined();
    expect(heatingCableFigures(room().heating).length.value).toBe(LABEL_LENGTH);
  });

  it("locks manufacturer/model only when the referenced product itself has a non-empty value", () => {
    setup();
    attachCableSnapshot(heatingCableSpecification());
    expect(heatingCableFigures(room().heating).model).toBe("SCK0765L");
    expect(heatingProductLocks(room().heating).model).toBe(true);
    expect(heatingProductLocks(room().heating).manufacturer).toBe(false);
    productStore.setState({ products: [libraryProduct("heating-cable", {
      cableLength: carton(LABEL_LENGTH, "heated length 42.5 m"),
    }, "named-cable")] });
    expect(actions.setRoomHeating(room().id, { cableProductId: "named-cable" }).ok).toBe(true);
    expect(heatingCableFigures(room().heating).manufacturer).toBe("Test Cable Co");
    expect(heatingCableFigures(room().heating).model).toBe("SCK0765L");
    expect(heatingProductLocks(room().heating).manufacturer).toBe(true);
    expect(heatingProductLocks(room().heating).model).toBe(true);
    expect(actions.setRoomHeating(room().id, { manufacturer: "Other" }).ok).toBe(false);
  });

  it("uses user-entered manufacturer/model when no product name exists, and never marks those names published", () => {
    setup();
    expect(actions.setRoomHeating(room().id, { manufacturer: "Acme Cables", model: "User Model" }).ok).toBe(true);
    const cable = heatingCableFigures(room().heating);
    expect(cable.manufacturer).toBe("Acme Cables");
    expect(cable.model).toBe("User Model");
    expect(cable.manufacturerOrigin).toBe("heating-record");
    expect(cable.modelOrigin).toBe("heating-record");
    expect(heatingProductLocks(room().heating).manufacturer).toBe(false);
    expect(heatingProductLocks(room().heating).model).toBe(false);
    expect(codes()).not.toContain("heating_product_unresolved");
    const unknown = heatingProblems(room()).find((p) => p.code === "heating_metadata_unknown")!;
    expect(unknown.message).not.toMatch(/manufacturer/);
    expect(unknown.message).not.toMatch(/model/);
    const html = renderHeatingReview(room());
    expect(html).toContain("Acme Cables");
    expect(html).toContain("User Model");
    expect(html).toContain("user-entered on the heating record");
    const el = catalogue(store.getState().model).elements.find((e) => e.type === "heating")!;
    expect(specRows(store.getState().model, el)).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: "manufacturer", value: "Acme Cables", status: "entered", source: "user-entered on the heating record" }),
      expect.objectContaining({ property: "model", value: "User Model", status: "entered", source: "user-entered on the heating record" }),
    ]));
  });

  it("reads heating spec rows from the products argument rather than the global library", () => {
    setup();
    productStore.setState({ products: [libraryProduct("heating-cable", {
      cableLength: carton(LABEL_LENGTH, "heated length 42.5 m"),
    }, "live-cable")] });
    expect(actions.setRoomHeating(room().id, { cableProductId: "live-cable" }).ok).toBe(true);
    const el = catalogue(store.getState().model).elements.find((e) => e.type === "heating")!;
    expect(specRows(store.getState().model, el)).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: "product length (m)", value: String(LABEL_LENGTH) }),
    ]));
    const otherLib = [libraryProduct("heating-cable", { cableLength: carton(10, "other library 10 m") }, "live-cable")];
    expect(specRows(store.getState().model, el, otherLib)).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: "product length (m)", value: "10" }),
    ]));
  });

  it("allows null-clear of manufacturer/model and refuses attaching a named product over leftover record names", () => {
    setup();
    productStore.setState({ products: [libraryProduct("heating-cable", {
      cableLength: carton(LABEL_LENGTH, "heated length 42.5 m"),
    }, "named-cable")] });
    expect(actions.setRoomHeating(room().id, { manufacturer: "Acme Cables", model: "SCK0765L" }).ok).toBe(true);
    const refused = actions.setRoomHeating(room().id, { cableProductId: "named-cable" });
    expect(refused.ok).toBe(false);
    expect(refused.summary).toMatch(/manufacturer/);
    expect(refused.summary).toMatch(/model/);
    expect(room().heating?.manufacturer).toBe("Acme Cables");
    expect(room().heating?.model).toBe("SCK0765L");
    expect(actions.setRoomHeating(room().id, { cableProductId: "named-cable", manufacturer: null, model: null }).ok).toBe(true);
    expect(room().heating?.manufacturer).toBeUndefined();
    expect(room().heating?.model).toBeUndefined();
    expect(heatingCableFigures(room().heating)).toMatchObject({
      manufacturer: "Test Cable Co",
      manufacturerOrigin: "product-brief",
      model: "SCK0765L",
      modelOrigin: "product-brief",
    });
    expect(actions.setRoomHeating(room().id, { manufacturer: null, model: null }).ok).toBe(true);
    expect(room().heating?.manufacturer).toBeUndefined();
    expect(room().heating?.model).toBeUndefined();
    expect(heatingCableFigures(room().heating).manufacturer).toBe("Test Cable Co");
  });

  it("validates the product id before write-lock messages so an unknown id is not reported as a locked length", () => {
    setup();
    productStore.setState({ products: [libraryProduct("heating-cable", {
      cableLength: carton(LABEL_LENGTH, "heated length 42.5 m"),
    }, "lock-cable")] });
    expect(actions.setRoomHeating(room().id, { cableProductId: "lock-cable" }).ok).toBe(true);
    const refused = actions.setRoomHeating(room().id, { cableProductId: "no-such-product", length: published(1) });
    expect(refused.ok).toBe(false);
    expect(refused.summary).toMatch(/no accepted product "no-such-product"/);
    expect(refused.summary).not.toMatch(/length is locked/);
  });

  it("retargets a rev1→rev2→rev3 chain even when the record is still pinned to rev1", () => {
    setup();
    const v1 = acceptCable({
      cableType: carton("in-screed", "in-screed"),
      cableLength: carton(LABEL_LENGTH, "heated length 42.5 m", "fixture-end"),
      totalPower: carton(LABEL_OUTPUT, "765 W"),
    });
    expect(actions.setRoomHeating(room().id, { cableProductId: v1.id }).ok).toBe(true);
    const r2 = products.reviseProduct(v1.id).requestId as string;
    const v2Length = 40;
    const v2Output = 720;
    expect(products.recordMeasurement(r2, "cableLength", carton(v2Length, "revised heated length 40 m", "fixture-end")).ok).toBe(true);
    expect(products.recordMeasurement(r2, "totalPower", carton(v2Output, "revised 720 W")).ok).toBe(true);
    expect(products.submitMeasurements(r2).ok).toBe(true);
    const v2 = reviewAndAccept(r2);
    expect(room().heating?.cableProductId).toBe(v2.id);
    expect(actions.setRoomHeating(room().id, { cableProductId: v1.id }).ok).toBe(true);
    expect(room().heating?.cableProductId).toBe(v1.id);
    expect(heatingCableFigures(room().heating).length.value).toBe(v2Length);
    expect(codes()).toContain("heating_product_superseded");
    const r3 = products.reviseProduct(v2.id).requestId as string;
    const v3Length = 38;
    const v3Output = 684;
    expect(products.recordMeasurement(r3, "cableLength", carton(v3Length, "revised heated length 38 m", "fixture-end")).ok).toBe(true);
    expect(products.recordMeasurement(r3, "totalPower", carton(v3Output, "revised 684 W")).ok).toBe(true);
    expect(products.submitMeasurements(r3).ok).toBe(true);
    const v3 = reviewAndAccept(r3);
    expect(v3.revision?.parentProductId).toBe(v2.id);
    expect(room().heating?.cableProductId).toBe(v3.id);
    expect(heatingCableFigures(room().heating).length.value).toBe(v3Length);
    expect(heatingCableFigures(room().heating).ratedOutput.value).toBe(v3Output);
    expect(codes()).not.toContain("heating_product_superseded");
  });

  it("follows the latest accepted revision when rev3 is accepted while another project is open", () => {
    setup();
    const v1 = acceptCable({
      cableType: carton("in-screed", "in-screed"),
      cableLength: carton(LABEL_LENGTH, "heated length 42.5 m", "fixture-end"),
      totalPower: carton(LABEL_OUTPUT, "765 W"),
    });
    expect(actions.setRoomHeating(room().id, { cableProductId: v1.id }).ok).toBe(true);
    const r2 = products.reviseProduct(v1.id).requestId as string;
    expect(products.recordMeasurement(r2, "cableLength", carton(40, "revised heated length 40 m", "fixture-end")).ok).toBe(true);
    expect(products.recordMeasurement(r2, "totalPower", carton(720, "revised 720 W")).ok).toBe(true);
    expect(products.submitMeasurements(r2).ok).toBe(true);
    const v2 = reviewAndAccept(r2);
    expect(actions.setRoomHeating(room().id, { cableProductId: v1.id }).ok).toBe(true);
    const saved = structuredClone(store.getState().model);
    store.setState({ model: emptyModel(), undoStack: [] });
    const r3 = products.reviseProduct(v2.id).requestId as string;
    expect(products.recordMeasurement(r3, "cableLength", carton(38, "revised heated length 38 m", "fixture-end")).ok).toBe(true);
    expect(products.recordMeasurement(r3, "totalPower", carton(684, "revised 684 W")).ok).toBe(true);
    expect(products.submitMeasurements(r3).ok).toBe(true);
    const v3 = reviewAndAccept(r3);
    expect(store.getState().model.rooms).toEqual([]);
    store.setState({ model: saved, undoStack: [] });
    expect(room().heating?.cableProductId).toBe(v1.id);
    expect(heatingCableFigures(room().heating).length.value).toBe(38);
    expect(heatingCableFigures(room().heating).ratedOutput.value).toBe(684);
    expect(codes()).toContain("heating_product_superseded");
    expect(heatingProblems(room()).find((p) => p.code === "heating_product_superseded")?.message).toContain(v3.id);
  });

  it("runs the write guard during retarget and null-clears a shadowed record length", () => {
    setup();
    const v1 = acceptCable({
      cableType: carton("in-screed", "in-screed"),
      cableLength: carton(LABEL_LENGTH, "heated length 42.5 m", "fixture-end"),
      totalPower: carton(LABEL_OUTPUT, "765 W"),
    });
    expect(actions.setRoomHeating(room().id, { cableProductId: v1.id }).ok).toBe(true);
    const heating = structuredClone(room().heating)!;
    heating.length = published(3);
    store.setState({
      model: { ...store.getState().model, rooms: store.getState().model.rooms.map((x) => x.id === room().id ? { ...x, heating } : x) },
    });
    expect(room().heating?.length?.value).toBe(3);
    const r2 = products.reviseProduct(v1.id).requestId as string;
    expect(products.recordMeasurement(r2, "cableLength", carton(40, "revised heated length 40 m", "fixture-end")).ok).toBe(true);
    expect(products.submitMeasurements(r2).ok).toBe(true);
    const req = productStore.getState().requests.find((r) => r.id === r2)!;
    for (const key of requiredReviewKeys(req)) {
      expect(products.review(r2, key, "accepted").ok).toBe(true);
    }
    const accepted = products.accept(r2);
    expect(accepted.ok).toBe(true);
    expect(accepted.summary).toMatch(/Cleared shadowed heating-record length/);
    expect(room().heating?.length).toBeUndefined();
    expect(heatingCableFigures(room().heating).length.value).toBe(40);
  });

  it("refuses to import a heating snapshot that does not name the product it was written from, and does not treat that snapshot as published", () => {
    setup();
    const orphan = heatingCableSpecification();
    delete (orphan as { productId?: string }).productId;
    attachCableSnapshot(orphan);
    expect(heatingSnapshotProductId(room().heating?.cableSpecification)).toBeUndefined();
    expect(heatingCableFigures(room().heating).length.value).toBeUndefined();
    expect(heatingCableFigures(room().heating).length.origin).toBe("heating-record");
    expect(codes()).toContain("heating_product_unresolved");
    const doc = { ...demoProject(), model: store.getState().model };
    expect(() => parseImport(JSON.stringify(doc))).toThrow(/invalid model data/i);
  });

  it("imports a snapshot that names an unresolvable productId, uses those figures, and flags unresolved", () => {
    setup();
    attachCableSnapshot(heatingCableSpecification());
    expect(room().heating?.cableProductId).toBeUndefined();
    expect(heatingSnapshotProductId(room().heating?.cableSpecification)).toBe(SAMPLE_CABLE_PRODUCT_ID);
    const resolved = resolveHeatingProduct(room().heating, "heating-cable", []);
    expect(resolved.unresolved).toBe(true);
    expect(resolved.mismatch).toBe(false);
    expect(resolved.live).toBeUndefined();
    expect(resolved.snapshot?.productId).toBe(SAMPLE_CABLE_PRODUCT_ID);
    expect(heatingCableFigures(room().heating).length).toMatchObject({
      value: LABEL_LENGTH,
      kind: "published",
      origin: PROJECT_SNAPSHOT_ORIGIN,
    });
    expect(codes()).toContain("heating_product_unresolved");
    expect(codes()).not.toContain("heating_product_snapshot_mismatch");
    const imported = parseImport(JSON.stringify({ ...demoProject(), model: store.getState().model }));
    const heating = imported.model.rooms[0].heating;
    expect(heating?.cableProductId).toBeUndefined();
    expect(heatingCableFigures(heating).length.origin).toBe(PROJECT_SNAPSHOT_ORIGIN);
    expect(heatingProblems(imported.model.rooms[0]).map((p) => p.code)).toContain("heating_product_unresolved");
  });

  it("does not use a snapshot whose productId is a different product than the stored id", () => {
    setup();
    const heating = structuredClone(room().heating)!;
    heating.cableProductId = "stored-cable";
    heating.cableSpecification = Object.assign(heatingCableSpecification(), {
      productId: "other-product",
      fields: { ...heatingCableSpecification().fields, cableLength: carton(3, "other product 3 m") },
    });
    store.setState({
      model: { ...store.getState().model, rooms: store.getState().model.rooms.map((x) => x.id === room().id ? { ...x, heating } : x) },
    });
    const resolved = resolveHeatingProduct(room().heating, "heating-cable", []);
    expect(resolved.referencedId).toBe("stored-cable");
    expect(resolved.unresolved).toBe(true);
    expect(resolved.mismatch).toBe(true);
    expect(resolved.snapshot).toBeUndefined();
    expect(heatingCableFigures(room().heating).length.value).toBeUndefined();
    expect(codes()).toContain("heating_product_unresolved");
    expect(codes()).toContain("heating_product_snapshot_mismatch");
    productStore.setState({ products: [libraryProduct("heating-cable", { cableLength: carton(10, "library 10 m") }, "stored-cable")] });
    expect(resolveHeatingProduct(room().heating, "heating-cable").mismatch).toBe(true);
    expect(resolveHeatingProduct(room().heating, "heating-cable").snapshot).toBeUndefined();
    expect(heatingCableFigures(room().heating).length.value).toBe(10);
    expect(codes()).toContain("heating_product_snapshot_mismatch");
    expect(codes()).not.toContain("heating_product_unresolved");
  });

  it("writes thermostat label voltage, current and IP as published so like-for-like compares published to published", () => {
    setup();
    attachCableSnapshot(heatingCableSpecification());
    attachThermoSnapshot(thermostatSpecificationOf());
    expect(heatingCableSpecification().acceptedAt).toBe(0);
    expect(thermostatSpecificationOf().acceptedAt).toBe(0);
    const cable = heatingCableFigures(room().heating);
    const thermo = thermostatFigures(room().heating);
    expect(cable.ratedCurrent).toMatchObject({ value: LABEL_CURRENT, kind: "published", origin: PROJECT_SNAPSHOT_ORIGIN });
    expect(thermo.ratedCurrent).toMatchObject({ value: THERMO_CURRENT, kind: "published", origin: PROJECT_SNAPSHOT_ORIGIN });
    expect(thermo.voltageMin).toMatchObject({ value: THERMO_VOLTAGE_MIN, kind: "published", origin: PROJECT_SNAPSHOT_ORIGIN });
    expect(thermo.voltageMax).toMatchObject({ value: THERMO_VOLTAGE_MAX, kind: "published", origin: PROJECT_SNAPSHOT_ORIGIN });
    expect(thermo.ingressProtection).toMatchObject({ value: "IP21", kind: "published" });
    expect(thermo.ratedCurrent.source).toMatch(/Photographed MWD5-1999-CBP3 carton label/);
    expect(codes()).not.toContain("heating_current_unknown");
    expect(codes()).not.toContain("heating_current_rating");
    expect(codes()).not.toContain("heating_voltage_unknown");
    expect(codes()).not.toContain("heating_voltage_range");
    const ip = heatingProblems(room()).find((p) => p.code === "heating_ip_location")!;
    expect(ip.message).toMatch(/published/);
    expect(ip.message).not.toMatch(/measured/);
  });

  it("refuses to import a heating record whose brief would silently shadow leftover length, output or names", () => {
    setup();
    attachCableSnapshot(heatingCableSpecification());
    const heating = structuredClone(room().heating)!;
    heating.length = published(3);
    expect(validHeating(heating)).toBe(false);
    expect(heatingShadowedRecordKeys(heating)).toEqual(["length"]);
    store.setState({
      model: { ...store.getState().model, rooms: store.getState().model.rooms.map((x) => x.id === room().id ? { ...x, heating } : x) },
    });
    expect(() => parseImport(JSON.stringify({ ...demoProject(), model: store.getState().model }))).toThrow(/invalid model data/i);
    const refused = actions.setRoomHeating(room().id, { requirements: "leave leftover length" });
    expect(refused.ok).toBe(false);
    expect(refused.summary).toMatch(/length:null/);
    expect(actions.setRoomHeating(room().id, { length: null, requirements: "cleared" }).ok).toBe(true);
    expect(room().heating?.length).toBeUndefined();
    expect(heatingCableFigures(room().heating).length.value).toBe(LABEL_LENGTH);
  });

  it("retargets heating to a real catalogue revision, rewrites the snapshot, and keeps those figures when the library is empty", () => {
    setup();
    const v1Fields = {
      cableType: carton("in-screed", "in-screed"),
      cableLength: carton(LABEL_LENGTH, "heated length 42.5 m", "fixture-end"),
      totalPower: carton(LABEL_OUTPUT, "765 W"),
      coverageAreaMin: carton(LABEL_COVERAGE_MIN, "coverage minimum"),
      coverageAreaMax: carton(LABEL_COVERAGE_MAX, "coverage maximum"),
      ratedCurrent: carton(LABEL_CURRENT, "3.2 A"),
      ratedVoltage: carton(LABEL_VOLTAGE, "240 V"),
    };
    const v1 = acceptCable(v1Fields);
    expect(actions.setRoomHeating(room().id, { cableProductId: v1.id }).ok).toBe(true);
    expect(heatingCableFigures(room().heating).length.value).toBe(LABEL_LENGTH);
    const revised = products.reviseProduct(v1.id).requestId as string;
    const v2Length = 40;
    const v2Output = 720;
    const v2Min = 3.5;
    const v2Max = 4.8;
    expect(products.recordMeasurement(revised, "cableLength", carton(v2Length, "revised heated length 40 m", "fixture-end")).ok).toBe(true);
    expect(products.recordMeasurement(revised, "totalPower", carton(v2Output, "revised 720 W")).ok).toBe(true);
    expect(products.recordMeasurement(revised, "coverageAreaMin", carton(v2Min, "revised coverage minimum")).ok).toBe(true);
    expect(products.recordMeasurement(revised, "coverageAreaMax", carton(v2Max, "revised coverage maximum")).ok).toBe(true);
    expect(products.submitMeasurements(revised).ok).toBe(true);
    const v2 = reviewAndAccept(revised);
    expect(v2.id).not.toBe(v1.id);
    expect(v2.revision?.parentProductId).toBe(v1.id);
    expect(room().heating?.cableProductId).toBe(v2.id);
    expect(room().heating?.cableSpecification?.fields.cableLength.value).toBe(v2Length);
    expect(room().heating?.length).toBeUndefined();
    const e = heatingEvidence(room());
    expect(e.cable.length.value).toBe(v2Length);
    expect(e.cable.ratedOutput.value).toBe(v2Output);
    expect(e.cable.coverageMin.value).toBe(v2Min);
    expect(e.cable.coverageMax.value).toBe(v2Max);
    expect(e.cable.spacingMin.value).toBe(Math.round((v2Min / v2Length) * 1e4) / 1e4);
    expect(e.cable.spacingMax.value).toBe(Math.round((v2Max / v2Length) * 1e4) / 1e4);
    expect(e.problems.some((p) => p.code === "heating_length_exceeded")).toBe(false);
    const html = renderHeatingReview(room());
    expect(html).toMatch(/40 m · published/);
    expect(html).toMatch(/720 W/);
    const cable = catalogue(store.getState().model).elements.find((el) => el.type === "heating")!;
    expect(specRows(store.getState().model, cable)).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: "product length (m)", value: String(v2Length), status: "published" }),
      expect.objectContaining({ property: "rated output (W)", value: String(v2Output), status: "published" }),
      expect.objectContaining({ property: "coverage min (m²)", value: String(v2Min), status: "published" }),
    ]));
    const payload = { heating: room().heating, ...heatingEvidence(room()) };
    expect(payload.cable.length.value).toBe(v2Length);
    expect(payload.cable.ratedOutput.value).toBe(v2Output);
    expect(payload.cable.coverageMin.value).toBe(v2Min);
    expect(payload.cable.spacingMin.value).toBe(Math.round((v2Min / v2Length) * 1e4) / 1e4);
    actions.undo();
    expect(room().heating?.cableProductId).toBe(v1.id);
    expect(heatingCableFigures(room().heating).length.value).toBe(v2Length);
    expect(codes()).toContain("heating_product_superseded");
    const preview = actions.previewProductRevision(v2.id, []);
    expect(preview).toBeTruthy();
    const applied = actions.applyProductRevision(preview!);
    expect(applied.ok).toBe(true);
    expect(applied.summary).toMatch(/Heating on 1 room/);
    expect(room().heating?.cableProductId).toBe(v2.id);
    const snapshot = structuredClone(room().heating?.cableSpecification);
    productStore.setState({ products: [] });
    expect(heatingCableFigures(room().heating).length.value).toBe(v2Length);
    expect(heatingCableFigures(room().heating).ratedOutput.value).toBe(v2Output);
    expect(heatingCableFigures(room().heating).coverageMin.value).toBe(v2Min);
    expect(heatingEvidence(room()).cable.spacingMin.value).toBe(Math.round((v2Min / v2Length) * 1e4) / 1e4);
    expect(room().heating?.cableSpecification).toEqual(snapshot);
    expect(codes()).toContain("heating_product_unresolved");
  });

  it("prefers the live library product over a travelling snapshot, and the snapshot when no id is set", () => {
    setup();
    attachCableSnapshot(heatingCableSpecification());
    expect(heatingCableFigures(room().heating).length.value).toBe(LABEL_LENGTH);
    productStore.setState({
      products: [libraryProduct("heating-cable", { cableLength: carton(10, "library 10 m") }, "other-cable")],
    });
    expect(heatingCableFigures(room().heating).length.value).toBe(LABEL_LENGTH);
    expect(actions.setRoomHeating(room().id, { cableProductId: "other-cable" }).ok).toBe(true);
    expect(heatingCableFigures(room().heating).length.value).toBe(10);
  });

  it("labels derived spacing and modelled route length and never stores them as published", () => {
    setup();
    attachCableSnapshot(heatingCableSpecification());
    const e = heatingEvidence(room());
    expect(e.cable.spacingMin).toMatchObject({ kind: "derived", formula: SPACING_FROM_COVERAGE_FORMULA });
    expect(e.figures.planRouteLength).toMatchObject({ kind: "modelled", value: 3.4 });
    expect(e.figures.spatialRouteLength.kind).toBe("modelled");
    expect(e.cable.length.kind).toBe("published");
    const html = renderHeatingReview(room());
    expect(html).toMatch(/Derived spacing, minimum/);
    expect(html).toMatch(/coverage area \/ cable length/);
    expect(html).toMatch(/3\.4 m · modelled/);
    const cable = catalogue(store.getState().model).elements.find((el) => el.type === "heating")!;
    expect(specRows(store.getState().model, cable)).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: "product length (m)", value: String(LABEL_LENGTH), status: "published" }),
      expect.objectContaining({ property: "plan route length (m)", value: "3.4", status: "modelled" }),
      expect.objectContaining({ property: "derived spacing min (mm)", status: "derived" }),
      expect.objectContaining({ property: "model", value: "SCK0765L" }),
      expect.objectContaining({ property: "cable depth datum", status: "named" }),
    ]));
  });

  it("does not compare unlike quantities: current to current, voltage to voltage range", () => {
    setup();
    attachCableSnapshot(heatingCableSpecification());
    attachThermoSnapshot(thermostatSpecificationOf());
    const cable = heatingCableFigures(room().heating);
    const thermo = thermostatFigures(room().heating);
    expect(cable.ratedCurrent.value).toBe(LABEL_CURRENT);
    expect(thermo.ratedCurrent.value).toBe(THERMO_CURRENT);
    expect(cable.ratedVoltage.value).toBe(LABEL_VOLTAGE);
    expect(thermo.voltageMin.value).toBe(THERMO_VOLTAGE_MIN);
    expect(thermo.voltageMax.value).toBe(THERMO_VOLTAGE_MAX);
    expect(codes()).not.toContain("heating_current_unknown");
    expect(codes()).not.toContain("heating_current_rating");
    expect(codes()).not.toContain("heating_voltage_unknown");
    expect(codes()).not.toContain("heating_voltage_range");
    const problems = heatingProblems(room());
    expect(problems.some((p) => /765\s*W/.test(p.message) && /16/.test(p.message))).toBe(false);
    expect(problems.filter((p) => p.code.startsWith("heating_current")).every((p) => /current/i.test(p.message) && !/\bW\b/.test(p.message))).toBe(true);
    productStore.setState({
      products: [libraryProduct("thermostat", {
        ratedCurrent: { value: 2, status: "published", source: CARTON_LABEL_SOURCE, note: "carton 2 A" },
        ratedVoltageMin: { value: THERMO_VOLTAGE_MIN, status: "published", source: CARTON_LABEL_SOURCE, note: "carton 100 V" },
        ratedVoltageMax: { value: THERMO_VOLTAGE_MAX, status: "published", source: CARTON_LABEL_SOURCE, note: "carton 240 V" },
      }, "tight-stat")],
    });
    expect(actions.setRoomHeating(room().id, { thermostatProductId: "tight-stat" }).ok).toBe(true);
    expect(codes()).toContain("heating_current_rating");
    const current = heatingProblems(room()).find((p) => p.code === "heating_current_rating")!;
    expect(current.message).toMatch(/cable rated current 3\.2 A/);
    expect(current.message).toMatch(/thermostat rated switching current 2 A/);
    expect(current.message).toMatch(/electrician decides/i);
    expect(current.message).not.toMatch(/765\s*W/);
  });

  it("keeps the IP-vs-location requirement when location or its source is missing and does not invent a source", () => {
    setup();
    attachThermoSnapshot(thermostatSpecificationOf());
    const missing = heatingProblems(room()).find((p) => p.code === "heating_ip_location")!;
    expect(missing.message).toMatch(/IP21/);
    expect(missing.message).toMatch(/remains required/);
    expect(missing.message).toMatch(/electrician decides/i);
    expect(missing.message).toMatch(/No compliance approval/);
    expect(actions.setRoomHeating(room().id, {
      thermostatLocation: { description: "Hallway next to the light switch" },
    }).ok).toBe(true);
    expect(room().heating?.thermostatLocation?.source).toBeUndefined();
    expect(heatingProblems(room()).find((p) => p.code === "heating_ip_location")!.message).toMatch(/remains required/);
    expect(actions.setRoomHeating(room().id, {
      thermostatLocation: { description: "Hallway next to the light switch", source: "Owner, 5 Oct 2026", kind: "outside-wet-room" },
    }).ok).toBe(true);
    const placed = heatingProblems(room()).find((p) => p.code === "heating_ip_location")!;
    expect(placed.message).toMatch(/IP21/);
    expect(placed.message).toMatch(/outside a wet room/);
    expect(placed.message).toMatch(/does not decide/);
    expect(placed.message).toMatch(/electrician decides/i);
    expect(actions.setRoomHeating(room().id, {
      thermostatLocation: { description: "Inside the bathroom", source: "Synthetic location", kind: "wet-room" },
    }).ok).toBe(true);
    expect(heatingProblems(room()).find((p) => p.code === "heating_ip_location")!.message).toMatch(/a wet room/);
    expect(heatingProblems(room()).find((p) => p.code === "heating_ip_location")!.severity).toBe("warning");
  });

  it("withholds coverage and current comparisons when those brief numbers are absent", () => {
    setup();
    attachCableSnapshot(Object.assign({ category: "heating-cable", acceptedAt: 1, fields: { cableLength: carton(LABEL_LENGTH, "length only") } }, { productId: "length-only-brief" }));
    expect(codes()).toContain("heating_coverage_unknown");
    expect(codes()).not.toContain("heating_coverage_range");
    expect(codes()).toContain("heating_current_unknown");
    expect(heatingCableFigures(room().heating).spacingMin.kind).toBe("unknown");
    expect(heatingCableFigures(room().heating).spacingMin.value).toBeUndefined();
  });

  it("names cable-depth and wall-setback datums and does not invent keep-outs or setbacks", () => {
    expect(CABLE_DEPTH_DATUM).toMatch(/bottom face of the selected screed/);
    expect(WALL_SETBACK_DATUM).toMatch(/finished wall face/);
    setup();
    expect(room().heating?.keepouts).toEqual([]);
    expect(room().heating?.edgeClearance).toBeUndefined();
    const html = renderHeatingReview(room());
    expect(html).toContain(CABLE_DEPTH_DATUM);
    expect(html).toContain(WALL_SETBACK_DATUM);
  });

  it("records the sample SCK0765L loop at 42.5 m plan length from independent geometry, unconstrained at fixtures", () => {
    const sample = demoProject().model.rooms[0];
    const path = proposedSck0765lPath();
    expect(sample.heating?.path).toEqual(path);
    expect(sample.heating?.keepouts).toEqual([]);
    expect(sample.heating?.edgeClearance).toBeUndefined();
    expect(sample.heating?.length).toBeUndefined();
    expect(sample.heating?.ratedOutput).toBeUndefined();
    expect(sample.heating?.model).toBeUndefined();
    expect(sample.heating?.manufacturer).toBeUndefined();
    expect(sample.heating?.cableProductId).toBe(SAMPLE_CABLE_PRODUCT_ID);
    expect(sample.heating?.thermostatProductId).toBe(SAMPLE_THERMOSTAT_PRODUCT_ID);
    expect(heatingSnapshotProductId(sample.heating?.cableSpecification)).toBe(SAMPLE_CABLE_PRODUCT_ID);
    expect(heatingSnapshotProductId(sample.heating?.thermostatSpecification)).toBe(SAMPLE_THERMOSTAT_PRODUCT_ID);
    let plan = 0;
    for (let i = 1; i < path.length; i++) plan += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    expect(plan).toBeCloseTo(15 * 2.74 + 14 * PROPOSED_CABLE_SPACING_M, 6);
    expect(plan).toBeCloseTo(LABEL_LENGTH, 6);
    const e = heatingEvidence(sample);
    expect(e.planRouteLength).toBe(LABEL_LENGTH);
    expect(e.cable.length.value).toBe(LABEL_LENGTH);
    expect(e.cable.model).toBe("SCK0765L");
    expect(e.cable.modelOrigin).toBe("product-brief");
    expect(e.cable.ratedOutput.value).toBe(LABEL_OUTPUT);
    expect(e.routeLength).toBeUndefined();
    expect(e.remainingProductLength).toBeUndefined();
    expect(e.figures.planRouteLength.kind).toBe("modelled");
    expect(e.cable.length.kind).toBe("published");
    expect(e.problems.map((p) => p.code)).toContain("heating_route_length_unknown");
    expect(e.problems.map((p) => p.code)).not.toContain("heating_length_exceeded");
    expect(e.problems.map((p) => p.code)).toContain("heating_coverage_range");
    expect(e.problems.find((p) => p.code === "heating_coverage_range")?.message).toMatch(/availableArea/);
    expect(e.problems.find((p) => p.code === "heating_ip_location")?.message).toMatch(/IP21/);
    expect(e.problems.find((p) => p.code === "heating_ip_location")?.message).toMatch(/outside a wet room/);
    expect(e.minimumNonAdjacentSpacing).toBeCloseTo(PROPOSED_CABLE_SPACING_M, 6);
    expect(e.minimumNonAdjacentSpacing!).toBeGreaterThanOrEqual(LABEL_SPACING_MIN - 1e-8);
    expect(e.minimumNonAdjacentSpacing!).toBeLessThanOrEqual(LABEL_SPACING_MAX + 1e-8);
    const original = structuredClone(sample.heating);
    store.setState({ model: demoProject().model, undoStack: [] });
    expect(demoProject().notes.some((n) => /zero slack/.test(n.text))).toBe(true);
    expect(room().heating?.requirements).toMatch(/zero slack/);
    actions.setRoomFloor(room().id, {
      layers: room().floorBuildUp!.layers.map((l) => l.id === "floor_screed" ? { ...l, thickness: proposed(0.04) } : l),
    });
    expect(room().heating).toEqual(original);
    expect(heatingEvidence(room()).cable.length.value).toBe(LABEL_LENGTH);
    expect(heatingEvidence(room()).routeLength).toBeUndefined();
  });
});

