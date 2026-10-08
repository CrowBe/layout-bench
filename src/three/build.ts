import { installationReading, localPointReading, clearanceRegions } from "../model/installation";
import { anchorPose } from "../model/fixtures";
import { buildFurniture, applyStopgapVisual, hasCustomKind } from "./furniture";
/**
 * 3D builder — extrudes the plan into a dollhouse-style model:
 * walls with REAL openings (lintels + sills, no CSG), resolved corner joints,
 * per-room floors with finishes, ground plane.
 */

import * as THREE from "three";
import { surfaces } from "../model/drainage";
import { finishedLevel, floorFill, floorLayerLabel, floorLevels } from "../model/floor";
import { floorTileLayout } from "../model/floorTiling";
import { tilingLayout } from "../model/tiling";
import type { Item, LayerKind, Opening, PlanModel, Room, ValueStatus, Wall, WallSideName } from "../model/types";
import { liningSlabs, resolveFace, sideNormal, wallBody, VALUE_STATUSES } from "../model/faces";
import { roughIn } from "../model/fixtures";
import { catalogForItem, catalogByKind } from "../model/catalog";
import { formatMm, segLen } from "../model/geometry";
import { openingSpan } from "../model/issues";
import { outletPosition, wasteProduct } from "../model/wasteProduct";

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

/** A layer of unknown thickness shown only as where it sits: a 2 mm film on its one known face. */
const FILM = 0.002;
/** The slab under the substrate top is drawn this deep; its real thickness is not recorded. */
const SUBSTRATE_DRAWN = 0.1;

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

/** Canonical fixture shape, transform and resolved vertical level; unknown placement is omitted. */
export function buildFixture(model: PlanModel,it: Item): THREE.Group | null {
  const lv=installationReading(model,it);
  if(it.installation && (!lv.resolved || !anchorPose(model,it).resolved))return null;
  const cat=catalogForItem(it);if(!cat)return null;
  // An installed fitting without a sourced outline is exactly its envelope, without
  // decorative legs/top offsets that would change its documented height or footprint. A
  // project kind modelled part by part inside its envelope keeps those parts: they are drawn
  // above the kind's own elevation, so they shift down by it onto the installed bottom.
  const parts=it.installation && !cat.outline && !it.productGeometry && hasCustomKind(it.kind);
  const fg=it.installation && !cat.outline && !parts ? new THREE.Group() : buildFurniture(it.kind,it.productGeometry);if(!fg)return null;
  if(it.installation && !cat.outline && !parts){const mesh=new THREE.Mesh(new THREE.BoxGeometry(cat.w,cat.h,cat.d),new THREE.MeshStandardMaterial({color:cat.color,roughness:.75}));mesh.position.y=cat.h/2;fg.add(mesh);}
  fg.position.set(it.x,lv.bottom!==undefined ? lv.bottom-(parts ? cat.elevation ?? 0 : 0) : .04,it.y);fg.rotation.y=it.rotation*Math.PI/180;
  if(it.installation?.mirror)fg.scale.x=-1;
  fg.userData={fixtureId:it.id,installation:lv};nameMeshes(fg,it.id);
  for(const p of it.installationGeometry?.fixings??[]){const r=localPointReading(model,it,p);if(r.x===undefined || r.y===undefined || r.level===undefined)continue;
    const marker=new THREE.Mesh(new THREE.SphereGeometry(.007,8,6),frameMaterial);marker.position.set(p.x! ,p.z!+(parts ? cat.elevation ?? 0 : 0),p.y!-catalogForItem(it)!.d/2);marker.name=`${it.id}:fixing:${p.id}`;fg.add(marker);}
  // tagged last, so the fixing markers hide and show with their fixture
  fg.traverse((o)=>{if(((o as THREE.Mesh).isMesh || (o as THREE.LineSegments).isLineSegments) && !o.userData.stage)o.userData.stage=`item:${it.id}`;});
  return fg;
}

const named = <T extends THREE.Object3D>(o: T, name: string): T => {
  o.name = name;
  return o;
};

/**
 * Give a drawn object, and every mesh or line under it that has none yet, the stage-view
 * element it draws (see sheets/stageView.ts). Set where the builders create the geometry,
 * from the model's own ids, so an id containing ":" or any other character is kept whole.
 */
const staged = <T extends THREE.Object3D>(o: T, id: string): T => {
  o.traverse((c) => {
    if (c.userData.stage || c.userData.stages) return;
    if ((c as THREE.Mesh).isMesh || (c as THREE.LineSegments).isLineSegments) c.userData.stage = id;
  });
  return o;
};
/** The element a room's finished floor surface stands for: its tile layer (or top layer), else the room. */
const finishStage = (room: Room): string => {
  const layers = room.floorBuildUp?.layers ?? [];
  const finish = [...layers].reverse().find((l) => l.kind === "tile") ?? layers.at(-1);
  return finish ? `room:${room.id}:floor:${finish.id}` : `room:${room.id}`;
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
function buildWall(wall: Wall, openings: Opening[], walls: Wall[], curtained: Set<string>, presentation: "planning" | "styled", base = 0, foot?: WallFoot): THREE.Group {
  const g = new THREE.Group();
  if (base < 0 && foot) g.userData.foot = foot;
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
    addSeg(cursor, x0, base, wall.height);
    // below a door's threshold, down to a stripped floor's substrate: what fills it is not recorded
    if (o.sill <= 0.005 && base < -0.005) {
      const before = g.children.length;
      addSeg(x0, x1, base, 0);
      for (const m of g.children.slice(before)) {
        m.userData.stopgapReason = "under the doorway down to the substrate; what fills it is not recorded";
        applyStopgapVisual(m as THREE.Mesh);
      }
    }
    // lintel above the opening
    addSeg(x0, x1, o.sill + o.height, wall.height);
    // sill below windows
    if (o.sill > 0.005) addSeg(x0, x1, base, o.sill);
    nameMeshes(g, wall.id); // everything so far is wall; what follows belongs to the opening
    staged(g, `wall:${wall.id}`);
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
    for (const part of g.children.slice(openingStart)) {
      nameMeshes(part, `${o.id}:part`);
      staged(part, `opening:${o.id}`);
    }
    cursor = x1;
  }
  addSeg(cursor, total, base, wall.height);

  // wall cap (top band) for a finished dollhouse look
  const cap = new THREE.Mesh(new THREE.BoxGeometry(total, 0.03, body.depth + 0.02), wallTopMaterial);
  cap.position.set(0, wall.height + 0.015, body.z);
  cap.castShadow = true;
  g.add(cap);
  nameMeshes(g, wall.id);
  staged(g, `wall:${wall.id}`);

  // proposed build-up (#4): one slab per resolved layer, over the wall's own length, open at
  // each opening. Unresolved layers have no position and are not drawn.
  for (const slab of liningSlabs(wall)) {
    const depth = Math.abs(slab.z1 - slab.z0);
    if (depth < 0.0005) continue;
    const z = (slab.z0 + slab.z1) / 2;
    const mat = liningMaterials[slab.layer.kind];
    // board and membrane go down to a stripped floor's substrate; adhesive and tile start at the floor
    const foot = slab.layer.kind === "board" || slab.layer.kind === "waterproofing" ? base : 0;
    const seg = (x0: number, x1: number, y0: number, y1: number) => {
      if (x1 - x0 < 0.005 || y1 - y0 < 0.005) return;
      g.add(staged(named(box(x1 - x0, y1 - y0, depth, mat, (x0 + x1) / 2 - total / 2, (y0 + y1) / 2, z, 0, false), `${wall.id}:${slab.side}:${slab.layer.id}`), `wall:${wall.id}:${slab.side}:${slab.layer.id}`));
    };
    let at = extA;
    for (const { o, span } of spans) {
      const x0 = toX(span[0]);
      const x1 = toX(span[1]);
      seg(at, x0, foot, wall.height);
      seg(x0, x1, o.sill + o.height, wall.height);
      if (o.sill > 0.005) seg(x0, x1, foot, o.sill);
      at = x1;
    }
    seg(at, extA + len, foot, wall.height);
  }

  // place group: center of extended wall, rotated
  g.position.set(ox + (dirX * total) / 2, 0, oy + (dirY * total) / 2);
  g.rotation.y = -angle;
  return g;
}

/**
 * Flat floors follow the authored assembly's finished level (#6), remaining absent when
 * unresolved. Rooms without an assembly keep the legacy visual slab. Derived falls (#7)
 * take precedence, with the slab dropped below their lowest sampled level or datum zero.
 */
function slabTop(room: Room): number | undefined {
  const finished = room.floorBuildUp ? finishedLevel(room.floorBuildUp) : undefined;
  const flatTop = finished ? finished.top : 0.04;
  const d = room.drainage;
  if (!d) return flatTop;
  const levels: number[] = [0];
  const map = surfaces(d);
  for (const p of d.planes) {
    const s = map.get(p.id)!;
    if (s.resolved) for (const [x, y] of [[p.x, p.y], [p.x + p.w, p.y], [p.x, p.y + p.h], [p.x + p.w, p.y + p.h], [p.x + p.w / 2, p.y + p.h / 2]]) levels.push(s.level(x, y)!);
  }
  return levels.length > 1 ? Math.min(...levels) - 0.002 : flatTop;
}

/** The derived sloped surface of each resolved floor plane, as a subdivided grid (#7). */
function buildFalls(room: Room, material: THREE.Material, flatTop?: number): THREE.Group | null {
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
    m.userData.stage = `room:${room.id}:plane:${p.id}`;
    m.receiveShadow = true;
    g.add(m);
  }
  // With no fall resolved, a waste with no level of its own sits on the flat finished floor.
  const onFlat = !g.children.length ? flatTop : undefined;
  for (const w of d.wastes) {
    const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
    const level = w.level?.value ?? onFlat;
    if (level === undefined) continue;
    let mesh: THREE.Mesh;
    let stopgap = false;
    // Sizes come only from the linked drain brief (#82): grate length and width at their real
    // size, body depth below the grate. Never use the outlet size as a grate size. A waste
    // with no product, or a brief that leaves a size unknown, is a film marker.
    const info = wasteProduct(w);
    const along = info?.grateLength?.value ?? (w.kind === "linear" ? len : FILM);
    const across = info?.grateWidth?.value ?? FILM;
    const depth = info?.installationDepth?.value;
    const height = depth ?? FILM;
    const y0 = depth !== undefined ? level - depth : level;
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(along, height, across),
      new THREE.MeshStandardMaterial({ color: "#2b2b2b", metalness: 0.6, roughness: 0.4 }),
    );
    mesh.position.set((w.ax + w.bx) / 2, y0 + height / 2, (w.ay + w.by) / 2);
    if (w.kind === "linear") mesh.rotation.y = -Math.atan2(w.by - w.ay, w.bx - w.ax);
    const sized = !!info?.grateLength && !!info.grateWidth;
    mesh.userData.body = !info
      ? "location marker; no drain product linked"
      : `${info.name}: grate ${sized ? "from the brief" : "size not in the brief"}, body depth below the grate ${depth !== undefined ? "from the brief" : "not in the brief, drawn as a film"}`;
    stopgap = !sized || depth === undefined;
    const outlet = outletPosition(w, info);
    if (outlet.x !== undefined && outlet.y !== undefined && outlet.diameter !== undefined) {
      const drop = info?.outletBelowGrate?.value ?? height;
      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(outlet.diameter / 2, outlet.diameter / 2, Math.max(drop, FILM), 24),
        new THREE.MeshStandardMaterial({ color: "#5a5a5a", metalness: 0.5, roughness: 0.5 }),
      );
      pipe.position.set(outlet.x, level - Math.max(drop, FILM) / 2, outlet.y);
      pipe.name = `${room.id}:waste:${w.id}:outlet`;
      pipe.userData.outlet = outlet.basis;
      staged(pipe, `room:${room.id}:waste:${w.id}`);
      if (w.level?.value === undefined || info?.outletBelowGrate === undefined) applyStopgapVisual(pipe);
      g.add(pipe);
    }
    mesh.name = `${room.id}:waste:${w.id}`;
    staged(mesh, `room:${room.id}:waste:${w.id}`);
    if (w.level?.value === undefined) {
      mesh.userData.level = "unknown; drawn on the flat finished floor";
      mesh.userData.stopgapReason = "level not recorded; drawn on the flat finished-level target";
      stopgap = true;
    }
    if (stopgap) applyStopgapVisual(mesh);
    g.add(mesh);
  }
  return g.children.length ? g : null;
}

export const tileMaterials = {
  full: new THREE.MeshStandardMaterial({ color: "#e9e4d8", roughness: 0.35 }),
  cut: new THREE.MeshStandardMaterial({ color: "#e6b98f", roughness: 0.35 }),
};
const tintedTiles = new Map<string, THREE.MeshStandardMaterial>();
/**
 * A set-out's own tile colour, when one is recorded; cut pieces lean toward the planning cut tint
 * so they still read as cuts. Without a colour, the shared planning materials.
 */
function tileMaterial(color: string | undefined, cut: boolean): THREE.MeshStandardMaterial {
  if (!color) return cut ? tileMaterials.cut : tileMaterials.full;
  const key = `${color}:${cut}`;
  let m = tintedTiles.get(key);
  if (!m) {
    const c = new THREE.Color(color);
    if (cut) c.lerp(tileMaterials.cut.color, 0.45);
    m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.35 });
    tintedTiles.set(key, m);
  }
  return m;
}
/**
 * The proposed tile set-out (#9) on one wall side, from the same derivation the elevation and
 * sheet use: every piece as a quad just proud of the finished face (or of the chosen reference
 * face when the finished face is unresolved), merged into one mesh for full pieces and one for
 * cut pieces (tinted) so a mosaic stays two draw calls. Joints show as gaps. Nothing is drawn
 * until the set-out resolves, so an unresolved input is never shown as a pattern.
 */
function buildTiling(model: PlanModel, wall: Wall, side: "left" | "right"): THREE.Group | null {
  if (!wall.tiling?.[side]) return null;
  const layout = tilingLayout(model, wall, side);
  if (!layout.cuts || !layout.pieces.length) return null;
  const finished = resolveFace(wall.sides?.[side], "finished");
  const offset = finished.resolved ? finished.offset! : layout.face.offset;
  if (offset === undefined) return null;
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  const d = { x: (wall.bx - wall.ax) / len, y: (wall.by - wall.ay) / len };
  const n = sideNormal(wall, side);
  const o = offset + 0.0015;
  const g = new THREE.Group();
  g.name = `${wall.id}:tiling:${side}`;
  g.userData.pieces = layout.pieces.length;
  for (const cut of [false, true]) {
    const pieces = layout.pieces.filter((p) => p.cut === cut);
    if (!pieces.length) continue;
    const pos = new Float32Array(pieces.length * 18);
    const at = (s: number, z: number, i: number) => {
      pos[i] = wall.ax + d.x * s + n.x * o;
      pos[i + 1] = z;
      pos[i + 2] = wall.ay + d.y * s + n.y * o;
    };
    // wind each quad so its front faces the tiled side (+n in plan x/z, y up)
    const flip = d.x * n.y - d.y * n.x < 0;
    pieces.forEach((p, k) => {
      const b = k * 18;
      const [sA, sB] = flip ? [p.s1, p.s0] : [p.s0, p.s1];
      at(sA, p.z0, b); at(sB, p.z0, b + 3); at(sB, p.z1, b + 6);
      at(sA, p.z0, b + 9); at(sB, p.z1, b + 12); at(sA, p.z1, b + 15);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const normals = new Float32Array(pos.length);
    for (let i = 0; i < normals.length; i += 3) { normals[i] = n.x; normals[i + 1] = 0; normals[i + 2] = n.y; }
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    const m = new THREE.Mesh(geo, tileMaterial(wall.tiling[side]!.color, cut));
    m.name = `${wall.id}:tiling:${side}:${cut ? "cut" : "full"}`;
    m.userData.pieces = pieces.length;
    m.receiveShadow = true;
    g.add(m);
  }
  const tile = [...(wall.sides?.[side]?.layers ?? [])].reverse().find((l) => l.kind === "tile");
  return staged(g, tile ? `wall:${wall.id}:${side}:${tile.id}` : `wall:${wall.id}`);
}

/**
 * The proposed floor set-out (#9) on the finished floor, from the same layout the floor tiling
 * sheet uses: full and cut pieces as two merged meshes just above the flat finished level. Drawn
 * once the grid itself resolves (faces, tile, joint and origin); what the layout still lists as
 * missing (falls, door transition, waste cuts) is carried on the group, not drawn. Not drawn on
 * resolved falls, which would need the pieces draped over each plane.
 */
function buildFloorTiling(model: PlanModel, room: Room): THREE.Group | null {
  if (!room.floorTiling) return null;
  const top = slabTop(room);
  if (top === undefined || !room.floorBuildUp || hasResolvedFalls(room)) return null;
  const layout = floorTileLayout(model, room);
  if (!layout.cuts || !layout.pieces.length) return null;
  const g = new THREE.Group();
  g.name = `${room.id}:floor-tiling`;
  g.userData.pieces = layout.pieces.length;
  g.userData.provenance = { status: room.floorTiling.tileLength?.status ?? "proposed", datum: room.floorBuildUp.datum };
  if (layout.missing.length) g.userData.unresolved = [...layout.missing];
  const y = top + TILE_LIFT;
  for (const cut of [false, true]) {
    const pieces = layout.pieces.filter((p) => p.cut === cut);
    if (!pieces.length) continue;
    const pos = new Float32Array(pieces.length * 18);
    pieces.forEach((p, k) => {
      // counter-clockwise seen from above (+y), with plan y as world z
      const quad = [p.x0, p.y0, p.x0, p.y1, p.x1, p.y1, p.x0, p.y0, p.x1, p.y1, p.x1, p.y0];
      for (let i = 0; i < 6; i++) pos.set([quad[i * 2], y, quad[i * 2 + 1]], k * 18 + i * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, tileMaterial(room.floorTiling.color, cut));
    m.name = `${room.id}:floor-tiling:${cut ? "cut" : "full"}`;
    m.userData.pieces = pieces.length;
    m.receiveShadow = true;
    g.add(m);
  }
  const grates = buildGratesThroughTiles(room, y);
  if (grates) g.add(grates);
  return staged(g, finishStage(room));
}

/** Height of the floor set-out quads above the flat finished level, so they don't z-fight it. */
const TILE_LIFT = 0.0015;

/**
 * Each waste's grate face drawn again just above the floor set-out, so a drain the set-out would
 * otherwise cover stays visible where the tiles are shown. Only a drawing lift: the waste keeps
 * its own level (recorded, or unknown and drawn on the flat finished floor) in buildFalls, and
 * its footprint is the same sourced grate plan (or film marker) drawn there. No aperture or cut
 * is drawn in the tiles: those stay listed as missing on the layout. The face draws the waste's
 * stage element inside a group that carries the floor set-out's, so it renders only when both
 * the waste and the tiles are shown.
 */
function buildGratesThroughTiles(room: Room, tileY: number): THREE.Group | null {
  const wastes = room.drainage?.wastes ?? [];
  if (!wastes.length) return null;
  const g = new THREE.Group();
  g.name = `${room.id}:floor-tiling:grates`;
  g.userData.stage = finishStage(room);
  const y = tileY + TILE_LIFT;
  for (const w of wastes) {
    const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
    const info = wasteProduct(w);
    const along = info?.grateLength?.value ?? (w.kind === "linear" ? len : FILM);
    const across = info?.grateWidth?.value ?? FILM;
    const stopgap = w.level?.value === undefined || !info?.grateLength || !info.grateWidth;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(along, across).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: "#2b2b2b", metalness: 0.6, roughness: 0.4 }),
    );
    face.position.set((w.ax + w.bx) / 2, y, (w.ay + w.by) / 2);
    if (w.kind === "linear") face.rotation.y = -Math.atan2(w.by - w.ay, w.bx - w.ax);
    face.name = `${room.id}:floor-tiling:grate:${w.id}`;
    face.userData.stage = `room:${room.id}:waste:${w.id}`;
    face.userData.level = w.level?.value !== undefined
      ? "waste level as recorded (drawn in the falls); this face is lifted just above the tile set-out to stay visible"
      : "waste level not recorded; this face is lifted just above the tile set-out to stay visible";
    face.userData.aperture = info?.grateLength && info.grateWidth ? `grate ${formatMm(info.grateLength.value)} × ${formatMm(info.grateWidth.value)} mm from ${info.name}; clearance and cut shape to confirm on site` : "not recorded; waste cuts unresolved";
    if (stopgap) applyStopgapVisual(face);
    g.add(face);
  }
  return g;
}

/** The weakest of two level bases, for a slab drawn between them. */
function weakerBasis(a: ValueStatus | "unknown", b: ValueStatus | "unknown"): ValueStatus | "unknown" {
  if (a === "unknown" || b === "unknown") return "unknown";
  return VALUE_STATUSES[Math.max(VALUE_STATUSES.indexOf(a), VALUE_STATUSES.indexOf(b))];
}

const hasResolvedFalls = (room: Room) => !!room.drainage && [...surfaces(room.drainage).values()].some((s) => s.resolved);

const substrateMaterial = new THREE.MeshStandardMaterial({ color: "#9d9a93", roughness: 0.95 });
const floorLayerMaterials: Record<string, THREE.Material> = {
  waterproofing: liningMaterials.waterproofing,
  screed: new THREE.MeshStandardMaterial({ color: "#b7aea0", roughness: 0.95 }),
  adhesive: liningMaterials.adhesive,
  tile: liningMaterials.tile,
};

/**
 * The floor build-up under the finished surface (#6), for a room with an authored assembly
 * and a known substrate top: the substrate as a slab, each layer whose top and bottom both
 * resolve at its real thickness, and the layers between known levels whose split is unknown
 * drawn without inventing it: the first as a film on the known level below, the last as a
 * film under the known level above, and the rest as one translucent fill between them. The
 * finished layer itself is the room's floor mesh.
 */
function buildFloorBuildUp(room: Room): THREE.Group | null {
  const fb = room.floorBuildUp;
  if (!fb || fb.substrateTop?.value === undefined) return null;
  const allLevels = floorLevels(fb);
  const levels = allLevels.map((l) => (l.resolved ? l.top : undefined));
  const between = (a: number, b: number) => ({ status: weakerBasis(allLevels[a].basis, allLevels[b].basis), datum: fb.datum });
  const g = new THREE.Group();
  const cx = room.x + room.w / 2;
  const cz = room.y + room.h / 2;
  const slab = (y0: number, y1: number, mat: THREE.Material, name: string, stage: string, extra: Record<string, unknown> = {}) => {
    if (y1 - y0 < 0.0005) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(room.w, y1 - y0, room.h), mat);
    m.position.set(cx, (y0 + y1) / 2, cz);
    m.receiveShadow = true;
    m.name = name;
    Object.assign(m.userData, extra);
    if (extra.stopgap) applyStopgapVisual(m);
    g.add(m.userData.stages ? m : staged(m, stage));
  };
  const sub = levels[0]!;
  slab(sub - SUBSTRATE_DRAWN, sub, substrateMaterial, `${room.id}:substrate`, `room:${room.id}:substrate`, {
    drawnThickness: "not recorded; drawn 100 mm",
    stopgap: true,
    provenance: { status: fb.substrateTop.status ?? allLevels[0].basis, ...(fb.substrateTop.source ? { source: fb.substrateTop.source } : {}), datum: fb.datum },
  });
  // on resolved falls the layers above the substrate follow sloped planes the model does not
  // derive per layer, so only the substrate is drawn (as the floor and floor tiling builders do)
  if (hasResolvedFalls(room)) return g;
  const layers = fb.layers;
  // the top layer is the floor mesh itself
  const below = layers.slice(0, -1);
  let i = 0;
  while (i < below.length) {
    const lo = levels[i];
    const hi = levels[i + 1];
    if (lo !== undefined && hi !== undefined) {
      slab(lo, hi, floorLayerMaterials[below[i].kind], `${room.id}:floor:${below[i].id}`, `room:${room.id}:floor:${below[i].id}`, { provenance: between(i, i + 1) });
      i++;
      continue;
    }
    // a run of layers between the last known level and the next one
    let j = i;
    while (j < below.length && levels[j + 1] === undefined) j++;
    const run = below.slice(i, Math.min(j, below.length - 1) + 1);
    const bottom = lo;
    const top = levels[i + run.length];
    if (bottom !== undefined && top !== undefined && top - bottom > 2 * FILM) {
      const first = run[0];
      const last = run.length > 1 ? run[run.length - 1] : undefined;
      slab(bottom, bottom + FILM, floorLayerMaterials[first.kind], `${room.id}:floor:${first.id}`, `room:${room.id}:floor:${first.id}`, { drawnThickness: "unknown; drawn as a film", stopgap: true });
      if (last) slab(top - FILM, top, floorLayerMaterials[last.kind], `${room.id}:floor:${last.id}`, `room:${room.id}:floor:${last.id}`, { drawnThickness: "unknown; drawn as a film", stopgap: true });
      const middle = run.slice(1, last ? -1 : undefined);
      // with no layer between the two films, the gap is shown with one layer only: a screed (or
      // other bulk layer) when the run has one, else the upper layer, so an earlier film's stage
      // never shows it as if the later layer were already laid
      const bulk = run.find((l) => l.kind !== "waterproofing" && l.kind !== "adhesive");
      const fill = middle.length ? middle : last ? [bulk ?? last] : run;
      const fillMat = (floorLayerMaterials[fill[0].kind] as THREE.MeshStandardMaterial).clone();
      fillMat.transparent = true;
      fillMat.opacity = 0.55;
      slab(bottom + FILM, top - (last ? FILM : 0), fillMat, `${room.id}:floor-fill`, "", {
        stages: fill.map((l) => `room:${room.id}:floor:${l.id}`),
        provenance: { status: floorFill(fb)?.basis ?? between(i, i + run.length).status, datum: fb.datum },
        drawnThickness: `${run.map(floorLayerLabel).join(" + ")} fill ${Math.round((top - bottom) * 1000)} mm together; the split is unknown`,
      });
    }
    i += run.length;
  }
  return g.children.length ? g : null;
}

/** The quantity and datum that gave a wall foot its level, kept beside the number. */
interface WallFoot {
  level: number;
  status?: ValueStatus;
  source?: string;
  datum: string;
}

/** Does this wall run along one of the room's edges (parallel, within its thickness plus 50 mm, overlapping)? */
function bounds(wall: Wall, r: Room): boolean {
  const reach = wall.thickness + 0.05;
  const along = (a0: number, a1: number, b0: number, b1: number) => Math.min(Math.max(a0, a1), b1) - Math.max(Math.min(a0, a1), b0) > 0.01;
  if (Math.abs(wall.ay - wall.by) < 1e-6) {
    const near = Math.min(Math.abs(wall.ay - r.y), Math.abs(wall.ay - (r.y + r.h)));
    return near <= reach && along(wall.ax, wall.bx, r.x, r.x + r.w);
  }
  if (Math.abs(wall.ax - wall.bx) < 1e-6) {
    const near = Math.min(Math.abs(wall.ax - r.x), Math.abs(wall.ax - (r.x + r.w)));
    return near <= reach && along(wall.ay, wall.by, r.y, r.y + r.h);
  }
  return false;
}

/**
 * Lowest substrate top of the rooms this wall bounds, or 0 when none has one, and the quantity
 * it came from. The wall (and its board) runs down to it; walls of other rooms stay at 0.
 */
function floorBase(model: PlanModel, wall: Wall): { base: number; foot?: WallFoot } {
  let base = 0;
  let foot: WallFoot | undefined;
  for (const r of model.rooms.filter((room) => bounds(wall, room))) {
    const q = r.floorBuildUp?.substrateTop;
    if (q?.value !== undefined && q.value < base) {
      base = q.value;
      foot = { level: q.value, ...(q.status ? { status: q.status } : {}), ...(q.source ? { source: q.source } : {}), datum: r.floorBuildUp!.datum };
    }
  }
  return { base, foot };
}

/** The floor mesh is the finished layer: its own thickness when both its faces resolve on a flat floor, else a 40 mm slab. */
function finishPiece(room: Room): { t: number; provenance?: { status: ValueStatus | "unknown"; datum: string } } {
  if (!room.floorBuildUp || hasResolvedFalls(room)) return { t: 0.04 };
  const levels = floorLevels(room.floorBuildUp);
  const [under, top] = levels.slice(-2);
  if (levels.length < 2 || !under.resolved || !top.resolved) return { t: 0.04 };
  const t = top.top! - under.top!;
  // the layer's own thickness carries the basis of its two levels; the 40 mm fallback carries none
  return t > 0.0005 ? { t, provenance: { status: weakerBasis(under.basis, top.basis), datum: room.floorBuildUp.datum } } : { t: 0.04 };
}

function buildFloor(room: Room, presentation: "planning" | "styled"): THREE.Mesh | null {
  const top = slabTop(room);
  if (top === undefined) return null; // authored unresolved levels must not become a default slab
  if (presentation === "planning") {
    const { t, provenance } = finishPiece(room);
    const m = new THREE.Mesh(new THREE.BoxGeometry(room.w, t, room.h), new THREE.MeshStandardMaterial({ color: "#b8b8b3", roughness: 0.95 }));
    m.name = `${room.id}:planning-floor`;
    m.userData.stage = finishStage(room);
    if (provenance) m.userData.provenance = provenance;
    m.position.set(room.x + room.w / 2, top - t / 2, room.y + room.h / 2);
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
  const { t, provenance } = finishPiece(room);
  const geo = new THREE.BoxGeometry(room.w, t, room.h);
  const m = new THREE.Mesh(geo, mat);
  m.name = room.id;
  m.userData.stage = finishStage(room);
  if (provenance) m.userData.provenance = provenance;
  m.position.set(room.x + room.w / 2, top - t / 2, room.y + room.h / 2);
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
    const cat = catalogForItem(it);
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
    const { base, foot } = floorBase(model, w);
    group.add(buildWall(w, openingsByWall.get(w.id) ?? [], model.walls, curtained, presentation, base, foot));
  }
  for (const r of model.rooms) {
    const floor = buildFloor(r, presentation);
    if (floor) group.add(floor);
    const buildUp = buildFloorBuildUp(r);
    if (buildUp) group.add(named(buildUp, `${r.id}:build-up`));
    const flatTop = r.floorBuildUp ? slabTop(r) : undefined;
    const falls = buildFalls(r, (floor?.material as THREE.Material | undefined) ?? liningMaterials.tile, flatTop);
    if (falls) group.add(named(falls, `${r.id}:falls`));
    const tiles = buildFloorTiling(model, r);
    if (tiles) group.add(tiles);
  }
  for (const w of model.walls) {
    for (const side of ["left", "right"] as const) {
      const tiles = buildTiling(model, w, side);
      if (tiles) group.add(tiles);
    }
  }
  const ceiling = model.walls[0]?.height ?? 2.7;
  if (presentation === "styled") for (const r of model.rooms) {
    const pendant = buildPendant(r, ceiling);
    nameMeshes(pendant, `${r.id}:pendant`);
    staged(pendant, `room:${r.id}`);
    group.add(named(pendant, `${r.id}:pendant`));
  }

  // service points (#5): a small marker where plan position and height are both known
  for (const it of model.items) {
    // Installation access is a wire volume, separate from the physical fixture mesh.
    for(const access of clearanceRegions(model,it)){
      if(!access.resolved || access.bottom===undefined || access.top===undefined)continue;
      const lines:number[]=[];const v=(i:number,z:number)=>[access.polygon[i].x,z,access.polygon[i].y];
      for(let i=0;i<4;i++){const j=(i+1)%4;for(const z of [access.bottom,access.top])lines.push(...v(i,z),...v(j,z));lines.push(...v(i,access.bottom),...v(i,access.top));}
      const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.Float32BufferAttribute(lines,3));
      const region=new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:"#8c6496",transparent:true,opacity:.65}));region.name=`${it.id}:access:${access.id}`;region.userData={requirement:access,stage:`item:${it.id}`};group.add(region);
    }
    for (const r of roughIn(model, it)) {
      const vertical=r.level ?? r.up;
      if (r.x === undefined || r.y === undefined || vertical === undefined) continue;
      const marker = new THREE.Mesh(serviceMarkerGeometry, serviceMaterials[r.service]);
      marker.position.set(r.x, vertical, r.y);
      marker.userData.provenance = { status: r.status, ...(r.axisEvidence ? { axisEvidence: structuredClone(r.axisEvidence) } : {}) };
      marker.userData.stage = `item:${it.id}:sp:${r.pointId}`;
      group.add(named(marker, `${it.id}:service:${r.pointId}`));
    }
  }

  tagStages(model, group);

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
  // under a stripped floor's drawn slab, so the ground never covers it
  const lowest = Math.min(0, ...model.rooms.map((r) => r.floorBuildUp?.substrateTop?.value ?? 0));
  ground.position.y = Math.min(-0.02, lowest - SUBSTRATE_DRAWN - 0.02);
  ground.receiveShadow = true;
  group.add(ground);

  return { group, bounds };
}

/**
 * Stage tags are set where the builders create each mesh (see `staged`), from the model's own
 * ids. This only hands a tag down to a mesh added later under an already tagged object; it
 * never reads one back out of a name. Untagged meshes (the ground) are always shown.
 */
export function tagStages(_model: PlanModel, root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o.userData.stages || o.userData.stage) return;
    if (!(o as THREE.Mesh).isMesh && !(o as THREE.LineSegments).isLineSegments) return;
    for (let n = o.parent; n && n !== root.parent; n = n.parent) {
      if (n.userData.stages) { o.userData.stages = n.userData.stages; return; }
      if (n.userData.stage) { o.userData.stage = n.userData.stage; return; }
    }
  });
}

/** Show only what a stage's visible set holds; null shows everything. */
export function applyStageVisibility(root: THREE.Object3D, visible: Set<string> | null): void {
  root.traverse((o) => {
    const ids: string[] | undefined = o.userData.stages ?? (o.userData.stage ? [o.userData.stage] : undefined);
    if (!ids) return;
    o.visible = !visible || ids.some((id) => visible.has(id));
  });
}
