/**
 * 3D builder — extrudes the plan into a dollhouse-style model:
 * walls with REAL openings (lintels + sills, no CSG), resolved corner joints,
 * per-room floors with finishes, ground plane.
 */

import * as THREE from "three";
import { surfaces } from "../model/drainage";
import type { Item, LayerKind, Opening, PlanModel, Room, Wall } from "../model/types";
import { liningSlabs, wallBody } from "../model/faces";
import { roughIn } from "../model/fixtures";
import { catalogByKind } from "../model/catalog";
import { segLen } from "../model/geometry";
import { openingSpan } from "../model/issues";

export const wallMaterial = new THREE.MeshStandardMaterial({
  color: "#f2ede4",
  roughness: 0.93,
  metalness: 0.0,
});
export const wallTopMaterial = new THREE.MeshStandardMaterial({
  color: "#d9d2c5",
  roughness: 0.9,
});
export const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: "#bcd8e8",
  roughness: 0.05,
  metalness: 0,
  transparent: true,
  opacity: 0.28,
  side: THREE.DoubleSide,
});
export const frameMaterial = new THREE.MeshStandardMaterial({ color: "#6b5d4f", roughness: 0.6 });

export const doorLeafMaterial = new THREE.MeshStandardMaterial({ color: "#e5ddd0", roughness: 0.5 });
export const doorPanelMaterial = new THREE.MeshStandardMaterial({ color: "#d8cfc0", roughness: 0.55 });
export const skirtingMaterial = new THREE.MeshStandardMaterial({ color: "#fbf8f2", roughness: 0.55 });
export const handleMaterial = new THREE.MeshStandardMaterial({ color: "#b9a26a", roughness: 0.3, metalness: 0.8 });

export const sillMaterial = new THREE.MeshStandardMaterial({ color: "#efeae0", roughness: 0.6 });
export const curtainMaterial = new THREE.MeshStandardMaterial({ color: "#ded5c6", roughness: 0.97 });
export const lampShadeMaterial = new THREE.MeshStandardMaterial({
  color: "#fdf6e6",
  roughness: 0.6,
  emissive: new THREE.Color("#ffe9bd"),
  emissiveIntensity: 0.9,
});
const serviceMarkerGeometry = new THREE.SphereGeometry(0.03, 12, 8);
const serviceMaterials = {
  waste: new THREE.MeshStandardMaterial({ color: "#7a5230" }),
  water: new THREE.MeshStandardMaterial({ color: "#2f78b7" }),
  power: new THREE.MeshStandardMaterial({ color: "#c0392b" }),
};
const liningMaterials: Record<LayerKind, THREE.Material> = {
  board: new THREE.MeshStandardMaterial({ color: "#d9d2c3", roughness: 0.9 }),
  waterproofing: new THREE.MeshStandardMaterial({ color: "#8fb3cf", roughness: 0.7 }),
  adhesive: new THREE.MeshStandardMaterial({ color: "#c9c2b0", roughness: 0.95 }),
  tile: new THREE.MeshStandardMaterial({ color: "#f2efe8", roughness: 0.4 }),
};
export const cableMaterial = new THREE.MeshStandardMaterial({ color: "#3a3733", roughness: 0.8 });

const SKIRTING_H = 0.09;
const DOOR_SWING = (82 * Math.PI) / 180;

/** Procedural floor finishes — one canvas per finish, cloned per room so each gets its own repeat. */
const texCache = new Map<string, THREE.CanvasTexture>();
function floorTexture(kind: string): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const hit = texCache.get(kind);
  if (hit) return hit;
  const S = 512;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const x = c.getContext("2d");
  if (!x) return null;
  const jitter = (base: string, amt: number) => {
    const n = Math.round((Math.random() - 0.5) * amt);
    const r = parseInt(base.slice(1, 3), 16) + n;
    const g = parseInt(base.slice(3, 5), 16) + n;
    const b = parseInt(base.slice(5, 7), 16) + n;
    const cl = (v: number) => Math.max(0, Math.min(255, v));
    return "rgb(" + cl(r) + "," + cl(g) + "," + cl(b) + ")";
  };
  if (kind === "oak") {
    x.fillStyle = "#c39a67";
    x.fillRect(0, 0, S, S);
    const rows = 8;
    const rh = S / rows;
    for (let i = 0; i < rows; i++) {
      let px = -Math.random() * 180;
      while (px < S) {
        const pw = 130 + Math.random() * 190;
        x.fillStyle = jitter("#c39a67", 26);
        x.fillRect(px, i * rh, pw, rh - 1.5);
        x.strokeStyle = "rgba(90,63,36,0.32)";
        x.lineWidth = 1.5;
        x.strokeRect(px, i * rh, pw, rh - 1.5);
        for (let gi = 0; gi < 5; gi++) {
          x.strokeStyle = "rgba(120,88,52,0.16)";
          x.lineWidth = 1;
          const gy = i * rh + 4 + Math.random() * (rh - 10);
          x.beginPath();
          x.moveTo(px + 4, gy);
          x.bezierCurveTo(px + pw * 0.3, gy + 3, px + pw * 0.7, gy - 3, px + pw - 4, gy);
          x.stroke();
        }
        px += pw;
      }
    }
  } else if (kind === "tile") {
    x.fillStyle = "#c0bab0";
    x.fillRect(0, 0, S, S);
    const n = 4;
    const t = S / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        x.fillStyle = jitter("#dcd6cb", 14);
        x.fillRect(i * t + 3, j * t + 3, t - 6, t - 6);
      }
    }
  } else if (kind === "carpet") {
    x.fillStyle = "#a9b39e";
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 26000; i++) {
      const w = Math.random() > 0.5 ? "255,255,255" : "0,0,0";
      x.fillStyle = "rgba(" + w + "," + Math.random() * 0.08 + ")";
      x.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
  } else {
    x.fillStyle = "#a5a5a0";
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 220; i++) {
      const w = Math.random() > 0.5 ? "255,255,255" : "0,0,0";
      x.fillStyle = "rgba(" + w + ",0.05)";
      x.beginPath();
      x.arc(Math.random() * S, Math.random() * S, 6 + Math.random() * 34, 0, Math.PI * 2);
      x.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(kind, tex);
  return tex;
}

/** Metres of floor covered by one texture tile, per finish. */
const FLOOR_SCALE: Record<string, number> = { oak: 2.4, tile: 1.2, carpet: 2, concrete: 3 };

const FLOOR_COLORS: Record<string, string> = {
  oak: "#c39a67",
  tile: "#dcd6cb",
  carpet: "#a9b39e",
  concrete: "#a5a5a0",
};

/** Endpoints that touch another wall get extended by half the partner thickness → clean joints. */
function jointExtensions(wall: Wall, walls: Wall[]): [number, number] {
  const a = { x: wall.ax, y: wall.ay };
  const b = { x: wall.bx, y: wall.by };
  let extA = 0;
  let extB = 0;
  for (const o of walls) {
    if (o.id === wall.id) continue;
    // the partner's farthest body face from its line: thickness/2 unless recorded faces shift it (#4)
    const body = wallBody(o);
    const reach = Math.abs(body.z) + body.depth / 2;
    const ends = [
      { x: o.ax, y: o.ay },
      { x: o.bx, y: o.by },
    ];
    for (const e of ends) {
      // extend just up to the partner's OUTER face — extending further pokes past the corner (X artifact)
      if (Math.hypot(e.x - a.x, e.y - a.y) < 0.09) extA = Math.max(extA, reach);
      if (Math.hypot(e.x - b.x, e.y - b.y) < 0.09) extB = Math.max(extB, reach);
    }
    // T-junction: our endpoint lands mid-span of the partner
    const pSeg = (p: { x: number; y: number }) => {
      const dx = o.bx - o.ax;
      const dy = o.by - o.ay;
      const l2 = dx * dx + dy * dy;
      if (l2 === 0) return Infinity;
      const t = Math.max(0, Math.min(1, ((p.x - o.ax) * dx + (p.y - o.ay) * dy) / l2));
      return Math.hypot(p.x - (o.ax + t * dx), p.y - (o.ay + t * dy));
    };
    if (pSeg(a) < 0.09) extA = Math.max(extA, reach);
    if (pSeg(b) < 0.09) extB = Math.max(extB, reach);
  }
  return [extA, extB];
}

/**
 * Name every still-unnamed mesh under `root`. Meshes are named `<entity id>` or
 * `<entity id>:<part>`, so the OBJ export (and anything else reading the scene) can be
 * traced back to the model entity it was built from.
 */
export function nameMeshes(root: THREE.Object3D, name: string): void {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !o.name) o.name = name;
  });
}

const named = <T extends THREE.Object3D>(o: T, name: string): T => {
  o.name = name;
  return o;
};

function box(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  rotY: number,
  castShadow = true,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.castShadow = castShadow;
  m.receiveShadow = true;
  return m;
}

/** Build one wall with its openings as solid segments + lintels + sills + glass. */
function buildWall(wall: Wall, openings: Opening[], walls: Wall[], curtained: Set<string>, presentation: "planning" | "styled"): THREE.Group {
  const g = new THREE.Group();
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  const [extA, extB] = jointExtensions(wall, walls);
  const total = len + extA + extB;
  const angle = Math.atan2(wall.by - wall.ay, wall.bx - wall.ax);
  // local frame: origin at wall start (extended), x along the wall
  const dirX = (wall.bx - wall.ax) / len;
  const dirY = (wall.by - wall.ay) / len;
  const ox = wall.ax - dirX * extA;
  const oy = wall.ay - dirY * extA;

  const body = wallBody(wall);
  const spans = openings
    .map((o) => ({ o, span: openingSpan(wall, o) }))
    .sort((p, q) => p.span[0] - q.span[0]);

  // full-height segments between openings (in extended coords: opening t is relative to original len)
  const toX = (t: number) => extA + t * len;
  let cursor = 0;
  const addSeg = (x0: number, x1: number, y0: number, y1: number, mat = wallMaterial) => {
    if (x1 - x0 < 0.005 || y1 - y0 < 0.005) return;
    // local coords: group origin is the CENTER of the extended wall
    g.add(box(x1 - x0, y1 - y0, body.depth, mat, (x0 + x1) / 2 - total / 2, (y0 + y1) / 2, body.z, 0));
    // skirting board wherever the wall meets the floor
    if (presentation === "styled" && y0 < 0.001 && y1 > SKIRTING_H) {
      g.add(named(
        box(x1 - x0, SKIRTING_H, body.depth + 0.024, skirtingMaterial, (x0 + x1) / 2 - total / 2, SKIRTING_H / 2, body.z, 0, false),
        `${wall.id}:skirting`,
      ));
    }
  };

  /**
   * One hinged door leaf. dir=+1 hinges on the A-side jamb (leaf runs toward +x), -1 on the
   * B-side jamb. `left` swings the leaf to -z instead of the default +z — i.e. to the left
   * of someone walking the wall from its A endpoint to its B endpoint.
   */
  const addLeaf = (hingeX: number, dir: 1 | -1, leafW: number, height: number, id: string, left: boolean) => {
    const hinge = new THREE.Group();
    hinge.position.set(hingeX - total / 2, 0, 0);
    hinge.userData = { doorHinge: true, doorId: id, swing: dir * (left ? 1 : -1) * DOOR_SWING };
    const h = height - 0.03;
    const cx = (dir * leafW) / 2;
    hinge.add(box(leafW, h, 0.045, doorLeafMaterial, cx, h / 2, 0, 0));
    // two recessed panels per leaf, on both faces
    for (const py_ph of [[h * 0.31, h * 0.42], [h * 0.75, h * 0.34]]) {
      const py = py_ph[0];
      const ph = py_ph[1];
      hinge.add(box(leafW - 0.18, ph, 0.008, doorPanelMaterial, cx, py, 0.027, 0, false));
      hinge.add(box(leafW - 0.18, ph, 0.008, doorPanelMaterial, cx, py, -0.027, 0, false));
    }
    // lever handle on the free edge, both faces
    const hx = cx + dir * (leafW / 2 - 0.09);
    for (const z of [0.055, -0.055]) {
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 12), handleMaterial);
      knob.rotation.x = Math.PI / 2;
      knob.position.set(hx, 1.05, z);
      knob.castShadow = true;
      hinge.add(knob);
      hinge.add(box(0.11, 0.022, 0.022, handleMaterial, hx - dir * 0.045, 1.05, z * 1.4, 0, false));
    }
    g.add(hinge);
  };

  for (const { o, span } of spans) {
    const x0 = toX(span[0]);
    const x1 = toX(span[1]);
    addSeg(cursor, x0, 0, wall.height);
    // lintel above the opening
    addSeg(x0, x1, o.sill + o.height, wall.height);
    // sill below windows
    if (o.sill > 0.005) addSeg(x0, x1, 0, o.sill);
    nameMeshes(g, wall.id); // everything so far is wall; what follows belongs to the opening
    const openingStart = g.children.length;
    // glass pane for windows
    if (o.kind === "window") {
      const glass = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 - 0.04, o.height - 0.04, 0.02), glassMaterial);
      glass.position.set((x0 + x1) / 2 - total / 2, o.sill + o.height / 2, 0);
      g.add(glass);
      // frame
      const fw = x1 - x0;
      const fh = o.height;
      const fT = 0.05;
      const cy = o.sill + fh / 2;
      const cx = (x0 + x1) / 2 - total / 2;
      for (const [bw, bh, px, py] of [
        [fw, fT, cx, o.sill + fT / 2],
        [fw, fT, cx, o.sill + fh - fT / 2],
        [fT, fh, x0 - total / 2 + fT / 2, cy],
        [fT, fh, x1 - total / 2 - fT / 2, cy],
      ] as const) {
        // the frame spans exactly the clear opening: jamb to jamb, sill to head
        g.add(named(box(bw, bh, wall.thickness + 0.02, frameMaterial, px, py, 0, 0, false), `${o.id}:frame`));
      }
      // stone sill, proud of both faces
      g.add(box(fw + 0.14, 0.045, wall.thickness + 0.16, sillMaterial, cx, o.sill - 0.022, 0, 0, false));
      // curtains, but only where nothing is parked in front of the window
      if (presentation === "styled" && curtained.has(o.id)) {
        const rodY = o.sill + fh + 0.16;
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, fw + 0.44, 10), frameMaterial);
        rod.rotation.z = Math.PI / 2;
        rod.position.set(cx, rodY, wall.thickness / 2 + 0.11);
        g.add(named(rod, `${o.id}:curtain-rod`));
        const top = rodY - 0.05;
        const bottom = 0.06;
        const ph = top - bottom;
        // four narrow slats per panel at alternating depths read as folds
        for (const edge of [-1, 1] as const) {
          const outer = cx + edge * (fw / 2 + 0.19);
          for (let k = 0; k < 4; k++) {
            const px2 = outer - edge * k * 0.082;
            const z = wall.thickness / 2 + (k % 2 === 0 ? 0.075 : 0.135);
            g.add(named(box(0.085, ph, 0.055, curtainMaterial, px2, bottom + ph / 2, z, 0, false), `${o.id}:curtain`));
          }
        }
      }
    } else {
      // hinged leaf (or two, for a double door) — clickable + animatable in Scene3D
      const clear = x1 - x0 - 0.04;
      const left = o.side === "left";
      if (clear > 1.15) {
        // double door: one leaf per jamb, both swinging to the same side
        addLeaf(x0 + 0.02, 1, clear / 2, o.height, o.id, left);
        addLeaf(x1 - 0.02, -1, clear / 2, o.height, o.id, left);
      } else if (o.hinge === "b") {
        addLeaf(x1 - 0.02, -1, clear, o.height, o.id, left);
      } else {
        addLeaf(x0 + 0.02, 1, clear, o.height, o.id, left);
      }
      // door frame (two posts + header)
      const fT = 0.06;
      for (const [bw, bh, px, py] of [
        [fT, o.height, x0 - total / 2 + fT / 2, o.height / 2],
        [fT, o.height, x1 - total / 2 - fT / 2, o.height / 2],
        [x1 - x0, fT, (x0 + x1) / 2 - total / 2, o.height + fT / 2],
      ] as const) {
        g.add(named(box(bw, bh, wall.thickness + 0.02, frameMaterial, px, py, 0, 0, false), `${o.id}:frame`));
      }
    }
    for (const part of g.children.slice(openingStart)) nameMeshes(part, `${o.id}:part`);
    cursor = x1;
  }
  addSeg(cursor, total, 0, wall.height);

  // wall cap (top band) for a finished dollhouse look
  const cap = new THREE.Mesh(new THREE.BoxGeometry(total, 0.03, body.depth + 0.02), wallTopMaterial);
  cap.position.set(0, wall.height + 0.015, body.z);
  cap.castShadow = true;
  g.add(cap);
  nameMeshes(g, wall.id);

  // proposed build-up (#4): one slab per resolved layer, over the wall's own length, open at
  // each opening. Unresolved layers have no position and are not drawn.
  for (const slab of liningSlabs(wall)) {
    const depth = Math.abs(slab.z1 - slab.z0);
    if (depth < 0.0005) continue;
    const z = (slab.z0 + slab.z1) / 2;
    const mat = liningMaterials[slab.layer.kind];
    const seg = (x0: number, x1: number, y0: number, y1: number) => {
      if (x1 - x0 < 0.005 || y1 - y0 < 0.005) return;
      g.add(named(box(x1 - x0, y1 - y0, depth, mat, (x0 + x1) / 2 - total / 2, (y0 + y1) / 2, z, 0, false), `${wall.id}:${slab.side}:${slab.layer.id}`));
    };
    let at = extA;
    for (const { o, span } of spans) {
      const x0 = toX(span[0]);
      const x1 = toX(span[1]);
      seg(at, x0, 0, wall.height);
      seg(x0, x1, o.sill + o.height, wall.height);
      if (o.sill > 0.005) seg(x0, x1, 0, o.sill);
      at = x1;
    }
    seg(at, extA + len, 0, wall.height);
  }

  // place group: center of extended wall, rotated
  g.position.set(ox + (dirX * total) / 2, 0, oy + (dirY * total) / 2);
  g.rotation.y = -angle;
  return g;
}

/**
 * Where the flat floor slab sits. Rooms with derived falls (#7) draw the sloped surface on top
 * of it, so the slab's top is dropped to the lowest derived level (or the datum, 0) to keep
 * the falls visible.
 */
function slabTop(room: Room): number {
  const d = room.drainage;
  if (!d) return 0.04;
  const levels: number[] = [0];
  const map = surfaces(d);
  for (const p of d.planes) {
    const s = map.get(p.id)!;
    if (s.resolved) for (const [x, y] of [[p.x, p.y], [p.x + p.w, p.y], [p.x, p.y + p.h], [p.x + p.w, p.y + p.h], [p.x + p.w / 2, p.y + p.h / 2]]) levels.push(s.level(x, y)!);
  }
  return levels.length > 1 ? Math.min(...levels) - 0.002 : 0.04;
}

/** The derived sloped surface of each resolved floor plane, as a subdivided grid (#7). */
function buildFalls(room: Room, material: THREE.Material): THREE.Group | null {
  const d = room.drainage;
  if (!d) return null;
  const g = new THREE.Group();
  const map = surfaces(d);
  for (const p of d.planes) {
    const s = map.get(p.id)!;
    if (!s.resolved) continue;
    const N = 16;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = p.x + (p.w * i) / N, y = p.y + (p.h * j) / N;
      pos.push(x, s.level(x, y)!, y);
      uv.push((x - room.x) / room.w, 1 - (y - room.y) / room.h);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, e = c + 1;
      idx.push(a, c, b, b, c, e);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, material);
    m.name = `${room.id}:fall:${p.id}`;
    m.receiveShadow = true;
    g.add(m);
  }
  for (const w of d.wastes) {
    const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
    const y = (w.level?.value ?? 0) + 0.003;
    const mesh = w.kind === "linear"
      ? new THREE.Mesh(new THREE.BoxGeometry(len, 0.006, 0.04), new THREE.MeshStandardMaterial({ color: "#2b2b2b", metalness: 0.6, roughness: 0.4 }))
      : new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.006, 24), new THREE.MeshStandardMaterial({ color: "#2b2b2b", metalness: 0.6, roughness: 0.4 }));
    mesh.position.set((w.ax + w.bx) / 2, y, (w.ay + w.by) / 2);
    if (w.kind === "linear") mesh.rotation.y = -Math.atan2(w.by - w.ay, w.bx - w.ax);
    mesh.name = `${room.id}:waste:${w.id}`;
    if (w.level?.value !== undefined) g.add(mesh);
  }
  return g.children.length ? g : null;
}

function buildFloor(room: Room, presentation: "planning" | "styled"): THREE.Mesh {
  if (presentation === "planning") {
    const m = new THREE.Mesh(new THREE.BoxGeometry(room.w, 0.04, room.h), new THREE.MeshStandardMaterial({ color: "#b8b8b3", roughness: 0.95 }));
    m.name = `${room.id}:planning-floor`;
    m.position.set(room.x + room.w / 2, slabTop(room) - 0.02, room.y + room.h / 2);
    m.receiveShadow = true;
    return m;
  }
  const color = FLOOR_COLORS[room.floor] ?? FLOOR_COLORS.oak;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: room.floor === "carpet" ? 1 : 0.72 });
  const base = floorTexture(room.floor in FLOOR_SCALE ? room.floor : "oak");
  if (base) {
    const tex = base.clone();
    tex.needsUpdate = true;
    const sc = FLOOR_SCALE[room.floor] ?? 2.4;
    tex.repeat.set(room.w / sc, room.h / sc);
    mat.map = tex;
    mat.color.set("#ffffff");
    if (room.floor === "tile") mat.roughness = 0.4;
  }
  const geo = new THREE.BoxGeometry(room.w, 0.04, room.h);
  const m = new THREE.Mesh(geo, mat);
  m.name = room.id;
  m.position.set(room.x + room.w / 2, slabTop(room) - 0.02, room.y + room.h / 2);
  m.receiveShadow = true;
  return m;
}

/** A pendant fixture plus the point light it stands for, hung over a room's centre. */
function buildPendant(room: Room, ceiling: number): THREE.Group {
  const g = new THREE.Group();
  const drop = Math.min(0.55, ceiling * 0.22);
  const shadeY = ceiling - drop;
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, drop, 6), cableMaterial);
  cable.position.set(0, ceiling - drop / 2, 0);
  g.add(cable);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.19, 0.17, 20, 1, true), lampShadeMaterial);
  shade.material.side = THREE.DoubleSide;
  shade.position.set(0, shadeY, 0);
  g.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), lampShadeMaterial);
  bulb.position.set(0, shadeY - 0.09, 0);
  g.add(bulb);
  // brightness scaled to the room so a corridor is not lit like a living room
  const area = Math.max(4, room.w * room.h);
  const light = new THREE.PointLight("#ffe0ae", Math.min(8, 2.2 + area * 0.26), Math.max(5, room.w + room.h), 2);
  light.position.set(0, shadeY - 0.12, 0);
  g.add(light);
  g.position.set(room.x + room.w / 2, 0, room.y + room.h / 2);
  return g;
}

export interface BuiltPlan {
  group: THREE.Group;
  bounds: THREE.Box3;
}

/** Is a piece of furniture parked within curtain depth of this window? */
function blockedInFront(wall: Wall, o: Opening, items: Item[]): boolean {
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  if (len === 0) return true;
  const dx = (wall.bx - wall.ax) / len;
  const dy = (wall.by - wall.ay) / len;
  const cx = wall.ax + dx * o.t * len;
  const cy = wall.ay + dy * o.t * len;
  for (const it of items) {
    const cat = catalogByKind(it.kind);
    if (!cat || cat.isRug) continue;
    const radius = Math.max(cat.w, cat.d) / 2;
    const vx = it.x - cx;
    const vy = it.y - cy;
    const along = Math.abs(vx * dx + vy * dy);
    const across = Math.abs(-vx * dy + vy * dx);
    if (along < o.width / 2 + radius && across < wall.thickness / 2 + 0.3 + radius) return true;
  }
  return false;
}

export function buildPlan(model: PlanModel, presentation: "planning" | "styled" = "styled"): BuiltPlan {
  const group = new THREE.Group();
  group.name = "plan";

  const openingsByWall = new Map<string, Opening[]>();
  for (const o of model.openings) {
    const list = openingsByWall.get(o.wallId) ?? [];
    list.push(o);
    openingsByWall.set(o.wallId, list);
  }

  // A window only gets curtains when the floor in front of it is free — otherwise the
  // fabric would grow straight through a sofa or a wardrobe.
  const curtained = new Set<string>();
  for (const w of model.walls) {
    for (const o of openingsByWall.get(w.id) ?? []) {
      if (o.kind !== "window") continue;
      if (!blockedInFront(w, o, model.items)) curtained.add(o.id);
    }
  }

  for (const w of model.walls) {
    group.add(buildWall(w, openingsByWall.get(w.id) ?? [], model.walls, curtained, presentation));
  }
  for (const r of model.rooms) {
    const floor = buildFloor(r, presentation);
    group.add(floor);
    const falls = buildFalls(r, floor.material as THREE.Material);
    if (falls) group.add(named(falls, `${r.id}:falls`));
  }
  const ceiling = model.walls[0]?.height ?? 2.7;
  if (presentation === "styled") for (const r of model.rooms) {
    const pendant = buildPendant(r, ceiling);
    nameMeshes(pendant, `${r.id}:pendant`);
    group.add(named(pendant, `${r.id}:pendant`));
  }

  // service points (#5): a small marker where plan position and height are both known
  for (const it of model.items) {
    for (const r of roughIn(model, it)) {
      if (r.x === undefined || r.y === undefined || r.up === undefined) continue;
      const marker = new THREE.Mesh(serviceMarkerGeometry, serviceMaterials[r.service]);
      marker.position.set(r.x, r.up, r.y);
      group.add(named(marker, `${it.id}:service:${r.pointId}`));
    }
  }

  // bounds of the CONTENT only (ground would blow up the camera fit)
  const bounds = new THREE.Box3().setFromObject(group);
  if (model.walls.length === 0) {
    bounds.set(new THREE.Vector3(-4, 0, -3), new THREE.Vector3(4, 3, 3));
  }

  // ground plane (outside the plan)
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(40, 64),
    new THREE.MeshStandardMaterial({ color: "#565b52", roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  group.add(ground);

  return { group, bounds };
}
