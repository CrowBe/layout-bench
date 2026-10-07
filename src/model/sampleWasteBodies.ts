/**
 * Drain briefs for the sample bathroom wastes (#82), from the packing slip (Surreal Solutions
 * INV-211061, 24 Sep 2026) and the owner's delivery photos (5 Oct 2026). Each sample waste links
 * to one of these as a travelling snapshot, the same way the sample heating record carries its
 * carton brief; no library product is inserted.
 *
 * Lauxes Next Gen 35: 1000 × 100 × 35 mm. 35 mm is channel depth below the grate (BuildMat
 * listing: 35 mm deep × 100 mm wide), not a height above the finished floor. 100 mm is width
 * across the channel. The 50 mm outlet (WO50-BN) is the outlet, never the channel width; where it
 * sits along the tray is a project choice and is not recorded.
 * Kano 316: 120 × 120 mm tile-insert grate with a 50 mm outlet. Its dimension drawing (owner's
 * copy, 7 Oct 2026) gives a 20 mm deep tray and a Ø90 spigot 10 mm below it: 30 mm from the grate
 * top to the bottom of the spigot. That copy has no web link, so the depth is a note here and
 * the brief's installation depth stays unresolved.
 * Lauxes WO50 outlet (owner's tape, 7 Oct 2026): 35 mm from its rim to the bottom of the pipe. The
 * rim fixes under the 35 mm tray, so the outlet's bottom is about 70 mm below the grate (derived);
 * its centre below the grate is not recorded, so `outletBelowGrate` stays unknown.
 */
import { unknownMeasurementFields, type MeasurementRecord } from "./productMeasurements";
import { categoryById, type FieldValue } from "./products";
import type { WasteProductLink } from "./types";
import { DRAIN_CATEGORY } from "./wasteProduct";

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

export const SAMPLE_LAUXES_PRODUCT_ID = "sample-lauxes-next-gen-35";
export const SAMPLE_KANO_PRODUCT_ID = "sample-kano-316-insert";

const SLIP = "Photographed packing slip, Surreal Solutions INV-211061 (24 Sep 2026)";
const DATE = "2026-10-05";
const ACCEPTED_AT = Date.parse("2026-10-05T00:00:00.000Z");
const seen = (value: number | string, unit: MeasurementRecord["unit"], evidence: string, note?: string): FieldValue =>
  ({ value, status: "measured", measurement: { unit, date: DATE, evidence, recordedBy: "human" }, ...(note ? { note } : {}) });

function drainSpec(fields: Record<string, FieldValue>, manufacturer: string, model: string, productId: string): WasteProductLink {
  const blank = unknownMeasurementFields(categoryById(DRAIN_CATEGORY)!);
  for (const [k, v] of Object.entries(blank)) if (v.value === null) blank[k] = { value: null, note: "Not on the packing slip or the delivery photos." };
  return {
    productId,
    specification: { category: DRAIN_CATEGORY, recordingMode: "human-measurement", acceptedAt: ACCEPTED_AT, fields: { ...blank, ...fields }, manufacturer, model, productId },
  };
}

export const lauxesNextGen35 = (): WasteProductLink => drainSpec({
  grateLength: seen(LAUXES_NEXT_GEN_35.length, "metres", `${SLIP}: Next Gen 35 Custom 1000 × 100 × 35 mm`, "1000 mm custom cut length, end to end"),
  grateWidth: seen(LAUXES_NEXT_GEN_35.width, "metres", `${SLIP}: Next Gen 35 Custom 1000 × 100 × 35 mm`, "100 mm across the channel (BuildMat listing: 100 mm wide)"),
  installationDepth: seen(LAUXES_NEXT_GEN_35.depthBelowGrate, "metres", `${SLIP}: Next Gen 35 Custom 1000 × 100 × 35 mm`, "35 mm channel depth below the grate (BuildMat listing: 35 mm deep)"),
  outletDiameter: seen(0.05, "metres", `${SLIP}: 1× WO50-BN waste outlet`, "50 mm outlet; owner found it in the box on 5 Oct 2026"),
}, "Lauxes", "Next Gen 35 Custom 1000, brushed nickel", SAMPLE_LAUXES_PRODUCT_ID);

export const kano316Insert = (): WasteProductLink => drainSpec({
  grateType: seen("tile-insert", "choice", `${SLIP}: KANO 316 Brushed Nickel Tile Insert Waste 120×120`),
  grateLength: seen(KANO_316_INSERT.grateW, "metres", `${SLIP}: KANO 316 Tile Insert Waste 120×120`),
  grateWidth: seen(KANO_316_INSERT.grateD, "metres", `${SLIP}: KANO 316 Tile Insert Waste 120×120`),
  outletDiameter: seen(0.05, "metres", "Owner's delivery check, 5 Oct 2026: the Kano outlet is 50 mm"),
}, "Kano", "316 Tile Insert Waste 120×120, brushed nickel", SAMPLE_KANO_PRODUCT_ID);
