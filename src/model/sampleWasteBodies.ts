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
 */
export const LAUXES_NEXT_GEN_35 = {
  length: 1,
  width: 0.1,
  depthBelowGrate: 0.035,
} as const;

export const KANO_316_INSERT = {
  grateW: 0.12,
  grateD: 0.12,
} as const;

export function sampleLinearWasteBody(id: string): { width: number; depthBelowGrate: number } | undefined {
  return id === "linear_drain"
    ? { width: LAUXES_NEXT_GEN_35.width, depthBelowGrate: LAUXES_NEXT_GEN_35.depthBelowGrate }
    : undefined;
}

export function samplePointWasteGrate(id: string): { w: number; d: number } | undefined {
  return id === "square_waste" ? { w: KANO_316_INSERT.grateW, d: KANO_316_INSERT.grateD } : undefined;
}
