import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { actions, store } from "../src/model/store";
import { demoProject } from "../src/model/projects";
import { resetRuntimeCatalog } from "../src/model/catalog";
import { emptyModel, type FloorAssembly, type FloorLayer, type PlanModel } from "../src/model/types";
import { bathroomKinds } from "../src/model/seed-bathroom";
import { applyStageVisibility, buildFixture, buildPlan, tagStages } from "../src/three/build";
import { floorFill } from "../src/model/floor";
import { catalogue, resolveVisible } from "../src/sheets/stageView";
import type { PartSpec } from "../src/three/furniture";

/** The sample bathroom, its kinds registered, built the way Scene3D builds it. */
const sample = () => {
  const doc = demoProject();
  store.setState({ model: doc.model, kinds: doc.kinds, notes: doc.notes, undoStack: [] });
  for (const k of doc.kinds) actions.defineItemKind({ ...k.entry, parts: k.parts });
  const model = store.getState().model;
  const { group } = buildPlan(model, "planning");
  // exactly as Scene3D does: fixtures added after buildPlan, with no further tagging pass
  for (const it of model.items) {
    const fg = buildFixture(model, it);
    if (fg) group.add(fg);
  }
  return { model, group };
};
const meshes = (root: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
  return out;
};
const byName = (root: THREE.Object3D, name: string) => meshes(root).filter((m) => m.name === name);
const box = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
const stagesOf = (m: THREE.Object3D): string[] => m.userData.stages ?? (m.userData.stage ? [m.userData.stage] : []);

function assertInside(parts: PartSpec[], env: { w: number; d: number; h: number }, label: string) {
  const eps = 1e-6;
  for (const p of parts) {
    const pw = p.w ?? 0.3, ph = p.h ?? 0.3, pd = p.d ?? 0.3;
    const x = p.x ?? 0, y = p.y ?? 0, z = p.z ?? 0;
    expect(x - pw / 2, `${label} x-`).toBeGreaterThanOrEqual(-env.w / 2 - eps);
    expect(x + pw / 2, `${label} x+`).toBeLessThanOrEqual(env.w / 2 + eps);
    expect(z - pd / 2, `${label} z-`).toBeGreaterThanOrEqual(-env.d / 2 - eps);
    expect(z + pd / 2, `${label} z+`).toBeLessThanOrEqual(env.d / 2 + eps);
    expect(y, `${label} y-`).toBeGreaterThanOrEqual(-eps);
    expect(y + ph, `${label} y+`).toBeLessThanOrEqual(env.h + 1e-4);
  }
}

beforeEach(() => { resetRuntimeCatalog(); store.setState({ model: emptyModel(), undoStack: [], kinds: [] }); });

describe("sample bathroom in 3D: the finished room over its build-up", () => {
  it("draws the floor down to the slab 120 mm below the current tile, without inventing the unknown split", () => {
    const { group } = sample();
    const substrate = byName(group, "bathroom:substrate")[0];
    expect(box(substrate).max.y).toBeCloseTo(-0.12, 4);
    expect(substrate.userData.stopgap).toBe(true); // slab thickness is not recorded; 100 mm is a drawn stand-in
    // membrane sits on the slab and the adhesive under the tile, each only as a film
    const membrane = byName(group, "bathroom:floor:floor_membrane")[0];
    expect(box(membrane).min.y).toBeCloseTo(-0.12, 4);
    expect(membrane.userData.drawnThickness).toMatch(/unknown/);
    expect(membrane.userData.stopgap).toBe(true);
    const adhesive = byName(group, "bathroom:floor:floor_adhesive")[0];
    expect(box(adhesive).max.y).toBeCloseTo(-0.01, 4);
    expect(adhesive.userData.stopgap).toBe(true);
    // the screed (heating cable inside) is one translucent fill, labelled as such
    const fill = byName(group, "bathroom:floor-fill")[0];
    expect(fill.userData.stages).toEqual(["room:bathroom:floor:floor_screed"]);
    expect((fill.material as THREE.Material).transparent).toBe(true);
    expect(fill.userData.stopgap).toBeUndefined();
    expect(fill.userData.drawnThickness).toMatch(/110 mm together; the split is unknown/);
    // the finished floor is the 10 mm tile, top at the current tile level
    const floor = byName(group, "bathroom:planning-floor")[0];
    expect(box(floor).max.y).toBeCloseTo(0, 4);
    expect(box(floor).min.y).toBeCloseTo(-0.01, 4);
  });

  it("runs the walls and the Villaboard down to the slab; adhesive and tile start at the floor", () => {
    const { group } = sample();
    const wall = meshes(group).filter((m) => m.name === "wall_w");
    expect(Math.min(...wall.map((m) => box(m).min.y))).toBeCloseTo(-0.12, 4);
    expect(Math.min(...byName(group, "wall_w:right:wall_w_board").map((m) => box(m).min.y))).toBeCloseTo(-0.12, 4);
    expect(Math.min(...byName(group, "wall_w:right:wall_w_tile").map((m) => box(m).min.y))).toBeCloseTo(0, 4);
  });

  it("lays the beige floor set-out on the finished floor and colours each wall's tiles", () => {
    const { group } = sample();
    const full = byName(group, "bathroom:floor-tiling:full")[0];
    expect(full).toBeDefined();
    expect(box(full).min.y).toBeGreaterThan(0);
    expect(box(full).max.y).toBeLessThan(0.003);
    const beige = (full.material as THREE.MeshStandardMaterial).color.getHexString();
    const north = byName(group, "wall_n:tiling:right:full")[0];
    const west = byName(group, "wall_w:tiling:right:full")[0];
    expect((north.material as THREE.MeshStandardMaterial).color.getHexString()).toBe(beige);
    expect((west.material as THREE.MeshStandardMaterial).color.getHexString()).not.toBe(beige);
    expect(group.getObjectByName("bathroom:floor-tiling")!.userData.unresolved.join(" ")).toMatch(/fall plane/);
  });

  it("puts both drains on the flat finished floor while the falls are unresolved, and says so", () => {
    const { group } = sample();
    for (const id of ["linear_drain", "square_waste"]) {
      const w = byName(group, `bathroom:waste:${id}`)[0];
      expect(w.userData.level).toMatch(/flat finished floor/);
    }
    const linear = byName(group, "bathroom:waste:linear_drain")[0];
    const linearBox = box(linear);
    // packing slip INV-211061: Lauxes Next Gen 35 is 1000 × 100 × 35 mm; 35 mm is depth below grate
    expect(linearBox.max.y).toBeCloseTo(0, 4);
    expect(linearBox.min.y).toBeCloseTo(-0.035, 4);
    expect(linearBox.max.x - linearBox.min.x).toBeCloseTo(0.1, 4); // 100 mm across the channel, not the 50 mm outlet
    expect(linearBox.max.z - linearBox.min.z).toBeCloseTo(1, 4); // 1000 mm centreline
    // no recorded level: the flat finished-level target is a stand-in, so the drain is stopgap
    expect(linear.userData.stopgap).toBe(true);
    expect(linear.userData.stopgapReason).toMatch(/level not recorded; drawn on the flat finished-level target/);
    expect(linear.userData.body).toMatch(/grate from the brief, body depth below the grate from the brief/); // sourced body kept distinct from the marker
    const square = byName(group, "bathroom:waste:square_waste")[0];
    const squareBox = box(square);
    // packing slip: Kano 316 120 × 120 grate; 50 mm is the outlet, not the grate
    expect(squareBox.min.y).toBeCloseTo(0, 4);
    expect(squareBox.max.x - squareBox.min.x).toBeCloseTo(0.12, 4);
    expect(squareBox.max.z - squareBox.min.z).toBeCloseTo(0.12, 4);
    expect(square.userData.stopgap).toBe(true); // body depth below grate is not recorded
    expect(square.userData.stopgapReason).toMatch(/level not recorded/);
  });

  it("draws a linear drain with a recorded level at that level and not as a stopgap", () => {
    const { model } = sample();
    const m = structuredClone(model);
    const linearWaste = m.rooms.find((r) => r.id === "bathroom")!.drainage!.wastes.find((w) => w.id === "linear_drain")!;
    linearWaste.level = { value: -0.01, status: "proposed", source: "test" };
    const { group } = buildPlan(m, "planning");
    const linear = byName(group, "bathroom:waste:linear_drain")[0];
    expect(linear.userData.stopgap).toBeUndefined();
    expect(linear.userData.stopgapReason).toBeUndefined();
    expect(box(linear).max.y).toBeCloseTo(-0.01, 4);
    expect(box(linear).min.y).toBeCloseTo(-0.045, 4);
  });

  it("carries each build-up value's status and datum on the 3D parts", () => {
    const { model, group } = sample();
    const fb = model.rooms.find((r) => r.id === "bathroom")!.floorBuildUp!;
    const sub = byName(group, "bathroom:substrate")[0];
    expect(sub.userData.stopgap).toBe(true); // the drawn 100 mm thickness stays a stopgap
    expect(sub.userData.provenance).toMatchObject({ status: "estimated", datum: fb.datum });
    expect(sub.userData.provenance.source).toMatch(/owner: about 120 mm below the current tile/);
    const fill = byName(group, "bathroom:floor-fill")[0];
    expect(fill).toBeDefined();
    expect(fill.userData.provenance.status).toBe(floorFill(fb)!.basis);
    expect(fill.userData.provenance.status).toBe("estimated"); // target (proposed) − estimated slab − estimated tile
    const wall = byName(group, "wall_w")[0].parent!; // the wall group
    expect(wall.userData.foot).toMatchObject({ level: -0.12, status: "estimated", datum: fb.datum });
    expect(wall.userData.foot.source).toMatch(/owner: about 120 mm below/);
    expect(group.getObjectByName("bathroom:floor-tiling")!.userData.provenance.datum).toBe(fb.datum);
  });

  it("draws the screen as see-through 10 mm glass with a stopgap wall channel inside that envelope", () => {
    const { group } = sample();
    const parts = meshes(group).filter((m) => m.userData.stage === "item:screen");
    expect(parts).toHaveLength(2);
    const glass = parts.find((m) => (m.material as THREE.Material).transparent);
    const channel = parts.find((m) => m.userData.stopgap);
    expect(glass).toBeDefined();
    expect(channel).toBeDefined();
    expect(glass!.userData.stopgap).toBeUndefined();
    // owner + workbook: 10 mm glass; channel section is not recorded, so it stays inside 10 mm
    expect(box(channel!).max.z - box(channel!).min.z).toBeLessThanOrEqual(0.01 + 1e-6);
  });

  it("does not draw a 3D heating cable: the proposed path is a 2D stage-diagram layer", () => {
    const { group } = sample();
    const names: string[] = [];
    group.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name) names.push(o.name); });
    expect(names.some((n) => /heating/i.test(n))).toBe(false);
  });

  it("keeps toilet parts inside the owner's 480 × 700 mm plan envelope and the 800 mm placeholder height", () => {
    const kind = bathroomKinds.find((k) => k.entry.kind === "toilet_proxy")!;
    // owner spec: seat about 480 wide, projection just under 700; 800 mm is the catalogue placeholder
    expect(kind.entry).toMatchObject({ w: 0.48, d: 0.7, h: 0.8 });
    expect(kind.entry.stopgap).toBeUndefined();
    expect(kind.parts!.every((p) => p.stopgap === true)).toBe(true);
    const cistern = kind.parts!.find((p) => p.w === 0.385);
    expect(cistern?.d).toBe(0.165); // owner spec: cistern 385 × 165
    assertInside(kind.parts!, { w: 0.48, d: 0.7, h: 0.8 }, "toilet_proxy");
  });

  it("keeps the screen glass and channel inside the 900 × 10 × 2000 mm panel", () => {
    const kind = bathroomKinds.find((k) => k.entry.kind === "screen_proposed")!;
    // owner 5 Oct + workbook: 900 × 2000 × 10 mm clear toughened
    expect(kind.entry).toMatchObject({ w: 0.9, d: 0.01, h: 2 });
    expect(kind.entry.stopgap).toBeUndefined();
    const glass = kind.parts!.find((p) => p.opacity !== undefined);
    const channel = kind.parts!.find((p) => p.stopgap);
    expect(glass?.d).toBe(0.01);
    expect(glass?.h).toBe(2);
    expect(glass?.w).toBe(0.9); // sourced 900 mm, not shrunk by the stopgap channel
    expect(glass?.stopgap).toBeUndefined();
    expect(channel?.d).toBe(0.01); // channel section not recorded; stays inside the glass envelope
    expect(channel?.stopgap).toBe(true);
    assertInside(kind.parts!, { w: 0.9, d: 0.01, h: 2 }, "screen_proposed");
  });
});

describe("3D follows a stage view", () => {
  it("tags every drawn mesh with an element the stage catalogue really has", () => {
    const { model, group } = sample();
    const known = new Set(catalogue(model).elements.map((e) => e.id));
    const untagged: string[] = [];
    group.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh && !(o as THREE.LineSegments).isLineSegments) return;
      const ids = stagesOf(o);
      if (!ids.length) untagged.push(o.name || "(unnamed)");
      for (const id of ids) expect(known.has(id), `${o.name} → ${id}`).toBe(true);
    });
    expect(untagged).toEqual(["(unnamed)"]); // the ground plane only
  });

  it("shows exactly a stage's visible set, and everything again with no stage", () => {
    const { model, group } = sample();
    const visibleIds = (ids: string[]) => new Set(resolveVisible(model, ids).elements.map((e) => e.id));
    const shown = () => new Set(meshes(group).filter((m) => m.visible).flatMap(stagesOf));

    // 1. post-demolition: frame and slab, the window opening empty
    applyStageVisibility(group, visibleIds(["walls", "floor-substrate"]));
    expect([...shown()].sort()).toEqual(["room:bathroom:substrate", "wall:wall_e", "wall:wall_n", "wall:wall_s", "wall:wall_w"]);

    // 4. waterproofing: Villaboard, the new window and the membrane film; screed and tiles not yet
    applyStageVisibility(group, visibleIds(["walls", "floor-substrate", "wall-board", "windows", "floor-waterproofing", "drainage-wastes"]));
    const wp = shown();
    expect(wp.has("room:bathroom:floor:floor_membrane")).toBe(true);
    expect(wp.has("opening:window_n")).toBe(true);
    expect(wp.has("wall:wall_n:right:wall_n_board")).toBe(true);
    expect(byName(group, "bathroom:floor-fill")[0].visible).toBe(false);
    expect(byName(group, "bathroom:planning-floor")[0].visible).toBe(false);
    expect(meshes(group).filter((m) => m.userData.stage === "item:bath").every((m) => !m.visible)).toBe(true);

    // 6. fit-out with the door wall left out: its body, linings and tiles hidden, the rest shown
    const all = catalogue(model).elements.map((e) => e.id).filter((id) => !id.startsWith("wall:wall_s"));
    applyStageVisibility(group, visibleIds(all));
    expect(byName(group, "wall_s").every((m) => !m.visible)).toBe(true);
    expect(byName(group, "wall_s:tiling:right:full").every((m) => !m.visible)).toBe(true);
    expect(meshes(group).filter((m) => m.userData.stage === "item:bath").every((m) => m.visible)).toBe(true);
    expect(byName(group, "bathroom:floor-tiling:full")[0].visible).toBe(true);

    applyStageVisibility(group, null);
    expect(meshes(group).every((m) => m.visible)).toBe(true);
  });
});

describe("review round 1: sizes tied to products, per-wall foot, stage-safe fill, falls", () => {
  const P = (value: number) => ({ value, status: "proposed" as const });
  const square = (id: string, x: number, w: number, h: number) => [
    { id: `${id}_n`, ax: x, ay: 0, bx: x + w, by: 0, thickness: 0.1, height: 2.4 },
    { id: `${id}_e`, ax: x + w, ay: 0, bx: x + w, by: h, thickness: 0.1, height: 2.4 },
    { id: `${id}_s`, ax: x + w, ay: h, bx: x, by: h, thickness: 0.1, height: 2.4 },
    { id: `${id}_w`, ax: x, ay: h, bx: x, by: 0, thickness: 0.1, height: 2.4 },
  ];
  const L = (id: string, kind: FloorLayer["kind"], thickness?: number): FloorLayer => ({ id, kind, name: id, thickness: thickness === undefined ? {} : P(thickness) });
  const stripped: FloorAssembly = { datum: "existing floor", substrateTop: { value: -0.12, status: "estimated" }, finishedTarget: P(0), layers: [L("t", "tile", 0.01)] };
  const built = (model: PlanModel) => { const { group } = buildPlan(model, "planning"); tagStages(model, group); return group; };

  it("gives a waste with no drain product no sourced body, even under a sample id; the sample keeps its packing-slip sizes", () => {
    const model: PlanModel = {
      ...emptyModel(), walls: square("a", 0, 2, 2),
      rooms: [{ id: "r", x: 0, y: 0, w: 2, h: 2, label: "R", floor: "tile", drainage: { planes: [], wastes: [
        { id: "linear_drain", label: "Some other channel", kind: "linear", ax: 0.2, ay: 0.2, bx: 0.2, by: 1.2, level: P(0) },
        { id: "square_waste", label: "Some other grate", kind: "point", ax: 1, ay: 1, bx: 1, by: 1, level: P(0) },
      ] } }],
    };
    const group = built(model);
    for (const id of ["linear_drain", "square_waste"]) {
      const w = byName(group, `r:waste:${id}`)[0];
      expect(w.userData.stopgap, id).toBe(true);
      expect(w.userData.body).toMatch(/no drain product linked/);
      const b = box(w);
      expect(Math.min(b.max.x - b.min.x, b.max.z - b.min.z), id).toBeLessThan(0.01);
    }
    const { group: sampleGroup } = sample();
    const lauxes = box(byName(sampleGroup, "bathroom:waste:linear_drain")[0]);
    expect(lauxes.max.x - lauxes.min.x).toBeCloseTo(0.1, 3);
    expect(lauxes.max.y - lauxes.min.y).toBeCloseTo(0.035, 3);
    const kano = box(byName(sampleGroup, "bathroom:waste:square_waste")[0]);
    expect(kano.max.x - kano.min.x).toBeCloseTo(0.12, 3);
    expect(kano.max.z - kano.min.z).toBeCloseTo(0.12, 3);
  });

  it("takes each wall's foot from the rooms it bounds: only the stripped room's walls go down", () => {
    const model: PlanModel = {
      ...emptyModel(), walls: [...square("a", 0, 2, 2), ...square("b", 4, 2, 2)],
      rooms: [
        { id: "ra", x: 0.05, y: 0.05, w: 1.9, h: 1.9, label: "Stripped", floor: "tile", floorBuildUp: stripped },
        { id: "rb", x: 4.05, y: 0.05, w: 1.9, h: 1.9, label: "Other", floor: "tile" },
      ],
    };
    const group = built(model);
    const foot = (id: string) => Math.min(...byName(group, id).map((m) => box(m).min.y));
    for (const id of ["a_n", "a_e", "a_s", "a_w"]) expect(foot(id), id).toBeCloseTo(-0.12, 4);
    for (const id of ["b_n", "b_e", "b_s", "b_w"]) expect(foot(id), id).toBeCloseTo(0, 4);
    const footInfo = (id: string) => group.children.find((c) => c.children.some((m) => m.name === id))?.userData.foot;
    expect(footInfo("a_n")).toMatchObject({ level: -0.12, status: "estimated" });
    expect(footInfo("b_n")).toBeUndefined();
  });

  it("hides the fill in the lower layer's stage when two unknown layers have nothing between them", () => {
    const model: PlanModel = {
      ...emptyModel(), walls: square("a", 0, 2, 2),
      rooms: [{ id: "r", x: 0.05, y: 0.05, w: 1.9, h: 1.9, label: "R", floor: "tile", floorBuildUp: {
        datum: "existing floor", substrateTop: { value: -0.1, status: "measured" }, finishedTarget: P(0),
        layers: [L("wp", "waterproofing"), L("sc", "screed"), L("t", "tile", 0.01)],
      } }],
    };
    const group = built(model);
    const fill = byName(group, "r:floor-fill")[0];
    expect(fill.userData.stages).toEqual(["room:r:floor:sc"]);
    const visible = (ids: string[]) => new Set(resolveVisible(model, ids).elements.map((e) => e.id));
    applyStageVisibility(group, visible(["floor-substrate", "floor-waterproofing"]));
    expect(fill.visible).toBe(false);
    expect(byName(group, "r:floor:wp")[0].visible).toBe(true);
    applyStageVisibility(group, visible(["floor-substrate", "floor-waterproofing", "floor-screed"]));
    expect(fill.visible).toBe(true);
  });

  it("draws only the substrate under resolved falls, like the floor and floor-tiling builders", () => {
    const model: PlanModel = {
      ...emptyModel(), walls: square("a", 0, 2, 2),
      rooms: [{ id: "r", x: 0.05, y: 0.05, w: 1.9, h: 1.9, label: "R", floor: "tile",
        floorBuildUp: { datum: "existing floor", substrateTop: { value: -0.1, status: "measured" }, finishedTarget: P(0),
          layers: [L("wp", "waterproofing"), L("sc", "screed"), L("ad", "adhesive", 0.004), L("t", "tile", 0.01)] },
        drainage: {
          wastes: [{ id: "w", label: "Channel", kind: "linear", ax: 0.2, ay: 0.2, bx: 1.8, by: 0.2, level: P(-0.02) }],
          planes: [{ id: "pl", label: "Floor", x: 0.05, y: 0.05, w: 1.9, h: 1.9, wasteId: "w", fall: P(0.015), controls: [] }],
        } }],
    };
    const group = built(model);
    const names = meshes(group.getObjectByName("r:build-up")!).map((m) => m.name);
    expect(names).toEqual(["r:substrate"]);
    expect(group.getObjectByName("r:fall:pl")).toBeDefined();
  });

  it("marks the block under a doorway down to the substrate as a stopgap", () => {
    const model: PlanModel = {
      ...emptyModel(), walls: square("a", 0, 2, 2),
      openings: [{ id: "d", kind: "door", wallId: "a_s", t: 0.5, width: 0.8, sill: 0, height: 2 }],
      rooms: [{ id: "r", x: 0.05, y: 0.05, w: 1.9, h: 1.9, label: "R", floor: "tile", floorBuildUp: stripped }],
    };
    const group = built(model);
    const under = byName(group, "a_s").filter((m) => box(m).max.y <= 0.001);
    expect(under.length).toBeGreaterThan(0);
    for (const m of under) expect(m.userData.stopgap).toBe(true);
  });
});

describe("review round 3: stage ids set where meshes are built", () => {
  it("keeps model ids containing ':' whole: each element shows exactly in the stages that list it", () => {
    const doc = demoProject();
    const renamed = JSON.parse(JSON.stringify(doc.model)
      .replaceAll('"wall_w"', '"bath:west"')
      .replaceAll('"bathroom"', '"bath:room"')
      .replaceAll('"wall_n_board"', '"wall_n:board"')) as PlanModel;
    store.setState({ model: renamed, kinds: doc.kinds, notes: doc.notes, undoStack: [] });
    for (const k of doc.kinds) actions.defineItemKind({ ...k.entry, parts: k.parts });
    const model = store.getState().model;
    const { group } = buildPlan(model, "planning");
    for (const it of model.items) { const fg = buildFixture(model, it); if (fg) group.add(fg); }
    const all = catalogue(model).elements.map((e) => e.id);
    const targets = ["wall:bath:west", "room:bath:room:substrate", "room:bath:room:waste:linear_drain", "wall:wall_n:right:wall_n:board"];
    for (const id of targets) {
      expect(all, id).toContain(id);
      const drawn = meshes(group).filter((m) => stagesOf(m).includes(id));
      expect(drawn.length, id).toBeGreaterThan(0);
      applyStageVisibility(group, new Set([id]));
      expect(drawn.every((m) => m.visible), `${id} shown when listed`).toBe(true);
      expect(meshes(group).filter((m) => m.visible && stagesOf(m).length).every((m) => stagesOf(m).includes(id)), `only ${id} shown`).toBe(true);
      applyStageVisibility(group, new Set(all.filter((x) => x !== id)));
      expect(drawn.every((m) => !m.visible), `${id} hidden when not listed`).toBe(true);
    }
  });
});

describe("review round 4: the drains stay visible through the floor tiles", () => {
  /** Rendered: the object and every ancestor visible. */
  const rendered = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };

  it("draws the linear drain's grate above the tile set-out in the stages that show both, its level and aperture unchanged", () => {
    const { model, group } = sample();
    const room = model.rooms.find((r) => r.id === "bathroom")!;
    const waste = room.drainage!.wastes.find((w) => w.id === "linear_drain")!;
    expect(waste.level).toBeUndefined(); // still unrecorded: nothing here sets a level
    // the stage pack's layers (stage-shots.mjs): 4. waterproofing, 5. screed and tiles, 6. fit-out
    const visibleIds = (ids: string[]) => new Set(resolveVisible(model, ids).elements.map((e) => e.id));
    const waterproofing = ["walls", "floor-substrate", "doors", "drainage-wastes", "wall-board", "windows", "floor-waterproofing", "wall-waterproofing"];
    const tiles = [...waterproofing, "floor-screed", "floor-adhesive", "floor-tile", "wall-adhesive", "wall-tile"];
    const fitOut = [...tiles, "fixtures"];

    const tileMeshes = byName(group, "bathroom:floor-tiling:full").concat(byName(group, "bathroom:floor-tiling:cut"));
    const tileTop = Math.max(...tileMeshes.map((m) => box(m).max.y));
    const face = byName(group, "bathroom:floor-tiling:grate:linear_drain")[0];
    expect(face).toBeDefined();
    const fb = box(face);
    expect(fb.min.y).toBeGreaterThan(tileTop); // drawn above the tiles, not under them
    // the same sourced 1000 × 100 mm grate plan drawn in the falls; no new size
    const body = box(byName(group, "bathroom:waste:linear_drain")[0]);
    expect(fb.max.x - fb.min.x).toBeCloseTo(body.max.x - body.min.x, 6);
    expect(fb.max.z - fb.min.z).toBeCloseTo(body.max.z - body.min.z, 6);
    expect(body.max.y).toBeCloseTo(0, 6); // the waste itself stays on the flat finished floor
    expect(face.userData.aperture).toMatch(/grate 1000 × 100 mm from Lauxes/); // from the linked brief (#82)
    expect(face.userData.stopgap).toBe(true); // level unrecorded, as on the waste
    // both sample drains have sized briefs, so the layout no longer lists their apertures as missing
    expect((byName(group, "bathroom:floor-tiling:full")[0].parent!.userData.unresolved as string[]).filter((m) => /aperture/.test(m))).toEqual([]);

    for (const ids of [tiles, fitOut]) {
      applyStageVisibility(group, visibleIds(ids));
      expect(tileMeshes.every(rendered)).toBe(true);
      expect(rendered(face)).toBe(true);
    }
    applyStageVisibility(group, null);
    expect(rendered(face)).toBe(true);

    // tiles hidden: the waste shows on its own; the lifted face does not float above it
    applyStageVisibility(group, visibleIds(waterproofing));
    expect(rendered(byName(group, "bathroom:waste:linear_drain")[0])).toBe(true);
    expect(rendered(face)).toBe(false);
    // waste hidden, tiles shown: no drain drawn
    applyStageVisibility(group, visibleIds(tiles.filter((id) => id !== "drainage-wastes")));
    expect(rendered(face)).toBe(false);
  });
});
