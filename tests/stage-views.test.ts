/**
 * Construction-stage diagram views (#41): one canonical bathroom, composed into stage views
 * by visibility alone. The model must come out of every compose, switch and export identical.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { emptyModel, type PlanModel } from "../src/model/types";
import { catalogue, renderStageDiagram, renderStageSpec, resolveVisible, specRows, viewFindings, NOT_MODELLED } from "../src/sheets/stageView";
import { applyView, composeView, currentView, resetViews, savedViews } from "../src/sheets/viewState";
import { reconcile } from "../src/sheets/check";

const PID = "test-project";
const model = () => store.getState().model;
const P = (value: number, source?: string) => ({ value, status: "proposed" as const, ...(source ? { source } : {}) });
const M = (value: number) => ({ value, status: "measured" as const, source: "site survey" });

beforeEach(() => {
  store.setState({ model: emptyModel(), undoStack: [], kinds: [] });
  resetViews();
});

/** The #1 bathroom with real wall and floor layers, drainage, fixtures and services. */
function bathroom() {
  const corners = [[0, 0], [2.11, 0], [2.11, 3.02], [0, 3.02]];
  const walls: string[] = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    walls.push(actions.addWall(ax, ay, bx, by, 0.1, 2.4).id as string);
  }
  actions.addRoom(0, 0, 2.11, 3.02, "Bathroom", "tile");
  const win = actions.addOpening("window", walls[0], { centre: 1.055 }, { width: 1.755, sill: 1.52, height: 0.6 }).id as string;
  const door = actions.addOpening("door", walls[2], { centre: 0.52, from: "b" }, { width: 0.8, height: 2.04 }).id as string;
  // the room is on the right of each wall (clockwise on screen)
  for (const w of walls) {
    actions.setWallSide(w, "right", {
      existing: M(0), frame: { value: -0.015, status: "site-confirmed", source: "strip-out check" },
      layers: [
        { kind: "board", name: "Villaboard 6 mm", thickness: P(0.006) },
        { kind: "waterproofing", name: "Liquid membrane", thickness: P(0.001) },
        { kind: "adhesive", name: "Tile adhesive", thickness: {} }, // unknown: must stay "?"
        { kind: "tile", name: "Wall tile", thickness: P(0.009) },
      ],
    });
  }
  actions.setRoomFloor("Bathroom", {
    substrate: "Timber subfloor", substrateTop: M(-0.02),
    layers: [
      { kind: "waterproofing", name: "Floor membrane", thickness: P(0.001) },
      { kind: "screed", name: "Sand/cement screed", thickness: P(0.03) },
      { kind: "adhesive", name: "Floor adhesive", thickness: P(0.004) },
      { kind: "tile", name: "Floor tile", thickness: P(0.01) },
    ],
  });
  actions.setRoomDrainage("Bathroom", {
    wastes: [{ id: "fw", label: "Floor waste", kind: "point", x: 0.5, y: 0.6, level: P(0) }],
    planes: [{ id: "pl", label: "Shower fall", x: 0, y: 0, w: 1, h: 1.2, waste: "fw", fall: { value: 0.015, status: "proposed" } }],
  });
  actions.defineItemKind({ kind: "vanity_recorded", label: "Vanity", w: 0.91, d: 0.465, h: 0.85, category: "bath" });
  const vanity = actions.placeItem("vanity_recorded", 1, 1).id as string;
  actions.anchorFixture(vanity, { wallId: walls[1], side: "right", face: "finished", distance: 1.7, status: "proposed" });
  actions.setServicePoint(vanity, { id: "vw", label: "Wall waste", service: "waste", face: "frame", out: 0, across: 0.1, up: 0.55, status: "proposed", source: "vanity install guide p. 3" });
  actions.setServicePoint(vanity, { id: "hw", label: "Hot water", service: "water", face: "frame", out: 0, across: -0.1, up: 0.5, status: "proposed" });
  actions.setServicePoint(vanity, { id: "gpo", label: "GPO", service: "power", face: "frame", out: 0, across: 0.3, status: "proposed" }); // up unknown
  actions.setSheetInfo({ project: "Bathroom renovation", site: "Main bathroom", preparedBy: "Owner" });
  store.setState({ undoStack: [] });
  return { walls, win, door, vanity };
}

const apply = (label: string, visible: string[]) => applyView(PID, model(), label, visible);

describe("stage diagram views (#41)", () => {
  it("lists only layers and objects the model really has, and names what it cannot model", () => {
    const { walls, vanity } = bathroom();
    const cat = catalogue(model());
    const layerIds = cat.layers.map((l) => l.id);
    expect(layerIds).toEqual(expect.arrayContaining(["walls", "wall-frame", "wall-board", "wall-waterproofing", "wall-adhesive", "wall-tile", "windows", "doors", "floor-screed", "drainage-wastes", "fixtures", "services-waste", "services-water", "services-power"]));
    expect(layerIds.some((l) => /heat|cable/.test(l))).toBe(false);
    expect(cat.notModelled.join(" ")).toMatch(/heating cable/);
    expect(cat.elements.map((e) => e.id)).toContain(`wall:${walls[0]}`);
    expect(cat.elements.map((e) => e.id)).toContain(`item:${vanity}:sp:vw`);
    // an empty model has no layers to offer
    expect(catalogue(emptyModel()).layers).toEqual([]);
  });

  it("rejects unknown ids as a whole and keeps the previous view", () => {
    bathroom();
    expect(apply("1. Post-demolition", ["walls", "wall-frame"]).ok).toBe(true);
    const bad = apply("5. Heating cable", ["floor-screed", "floor-heating-cable", "item:nope"]);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.unknown).toEqual(["floor-heating-cable", "item:nope"]);
    expect(bad.summary).toMatch(/Nothing changed/);
    expect(currentView(PID)!.label).toBe("1. Post-demolition");
    // a known kind with nothing recorded is not offered, and the refusal says why
    store.setState({ model: { ...model(), items: model().items.map((it) => ({ ...it, servicePoints: it.servicePoints?.filter((p) => p.service !== "water") })) } });
    const empty = apply("x", ["services-water"]);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.summary).toMatch(/services-water: a known layer kind with nothing recorded/);
    expect(apply("x", []).ok).toBe(false);
    expect(apply("", ["walls"]).ok).toBe(false);
    expect(applyView(PID, model(), "x", "walls").ok).toBe(false);
  });

  it("composing, switching and exporting never mutates or copies the canonical model", () => {
    bathroom();
    const before: PlanModel = structuredClone(model());
    const ref = model();
    const undo = store.getState().undoStack.length;
    for (const [label, ids] of [["A", ["walls"]], ["B", ["fixtures", "services-waste"]], ["A", ["walls"]]] as const) {
      const r = apply(label, [...ids]);
      expect(r.ok).toBe(true);
      const c = composeView(model(), currentView(PID)!);
      renderStageDiagram(model(), c.resolution.elements, { label, findings: c.findings, date: "2026-10-01" });
      renderStageSpec(model(), c.resolution.elements, { label, findings: c.findings });
    }
    expect(model()).toBe(ref); // same object: no copy was swapped in
    expect(model()).toEqual(before);
    expect(store.getState().undoStack).toHaveLength(undo);
    expect(JSON.stringify(model())).not.toMatch(/diagram|stage|visible/i);
    expect(savedViews(PID).map((v) => v.label).sort()).toEqual(["A", "B"]);
  });

  it("outputs contain exactly the visible content, and the diagram and spec agree", () => {
    const { walls, win, door, vanity } = bathroom();
    apply("3. Rough-in", ["walls", "wall-frame", "windows", "doors", "services-waste", "services-water", "services-power"]);
    const c = composeView(model(), currentView(PID)!);
    const svg = renderStageDiagram(model(), c.resolution.elements, { label: "3. Rough-in", findings: c.findings });
    const { html, rows } = renderStageSpec(model(), c.resolution.elements, { label: "3. Rough-in", findings: c.findings });
    const shown = (s: string) => [...s.matchAll(/data-element="([^"]+)"/g)].map((m) => m[1]);
    const ids = new Set(c.resolution.elements.map((e) => e.id));
    for (const id of shown(svg)) expect(ids.has(id)).toBe(true);
    for (const id of shown(html)) expect(ids.has(id)).toBe(true);
    // the same set is declared in both outputs
    const declared = (s: string) => JSON.parse(s.match(/id="stage-view">([^<]+)</)![1].replace(/&quot;/g, '"')).elements;
    expect(declared(svg)).toEqual(declared(html));
    expect(new Set(rows.map((r) => r.element))).toEqual(ids);
    expect(svg).toContain(`data-element="wall:${walls[0]}:right:frame"`);
    expect(svg).toContain(`data-element="opening:${win}"`);
    expect(svg).toContain(`data-element="opening:${door}"`);
    expect(svg).toContain(`data-element="item:${vanity}:sp:vw"`);
    // hidden: the fixture itself, its build-up, the floor
    expect(svg).not.toContain(`data-element="item:${vanity}"`);
    expect(svg).not.toMatch(/data-element="wall:[^"]+:right:layer_/);
    expect(html).not.toMatch(/Villaboard|Floor membrane|Screed/);
  });

  it("keeps unknown values unknown and statuses and sources attached", () => {
    const { walls, vanity } = bathroom();
    apply("7. Adhesive", ["wall-adhesive", "services-power", "services-waste", "floor-adhesive"]);
    const c = composeView(model(), currentView(PID)!);
    const { html, rows } = renderStageSpec(model(), c.resolution.elements, { label: "7. Adhesive", findings: c.findings });
    const adhesive = rows.filter((r) => r.element.startsWith(`wall:${walls[0]}:right:`) && r.property === "thickness (mm)");
    expect(adhesive).toMatchObject([{ value: "?", status: "unknown" }]);
    const outer = rows.find((r) => r.element.startsWith(`wall:${walls[0]}:right:`) && r.property === "outer face position (mm)")!;
    expect(outer.value).toBe("?");
    expect(outer.missing!.join(" ")).toMatch(/Tile adhesive thickness/);
    const gpo = rows.find((r) => r.element === `item:${vanity}:sp:gpo` && r.property.startsWith("up"))!;
    expect(gpo).toMatchObject({ value: "?", status: "unknown" });
    const waste = rows.find((r) => r.element === `item:${vanity}:sp:vw` && r.property.startsWith("out"))!;
    expect(waste).toMatchObject({ value: "0", status: "proposed", datum: "frame face", source: "vanity install guide p. 3" });
    const floorAdh = rows.find((r) => r.property === "top level (mm)")!;
    expect(floorAdh).toMatchObject({ value: "15", status: "proposed", datum: "existing floor surface" }); // -20 + 1 + 30 + 4, weakest of measured + proposed
    expect(html).toContain("must not be read as a measurement");
    expect(c.findings.filter((f) => f.code === "unresolved_in_view").length).toBeGreaterThan(0);
    const svg = renderStageDiagram(model(), c.resolution.elements, { label: "7. Adhesive", findings: c.findings });
    expect(svg).toContain("Tile adhesive ? (position unresolved)");
    // the vanity is set out from the finished face, which depends on the unknown adhesive: its points are listed, never placed
    expect(svg).not.toMatch(/<circle[^>]+data-element="item:[^"]+:sp:/);
    expect(svg).toMatch(/<text[^>]+data-element="item:[^"]+:sp:gpo"/);
  });

  it("places service points once their inputs resolve, measured from the face they name", () => {
    const { walls, vanity } = bathroom();
    const side = model().walls.find((w) => w.id === walls[1])!.sides!.right!;
    actions.setWallSide(walls[1], "right", { layers: side.layers.map((l) => ({ id: l.id, kind: l.kind, name: l.name, thickness: l.kind === "adhesive" ? P(0.004) : l.thickness })) });
    apply("Rough-in", ["walls", "services-waste"]);
    const c = composeView(model(), currentView(PID)!);
    const svg = renderStageDiagram(model(), c.resolution.elements, { label: "Rough-in", findings: c.findings });
    expect(svg).toMatch(new RegExp(`<circle[^>]+data-element="item:${vanity}:sp:vw"`));
    expect(svg).not.toMatch(/sp:hw|sp:gpo/); // other services hidden
    const along = renderStageSpec(model(), c.resolution.elements, { label: "Rough-in", findings: c.findings }).rows.find((r) => r.property === "along from end A (mm)")!;
    expect(along).toMatchObject({ value: "1800", status: "proposed", datum: `${walls[1]} end A` });
  });

  it("applies the A-01 blocking rules to visible content and requires reasoned acknowledgement", () => {
    const { walls } = bathroom();
    const door2 = actions.addOpening("door", walls[3], { centre: 1.5 }, { height: 2.04 }).id as string; // width defaulted
    apply("Walls only", ["walls", "wall-frame"]);
    let c = composeView(model(), currentView(PID)!);
    expect(c.findings.filter((f) => f.severity === "blocking")).toEqual([]); // the door is hidden
    apply("With doors", ["walls", "doors"]);
    c = composeView(model(), currentView(PID)!);
    const blocking = c.findings.filter((f) => f.severity === "blocking");
    expect(blocking.map((f) => f.code)).toContain("default:opening_width_default");
    expect(blocking.find((f) => f.code === "default:opening_width_default")!.ref).toContain(door2);
    expect(reconcile(c.findings, []).ok).toBe(false);
    const ack = reconcile(c.findings, blocking.map((f) => ({ code: f.code, ref: f.ref, reason: "Linen door width set on site by joiner" })));
    expect(ack.ok).toBe(true);
    if (!ack.ok) return;
    const svg = renderStageDiagram(model(), c.resolution.elements, { label: "With doors", findings: c.findings, acknowledged: ack.acknowledged, date: "2026-10-01" });
    expect(svg).toContain("Linen door width set on site by joiner");
    expect(svg).toContain("D 800 ENT");
    expect(svg).toMatch(/D 900 DEF/);
    // the title block rule still applies
    actions.setSheetInfo({ project: "", site: "" });
    expect(composeView(model(), currentView(PID)!).findings.map((f) => f.code)).toContain("title_block_incomplete");
  });

  it("reports a stored view whose ids no longer exist instead of dropping them silently", () => {
    const { vanity } = bathroom();
    apply("Fit-out", ["fixtures", `item:${vanity}`]);
    actions.removeItem(vanity);
    const c = composeView(model(), currentView(PID)!);
    expect(c.resolution.unknown).toEqual(["fixtures", `item:${vanity}`]); // the layer went with its only object
    expect(c.findings.find((f) => f.code === "view_stale_ids")?.severity).toBe("blocking");
    expect(c.findings.find((f) => f.code === "view_empty")?.severity).toBe("blocking"); // fixtures layer is gone too
  });

  it("walks the nine renovation stages over one shared model", () => {
    const { vanity } = bathroom();
    const before = structuredClone(model());
    const shell = ["walls", "rooms", "doors"];
    const stages: [string, string[]][] = [
      ["1. Post-demolition", [...shell, "wall-existing", "wall-frame", "floor-substrate"]],
      ["2. Initial surfacing and window", [...shell, "wall-frame", "wall-board", "windows", "floor-substrate"]],
      ["3. Plumbing and electrical rough-in", [...shell, "wall-frame", "windows", "services-waste", "services-water", "services-power", "drainage-wastes"]],
      ["4. Waterproofing", [...shell, "windows", "wall-board", "wall-waterproofing", "floor-waterproofing", "drainage-wastes"]],
      // no heating record exists: the stage shows the substrate and lists absent heating
      ["5. In-screed heating cable", [...shell, "windows", "floor-substrate", "floor-waterproofing", "drainage-wastes"]],
      ["6. Screed", [...shell, "windows", "floor-screed", "drainage-wastes", "drainage-planes"]],
      ["7. Adhesive", [...shell, "windows", "wall-adhesive", "floor-adhesive"]],
      ["8. Tiles", [...shell, "windows", "wall-tile", "floor-tile", "drainage-wastes"]],
      ["9. Fit-out", [...shell, "windows", "wall-tile", "floor-tile", "fixtures", "services-waste", "services-water", "services-power"]],
    ];
    expect(apply("heating", ["floor-heating-cable"]).ok).toBe(false);
    const outputs: string[] = [];
    for (const [label, ids] of stages) {
      const r = apply(label, ids);
      expect(r.ok, label).toBe(true);
      const c = composeView(model(), currentView(PID)!);
      const ack = reconcile(c.findings, []);
      expect(ack.ok, `${label}: ${JSON.stringify(c.findings.filter((f) => f.severity === "blocking"))}`).toBe(true);
      const svg = renderStageDiagram(model(), c.resolution.elements, { label, findings: c.findings, date: "2026-10-01" });
      const { html, rows } = renderStageSpec(model(), c.resolution.elements, { label, findings: c.findings, date: "2026-10-01" });
      expect(svg).toContain(`Stage diagram: ${label}`);
      expect(html).toContain(`Specification: ${label}`);
      expect(new Set(rows.map((x) => x.element))).toEqual(new Set(c.resolution.elements.map((e) => e.id)));
      expect(svg).toContain("NOT A COMPLIANCE CERTIFICATE");
      expect(svg).toContain(NOT_MODELLED[0].split(" (")[0]);
      outputs.push(svg);
    }
    expect(new Set(outputs).size).toBe(9); // every stage renders differently
    expect(outputs[8]).toContain(`data-element="item:${vanity}"`);
    expect(outputs[0]).not.toContain(`data-element="item:${vanity}"`);
    // every stage is drawn at the same scale from the same model
    expect(new Set(outputs.map((s) => s.match(/data-scale="(\d+)"/)![1])).size).toBe(1);
    expect(model()).toEqual(before);
    // switching back reproduces an earlier stage's content
    apply(stages[2][0], stages[2][1]);
    const again = composeView(model(), currentView(PID)!);
    expect(resolveVisible(model(), stages[2][1]).elements).toEqual(again.resolution.elements);
    expect(viewFindings(model(), again.resolution).some((f) => f.severity === "blocking")).toBe(false);
  });

  it("resolves service points whose ids contain a colon", () => {
    const { vanity } = bathroom();
    expect(actions.setServicePoint(vanity, { id: "cw:1", label: "Cold water", service: "water", face: "frame", out: 0, across: 0, up: 0.5, status: "proposed" }).ok).toBe(true);
    expect(apply("Water", ["services-water"]).ok).toBe(true);
    const c = composeView(model(), currentView(PID)!);
    const { rows } = renderStageSpec(model(), c.resolution.elements, { label: "Water", findings: c.findings });
    expect(rows.find((r) => r.element === `item:${vanity}:sp:cw:1` && r.property.startsWith("up"))).toMatchObject({ value: "500", status: "proposed" });
  });

  it("does not present a built-in catalogue footprint as an entered size", () => {
    bathroom();
    const toilet = actions.placeItem("toilet", 0.5, 2.5).id as string;
    const rows = specRows(model(), catalogue(model()).elements.find((e) => e.id === `item:${toilet}`)!);
    expect(rows.find((r) => r.property.startsWith("footprint"))).toMatchObject({ status: "defaulted" });
  });

  it("prints product counts as counts, not millimetres", () => {
    const { walls } = bathroom();
    const product = { id: "prod_v", category: "vanity", manufacturer: "Acme", model: "V1", requestId: "r", acceptedAt: 0, roughIn: [],
      fields: { width: { value: 0.9, status: "published" as const }, depth: { value: 0.46, status: "published" as const }, height: { value: 0.85, status: "published" as const }, tapHoles: { value: 1, status: "published" as const } } };
    expect(actions.placeProduct(product, { wallId: walls[3], side: "right", face: "existing", distance: 1, status: "proposed" } as never).ok).toBe(true);
    const el = catalogue(model()).elements.find((e) => e.type === "fixture" && model().items.find((i) => i.id === e.ref)?.productId === "prod_v")!;
    const rows = specRows(model(), el, [product]);
    expect(rows.find((r) => r.property === "tapHoles")!.value).toBe("1");
    expect(rows.find((r) => r.property === "width")!.value).toBe("900");
    // with the library loaded, the product is not reported as unresolved
    const findings = viewFindings(model(), resolveVisible(model(), [el.id]), [product]);
    expect(findings.some((f) => /product not in this browser/.test(f.message))).toBe(false);
  });
});

