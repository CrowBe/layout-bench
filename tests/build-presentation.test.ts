import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildPlan, curtainMaterial, skirtingMaterial } from "../src/three/build";
import type { PlanModel } from "../src/model/types";

const smallRoom: PlanModel = {
  name: "Small room",
  walls: [
    { id: "north", ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.15, height: 2.7 },
    { id: "east", ax: 4, ay: 0, bx: 4, by: 3, thickness: 0.15, height: 2.7 },
    { id: "south", ax: 4, ay: 3, bx: 0, by: 3, thickness: 0.15, height: 2.7 },
    { id: "west", ax: 0, ay: 3, bx: 0, by: 0, thickness: 0.15, height: 2.7 },
  ],
  openings: [
    { id: "door", kind: "door", wallId: "south", t: 0.25, width: 0.9, sill: 0, height: 2.1 },
    { id: "window", kind: "window", wallId: "north", t: 0.5, width: 1.2, sill: 0.9, height: 1.2 },
  ],
  rooms: [{ id: "room", x: 0.075, y: 0.075, w: 3.85, h: 2.85, label: "Room", floor: "tile" }],
  items: [{ id: "authored-sofa", kind: "sofa", x: 2.4, y: 1.8, rotation: 0 }],
  underlay: null,
};

function meshes(model: PlanModel, presentation: "planning" | "styled") {
  const { group } = buildPlan(model, presentation);
  const found: THREE.Mesh[] = [];
  group.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) found.push(object as THREE.Mesh);
  });
  return found;
}

describe("3D planning presentation", () => {
  it("keeps openings and authored model geometry while omitting automatic decoration", () => {
    const result = meshes(smallRoom, "planning");
    const names = result.map((mesh) => mesh.name);
    expect(names).toContain("north");
    expect(names).toContain("south");
    expect(names).toContain("room:planning-floor");
    expect(names.some((name) => /pendant|curtain|skirting/.test(name))).toBe(false);
    expect(result.some((mesh) => mesh.material === skirtingMaterial || mesh.material === curtainMaterial)).toBe(false);
    const floor = result.find((mesh) => mesh.name === "room:planning-floor")!;
    expect((floor.material as THREE.MeshStandardMaterial).map).toBeNull();
  });

  it("retains the styled demo decoration", () => {
    const result = meshes(smallRoom, "styled");
    const names = result.map((mesh) => mesh.name);
    expect(names.some((name) => name.endsWith(":skirting"))).toBe(true);
    expect(names.some((name) => name.includes("curtain"))).toBe(true);
    expect(names.some((name) => name.includes(":pendant"))).toBe(true);
    expect(names).not.toContain("room:planning-floor");
  });
});

describe("3D drainage falls (#7)", () => {
  const p = (value: number) => ({ value, status: "proposed" as const });
  const drained: PlanModel = {
    ...smallRoom,
    rooms: [{
      ...smallRoom.rooms[0],
      drainage: {
        wastes: [{ id: "w", label: "Channel", kind: "linear", ax: 0.5, ay: 0.3, bx: 3.5, by: 0.3, level: p(0) }],
        planes: [{ id: "pl", label: "Floor", x: 0.075, y: 0.075, w: 3.85, h: 2.85, wasteId: "w", fall: p(0.02), controls: [] }],
      },
    }],
  };

  it("draws a sloped surface that rises away from the waste", () => {
    const fall = meshes(drained, "planning").find((m) => m.name === "room:fall:pl")!;
    expect(fall).toBeDefined();
    const box = new THREE.Box3().setFromObject(fall);
    expect(box.min.y).toBeLessThan(0.002); // grid vertices straddle the waste line
    expect(box.max.y).toBeCloseTo(0.02 * Math.hypot(0.5 - 0.075, 2.925 - 0.3), 3); // far corner, measured to the channel end
  });

  it("draws no surface for an unresolved plane", () => {
    const open = structuredClone(drained);
    delete open.rooms[0].drainage!.planes[0].fall;
    expect(meshes(open, "planning").some((m) => m.name.includes(":fall:"))).toBe(false);
  });
});
