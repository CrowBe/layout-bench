import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { emptyModel } from "../src/model/types";
import { checkModel } from "../src/model/issues";
import { edgeCut, tilingLayout } from "../src/model/tiling";
import { demoProject, parseImport } from "../src/model/projects";
import { buildPlan } from "../src/three/build";
import { renderTilingSheet } from "../src/sheets/tiling";
import * as THREE from "three";

beforeEach(() => store.setState({ model: emptyModel(), undoStack: [] }));

const P = (value: number) => ({ value, status: "proposed" as const });
const model = () => store.getState().model;
const north = () => model().walls.find((w) => w.id === ids.north)!;
const layout = () => tilingLayout(model(), north(), "right");
const ids: Record<string, string> = {};

/**
 * A 2110 x 3020 bathroom drawn clockwise on the frame line, so every wall's right side faces
 * the room. Each right side: frame 0 (measured), Villaboard, membrane, adhesive, tile.
 */
function bathroom(board = 0.01) {
  for (const [name, ax, ay, bx, by] of [["north", 0, 0, 2.11, 0], ["east", 2.11, 0, 2.11, 3.02], ["south", 2.11, 3.02, 0, 3.02], ["west", 0, 3.02, 0, 0]] as const) {
    const r = actions.addWall(ax, ay, bx, by, 0.1, 2.4);
    ids[name] = r.id as string;
    actions.setWallSide(ids[name], "right", {
      frame: { value: 0, status: "measured" },
      layers: [
        { kind: "board", name: "Villaboard", thickness: P(board) },
        { kind: "waterproofing", thickness: P(0.001) },
        { kind: "adhesive", thickness: P(0.004) },
        { kind: "tile", thickness: P(0.01) },
      ],
    });
  }
  actions.addRoom(0, 0, 2.11, 3.02, "Bathroom", "tile");
  actions.setRoomFloor("Bathroom", {
    substrateTop: { value: 0, status: "measured" },
    layers: [{ kind: "waterproofing", thickness: P(0.002) }, { kind: "screed", thickness: P(0.03) }, { kind: "adhesive", thickness: P(0.005) }, { kind: "tile", thickness: P(0.01) }],
  });
  const w = actions.addOpening("window", ids.north, { t: 0.5 }, { width: 0.9, sill: 1.0, height: 0.8 });
  ids.window = w.id as string;
}

/** 600 x 300 landscape, 2 mm joint, a full tile at the end A board face, a full course on the finished floor, 2100 high. */
const setOut = (extra: Record<string, unknown> = {}) =>
  actions.setWallTiling(ids.north, "right", {
    tileLength: P(0.6), tileWidth: P(0.3), orientation: "landscape", joint: P(0.002),
    reference: "board", floor: "finished", originFrom: "a", originAlong: P(0), originUp: P(0), tiledHeight: P(2.1),
    ...extra,
  });

describe("edgeCut", () => {
  it("returns the piece on the kept side and joint gaps", () => {
    expect(edgeCut(0, 0.6, 0.002, 0.284, "before")).toEqual({ size: 0.284, of: 0.6, full: false });
    expect(edgeCut(0, 0.6, 0.002, 0.284, "after").size).toBeCloseTo(0.316, 6);
    expect(edgeCut(0, 0.6, 0.002, 0, "after")).toEqual({ size: 0.6, of: 0.6, full: true });
    expect(edgeCut(0, 0.6, 0.002, 0, "before")).toEqual({ size: 0.6, of: 0.6, full: true, gap: 0.002 });
    expect(edgeCut(0, 0.6, 0.002, 0.601, "before")).toMatchObject({ full: true, gap: 0.001 });
    expect(edgeCut(0, 0.6, 0.002, 0.601, "after")).toMatchObject({ full: true, gap: 0.001 });
  });
});

describe("wall tile set-out (#9)", () => {
  it("derives the grid and edge cuts from the board faces, the finished floor and the window", () => {
    bathroom();
    expect(setOut().ok).toBe(true);
    const l = layout();
    expect(l.status).toBe("proposed");
    expect(l.resolved).toBe(true);
    expect(l.missing).toEqual([]);
    // the run is between the board faces of the west and east walls, 10 mm off each frame
    expect(l.limits.a).toMatchObject({ s: 0.01, wallId: ids.west, resolved: true });
    expect(l.limits.b).toMatchObject({ s: 2.1, wallId: ids.east, resolved: true });
    expect(l.limits.a.label).toMatch(/Board face/);
    expect(l.run).toBe(2.09);
    expect(l.floor).toMatchObject({ level: 0.047, resolved: true, basis: "proposed" });
    expect(l.band).toEqual({ z0: 0.047, z1: 2.147 });
    expect(l.tile).toEqual({ along: 0.6, up: 0.3 });
    expect(l.cuts!.a).toMatchObject({ size: 0.6, full: true });
    expect(l.cuts!.b).toMatchObject({ size: 0.284, full: false }); // 2090 - 3 × 602
    expect(l.cuts!.bottom).toMatchObject({ size: 0.3, full: true });
    expect(l.cuts!.top).toMatchObject({ size: 0.288, full: false }); // 2100 - 6 × 302
    expect(l.columns).toBe(4);
    expect(l.rows).toBe(7);
    const win = l.openings.find((o) => o.openingId === ids.window)!;
    expect(win.jambA!.size).toBeCloseTo(0.595, 6);
    expect(win.jambB!.size).toBeCloseTo(0.309, 6);
    expect(win.sill!.size).toBeCloseTo(0.047, 6);
    expect(win.head!.size).toBeCloseTo(0.057, 6);
    // no tile piece overlaps the window
    expect(l.pieces.some((p) => p.s1 > win.s0 + 1e-6 && p.s0 < win.s1 - 1e-6 && p.z1 > win.z0 + 1e-6 && p.z0 < win.z1 - 1e-6)).toBe(false);
    expect(l.basis).toBe("proposed");
  });

  it("moving the origin 10 mm changes the end cuts by 10 mm", () => {
    bathroom();
    setOut();
    const before = layout();
    setOut({ originAlong: P(0.01) });
    const after = layout();
    expect(after.origin!.s).toBeCloseTo(before.origin!.s + 0.01, 6);
    // end A now has a 10 mm strip less the 2 mm joint; end B loses 10 mm
    expect(after.cuts!.a.size).toBeCloseTo(0.008, 6);
    expect(after.cuts!.b.size).toBeCloseTo(before.cuts!.b.size - 0.01, 6);
    expect(after.columns).toBe(5);
    const w0 = before.openings[0], w1 = after.openings[0];
    expect(w1.jambA!.size).toBeCloseTo(w0.jambA!.size - 0.01, 6);
    expect(w1.jambB!.size).toBeCloseTo(w0.jambB!.size + 0.01, 6);
    // vertical cuts are untouched
    expect(after.cuts!.top).toEqual(before.cuts!.top);
    // from end B and from the centre
    setOut({ originFrom: "b", originAlong: P(0) });
    expect(layout().cuts!.b).toMatchObject({ size: 0.6, full: true });
    setOut({ originFrom: "centre", originAlong: P(-0.3) });
    const c = layout();
    expect(c.cuts!.a.size).toBeCloseTo(c.cuts!.b.size, 6); // a tile centred on the run gives equal end cuts
  });

  it("follows the board build-up and the floor level", () => {
    bathroom();
    setOut();
    const before = layout();
    // a thicker board on the return walls shortens the run by 3 mm at each end
    for (const w of [ids.west, ids.east]) {
      const layers = model().walls.find((x) => x.id === w)!.sides!.right!.layers;
      actions.setWallSide(w, "right", { layers: layers.map((l, i) => ({ id: l.id, kind: l.kind, name: l.name, thickness: i === 0 ? P(0.013) : l.thickness })) });
    }
    const thick = layout();
    expect(thick.run).toBeCloseTo(before.run! - 0.006, 6);
    expect(thick.limits.a.s).toBeCloseTo(0.013, 6);
    expect(thick.cuts!.b.size).toBeCloseTo(before.cuts!.b.size - 0.006, 6);
    // finished-face reference: the run is cut to the tile face of each return wall
    setOut({ reference: "finished" });
    expect(layout().limits.a.s).toBeCloseTo(0.028, 6);
    // a thicker screed raises the floor reference, the origin course and the band
    setOut({ reference: "board" });
    const assembly = model().rooms[0].floorBuildUp!;
    actions.setRoomFloor("Bathroom", { layers: assembly.layers.map((l) => ({ id: l.id, kind: l.kind, name: l.name, thickness: l.kind === "screed" ? P(0.04) : l.thickness })) });
    const raised = layout();
    expect(raised.floor.level).toBeCloseTo(0.057, 6);
    expect(raised.origin!.z).toBeCloseTo(0.057, 6);
    expect(raised.openings[0].sill!.size).toBeCloseTo(0.037, 6);
    // the datum instead of the finished floor
    setOut({ floor: "datum" });
    expect(layout().floor).toMatchObject({ level: 0, basis: "datum" });
  });

  it("portrait orientation swaps the tile on the wall", () => {
    bathroom();
    setOut({ orientation: "portrait" });
    expect(layout().tile).toEqual({ along: 0.3, up: 0.6 });
  });

  it("shows unresolved inputs instead of filling them", () => {
    bathroom();
    expect(actions.setWallTiling(ids.north, "right", { orientation: "landscape", joint: P(0.002) }).ok).toBe(true);
    let l = layout();
    expect(l.resolved).toBe(false);
    expect(l.cuts).toBeUndefined();
    expect(l.missing).toEqual(expect.arrayContaining(["tile length", "tile width", "origin along", "origin up", "tiled height", "reference face (board or finished)", "floor reference (finished, screed, substrate or datum)"]));
    expect(l.tile).toBeUndefined();
    expect(checkModel(model()).some((i) => i.code === "tiling_unresolved" && i.refs.includes(ids.north))).toBe(true);
    // an unknown board thickness on a return wall leaves that end unresolved
    setOut();
    const layers = model().walls.find((x) => x.id === ids.west)!.sides!.right!.layers;
    actions.setWallSide(ids.west, "right", { layers: layers.map((x, i) => ({ id: x.id, kind: x.kind, name: x.name, thickness: i === 0 ? null : x.thickness })) });
    l = layout();
    expect(l.limits.a.resolved).toBe(false);
    expect(l.missing.some((m) => m.includes(ids.west) && m.includes("Villaboard thickness"))).toBe(true);
    expect(l.cuts).toBeUndefined();
  });

  it("does not cut around a window whose size is a placeholder", () => {
    bathroom();
    actions.removeOpening(ids.window);
    const w = actions.addOpening("window", ids.north, { t: 0.5 }, {});
    setOut();
    const l = layout();
    const o = l.openings.find((x) => x.openingId === w.id)!;
    expect(o.unresolved).toMatch(/placeholder/);
    expect(o.jambA).toBeUndefined();
    expect(l.resolved).toBe(false);
  });

  it("rejects values without a status and non-positive tile sizes, storing nothing", () => {
    bathroom();
    expect(actions.setWallTiling(ids.north, "right", { tileLength: { value: 0.6 } }).ok).toBe(false);
    expect(actions.setWallTiling(ids.north, "right", { tileLength: P(0) }).ok).toBe(false);
    expect(actions.setWallTiling(ids.north, "right", { joint: P(-0.001) }).ok).toBe(false);
    expect(actions.setWallTiling(ids.north, "right", { orientation: "diagonal" as never }).ok).toBe(false);
    expect(north().tiling).toBeUndefined();
    setOut();
    expect(actions.setWallTiling(ids.north, "right", { clear: true }).ok).toBe(true);
    expect(north().tiling).toBeUndefined();
  });

  it("round-trips through a saved project and rejects bad tiling data", () => {
    bathroom();
    setOut();
    const doc = { ...demoProject(), model: model() };
    const back = parseImport(JSON.stringify(doc));
    expect(back.model.walls.find((w) => w.id === ids.north)!.tiling).toEqual(north().tiling);
    const bad = structuredClone(doc);
    (bad.model.walls.find((w) => w.id === ids.north)!.tiling!.right as Record<string, unknown>).orientation = "diagonal";
    expect(() => parseImport(JSON.stringify(bad))).toThrow();
    // older documents without tiling still load
    expect(() => parseImport(JSON.stringify(demoProject()))).not.toThrow();
  });

  it("draws the proposed tile pieces in 3D on the tiled face", () => {
    bathroom();
    setOut();
    const { group } = buildPlan(model(), "planning");
    const tiles = group.getObjectByName(`${ids.north}:tiling:right`) as THREE.Object3D;
    expect(tiles).toBeTruthy();
    const meshes: THREE.Mesh[] = [];
    tiles.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    // merged: one mesh for full pieces, one for cut pieces, two triangles per piece
    expect(meshes.map((m) => m.name).sort()).toEqual([`${ids.north}:tiling:right:cut`, `${ids.north}:tiling:right:full`]);
    const pieces = layout().pieces;
    expect(meshes.reduce((n, m) => n + m.geometry.getAttribute("position").count / 6, 0)).toBe(pieces.length);
    const cutMesh = meshes.find((m) => m.name.endsWith(":cut"))!;
    expect(cutMesh.geometry.getAttribute("position").count / 6).toBe(pieces.filter((p) => p.cut).length);
    // every triangle faces into the room (+z for the north wall's right side) and sits just
    // proud of the finished face, 25 mm off the frame line
    const pos = cutMesh.geometry.getAttribute("position");
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      expect(normal.z).toBeCloseTo(1, 6);
      expect(a.z).toBeGreaterThan(0.025);
      expect(a.z).toBeLessThan(0.03);
    }
  });

  it("prints a sheet that labels the board reference, the cuts and the proposal status", () => {
    bathroom();
    setOut({ originAlong: P(0.01) });
    const svg = renderTilingSheet(model(), ids.north, "right", { title: "Bath <north>" });
    expect(svg).toContain("PROPOSED SET-OUT");
    expect(svg).toMatch(/not as-built/i);
    expect(svg).toMatch(/to board face/);
    expect(svg).toContain("600 × 300");
    expect(svg).toContain("Bath &lt;north&gt;");
    expect(svg).toContain('data-cut="a">8');
    expect(svg).toContain('data-cut="b">274');
    expect(svg).not.toMatch(/as-built set-out/i);
  });

  it("faces the 3D tiles toward a left-side set-out too", () => {
    bathroom();
    // the north wall's left side faces away from the bathroom (-y); give it a build-up and return walls on that side
    actions.setWallSide(ids.north, "left", { frame: { value: 0, status: "measured" }, layers: [{ kind: "board", thickness: P(0.01) }] });
    actions.addWall(0, 0, 0, -1, 0.1, 2.4);
    actions.addWall(2.11, 0, 2.11, -1, 0.1, 2.4);
    for (const w of model().walls.filter((x) => x.ay === 0 && x.by === -1)) for (const s of ["left", "right"] as const) {
      actions.setWallSide(w.id, s, { frame: { value: 0, status: "measured" }, layers: [{ kind: "board", thickness: P(0.01) }] });
    }
    actions.setWallTiling(ids.north, "left", {
      tileLength: P(0.6), tileWidth: P(0.3), orientation: "landscape", joint: P(0.002),
      reference: "board", floor: "datum", originFrom: "a", originAlong: P(0), originUp: P(0), tiledHeight: P(1),
    });
    const l = tilingLayout(model(), north(), "left");
    expect(l.missing).toEqual([]);
    expect(l.cuts).toBeTruthy();
    const { group } = buildPlan(model(), "planning");
    const mesh = group.getObjectByName(`${ids.north}:tiling:left:full`) as THREE.Mesh;
    const pos = mesh.geometry.getAttribute("position");
    const a = new THREE.Vector3().fromBufferAttribute(pos, 0), b = new THREE.Vector3().fromBufferAttribute(pos, 1), c = new THREE.Vector3().fromBufferAttribute(pos, 2);
    expect(b.sub(a).cross(c.sub(a)).normalize().z).toBeCloseTo(-1, 6);
    expect(a.z).toBeLessThan(-0.01);
  });

});
