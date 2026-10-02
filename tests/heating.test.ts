import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { emptyModel, type Heating, type Room } from "../src/model/types";
import {
  heatingEvidence,
  heatingProblems,
  heatingSection,
} from "../src/model/heating";
import { checkModel } from "../src/model/issues";
import { demoProject, parseImport } from "../src/model/projects";
import {
  catalogue,
  renderStageDiagram,
  renderStageSpec,
  specRows,
} from "../src/sheets/stageView";
import { renderHeatingReview } from "../src/sheets/heating";

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
beforeEach(() => store.setState({ model: emptyModel(), undoStack: [] }));
describe("proposed heating (#8), synthetic evidence only", () => {
  it("keeps purchased metadata unknown and derives route length, actual zone union and clearances", () => {
    expect(setup().ok).toBe(true);
    const e = heatingEvidence(room());
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
    expect(diagram).toContain("PROPOSED CABLE 3.4 m");
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
