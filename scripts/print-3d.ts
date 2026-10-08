/**
 * The finished sample bathroom as a 3D print: 1:20, open top, sized for a 256 mm bed. Walls stand
 * on a base slab, thickened outward from the finished faces so the room inside stays true to
 * scale; the wall and floor tiles are a shallow relief at the recorded set-out (joints widened so a
 * 0.4 mm nozzle shows them); the window is a recess down to a thin pane so nothing has to bridge;
 * the door is a real opening. Every fixture is the same model the app draws in 3D, placed by the
 * same set-out, with parts thinner than a printable wall thickened about their own centre.
 *
 *   npm run print-3d
 *
 * Output: shots/print-3d/bathroom-1to20.3mf (one object, one named part per piece, for colour
 * assignment), bathroom-1to20.stl (everything, one mesh) and README.md. Millimetres, Z up.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import * as THREE from "three";
import type { PlanModel, Wall } from "../src/model/types";

const OUT = resolve(fileURLToPath(new URL("../shots/print-3d", import.meta.url)));
const SCALE = 20; // 1:20
const S = 1000 / SCALE; // model metres → print millimetres
const BED = 256; // Bambu Lab X1 / P1 / A1 bed, mm
const WALL_T = 0.1; // wall thickness behind the finished face, m (5 mm printed)
const BASE_T = 0.06; // base slab under the finished floor, m (3 mm printed)
const RELIEF = 0.01; // tile relief, m (0.5 mm printed)
const MIN_JOINT = 0.008; // tile joint as printed, m (0.4 mm: one nozzle width)
const MIN_PART = 1.0 / S; // thinnest printed feature, m (1.0 mm)
const PANE = 0.03; // window pane left at the outer face, m (1.5 mm printed)
const LEGACY_GROUND = 0.04; // the app lifts an uninstalled fixture this much for display (build.ts)

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};

const { store, initializeProjects, projects } = await import("../src/model/store");
const { DEMO_ID } = await import("../src/model/projects");
const { catalogForItem } = await import("../src/model/catalog");
const { resolveFace, sideNormal } = await import("../src/model/faces");
const { segLen } = await import("../src/model/geometry");
const { openingSpan } = await import("../src/model/issues");
const { tilingLayout } = await import("../src/model/tiling");
const { floorTileLayout } = await import("../src/model/floorTiling");
const { buildFixture } = await import("../src/three/build");

initializeProjects();
const opened = projects.open(DEMO_ID);
if (!opened.ok) throw new Error(`Could not open the sample: ${opened.summary}`);
const model: PlanModel = store.getState().model;
const room = model.rooms[0];

// ---- parts, as triangles in model metres (plan x, plan y, height z) ----------------------------
interface Part { name: string; color: string; tris: number[] } // 9 numbers per triangle
const parts: Part[] = [];
const part = (name: string, color: string) => { const p = { name, color, tris: [] as number[] }; parts.push(p); return p; };

/** An axis-aligned box in plan coordinates, outward-facing triangles. */
function box(p: Part, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6 || z1 - z0 < 1e-6) return;
  const g = new THREE.BoxGeometry(x1 - x0, z1 - z0, y1 - y0).translate((x0 + x1) / 2, (z0 + z1) / 2, (y0 + y1) / 2);
  addGeometry(p, g);
}

/** Three.js space (X = plan x, Y = up, Z = plan y) into plan (x, y, z). */
function addGeometry(p: Part, g: THREE.BufferGeometry, m?: THREE.Matrix4) {
  const geo = (g.index ? g.toNonIndexed() : g.clone());
  if (m) geo.applyMatrix4(m);
  const a = geo.getAttribute("position");
  // a mirrored transform flips winding: put it back so normals still face out
  const flip = m ? m.determinant() < 0 : false;
  for (let i = 0; i < a.count; i += 3) {
    const idx = flip ? [i, i + 2, i + 1] : [i, i + 1, i + 2];
    for (const j of idx) p.tris.push(a.getX(j), a.getZ(j), a.getY(j));
  }
}
// (x, z, y) ordering above is a reflection; the writer reflects plan y back (print Y = −plan y), so
// the two together are a proper rotation and the winding is kept.

// ---- the room: finished faces, walls, openings --------------------------------------------------
const faceLine = (w: Wall) => {
  const f = resolveFace(w.sides?.right, "finished");
  if (!f.resolved) throw new Error(`${w.id}: finished face unresolved (${f.missing.join(", ")})`);
  const n = sideNormal(w, "right");
  if (Math.abs(n.x) > 1e-9 && Math.abs(n.y) > 1e-9) throw new Error(`${w.id} is not axis-aligned; the print model handles a rectangular room only.`);
  return { n, at: n.x !== 0 ? w.ax + n.x * f.offset! : w.ay + n.y * f.offset! };
};
const lines = model.walls.map((w) => ({ w, ...faceLine(w) }));
const X0 = Math.max(...lines.filter((l) => l.n.x > 0).map((l) => l.at)), X1 = Math.min(...lines.filter((l) => l.n.x < 0).map((l) => l.at));
const Y0 = Math.max(...lines.filter((l) => l.n.y > 0).map((l) => l.at)), Y1 = Math.min(...lines.filter((l) => l.n.y < 0).map((l) => l.at));
const H = Math.max(...model.walls.map((w) => w.height));
const ZB = -RELIEF - BASE_T;

const shell = part("Room shell (walls and base)", "#EDE8DF");
box(shell, X0 - WALL_T, X1 + WALL_T, Y0 - WALL_T, Y1 + WALL_T, ZB, -RELIEF);

/** Along-the-wall interval of an opening, in plan coordinates of the wall's running axis. */
function along(w: Wall, s: number) { const len = segLen(w.ax, w.ay, w.bx, w.by); return { x: w.ax + ((w.bx - w.ax) / len) * s, y: w.ay + ((w.by - w.ay) / len) * s }; }

for (const l of lines) {
  const { w, n } = l;
  // the wall slab: from the finished face (less the tile relief) outward by WALL_T, corners overlapped
  const inner = l.at - RELIEF * (n.x + n.y), outer = l.at - (RELIEF + WALL_T) * (n.x + n.y);
  const [c0, c1] = [Math.min(inner, outer), Math.max(inner, outer)];
  const runsX = n.x === 0;
  const lo = runsX ? X0 - WALL_T : Y0 - WALL_T, hi = runsX ? X1 + WALL_T : Y1 + WALL_T;
  const spans = model.openings.filter((o) => o.wallId === w.id).map((o) => {
    const [t0, t1] = openingSpan(w, o).map((t) => along(w, t * segLen(w.ax, w.ay, w.bx, w.by)));
    const [a, b] = runsX ? [t0.x, t1.x] : [t0.y, t1.y];
    return { o, a: Math.min(a, b), b: Math.max(a, b) };
  }).sort((p, q) => p.a - q.a);
  const put = (a: number, b: number, z0: number, z1: number, k0 = c0, k1 = c1) => (runsX ? box(shell, a, b, k0, k1, z0, z1) : box(shell, k0, k1, a, b, z0, z1));
  let cur = lo;
  for (const { o, a, b } of spans) {
    put(cur, a, ZB, H);
    put(a, b, ZB, o.sill); // under a window (nothing under a door)
    put(a, b, o.sill + o.height, H); // over the opening
    if (o.kind === "window") {
      // the pane: the outer PANE of the wall stays, so the window reads as a recess and nothing bridges
      const outerSide = (n.x + n.y) > 0 ? [c0, c0 + PANE] : [c1 - PANE, c1];
      put(a, b, o.sill, o.sill + o.height, outerSide[0], outerSide[1]);
    }
    cur = b;
  }
  put(cur, hi, ZB, H);
}

// ---- tiles: relief at the recorded set-out --------------------------------------------------------
const shrink = (joint: number | undefined) => Math.max(0, (MIN_JOINT - (joint ?? 0)) / 2);
/** A rectangle less the rectangles that cut it, as up to four pieces each. */
function subtract(r: [number, number, number, number], holes: [number, number, number, number][]): [number, number, number, number][] {
  let out = [r];
  for (const [h0, h1, v0, v1] of holes) {
    out = out.flatMap(([a0, a1, b0, b1]) => {
      if (h1 <= a0 || h0 >= a1 || v1 <= b0 || v0 >= b1) return [[a0, a1, b0, b1]];
      return ([[a0, h0, b0, b1], [h1, a1, b0, b1], [Math.max(a0, h0), Math.min(a1, h1), b0, v0], [Math.max(a0, h0), Math.min(a1, h1), v1, b1]] as [number, number, number, number][]).filter(([p, q, s, t]) => q - p > 1e-4 && t - s > 1e-4);
    });
  }
  return out;
}

for (const l of lines) {
  const { w, n } = l;
  const t = tilingLayout(model, w, "right");
  if (!t.pieces.length) continue;
  const tiles = part(`Wall tiles: ${w.id.replace("wall_", "")}`, w.tiling?.right?.color ?? "#FFFFFF");
  const g = shrink(w.tiling?.right?.joint?.value);
  const holes = model.openings.filter((o) => o.wallId === w.id).map((o) => { const [t0, t1] = openingSpan(w, o); const len = segLen(w.ax, w.ay, w.bx, w.by); return [t0 * len, t1 * len, o.sill, o.sill + o.height] as [number, number, number, number]; });
  const k0 = l.at - RELIEF * (n.x + n.y), k1 = l.at;
  for (const pc of t.pieces) {
    for (const [s0, s1, z0, z1] of subtract([pc.s0 + g, pc.s1 - g, Math.max(pc.z0 + g, 0), pc.z1 - g], holes)) {
      const a = along(w, s0), b = along(w, s1);
      if (n.x === 0) box(tiles, Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(k0, k1), Math.max(k0, k1), z0, z1);
      else box(tiles, Math.min(k0, k1), Math.max(k0, k1), Math.min(a.y, b.y), Math.max(a.y, b.y), z0, z1);
    }
  }
}

const fl = floorTileLayout(model, room);
if (fl.pieces.length) {
  const tiles = part("Floor tiles", room.floorTiling?.color ?? "#D9C3A0");
  const g = shrink(fl.joint);
  // the linear channel's grate stays open: its tiles are left out, so the channel reads as a slot
  const holes = fl.wastes.filter((d) => !d.tileInsert).map((d) => {
    const pts = d.grate ?? [d.a, d.b];
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const half = d.grate ? 0 : 0.05;
    return [Math.min(...xs) - half, Math.max(...xs) + half, Math.min(...ys) - half, Math.max(...ys) + half] as [number, number, number, number];
  });
  for (const pc of fl.pieces) for (const [x0, x1, y0, y1] of subtract([pc.x0 + g, pc.x1 - g, pc.y0 + g, pc.y1 - g], holes)) box(tiles, x0, x1, y0, y1, -RELIEF, 0);
}

// ---- fixtures: the app's own 3D, thickened where too thin to print --------------------------------
const fixtureNo = new Map(model.items.map((it, i) => [it.id, `F${i + 1}`]));
for (const it of model.items) {
  const g = buildFixture(model, it);
  const cat = catalogForItem(it);
  if (!g || !cat) { console.warn(`${it.id}: no 3D (placement unresolved), left out`); continue; }
  if (!it.installation) g.position.y -= LEGACY_GROUND; // stands on the finished floor
  g.updateMatrixWorld(true);
  const p = part(`${fixtureNo.get(it.id)} ${cat.label}`, (cat.color ?? "#BBBBBB").toUpperCase());
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (o as unknown as THREE.LineSegments).isLineSegments) return;
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    geo.computeBoundingBox();
    const bb = geo.boundingBox!, size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
    const k = [size.x, size.y, size.z].map((v) => (v > 1e-9 && v < MIN_PART ? MIN_PART / v : 1));
    if (k.some((v) => v !== 1)) geo.translate(-c.x, -c.y, -c.z).scale(k[0], k[1], k[2]).translate(c.x, c.y, c.z);
    addGeometry(p, geo);
  });
}

// ---- place on the bed and write ----------------------------------------------------------------------
// print X = plan x, print Y = −plan y (north stays at the back), Z = height; centred on the bed
const all = parts.flatMap((p) => p.tris);
const ext = (k: number) => { let lo = Infinity, hi = -Infinity; for (let i = k; i < all.length; i += 3) { lo = Math.min(lo, all[i]); hi = Math.max(hi, all[i]); } return [lo, hi]; };
const [xl, xh] = ext(0), [yl, yh] = ext(1), [zl, zh] = ext(2);
const size = { x: (xh - xl) * S, y: (yh - yl) * S, z: (zh - zl) * S };
if (size.x > BED || size.y > BED || size.z > BED) throw new Error(`Model ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm does not fit a ${BED} mm bed.`);
const ox = BED / 2 - size.x / 2, oy = BED / 2 - size.y / 2;
const toPrint = (x: number, y: number, z: number): [number, number, number] => [(x - xl) * S + ox, (yh - y) * S + oy, (z - zl) * S];

interface Mesh { name: string; color: string; v: number[]; t: number[] }
const meshes: Mesh[] = parts.filter((p) => p.tris.length).map((p) => {
  const v: number[] = [], t: number[] = [], key = new Map<string, number>();
  const id = (x: number, y: number, z: number) => {
    const [a, b, c] = toPrint(x, y, z);
    const k = `${a.toFixed(4)},${b.toFixed(4)},${c.toFixed(4)}`;
    let i = key.get(k);
    if (i === undefined) { i = v.length / 3; key.set(k, i); v.push(a, b, c); }
    return i;
  };
  for (let i = 0; i < p.tris.length; i += 9) {
    const a = id(p.tris[i], p.tris[i + 1], p.tris[i + 2]), b = id(p.tris[i + 3], p.tris[i + 4], p.tris[i + 5]), c = id(p.tris[i + 6], p.tris[i + 7], p.tris[i + 8]);
    if (a !== b && b !== c && a !== c) t.push(a, b, c); // welded slivers (sphere poles) drop out
  }
  return { name: p.name, color: p.color, v, t };
});

mkdirSync(OUT, { recursive: true });

// binary STL, every part in one file
const triCount = meshes.reduce((n, m) => n + m.t.length / 3, 0);
const stl = Buffer.alloc(84 + triCount * 50);
stl.write(`${model.name} 1:${SCALE} mm`.padEnd(80, " ").slice(0, 80), 0, "ascii");
stl.writeUInt32LE(triCount, 80);
let off = 84;
for (const m of meshes) for (let i = 0; i < m.t.length; i += 3) {
  const P = [m.t[i], m.t[i + 1], m.t[i + 2]].map((j) => new THREE.Vector3(m.v[j * 3], m.v[j * 3 + 1], m.v[j * 3 + 2]));
  const nrm = new THREE.Vector3().subVectors(P[1], P[0]).cross(new THREE.Vector3().subVectors(P[2], P[0])).normalize();
  for (const f of [nrm, ...P]) { stl.writeFloatLE(f.x, off); stl.writeFloatLE(f.y, off + 4); stl.writeFloatLE(f.z, off + 8); off += 12; }
  stl.writeUInt16LE(0, off); off += 2;
}
writeFileSync(join(OUT, "bathroom-1to20.stl"), stl);

// 3MF: one object built from named parts (components), so a slicer keeps it assembled and lets each
// part take its own filament; base materials carry each part's display colour
const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colours = [...new Set(meshes.map((m) => m.color))];
const objects = meshes.map((m, i) => {
  const vs: string[] = [], ts: string[] = [];
  for (let j = 0; j < m.v.length; j += 3) vs.push(`<vertex x="${m.v[j].toFixed(4)}" y="${m.v[j + 1].toFixed(4)}" z="${m.v[j + 2].toFixed(4)}"/>`);
  for (let j = 0; j < m.t.length; j += 3) ts.push(`<triangle v1="${m.t[j]}" v2="${m.t[j + 1]}" v3="${m.t[j + 2]}"/>`);
  return `<object id="${i + 2}" name="${xmlEsc(m.name)}" type="model" pid="1" pindex="${colours.indexOf(m.color)}"><mesh><vertices>${vs.join("")}</vertices><triangles>${ts.join("")}</triangles></mesh></object>`;
});
const assembly = meshes.length + 2;
const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${xmlEsc(model.name)} 1:${SCALE}</metadata>
<metadata name="Designer">Reno Layouts (npm run print-3d)</metadata>
<metadata name="Description">${xmlEsc(`${model.name}, finished room at 1:${SCALE}, open top. Millimetres. Proposed design, not as-built.`)}</metadata>
<resources><basematerials id="1">${colours.map((c, i) => `<base name="colour ${i + 1}" displaycolor="${c.length === 7 ? c : "#BBBBBB"}FF"/>`).join("")}</basematerials>
${objects.join("\n")}
<object id="${assembly}" name="${xmlEsc(`${model.name} 1:${SCALE}`)}" type="model"><components>${meshes.map((_, i) => `<component objectid="${i + 2}"/>`).join("")}</components></object>
</resources>
<build><item objectid="${assembly}"/></build>
</model>`;
const files: [string, string][] = [
  ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`],
  ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`],
  ["3D/3dmodel.model", modelXml],
];
writeFileSync(join(OUT, "bathroom-1to20.3mf"), zip(files));

const lines3 = [
  `# ${model.name}: 3D print, 1:${SCALE}`, "",
  "Generated by `npm run print-3d` from the same model as the drawings: the finished room, open top, with every fixture at its set-out.", "",
  `- [bathroom-1to20.3mf](bathroom-1to20.3mf): open this in Bambu Studio. One object of ${meshes.length} named parts (shell, wall and floor tiles, each fixture), so a part can take its own filament on an AMS.`,
  "- [bathroom-1to20.stl](bathroom-1to20.stl): the same, one mesh, for any slicer.", "",
  "![The print model, rendered from the STL](preview.png)", "",
  `Size ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm (W × D × H), centred on a ${BED} mm bed. 1 mm on the print is ${SCALE} mm in the room. North (the window wall) is at the back of the plate.`, "",
  "## Printing on a Bambu", "",
  "1. Bambu Studio → File → Import → the .3mf. If it asks, load it as a single object with multiple parts. Do not scale it.",
  "2. 0.4 mm nozzle, 0.12–0.16 mm layers for the detail (0.2 mm works, coarser). PLA.",
  "3. Supports on, type tree (auto), threshold angle 30°: the shower head arm, the towel rails, the mixers and the shaving cabinet hang off the walls. The walls, window recess and door need none.",
  "4. Brim off; the 3 mm base is wide and flat. 2 wall loops is enough (walls are 5 mm).",
  "5. One colour prints fine: the tiles are a 0.5 mm relief with joints widened to 0.4 mm. With an AMS, give the floor tiles and window-wall tiles beige, the other wall tiles white and the fittings grey or silver.", "",
  "## What is exaggerated for printing", "",
  `- Walls are ${WALL_T * 1000} mm thick behind the finished face (${(WALL_T * S).toFixed(1)} mm printed), on a ${(BASE_T * S).toFixed(1)} mm base; the room inside is to scale.`,
  `- Tile joints are printed at least ${(MIN_JOINT * S).toFixed(1)} mm wide (4 mm joints would be 0.2 mm) and the tiles stand ${(RELIEF * S).toFixed(1)} mm proud.`,
  `- Any fixture part thinner than ${(MIN_PART * S).toFixed(1)} mm printed (levers, the shower rail, the 10 mm glass screen) is thickened to ${(MIN_PART * S).toFixed(1)} mm about its own centre.`,
  "- The window is a recess with a 1.5 mm pane; the door opening is open.",
  "- The linear drain is a slot in the floor tiles; the Kano tile-insert waste is tiled over, as built.", "",
  "Proposed design, for showing the layout: dimension from the drawings, not from the print.", "",
];
writeFileSync(join(OUT, "README.md"), lines3.join("\n"));
console.log(`${meshes.length} part(s), ${triCount} triangles, ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm → ${OUT}`);

// ---- a minimal zip (deflate) for the 3MF package ----------------------------------------------------
function zip(entries: [string, string][]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const raw = Buffer.from(text, "utf8"), data = deflateRawSync(raw), nm = Buffer.from(name, "utf8"), crc = crc32(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0, 6); h.writeUInt16LE(8, 8); h.writeUInt32LE(0, 10);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26); h.writeUInt16LE(0, 28);
    local.push(h, nm, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0, 8); c.writeUInt16LE(8, 10); c.writeUInt32LE(0, 12);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nm);
    offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
