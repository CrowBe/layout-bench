/**
 * Wall reference faces (#4) — the faces a trade measures from: the existing surveyed surface,
 * the frame after strip-out, and each face of a proposed build-up (board, waterproofing,
 * adhesive, tile).
 *
 * Every face is an offset from the wall's drawn line, perpendicular to it, positive toward the
 * named side. Sides are named as the door `side` is: walking the wall from end A to end B on
 * the plan as drawn (x right, y down), "left" is on your left.
 *
 * Unknown stays unknown. A face whose inputs are not all known is unresolved and names what is
 * missing; nothing here substitutes a default thickness or converts a surveyed surface into a
 * frame position.
 */

import type { BuildUpLayer, LayerKind, Quantity, Room, ValueStatus, Wall, WallSide, WallSideName } from "./types";
import { catalogByKind } from "./catalog";
import { quantize, segLen, type Pt } from "./geometry";
import { itemPolygon } from "./outline";

export const VALUE_STATUSES: ValueStatus[] = ["site-confirmed", "measured", "published", "proposed", "estimated"];
export const LAYER_KINDS: LayerKind[] = ["board", "waterproofing", "adhesive", "tile"];
export const LAYER_LABELS: Record<LayerKind, string> = {
  board: "Board (e.g. Villaboard)",
  waterproofing: "Waterproofing",
  adhesive: "Tile adhesive",
  tile: "Tile",
};

/** Named faces a caller can ask for, besides a layer id. */
export const FACE_NAMES = ["existing", "frame", "board", "finished"] as const;
export type FaceName = (typeof FACE_NAMES)[number];

export interface FaceInput {
  field: string;
  value: number | null;
  status: ValueStatus | "unknown";
}

export interface FaceResult {
  /** "existing" | "frame" | a layer id; aliases resolve to the layer they name. */
  face: string;
  label: string;
  /** metres from the drawn line toward the side; absent when unresolved */
  offset?: number;
  resolved: boolean;
  /** weakest status among the inputs; "unknown" when unresolved */
  basis: ValueStatus | "unknown";
  inputs: FaceInput[];
  missing: string[];
}

export const known = (q: Quantity | undefined): q is Quantity & { value: number; status: ValueStatus } =>
  !!q && typeof q.value === "number" && Number.isFinite(q.value) && !!q.status;

export const input = (field: string, q: Quantity | undefined): FaceInput =>
  known(q) ? { field, value: q.value, status: q.status } : { field, value: null, status: "unknown" };

/** Weakest status wins: a face derived from an estimate is no better than that estimate. */
export function weakest(inputs: FaceInput[]): ValueStatus | "unknown" {
  let rank = -1;
  for (const i of inputs) {
    if (i.status === "unknown") return "unknown";
    rank = Math.max(rank, VALUE_STATUSES.indexOf(i.status));
  }
  return rank < 0 ? "unknown" : VALUE_STATUSES[rank];
}

function result(face: string, label: string, inputs: FaceInput[], offset: number | undefined): FaceResult {
  const missing = inputs.filter((i) => i.status === "unknown").map((i) => i.field);
  const resolved = missing.length === 0 && offset !== undefined;
  return {
    face,
    label,
    ...(resolved ? { offset: quantize(offset!) } : {}),
    resolved,
    basis: resolved ? weakest(inputs) : "unknown",
    inputs,
    missing,
  };
}

export const layerLabel = (l: BuildUpLayer): string => l.name || LAYER_LABELS[l.kind];

/** Unit normal pointing toward the named side of the wall. */
export function sideNormal(wall: Wall, side: WallSideName): Pt {
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by) || 1;
  const dx = (wall.bx - wall.ax) / len;
  const dy = (wall.by - wall.ay) / len;
  return side === "left" ? { x: dy, y: -dx } : { x: -dy, y: dx };
}

/** The label of the room a wall side faces: the room holding a point 100 mm off the wall's midpoint. */
export function roomOnSide(wall: Wall, side: WallSideName, rooms: Room[]): string | null {
  const n = sideNormal(wall, side);
  const p = { x: (wall.ax + wall.bx) / 2 + n.x * 0.1, y: (wall.ay + wall.by) / 2 + n.y * 0.1 };
  return rooms.find((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)?.label ?? null;
}

/** Signed distance of a point from the drawn line, positive toward the side. */
export function offsetFromLine(wall: Wall, side: WallSideName, p: Pt): number {
  const n = sideNormal(wall, side);
  return (p.x - wall.ax) * n.x + (p.y - wall.ay) * n.y;
}

/** Every face of one wall side, from the existing surface through the frame and each layer's outer face. */
export function sideFaces(side: WallSide | undefined): FaceResult[] {
  const faces: FaceResult[] = [];
  faces.push(result("existing", "Existing surface", [input("existing surface position", side?.existing)], side?.existing?.value));
  const frameInput = input("frame face position", side?.frame);
  faces.push(result("frame", "Frame face", [frameInput], side?.frame?.value));
  const inputs: FaceInput[] = [frameInput];
  let offset = known(side?.frame) ? side!.frame!.value! : undefined;
  for (const layer of side?.layers ?? []) {
    const t = input(`${layerLabel(layer)} thickness`, layer.thickness);
    inputs.push(t);
    offset = offset !== undefined && t.value !== null ? offset + t.value : undefined;
    faces.push(result(layer.id, `${layerLabel(layer)} face`, [...inputs], offset));
  }
  return faces;
}

/**
 * One face by name. "board" is the outer face of the outermost board layer (the fixed
 * Villaboard face); "finished" is the outer face of the outermost layer.
 */
export function resolveFace(side: WallSide | undefined, face: string): FaceResult {
  const faces = sideFaces(side);
  const layers = side?.layers ?? [];
  let id = face;
  if (face === "board") {
    const board = [...layers].reverse().find((l) => l.kind === "board");
    if (!board) return result("board", "Board face", [{ field: "board layer (none entered on this side)", value: null, status: "unknown" }], undefined);
    id = board.id;
  } else if (face === "finished") {
    const last = layers[layers.length - 1];
    if (!last) return result("finished", "Finished face", [{ field: "build-up layers (none entered on this side)", value: null, status: "unknown" }], undefined);
    id = last.id;
  }
  const hit = faces.find((f) => f.face === id);
  if (!hit) return result(face, face, [{ field: `face "${face}" (not on this side)`, value: null, status: "unknown" }], undefined);
  if (face === "board") return { ...hit, label: `Board face (${layerLabel(layers.find((l) => l.id === id)!)})` };
  if (face === "finished") return { ...hit, label: "Finished face" };
  return hit;
}

export interface FaceDistance {
  face: FaceResult;
  /** metres from the face to the point, positive in front of the face (toward the side) */
  distance?: number;
  resolved: boolean;
}

/** Perpendicular distance from a face to a point. Unresolved when the face is. */
export function distanceToFace(wall: Wall, side: WallSideName, face: string, p: Pt): FaceDistance {
  const f = resolveFace(wall.sides?.[side], face);
  if (!f.resolved) return { face: f, resolved: false };
  return { face: f, distance: quantize(offsetFromLine(wall, side, p) - f.offset!), resolved: true };
}

/** The footprint point of an item nearest the wall on the named side. */
export function nearestFootprintPoint(wall: Wall, side: WallSideName, item: { kind: string; x: number; y: number; rotation: number }): Pt | null {
  const corners = itemPolygon(item);
  if (!corners) return null;
  return corners.reduce((best, p) => (offsetFromLine(wall, side, p) < offsetFromLine(wall, side, best) ? p : best));
}

/** Problems in one side's build-up: order, negative values, missing inputs, contradictions. */
export function sideProblems(side: WallSide): { severity: "error" | "warning"; code: string; message: string }[] {
  const out: { severity: "error" | "warning"; code: string; message: string }[] = [];
  const layers = side.layers ?? [];
  for (let i = 1; i < layers.length; i++) {
    if (LAYER_KINDS.indexOf(layers[i].kind) < LAYER_KINDS.indexOf(layers[i - 1].kind)) {
      out.push({ severity: "error", code: "wall_layer_order", message: `${layerLabel(layers[i])} sits outside ${layerLabel(layers[i - 1])}; expected board, waterproofing, adhesive, tile from the frame out.` });
    }
  }
  for (const l of layers) {
    if (known(l.thickness) && l.thickness.value < 0) {
      out.push({ severity: "error", code: "wall_layer_negative", message: `${layerLabel(l)} thickness is negative.` });
    }
  }
  const missing = [
    ...(layers.length && !known(side.frame) ? ["frame face position"] : []),
    ...layers.filter((l) => !known(l.thickness)).map((l) => `${layerLabel(l)} thickness`),
  ];
  if (missing.length) {
    out.push({ severity: "warning", code: "wall_face_unresolved", message: `Unknown: ${missing.join(", ")}. Faces beyond them stay unresolved until entered.` });
  }
  if (known(side.frame) && known(side.existing) && side.frame.value > side.existing.value + 1e-9) {
    out.push({ severity: "warning", code: "wall_frame_proud", message: "Frame face is recorded in front of the existing surface; check both positions." });
  }
  return out;
}

/**
 * The wall body's extent across its thickness for 3D, in the wall's local frame (+ toward the
 * right side). A side's body face is its frame face when known, else its existing surface;
 * a side with neither keeps the drawn thickness. Without any recorded face the body stays
 * centred on the drawn line, as before.
 */
export function wallBody(wall: Wall): { z: number; depth: number } {
  const face = (side: WallSideName): number | undefined => {
    const spec = wall.sides?.[side];
    if (!spec) return undefined;
    for (const name of ["frame", "existing"]) {
      const f = resolveFace(spec, name);
      if (f.resolved) return f.offset;
    }
    return undefined;
  };
  const right = face("right");
  const left = face("left");
  if (right === undefined && left === undefined) return { z: 0, depth: wall.thickness };
  const zMax = right ?? -left! + wall.thickness;
  const zMin = left !== undefined ? -left : zMax - wall.thickness;
  if (zMax - zMin < 0.005) return { z: 0, depth: wall.thickness };
  return { z: (zMin + zMax) / 2, depth: zMax - zMin };
}

/** Each resolved layer as a slab across the thickness: local z of its inner and outer faces (+ toward the right side). */
export function liningSlabs(wall: Wall): { side: WallSideName; layer: BuildUpLayer; z0: number; z1: number }[] {
  const out: { side: WallSideName; layer: BuildUpLayer; z0: number; z1: number }[] = [];
  for (const side of ["left", "right"] as const) {
    const spec = wall.sides?.[side];
    if (!spec) continue;
    const faces = sideFaces(spec);
    const sign = side === "right" ? 1 : -1;
    spec.layers.forEach((layer, i) => {
      const inner = faces[1 + i]; // frame, then each layer's outer face
      const outer = faces[2 + i];
      if (!inner.resolved || !outer.resolved) return;
      out.push({ side, layer, z0: sign * inner.offset!, z1: sign * outer.offset! });
    });
  }
  return out;
}
