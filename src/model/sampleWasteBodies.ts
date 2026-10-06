/**
 * Packing-slip bodies for the sample bathroom wastes (Surreal Solutions INV-211061,
 * 24 Sep 2026). Waste records have no size fields; 3D looks them up by the sample
 * waste id so the figures live in one place.
 *
 * Lauxes Next Gen 35: 1000 × 100 × 35 mm. 35 mm is channel depth below the grate
 * (BuildMat listing: 35 mm deep × 100 mm wide), not a height above the finished
 * floor. 100 mm is width across the channel. Length is the recorded centreline.
 * Kano 316: 120 × 120 mm tile-insert grate. Body depth below the grate is not on
 * the slip.
 *
 * A size belongs to the product, not to a waste id: it is only given to a waste whose
 * id AND recorded label are the sample's own packing-slip product (and, for the channel,
 * of a kind the size fits). Any other waste, including one that merely reuses an id,
 * gets no sourced body.
 */
import type { Waste } from "./types";

/** The sample's recorded product labels, from the packing slip. */
export const LAUXES_LABEL = "Lauxes Next Gen 35 channel 1000 × 100 × 35, brushed nickel, 50 mm outlet WO50-BN";
export const KANO_LABEL = "Kano 316 tile-insert waste 120 × 120, brushed nickel, 50 mm outlet";
export const LAUXES_NEXT_GEN_35 = {
  length: 1,
  width: 0.1,
  depthBelowGrate: 0.035,
} as const;

export const KANO_316_INSERT = {
  grateW: 0.12,
  grateD: 0.12,
} as const;

type WasteRef = Pick<Waste, "id" | "label" | "kind">;

export function sampleLinearWasteBody(w: WasteRef): { width: number; depthBelowGrate: number } | undefined {
  return w.id === "linear_drain" && w.kind === "linear" && w.label === LAUXES_LABEL
    ? { width: LAUXES_NEXT_GEN_35.width, depthBelowGrate: LAUXES_NEXT_GEN_35.depthBelowGrate }
    : undefined;
}

export function samplePointWasteGrate(w: WasteRef): { w: number; d: number } | undefined {
  return w.id === "square_waste" && w.kind === "point" && w.label === KANO_LABEL
    ? { w: KANO_316_INSERT.grateW, d: KANO_316_INSERT.grateD }
    : undefined;
}
