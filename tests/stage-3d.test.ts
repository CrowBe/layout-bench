import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { actions, store } from "../src/model/store";
import { demoProject } from "../src/model/projects";
import { resetRuntimeCatalog } from "../src/model/catalog";
import { emptyModel } from "../src/model/types";
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
  for (const it of model.items) {
    const fg = buildFixture(model, it);
    if (fg) group.add(fg);
  }
  tagStages(model, group);
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
    expect(linear.userData.body).toMatch(/channel body/); // sourced body kept distinct from the marker
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
