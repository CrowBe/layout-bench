import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { actions, store } from "../src/model/store";
import { demoProject } from "../src/model/projects";
import { resetRuntimeCatalog } from "../src/model/catalog";
import { emptyModel } from "../src/model/types";
import { applyStageVisibility, buildFixture, buildPlan, tagStages } from "../src/three/build";
import { catalogue, resolveVisible } from "../src/sheets/stageView";

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

beforeEach(() => { resetRuntimeCatalog(); store.setState({ model: emptyModel(), undoStack: [], kinds: [] }); });

describe("sample bathroom in 3D: the finished room over its build-up", () => {
  it("draws the floor down to the slab 120 mm below the current tile, without inventing the unknown split", () => {
    const { group } = sample();
    const substrate = byName(group, "bathroom:substrate")[0];
    expect(box(substrate).max.y).toBeCloseTo(-0.12, 4);
    // membrane sits on the slab and the adhesive under the tile, each only as a film
    const membrane = byName(group, "bathroom:floor:floor_membrane")[0];
    expect(box(membrane).min.y).toBeCloseTo(-0.12, 4);
    expect(membrane.userData.drawnThickness).toMatch(/unknown/);
    const adhesive = byName(group, "bathroom:floor:floor_adhesive")[0];
    expect(box(adhesive).max.y).toBeCloseTo(-0.01, 4);
    // the screed (heating cable inside) is one translucent fill, labelled as such
    const fill = byName(group, "bathroom:floor-fill")[0];
    expect(fill.userData.stages).toEqual(["room:bathroom:floor:floor_screed"]);
    expect((fill.material as THREE.Material).transparent).toBe(true);
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
      expect(box(w).min.y).toBeCloseTo(0, 4);
    }
  });

  it("draws the screen as see-through glass with its wall channel", () => {
    const { group } = sample();
    const parts = meshes(group).filter((m) => m.userData.stage === "item:screen");
    expect(parts).toHaveLength(2);
    expect(parts.some((m) => (m.material as THREE.Material).transparent)).toBe(true);
  });
});

describe("3D follows a stage view", () => {
  it("tags every drawn mesh with an element the stage catalogue really has", () => {
    const { model, group } = sample();
    const known = new Set(catalogue(model).elements.map((e) => e.id));
    const untagged: string[] = [];
    group.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
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
