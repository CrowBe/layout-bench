/**
 * Floor assembly and level datums (#6) — the vertical stack under a bathroom floor: the
 * stripped substrate, then waterproofing, screed, adhesive and tile.
 *
 * Levels are metres above a named datum (default: the existing floor surface, 0). The top of a
 * layer is the substrate top plus every thickness up to and including it, and exists only when
 * all of those are known. Nothing here substitutes zero or a default thickness; an unknown
 * input leaves every level above it unresolved and names what is missing.
 */

import type { FloorAssembly, FloorLayer, FloorLayerKind, ValueStatus } from "./types";
import { input, known, weakest, type FaceInput } from "./faces";
import { quantize } from "./geometry";

export const FLOOR_LAYER_KINDS: FloorLayerKind[] = ["waterproofing", "screed", "adhesive", "tile"];
export const FLOOR_LAYER_LABELS: Record<FloorLayerKind, string> = {
  waterproofing: "Waterproofing",
  screed: "Screed",
  adhesive: "Tile adhesive",
  tile: "Tile",
};
export const DEFAULT_DATUM = "existing floor surface";

/** Waterproofing and screed may sit either way round; adhesive then tile always finish the stack. */
export const FLOOR_RANK: Record<FloorLayerKind, number> = { waterproofing: 0, screed: 0, adhesive: 1, tile: 2 };

export const floorLayerLabel = (l: FloorLayer): string => l.name || FLOOR_LAYER_LABELS[l.kind];

export interface FloorLevel {
  /** "substrate" or a layer id */
  level: string;
  label: string;
  kind: "substrate" | FloorLayerKind;
  /** metres above the datum; absent when unresolved */
  top?: number;
  resolved: boolean;
  basis: ValueStatus | "unknown";
  inputs: FaceInput[];
  missing: string[];
}

function level(id: string, label: string, kind: FloorLevel["kind"], inputs: FaceInput[], top: number | undefined): FloorLevel {
  const missing = inputs.filter((i) => i.status === "unknown").map((i) => i.field);
  const resolved = missing.length === 0 && top !== undefined;
  return { level: id, label, kind, ...(resolved ? { top: quantize(top!) } : {}), resolved, basis: resolved ? weakest(inputs) : "unknown", inputs, missing };
}

/** The top of the substrate, then of each layer in turn. */
export function floorLevels(assembly: FloorAssembly | undefined): FloorLevel[] {
  const substrate = input("substrate top", assembly?.substrateTop);
  const out = [level("substrate", "Substrate top", "substrate", [substrate], assembly?.substrateTop?.value)];
  const inputs = [substrate];
  let top = known(assembly?.substrateTop) ? assembly!.substrateTop!.value : undefined;
  for (const layer of assembly?.layers ?? []) {
    const t = input(`${floorLayerLabel(layer)} thickness`, layer.thickness);
    inputs.push(t);
    top = top !== undefined && t.value !== null ? top + t.value : undefined;
    out.push(level(layer.id, `${floorLayerLabel(layer)} top`, layer.kind, [...inputs], top));
  }
  return out;
}

/** Top of the first layer of a kind, counted from the top of the stack (the finished tile, the screed). */
export function levelOfKind(assembly: FloorAssembly | undefined, kind: FloorLayerKind): FloorLevel | undefined {
  const levels = floorLevels(assembly);
  for (let i = levels.length - 1; i >= 1; i--) if (levels[i].kind === kind) return levels[i];
  return undefined;
}

/** The finished floor: top of the outermost layer, or the substrate when no layers are entered. */
export function finishedLevel(assembly: FloorAssembly | undefined): FloorLevel {
  const levels = floorLevels(assembly);
  return levels[levels.length - 1];
}

/** Problems in one room's assembly: order, negative thickness, unknown inputs. */
export function floorProblems(assembly: FloorAssembly): { severity: "error" | "warning"; code: string; message: string }[] {
  const out: { severity: "error" | "warning"; code: string; message: string }[] = [];
  const layers = assembly.layers ?? [];
  for (let i = 1; i < layers.length; i++) {
    if (FLOOR_RANK[layers[i].kind] < FLOOR_RANK[layers[i - 1].kind]) {
      out.push({ severity: "error", code: "floor_layer_order", message: `${floorLayerLabel(layers[i])} sits above ${floorLayerLabel(layers[i - 1])}; expected waterproofing and screed, then adhesive, then tile from the substrate up.` });
    }
  }
  for (const l of layers) {
    if (known(l.thickness) && l.thickness.value < 0) {
      out.push({ severity: "error", code: "floor_layer_negative", message: `${floorLayerLabel(l)} thickness is negative.` });
    }
  }
  const unresolved = floorLevels(assembly).filter((l) => !l.resolved);
  if (layers.length && unresolved.length) {
    out.push({ severity: "warning", code: "floor_level_unresolved", message: `Unknown: ${[...new Set(unresolved.flatMap((l) => l.missing))].join(", ")}. Levels above them stay unresolved until entered.` });
  }
  return out;
}
