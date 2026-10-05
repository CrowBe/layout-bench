import type { CatalogEntry } from "./catalog";
import { cornerBathOutline, type ReferenceId, type SourceRef } from "./products";
import { quantize } from "./geometry";
import { outlineExtents, type Outline } from "./outline";
import type { ExactProduct, ProductComponent } from "./productIdentity";
import type { PartSpec } from "../three/furniture";
import type { ProjectKind } from "./projects";
import type { Item, Note, PlanModel, Quantity, ValueStatus, Wall, WallSide, WallTiling } from "./types";

/**
 * A rough bathroom concept sample. Geometry and placements are illustrative, not set-out.
 * Purchased fitting sizes come from the manufacturer's own specification drawing or sheet
 * when that sheet names the exact model; a carton label; or a human measurement. Mounting
 * heights stay proposed/placeholder: the room has no wall anchors and no surveyed finished
 * faces, so #60 installation placement is not used and the catalogue `elevation` stopgap
 * remains. A value with no manufacturer sheet stays a labelled placeholder.
 */

type Item_ = Pick<Item, "id" | "kind" | "x" | "y" | "rotation"> & Partial<Pick<Item, "fittedTo">>;

const NICKEL = { color: "#b9bbbb", metalness: 0.85, roughness: 0.3 } as const;

const box = (x: number, y: number, z: number, w: number, h: number, d: number, style: Partial<PartSpec> = NICKEL): PartSpec =>
  ({ shape: "box", x, y, z, w, h, d, ...style });
const tube = (x: number, y: number, z: number, dia: number, h: number, style: Partial<PartSpec> = NICKEL): PartSpec =>
  ({ shape: "cylinder", x, y, z, w: dia, d: dia, h, ...style });

/** One recorded figure on a purchased fitting. Reuses product `SourceRef` so a sheet can carry its URL. */
export interface FittingMeasure {
  key: string;
  value: number;
  status: ValueStatus;
  sources?: SourceRef[];
  reference?: ReferenceId;
  note?: string;
}

/** Where each fitting's figures come from. "label" = printed on the carton or sticker. */
export interface PurchasedFitting {
  kind: string;
  label: string;
  /** what the photo shows; the code is the printed one, never a guess */
  product: ExactProduct;
  /** footprint w × d × h; `printed` names the ones copied from a label */
  size: { w: number; d: number; h: number; printed: ("w" | "d" | "h")[]; elevation?: number; caveat?: string };
  /** envelope, extras and mounting height, each with status and a source URL when one exists */
  measures: FittingMeasure[];
  parts: PartSpec[];
  /** real plan shape; drawn in 3D from the outline when there are no parts */
  outline?: Outline;
  /** present when the seed places it */
  placement?: Item_;
  /** further purchased units of the same fitting, placed separately */
  extra?: Item_[];
}

const sheet = (url: string, locator: string): SourceRef => ({ url, locator });
const published = (key: string, value: number, source: SourceRef, reference: ReferenceId, note?: string): FittingMeasure =>
  ({ key, value, status: "published", sources: [source], reference, ...(note ? { note } : {}) });
const proposedDim = (key: string, value: number, note: string, reference?: ReferenceId): FittingMeasure =>
  ({ key, value, status: "proposed", note, ...(reference ? { reference } : {}) });
const measuredDim = (key: string, value: number, note: string, reference: ReferenceId): FittingMeasure =>
  ({ key, value, status: "measured", note, reference });

/** A figure the captain still has to take: no manufacturer sheet, or no surveyed face for a height. */
export interface CaptainMeasurement {
  fitting: string;
  what: string;
  from: string;
}

const ENFLAIR_BATH = "https://enflair.com.au/products/angie-1000mm-corner-fit-japanese-soaking-bathtub-gloss-white";
const ENFLAIR_K1110 = "https://enflair.com.au/products/profile-iii-petite-basin-mixer-brushed-ss-nickel";
const ENFLAIR_K1132 = "https://enflair.com.au/products/profile-iii-150mm-basin-bath-wall-mixer-set-with-round-plates-brushed-ss-nickel";
const ENFLAIR_K1150 = "https://enflair.com.au/products/profile-iii-150mm-basin-bath-wall-spout-brushed-ss-nickel";
const ENFLAIR_Y1173 = "https://enflair.com.au/products/profile-round-twin-shower-system-with-adjustable-rail-and-250mm-head-brushed-nickel";
const THERMO_VS900 = "https://www.thermogroup.com.au/wp-content/uploads/2021/02/2022-VS900HBN-Specification-Sheet.pdf";
const OJ_MWD5 = "https://www.coldbuster.com.au/wp-content/uploads/2021/04/MWD5-1999-Brochure-CB.pdf";

const fitting = (m: string, code: string, label: string, notes: string, manufacturer = "", components?: ProductComponent[]): ExactProduct =>
  ({ manufacturer, model: m, code, physicalItem: { label, notes }, ...(components ? { components, componentsStatus: "documented" as const } : {}) });

/** A part of a set that was seen, or not seen, in the photos. Its code and quantity stay unknown: nothing sourced says it ships with this fitting. */
const part = (name: string, note: string): ProductComponent =>
  ({ name, code: { state: "unknown", value: null, note }, quantity: null, provision: "unresolved", note });

// ---- Bath: Angie Corner 1000, SB184-1000GW ---------------------------------------------------
// Enflair dimension drawing (SB184-1000): 1000 mm sides along the two walls, a right angle at the
// back-right (the NE corner), 1090 mm from that corner to the front of the curve along the
// bisector (section A-A), 630 mm high, 550 mm inside depth, 278 L, 36 kg net. Ø50 waste on the
// bisector, 520 mm from the corner (368 mm along each side). The drawing's 1178 and 920 widths
// are not used: their extension lines do not show which edges they measure.
// Its outline is extruded in 3D with a recessed basin, so it has no hand-built parts. The
// outline comes from the same function the product library uses for a corner bath: 1000 mm
// sides mean a 1414 mm chord across the front, and the circular front passes 1090 mm out.
const BATH_LEG = 1;
const BATH_PROJECTION = 1.09;
const BATH_WASTE_FROM_CORNER = 0.52;
const bathFields = {
  frontWidth: { value: Math.SQRT2 * BATH_LEG, status: "published" as const },
  frontProjection: { value: BATH_PROJECTION, status: "published" as const },
};

// A circular front through the sides' ends and that point runs about 18 mm past the 1000 mm
// square, so the bath's box is the curve's own extent; the sides stay 1000 mm along the walls.
const BATH_BOX = (({ maxX, minX }) => Math.ceil((maxX - minX) * 1000) / 1000)(outlineExtents(cornerBathOutline(bathFields, 10, 10, "right")!));
const bathOutline: Outline = cornerBathOutline(bathFields, BATH_BOX, BATH_BOX, "right")!;
/** The waste on the bisector, in the bath's own frame: across from its centre, out from its back. */
const bathWaste = { across: +(BATH_BOX / 2 - BATH_WASTE_FROM_CORNER / Math.SQRT2).toFixed(3), out: +(BATH_WASTE_FROM_CORNER / Math.SQRT2).toFixed(3) };
/** The square corner stays where it was drawn before: 2100 mm across, against the window wall. */
const BATH_CORNER = { x: 2.1, y: 0 };

// ---- Enflair wall set for the bath: K1132-31 outside part + K1150-31-0-150 spout ---------------
// Mixer geometry from the K1132-##-150 set drawing (mixer plate, handle and parenthetical body
// projection only; the set's 150 mm spout is the separate K1150). Spout from the K1150 drawing.
// Mounting height 800 mm is proposed: no wall anchor and no surveyed finished face (#60 unused).
const MIXER_EL = 0.8;
const MIXER_PLATE = 0.065;
const wallMixer: PartSpec[] = [
  // a cylinder's axis is vertical, so a square plate stands in for the Ø65 round trim
  box(0, MIXER_EL, -0.002, MIXER_PLATE, MIXER_PLATE, 0.004),
  box(0, MIXER_EL + MIXER_PLATE / 2 - 0.1055, 0.02, 0.01, 0.1055, 0.01), // handle Ø10, 105.5 mm down from plate centre
];
const spout: PartSpec[] = [
  box(0, MIXER_EL, -0.002, MIXER_PLATE, MIXER_PLATE, 0.004),
  box(0, MIXER_EL + MIXER_PLATE / 2 - 0.012, 0.075, 0.024, 0.024, 0.15), // Ø24 tube, 150 mm from the plate face
];

// ---- Ahrok SDP-40BN bath waste, dome pop with pull-out basket, 40 mm -------------------------
// Fitted inside the bath. The 40 mm is the connection size printed on the carton; no manufacturer
// sheet was found. The visible dome, its height and where it sits in the tub stay placeholders.
const WASTE_EL = 0.59;
const waste: PartSpec[] = [
  tube(0, WASTE_EL, 0, 0.07, 0.012),
  tube(0, WASTE_EL + 0.012, 0, 0.05, 0.008),
];

// ---- Basin: Enflair K1110-31 petite basin mixer, on the vanity top ----------------------------
const BASIN_EL = 0.85; // vanity top, owner's tape
const basinMixer: PartSpec[] = [
  tube(0, BASIN_EL, 0, 0.048, 0.0055), // flange Ø48 × 5.5 mm
  tube(0, BASIN_EL + 0.0055, 0, 0.04, 0.1425), // body Ø40, 148 mm from the deck
  box(0, BASIN_EL + 0.128, 0.05, 0.02, 0.02, 0.1), // spout Ø20
  box(0.04, BASIN_EL + 0.1, 0, 0.05, 0.012, 0.012), // lever; overall back-to-front 145 mm
];

// ---- Shower: Y1173-31-11-250 system. K1130 mixer trim was not photographed, so it is not drawn.
// Sheet: rail Ø22 × 981 mm, head Ø250 × 7 mm (53.1 with connector), arm 427 mm (datum unnamed on
// the drawing), handpiece 210.3 × Ø106. Foot 400 mm is the existing proposed placeholder; the
// real 981 mm rail therefore sits low. Do not invent a "nicer" height.
const SHOWER_FOOT = 0.4;
const SHOWER_H = 0.981;
const SHOWER_ARM = 0.427;
const shower: PartSpec[] = [
  box(0, SHOWER_FOOT, -0.185, 0.022, SHOWER_H, 0.022), // rail Ø22 × 981
  box(0, SHOWER_FOOT + SHOWER_H - 0.022, -0.185 + SHOWER_ARM / 2, 0.022, 0.022, SHOWER_ARM), // arm 427 mm
  tube(0, SHOWER_FOOT + SHOWER_H - 0.053, -0.185 + SHOWER_ARM - 0.125, 0.25, 0.053), // Ø250 head, 53.1 with connector
  box(0, SHOWER_FOOT + 0.5, -0.16, 0.055, 0.106, 0.049), // slider; 106.4 mm, 49 mm from the wall
  tube(0, SHOWER_FOOT + 0.4, -0.12, 0.106, 0.210, { color: "#2e2c2a", roughness: 0.5 }), // 3F handpiece 210.3 × Ø106
];

// ---- Thermorail VS900HBN, 12 V vertical rail, concealed wiring: 142 × 900 × 100 mm -------------
// Manufacturer sheet: tube Ø38, 780 mm mounting centres, 24 W. Carton agrees W142 × H900 × D100.
// Owner: the foot is 750 mm above the finished floor tiles (proposed, not surveyed).
const RAIL_FOOT = 0.75;
const RAIL_TUBE = 0.038;
const RAIL_Z = 0.05 - RAIL_TUBE / 2; // the upright's front at the 100 mm projection
const railBracket = (up: number): PartSpec[] => [
  tube(0, RAIL_FOOT + up - 0.025, -0.045, 0.05, 0.05, { ...NICKEL, d: 0.01 }), // wall rose
  box(0, RAIL_FOOT + up - 0.01, (-0.04 + RAIL_Z - RAIL_TUBE / 2) / 2, 0.02, 0.02, RAIL_Z - RAIL_TUBE / 2 + 0.04),
];
const rail: PartSpec[] = [
  tube(0, RAIL_FOOT, RAIL_Z, RAIL_TUBE, 0.9), // upright Ø38 × 900
  box(0, RAIL_FOOT + 0.882, RAIL_Z, 0.142, 0.019, 0.019), // crossbar, 142 mm overall
  box(-0.0625, RAIL_FOOT + 0.882, RAIL_Z, 0.017, 0.028, 0.028), box(0.0625, RAIL_FOOT + 0.882, RAIL_Z, 0.017, 0.028, 0.028), // knob ends
  // 780 mm centres: 60 mm from each end of the 900 mm tube
  ...railBracket(0.84), ...railBracket(0.06),
];

// ---- OJ Electronics MWD5-1999-CBP3 (Coldbuster 2" WiFi thermostat), flush --------------------
// Brochure lists OxD5 82×82×40, MxD5 84×84×40, MxD5-UA 115×84×40; it does not name the CBP3 cover,
// so the plate size stays a labelled placeholder. Owner: hallway wall, about 850 mm off the floor.
const THERMO_EL = 0.85;
const thermostat: PartSpec[] = [
  box(0, THERMO_EL, 0, 0.085, 0.085, 0.012, { color: "#f1f4f5", roughness: 0.4 }),
  box(0, THERMO_EL + 0.025, 0.007, 0.05, 0.035, 0.004, { color: "#1b1d1f", roughness: 0.2 }),
];

// ---- Reused vanity: 910 W × 850 H × 465 D (owner's tape) -----------------------------------
// Floor-standing, gloss white, on a plinth: two doors on the left, three drawers on the right, a
// ceramic top with an integrated rectangular basin, overflow and a single tap hole. Only the three
// overall sizes are measured; the split between the door bay and the drawer stack, the drawer
// heights, plinth and top thickness and the basin's size are read off the photos as placeholders.
// Owner: the waste and water points move about 300 mm right of where they are now, so they keep
// the same place behind the doors (bottle trap, waste through the cabinet floor, braided hoses).
const VANITY = { w: 0.91, h: 0.85, d: 0.465 };
const GLOSS = { color: "#f4f4f1", roughness: 0.25 } as const;
const GLAZE = { color: "#fbfbfa", roughness: 0.1 } as const;
const VANITY_TOP = 0.03; // placeholder: the rolled edge of the ceramic top
const PLINTH = 0.1; // placeholder
const vanityBack = -VANITY.d / 2;
/** Door bay from the left end to here (facing the vanity), drawer stack beyond: placeholders. */
const DOOR_BAY = { from: -0.445, to: 0.14 };
const front = (x0: number, x1: number, y0: number, y1: number): PartSpec => box((x0 + x1) / 2, y0, 0.2065, x1 - x0, y1 - y0, 0.018, GLOSS);
const vanity: PartSpec[] = [
  box(0, 0, vanityBack + 0.21, 0.9, PLINTH, 0.42, GLOSS), // plinth, a little behind the fronts
  box(0, PLINTH, vanityBack + 0.215, 0.9, VANITY.h - VANITY_TOP - PLINTH, 0.43, GLOSS), // carcass
  front(DOOR_BAY.from, -0.152, 0.105, 0.815), // left door
  front(-0.148, DOOR_BAY.to, 0.105, 0.815), // second door
  front(0.145, 0.445, 0.105, 0.325), // bottom drawer
  front(0.145, 0.445, 0.33, 0.55),
  front(0.145, 0.445, 0.555, 0.815), // top drawer
  box(0, VANITY.h - VANITY_TOP, 0, VANITY.w, VANITY_TOP, VANITY.d, GLAZE), // ceramic top
  box(0, VANITY.h - 0.001, 0.03, 0.47, 0.002, 0.3, { color: "#e3e7e9", roughness: 0.1 }), // basin opening (placeholder size)
  tube(0, VANITY.h, 0.03, 0.04, 0.002, NICKEL), // plug
];

// ---- Reused shaving cabinet: 750 W × 620 H × 160 D (owner's tape) ----------------------------
// Two mirror doors on concealed hinges, white carcass, two adjustable shelves; no light or
// demister seen. It screws to the wall through wall plugs and is hung last, after the tiles.
// Owner: bottom edge 1200 mm, where it is now, to clear the tap; it moves about 300 mm right
// with the vanity at the same height.
const CABINET = { w: 0.75, h: 0.62, d: 0.16, elevation: 1.2 };
const MIRROR = { color: "#c9d6dc", roughness: 0.05, metalness: 0.6 } as const;
const shavingCabinet: PartSpec[] = [
  box(0, CABINET.elevation, -0.003, CABINET.w, CABINET.h, 0.154, GLOSS), // carcass
  box(-CABINET.w / 4, CABINET.elevation, 0.077, CABINET.w / 2 - 0.003, CABINET.h, 0.006, MIRROR),
  box(CABINET.w / 4, CABINET.elevation, 0.077, CABINET.w / 2 - 0.003, CABINET.h, 0.006, MIRROR),
];

export const purchasedFittings: PurchasedFitting[] = [
  {
    kind: "bath_sb184_1000gw", label: "Corner bath",
    product: fitting("Angie Corner 1000mm Bath, GW", "SB184-1000GW", "Angie Corner 1000mm Bath, GW (SB184-1000GW)",
      "Carton label: 1 pc, 36 kg net, 46 kg gross, 1000 × 1000 × 630 mm. Enflair dimension drawing: 1000 mm sides, 1090 mm from the corner to the front of the curve, 630 mm high, 550 mm inside depth, 278 L, 36 kg net, Ø50 waste centred 520 mm from the corner, no overflow shown. The drawing notes slight variations; check the delivered bath. The drawing's 1178 and 920 widths are not used: their extension lines do not show which edges they measure."),
    size: { w: BATH_BOX, d: BATH_BOX, h: 0.63, printed: ["h"], caveat: "1000 mm sides; the box is the extent of a circular front 1090 mm from the corner" },
    measures: [
      published("side", BATH_LEG, sheet(ENFLAIR_BATH, "SB184-1000 dimension drawing: 1000 mm along each wall side"), "fixture-side", "From the right-angle corner along each wall"),
      published("frontProjection", BATH_PROJECTION, sheet(ENFLAIR_BATH, "section A-A: 1090 mm from the corner to the front of the curve"), "other", "Along the bisector, from the right-angle corner to the front of the curve"),
      published("height", 0.63, sheet(ENFLAIR_BATH, "A-A: 630 mm overall height"), "fixture-bottom"),
      published("insideDepth", 0.55, sheet(ENFLAIR_BATH, "A-A: 550 mm inside depth"), "other", "Inside water depth on section A-A"),
      published("wasteFromCorner", BATH_WASTE_FROM_CORNER, sheet(ENFLAIR_BATH, "plan: Ø50 waste 520 mm from the corner on the bisector; 368 mm along each side"), "other", "Waste centre on the bisector"),
    ],
    parts: [], outline: bathOutline, placement: { id: "bath", kind: "bath_sb184_1000gw", x: quantize(BATH_CORNER.x - BATH_BOX / 2), y: quantize(BATH_CORNER.y + BATH_BOX / 2), rotation: 0 },
  },
  {
    kind: "mixer_k1132_31", label: "Bath mixer",
    product: fitting("Profile III wall basin/bath mixer", "K1132-31", "Enflair K1132-31 outside part (K1132 inner part is the in-wall body)",
      "Label: brushed SS nickel, max static inlet pressure 500 kPa, max hot water 80°, WaterMark AS 3718:2021 WM-080082. Trim geometry from the K1132-##-150 set drawing (plate, handle, parenthetical body projection); the set's 150 mm spout is the separate K1150, not this mixer.", "Enflair",
      [part("K1132 inner part (in-wall body)", "Its carton was photographed; whether it is the body for this trim is not confirmed by a sourced sheet.")]),
    size: { w: MIXER_PLATE, d: 0.065, h: MIXER_PLATE, printed: [], elevation: MIXER_EL, caveat: "mounting height 800 mm is proposed; no surveyed wall face. Body projection 61 mm is in parentheses on the set drawing" },
    measures: [
      published("plateDiameter", 0.065, sheet(ENFLAIR_K1132, "K1132-##-150 set drawing: cover plate Ø65"), "other", "Cover plate diameter"),
      published("plateThickness", 0.004, sheet(ENFLAIR_K1132, "K1132-##-150 set drawing: plate 4 mm"), "finished-wall", "Plate thickness from the wall face of the plate"),
      published("handleDrop", 0.1055, sheet(ENFLAIR_K1132, "K1132-##-150 set drawing: handle 105.5 mm down from plate centre, Ø10"), "other", "From plate centre down to the handle end"),
      published("bodyProjection", 0.061, sheet(ENFLAIR_K1132, "K1132-##-150 set drawing: (61) in parentheses"), "finished-wall", "Sheet puts 61 mm in parentheses; from the plate face"),
      proposedDim("elevation", MIXER_EL, "Proposed 800 mm to the underside of the cover plate. No wall anchor and no surveyed finished face, so #60 installation is not used.", "finished-floor"),
    ],
    parts: wallMixer, placement: { id: "bath_mixer", kind: "mixer_k1132_31", x: 1.85, y: 0.03, rotation: 0 },
  },
  {
    kind: "spout_k1150_31_0_150", label: "Bath spout",
    product: fitting("Profile III 150mm spout for basin/bath", "K1150-31-0-150", "Enflair K1150-31-0-150 spout (304SS, brushed SS nickel)",
      "Carton label: 304 stainless steel, brushed SS nickel, 150 mm.", "Enflair"),
    size: { w: MIXER_PLATE, d: 0.15, h: MIXER_PLATE, printed: ["d"], elevation: MIXER_EL, caveat: "mounting height 800 mm is proposed; no surveyed wall face" },
    measures: [
      published("plateDiameter", 0.065, sheet(ENFLAIR_K1150, "K1150-##-0-150 drawing: cover plate Ø65"), "other", "Cover plate diameter"),
      published("plateThickness", 0.004, sheet(ENFLAIR_K1150, "K1150-##-0-150 drawing: plate 4 mm"), "finished-wall"),
      published("reach", 0.15, sheet(ENFLAIR_K1150, "K1150-##-0-150 drawing: 150 mm from the plate face to the outlet"), "finished-wall", "Reach from the plate face; also printed 150 mm on the carton"),
      published("tubeDiameter", 0.024, sheet(ENFLAIR_K1150, "K1150-##-0-150 drawing: tube Ø24"), "other"),
      published("outletDrop", 0.045, sheet(ENFLAIR_K1150, "K1150-##-0-150 drawing: 45 mm drop, 15°"), "other", "Drop from the tube axis to the outlet"),
      proposedDim("elevation", MIXER_EL, "Proposed 800 mm to the underside of the cover plate. No wall anchor and no surveyed finished face, so #60 installation is not used.", "finished-floor"),
    ],
    parts: spout, placement: { id: "bath_spout", kind: "spout_k1150_31_0_150", x: 1.55, y: 0.075, rotation: 0 },
  },
  {
    kind: "waste_sdp40bn", label: "Bath waste",
    product: fitting("Dome Pop Short Bath Waste 40mm, with pull out basket", "SDP-40BN", "Ahrok SDP-40BN dome pop short bath waste, 40 mm, pull-out basket, brushed nickel",
      "Carton label: WaterMark licence WM-022812, AS 1589-2001. No manufacturer sheet found for this code.", "Ahrok"),
    size: { w: 0.07, d: 0.07, h: 0.02, printed: [], elevation: WASTE_EL, caveat: "dome size is a placeholder; 40 mm connection is from the carton; its place is the drawing's waste point" },
    measures: [
      measuredDim("connection", 0.04, "40 mm pipe connection printed on the carton (photographed). No manufacturer sheet found.", "other"),
      proposedDim("domeDiameter", 0.07, "Placeholder for the visible dome; no manufacturer sheet.", "other"),
      proposedDim("domeHeight", 0.02, "Placeholder for the dome height above the waste flange; no manufacturer sheet.", "fixture-bottom"),
      proposedDim("elevation", WASTE_EL, "Placeholder height of the dome above the finished floor, inside the bath. Measure from the bath floor / waste flange.", "finished-floor"),
    ],
    // the drawing's waste point: on the bisector, 520 mm from the corner (368 mm along each side).
    // Its hole is drawn Ø50; this waste's 40 mm is the pipe connection, so check the fit (#75).
    parts: waste, placement: { id: "bath_waste", kind: "waste_sdp40bn", x: quantize(BATH_CORNER.x - BATH_BOX / 2 + bathWaste.across), y: quantize(BATH_CORNER.y + bathWaste.out), rotation: 0, fittedTo: { hostId: "bath", ...bathWaste } },
  },
  {
    kind: "mixer_k1110_31", label: "Basin mixer",
    product: fitting("Profile III petite basin mixer", "K1110-31", "Enflair K1110-31 petite basin mixer, brushed SS nickel",
      "Label: 6 L/min WELS licence 2054 (Jina Enterprises Pty Ltd), max static inlet pressure 500 kPa, max hot water 80°, WaterMark AS 3718:2021 WM-080082.", "Enflair"),
    size: { w: 0.048, d: 0.145, h: 0.148, printed: [], elevation: BASIN_EL, caveat: "elevation is the measured vanity top (owner's tape 850 mm); mixer sizes from the K1110 drawing" },
    measures: [
      published("height", 0.148, sheet(ENFLAIR_K1110, "K1110 drawing: 148 mm from the deck/flange to the top"), "fixture-bottom", "Overall height from the deck"),
      published("flangeDiameter", 0.048, sheet(ENFLAIR_K1110, "K1110 drawing: flange Ø48"), "other"),
      published("flangeThickness", 0.0055, sheet(ENFLAIR_K1110, "K1110 drawing: flange 5.5 mm"), "fixture-bottom"),
      published("bodyDiameter", 0.04, sheet(ENFLAIR_K1110, "K1110 drawing: body Ø40"), "other"),
      published("overallDepth", 0.145, sheet(ENFLAIR_K1110, "K1110 drawing: 145 mm back-to-front"), "fixture-side"),
      published("spoutDiameter", 0.02, sheet(ENFLAIR_K1110, "K1110 drawing: spout Ø20"), "other"),
      published("basinClearance", 0.062, sheet(ENFLAIR_K1110, "K1110 drawing: 62 mm under the spout; text says 60 mm approx."), "other", "Drawing 62 mm; marketing text 60 mm approx. Drawing figure kept."),
      measuredDim("elevation", BASIN_EL, "Vanity top, owner's tape 850 mm, 5 Oct 2026.", "finished-floor"),
    ],
    parts: basinMixer, placement: { id: "basin_mixer", kind: "mixer_k1110_31", x: 2.02, y: 1.7, rotation: 270 },
  },
  {
    kind: "shower_y1173_31_11_250", label: "Shower system",
    product: fitting("Profile round twin shower system with adjustable rail", "Y1173-31-11-250", "Y1173-31-11-250 twin shower, 250 mm rain head, 3F handpiece, brushed nickel",
      "Label: 9.0 L/min WELS licence 1281 (Kaiping Huipu Shower Metalwork Industrial Co Ltd), WaterMark AS/NZS 3662 WMKT25262. Brand is not printed on the label. Envelope from the Y1173 drawing: rail 981 mm, head Ø250, arm 427 mm (datum unnamed on the sheet). The 66 mm lower-bracket offset is not added to the 427 mm arm.", "",
      [part("K1130 wall shower/bath mixer, inner part", "Its carton was photographed; the shower mixer instruction sheet shows its 45 mm and 60 mm dimensions without a clear datum."),
        part("K1130 outside part (handle trim)", "No carton for the trim was photographed; not confirmed as held. Enflair K1130-##+KDPP30 drawing (Ø95 plate, 107 mm handle, 103 mm projection) is not entered as a kind because the trim was not seen.")]),
    size: { w: 0.25, d: SHOWER_ARM, h: SHOWER_H, printed: ["w"], elevation: SHOWER_FOOT, caveat: "rail foot 400 mm is the existing proposed placeholder; no surveyed wall face. Arm 427 mm datum is unnamed on the sheet" },
    measures: [
      published("headDiameter", 0.25, sheet(ENFLAIR_Y1173, "Y1173-##-11-250 drawing: rain head Ø250"), "other"),
      published("headThickness", 0.007, sheet(ENFLAIR_Y1173, "Y1173 drawing: head plate 7 mm; 53.1 mm with connector"), "other"),
      published("railHeight", SHOWER_H, sheet(ENFLAIR_Y1173, "Y1173 drawing: rail overall 981 mm"), "fixture-bottom"),
      published("railDiameter", 0.022, sheet(ENFLAIR_Y1173, "Y1173 drawing: rail Ø22"), "other"),
      published("armReach", SHOWER_ARM, sheet(ENFLAIR_Y1173, "Y1173 drawing: 427 mm along the arm and head"), "unresolved", "Sheet does not name whether 427 mm is from the wall face or from the riser; kept as written, not used as set-out from a named face"),
      published("handpieceLength", 0.2103, sheet(ENFLAIR_Y1173, "Y1173 drawing B: handpiece 210.3 mm"), "fixture-bottom"),
      published("handpieceDiameter", 0.106, sheet(ENFLAIR_Y1173, "Y1173 drawing B: handpiece Ø106"), "other"),
      published("lowerBracket", 0.066, sheet(ENFLAIR_Y1173, "Y1173 drawing: lower bracket 66 mm, plate 10 mm, rose Ø55"), "unresolved", "Offset of the lower bracket; not added to the 427 mm arm for the envelope"),
      proposedDim("elevation", SHOWER_FOOT, "Proposed 400 mm to the rail foot (the existing placeholder). No wall anchor and no surveyed finished face. The 981 mm product therefore sits low; that height is not replaced with a guessed rain-head height.", "finished-floor"),
    ],
    parts: shower, placement: { id: "shower_system", kind: "shower_y1173_31_11_250", x: 0.2, y: 0.6, rotation: 90 },
  },
  {
    kind: "towel_rail_vs900hbn", label: "Towel rail",
    product: fitting("VS900HBN", "VS900HBN", "Thermorail VS900HBN, 12 V vertical rail, round, brushed nickel, concealed wiring",
      "Carton label: 142 × 900 × 100 mm. Manufacturer sheet: W142 × H900 × D100, tube Ø38, 780 mm mounting centres, 24 W (this sheet; a product page that says 22 W is not used). 12 V: a transformer came with each rail (owner); both go up in the ceiling space for access later.", "Thermorail"),
    size: { w: 0.142, d: 0.1, h: 0.9, printed: ["w", "d", "h"], elevation: RAIL_FOOT, caveat: "foot 750 mm above the floor tiles (owner, proposed); no surveyed wall face" },
    measures: [
      published("width", 0.142, sheet(THERMO_VS900, "VS900HBN specification sheet: Size W142 × H900 × D100"), "other"),
      published("depth", 0.1, sheet(THERMO_VS900, "VS900HBN specification sheet: D100"), "finished-wall"),
      published("height", 0.9, sheet(THERMO_VS900, "VS900HBN specification sheet: H900"), "fixture-bottom"),
      published("tubeDiameter", RAIL_TUBE, sheet(THERMO_VS900, "VS900HBN specification sheet: tube Ø38"), "other"),
      published("mountingCentres", 0.78, sheet(THERMO_VS900, "VS900HBN specification sheet: 780 mm between fixing centres"), "other"),
      proposedDim("elevation", RAIL_FOOT, "Owner: foot 750 mm above the finished floor tiles. Proposed, not surveyed; no wall anchor, so #60 installation is not used.", "finished-floor"),
    ],
    parts: rail, placement: { id: "towel_rail", kind: "towel_rail_vs900hbn", x: 0.05, y: 1.825, rotation: 90 },
    // the owner bought two; the second hangs beside the first on the left wall, its foot also at 750
    extra: [{ id: "towel_rail_2", kind: "towel_rail_vs900hbn", x: 0.05, y: 1.575, rotation: 90 }],
  },
  {
    kind: "thermostat_mwd5_1999_cbp3", label: "Thermostat",
    product: fitting("MWD5-1999-CBP3", "MWD5-1999-CBP3", "OJ Electronics Coldbuster 2\" WiFi thermostat, flush mount",
      "Label: incl. limitation sensor, 100–240 V AC / 16 A, 5–40 °C, housing IP21, flush mounting. The plate size is not printed. OJ Microline brochure lists OxD5 82×82×40, MxD5 84×84×40 and MxD5-UA 115×84×40 without naming the CBP3 cover, so none of those sizes is entered as this product.", "OJ Electronics"),
    size: { w: 0.085, d: 0.012, h: 0.085, printed: [], elevation: THERMO_EL, caveat: "plate size is a placeholder; CBP3 cover is not identified on the brochure. Height 850 mm is the owner's hallway proposal; this fitting is not placed in the bathroom" },
    measures: [
      proposedDim("width", 0.085, "Placeholder plate width. OJ brochure lists family sizes (OxD5 82×82×40, MxD5 84×84×40, MxD5-UA 115×84×40) without naming CBP3; none is used as this cover.", "other"),
      proposedDim("height", 0.085, "Placeholder plate height; CBP3 cover not identified on the manufacturer brochure.", "other"),
      proposedDim("projection", 0.012, "Placeholder projection of the flush plate; brochure build-in 22 mm is a family figure, not used as this cover.", "finished-wall"),
      proposedDim("elevation", THERMO_EL, "Owner: hallway wall outside the bathroom, next to the light switch, about 850 mm off the floor. Proposed, not surveyed. Not placed in this plan.", "finished-floor"),
    ],
    // owner: on the hallway wall outside the bathroom, so it is not placed in this plan
    parts: thermostat,
  },
];

/** Remaining placeholders: no manufacturer sheet, or a height with no surveyed face. */
export const stillNeedsCaptainsMeasurement: CaptainMeasurement[] = [
  { fitting: "Bath mixer K1132-31", what: "Mounting height to the underside of the cover plate", from: "finished floor tiles, on the window-wall finished (tile) face once that face is surveyed" },
  { fitting: "Bath spout K1150-31-0-150", what: "Mounting height to the underside of the cover plate", from: "finished floor tiles, on the window-wall finished (tile) face once that face is surveyed" },
  { fitting: "Shower Y1173-31-11-250", what: "Height of the rail foot (lower bracket)", from: "finished floor tiles, on the left-wall finished (tile) face once that face is surveyed" },
  { fitting: "Shower Y1173-31-11-250", what: "Reach of the rain head from the finished wall face (sheet 427 mm does not name wall vs riser)", from: "left-wall finished (tile) face, out to the front of the Ø250 head" },
  { fitting: "Towel rail VS900HBN (both)", what: "Height of the rail foot", from: "finished floor tiles, on the left-wall finished (tile) face (owner proposed 750 mm; not surveyed)" },
  { fitting: "Ahrok SDP-40BN bath waste", what: "Visible dome diameter and dome height above the waste flange", from: "the bath floor / waste flange of SB184-1000GW (no manufacturer sheet; carton names the 40 mm connection only)" },
  { fitting: "Ahrok SDP-40BN bath waste", what: "Fit of the 40 mm connection in the bath's Ø50 waste hole", from: "the Ø50 waste on the bath bisector, 520 mm from the right-angle corner" },
  { fitting: "OJ MWD5-1999-CBP3 thermostat", what: "Cover-plate width, height and projection of this exact CBP3 cover", from: "the CBP3 cover itself (brochure lists OxD5 / MxD5 / MxD5-UA sizes without naming CBP3)" },
  { fitting: "OJ MWD5-1999-CBP3 thermostat", what: "Mounting height to the plate", from: "hallway finished floor, next to the light switch (owner: about 850 mm; not surveyed)" },
  { fitting: "K1130 shower mixer outside part", what: "Confirm the trim is held, then mounting height to the cover plate", from: "finished floor tiles, on the shower-wall finished (tile) face. Not drawn: no outside part was photographed" },
  { fitting: "Bath SB184-1000GW", what: "Check the delivered bath: 1000 mm wall sides, 1090 mm corner-to-front, 630 mm height, waste 520 mm from the corner", from: "the two wall sides and the right-angle corner (sheet notes slight variations)" },
  { fitting: "Room walls", what: "Survey finished wall faces (or confirm the frame after strip-out) so #60 installation can replace the catalogue elevation stopgap", from: "each room-facing wall: existing surface is measured; finished face is still estimated from the frame plus proposed layers" },
];

// ---- Construction spec from the owner ------------------------------------------------------
// Survey (#1): existing internal surfaces 2110 × 3020 mm, measured. Each wall's drawn line sits
// 50 mm behind its existing surface. The frame is about 45 mm behind the surface where it was
// seen once: an estimate. Walls are stripped to the frame and lined with 6 mm Villaboard.
// No wall membrane is recorded: the owner named waterproofing under the screed only.
const SURVEY = "owner survey (#1): existing internal surfaces 2110 × 3020 mm";
const OWNER = "owner's tile and build-up choices";
const proposed = (value: number, source = OWNER): Quantity => ({ value, status: "proposed", source });
/** Thicknesses nobody has supplied yet: recorded as unknown, never filled in. */
const unknown = (): Quantity => ({});
/** Porcelain, 10 mm by the owner's reckoning; to be checked against the tiles. */
const TILE: Quantity = { value: 0.01, status: "estimated", source: "owner: 10 mm porcelain, to be checked" };
/** The tiler chooses the bed; 4 mm is the owner's figure ("glue probably 4mm"). */
const ADHESIVE: Quantity = { value: 0.004, status: "estimated", source: "owner: \"glue probably 4mm\"; the tiler's choice" };
const WHITE = "600 × 600 white gloss, a few light grey streaks (Tile Wizards 'Ice' TWJ-14, porcelain)";
const BEIGE = "300 × 600 sandy beige matte (Tile Wizards porcelain, colour 'Beige'; code not legible in the photo)";
const JOINT = proposed(0.004, "owner: \"glue probably 4mm gaps\", read as the joint between tiles; adhesive bed thickness not given");
/** Four full 600 mm courses and the three joints between them, from the finished floor. */
/** A thin joint of silicone or tile adhesive under the bottom course; its width is not given, so 4 mm (as the tile joints) is an estimate. */
const BASE_JOINT: Quantity = { value: 0.004, status: "estimated", source: "owner: a thin joint of silicone or tile glue at the floor; 4 mm assumed, the same as the tile joints" };
/** Four full 600 mm courses above that joint, with the three joints between them. */
const FOUR_COURSES: Quantity = { value: 0.004 + 4 * 0.6 + 3 * 0.004, status: "estimated", source: "owner: four full 600 mm courses on the base joint; the rest of the height gets a timber trim later" };
/**
 * Full tiles start at the door end so the cuts land away from the door: the side walls from
 * their door-wall corner, the door wall from the door's jamb toward the far corner, and the
 * window wall from the corner nearer the door (the door sits by the left wall), in line with
 * the floor's columns. Runs are cut to the tile faces of the walls they meet.
 */
const START: Record<string, Pick<WallTiling, "reference" | "originFrom" | "originOpening" | "originAlong">> = {
  wall_w: { reference: "finished", originFrom: "a", originAlong: proposed(0, "owner: start near the door with full tiles") },
  wall_e: { reference: "finished", originFrom: "b", originAlong: proposed(0, "owner: start near the door with full tiles") },
  wall_s: { reference: "finished", originFrom: "jamb-a", originOpening: "door_s", originAlong: proposed(0, "owner: start near the door with full tiles") },
  wall_n: { reference: "finished", originFrom: "a", originAlong: proposed(0, "owner: start near the door with full tiles; columns in line with the floor") },
};

const side = (wall: string, tile: string): WallSide => ({
  existing: { value: 0.05, status: "measured", source: SURVEY },
  frame: { value: 0.005, status: "estimated", source: "surface-to-frame about 45 mm, seen in one place (#1); owner: guess the framing until demolition" },
  layers: [
    { id: `${wall}_board`, kind: "board", name: "Villaboard 6 mm", thickness: proposed(0.006) },
    { id: `${wall}_adhesive`, kind: "adhesive", name: "Tile adhesive (tiler's)", thickness: ADHESIVE },
    { id: `${wall}_tile`, kind: "tile", name: tile, thickness: TILE },
  ],
});
/** Four full 600 mm courses on every wall, starting from the door end. */
const courses = (wall: string, tile: "white" | "beige"): WallTiling => tile === "white"
  ? { tileLength: proposed(0.6), tileWidth: proposed(0.6), orientation: "landscape", joint: JOINT, floor: "finished", originUp: BASE_JOINT, tiledHeight: FOUR_COURSES, ...START[wall], note: `${WHITE}. Four full courses; full tiles start at the door end; timber trim above, later.` }
  : { tileLength: proposed(0.6), tileWidth: proposed(0.3), orientation: "portrait", joint: JOINT, floor: "finished", originUp: BASE_JOINT, tiledHeight: FOUR_COURSES, ...START[wall], note: `${BEIGE}, the floor tile carried up the whole window wall from the floor, around the window frame, to the top of the fourth course: 600 mm edge vertical so its courses match the 600 mm courses on the other walls. Timber trim above, later.` };
const wall = (id: string, ax: number, ay: number, bx: number, by: number, tile: "white" | "beige"): Wall => ({
  // owner: about 2700 mm from the current floor to the cornice (about 2850 from the slab once stripped)
  id, ax, ay, bx, by, thickness: 0.1, height: 2.7,
  sides: { right: side(id, tile === "white" ? WHITE : BEIGE) }, tiling: { right: courses(id, tile) },
});

// ---- Reused toilet suite with Spalet E-bidet seat ------------------------------------------
// Owner: Reece listing 9509830 (Reece's product code, not the maker's). Spec (25 Aug): cistern
// 385 wide × 165 deep, centred; overall projection just under 700 mm; seat about 480 mm wide;
// markings from the unit: cistern TF-4325, WaterMark AS 1172.2 / WMK A21024, 4.5 L flush.
const toiletSuite: ExactProduct = {
  manufacturer: "American Standard",
  model: "Cygnet Square Hygiene Rim close coupled back-to-wall toilet suite, bottom inlet, with Spalet E-bidet seat",
  code: "9509830",
  physicalItem: {
    label: "American Standard Cygnet Square back-to-wall suite with Spalet E-bidet seat (reused)",
    notes: "Reece product code 9509830, from the owner's screenshot of the listing. Spalet seat label (photographed 5 Oct 2026): American Standard Spalet E-Bidet, full function with deodoriser, model type CEAS7SS1-0100510R0, product number SAR1101330, 230 V 50 Hz, rated 300 W, water pressure 0.06–0.75 MPa, IPX4, WaterMark WMTS-051 WM-022901. The workbook's 1800 W (from the installation sheet) is the figure to size the GPO circuit until the electrician says otherwise. Markings recorded from the pan and cistern: cistern TF-4325 (a model candidate), WaterMark AS 1172.2 / WMK A21024, 4.5 L. Spec: cistern 385 × 165 mm, centred; projection just under 700 mm; seat footprint about 480 mm wide. Workbook: seat 1800 W on a ~1.7 m cord; G1/2 water point with an isolating stop tap on the left facing the pan. Pan waste set-out not recorded.",
  },
};

const reusedVanity: ExactProduct = {
  manufacturer: "", model: "",
  physicalItem: {
    label: "Gloss white floor-standing vanity, ceramic top with integrated basin (reused)",
    notes: "Owner's tape, 5 Oct 2026: 910 W × 850 H × 465 D overall. Photographed: two doors on the left and a stack of three drawers on the right (facing it), on a plinth; ceramic top with a rectangular integrated basin, overflow and one tap hole; one fixed shelf in the door bay, cut round the waste. Existing plumbing: a white plastic bottle trap behind the doors with its waste going down through the cabinet floor, and braided flexible hoses to the mixer. Maker and model not recorded. The door-bay width, drawer heights, plinth height, top thickness and basin size in the model are read off the photos, not measured.",
  },
};

const reusedCabinet: ExactProduct = {
  manufacturer: "", model: "",
  physicalItem: {
    label: "Two-door mirror shaving cabinet (reused)",
    notes: "Owner's tape, 5 Oct 2026: 750 W × 620 H × 160 D. Photographed: two mirror doors on concealed hinges, white carcass, two adjustable shelves and the base; no light or demister seen, so no power drawn for it. Fixing: screws through the back into wall plugs; hung last, once everything else is fitted. Bottom edge 1200 mm (owner, as now, to clear the tap). Maker and model not recorded.",
  },
};

export const seedBathroom = (): PlanModel => ({
  name: "Bathroom Concept",
  walls: [
    wall("wall_n", -0.05, -0.05, 2.16, -0.05, "beige"), // window wall
    wall("wall_e", 2.16, -0.05, 2.16, 3.07, "white"),
    wall("wall_s", 2.16, 3.07, -0.05, 3.07, "white"), // door wall
    wall("wall_w", -0.05, 3.07, -0.05, -0.05, "white"),
  ],
  openings: [
    // Replacement bought from Stock Windows & Doors: custom double-glazed sliding window, 1810 W x
    // 600 H unit size, white translucent laminated glass, White Pearl frame, right-hand opening from
    // outside (sash on the left from inside), flyscreen, no reveals. Centred, as the old window was;
    // the sill stays 1520 above the existing floor (#1), the old frame's 640 height packed down at
    // the head. The framed opening and the clear glass size are not measured. The old window's clear
    // width was 1755.
    { id: "window_n", kind: "window", wallId: "wall_n", t: 0.5, width: 1.81, sill: 1.52, height: 0.6 },
    // 800 jamb to jamb, one jamb 120 mm from the left wall (#1)
    { id: "door_s", kind: "door", wallId: "wall_s", t: 1.64 / 2.21, width: 0.8, sill: 0, height: 1.9, hinge: "b", side: "left" },
  ],
  rooms: [{
    id: "bathroom", x: 0, y: 0, w: 2.11, h: 3.02, label: "Bathroom", floor: "tile",
    // stripped back to the concrete slab; membrane on it, the heating cable on that, then the tiler's
    // own screed and adhesive up to the target. Only the target is ours to set.
    floorBuildUp: {
      datum: "existing floor surface (current tile top)", substrate: "concrete slab, framed in place (house on piers)",
      substrateTop: { value: -0.12, status: "estimated", source: "owner: about 120 mm below the current tile, seen from underneath; confirm after demolition" },
      finishedTarget: { value: 0, status: "proposed", source: "finished tile back at the current tile level, so the doorway stays flush (to confirm)" },
      layers: [
        { id: "floor_membrane", kind: "waterproofing", name: "Waterproofing on the slab", thickness: unknown() },
        { id: "floor_screed", kind: "screed", name: "Tiler's screed (heating cable inside)", thickness: unknown() },
        { id: "floor_adhesive", kind: "adhesive", name: "Tiler's adhesive", thickness: unknown() },
        { id: "floor_tile", kind: "tile", name: BEIGE, thickness: TILE },
      ],
    },
    // Owner's drains, from the packing slip (Surreal Solutions INV-211061): a Lauxes Next Gen 35
    // channel, 1000 × 100 × 35 mm custom length, with end cap EC35-BN and 50 mm outlet WO50-BN, along
    // the left wall beneath the shower head, a small distance off it, centred on the 1200 mm shower;
    // and a Kano 316 120 × 120 tile-insert waste centred in the dry area.
    // Positions are proposals; falls and waste levels are not chosen, so the planes stay unresolved.
    drainage: {
      wastes: [
        { id: "linear_drain", label: "Lauxes Next Gen 35 channel 1000 × 100 × 35, brushed nickel, 50 mm outlet WO50-BN", kind: "linear", ax: 0.05, ay: 0.1, bx: 0.05, by: 1.1 },
        { id: "square_waste", label: "Kano 316 tile-insert waste 120 × 120, brushed nickel, 50 mm outlet", kind: "point", ax: 1.055, ay: 2.11, bx: 1.055, by: 2.11 },
      ],
      planes: [
        { id: "shower", label: "Shower", x: 0, y: 0, w: 0.9, h: 1.2, wasteId: "linear_drain", controls: [] },
        { id: "bath_side", label: "Beside the shower (under the bath)", x: 0.9, y: 0, w: 1.21, h: 1.2, wasteId: "square_waste", controls: [] },
        { id: "dry", label: "Dry area", x: 0, y: 1.2, w: 2.11, h: 1.82, wasteId: "square_waste", controls: [] },
      ],
    },
    // long side runs toward the window wall, then carries on up it
    // full tiles at the doorway (south) and along the left wall the door sits beside; the cut row lands at the window wall
    floorTiling: {
      tileLength: proposed(0.6), tileWidth: proposed(0.3), joint: JOINT, axis: "y", zone: "room",
      originX: proposed(0, "owner: start near the door with full tiles"), originXFrom: "west",
      originY: proposed(0, "owner: start near the door with full tiles"), originYFrom: "south",
      note: `${BEIGE}. Long side runs toward the window wall and continues up it. Full tiles start at the doorway.`,
    },
    heating: {
      model: "SCK0765L", length: { value: 42.5, status: "published", source: "carton label" }, ratedOutput: { value: 765, status: "published", source: "carton label" },
      screedLayerId: "floor_screed", zoneIds: ["bathroom"], path: [], keepouts: [],
      requirements: "Owner lays it in a snaking pattern on the cured membrane, before the tiler's screed, and may run it under the shower; the electrician tests it before and after the screed and wires the thermostat. Owner, 5 Oct 2026: the cable's thermostat end is at the bathroom doorway, where the floor beyond is timber; its lead goes down through it to under the house (on piers), so it can be hooked up to the thermostat at any time; the lead is long enough. Route not drawn yet.",
    },
  }],
  items: [
    ...purchasedFittings.flatMap((f) => [f.placement, ...(f.extra ?? [])].filter((p): p is Item_ => !!p).map((p): Item => ({
      ...p, productIdentity: structuredClone(f.product), selectionStatus: "purchased",
    }))),
    // back to the right wall's finished face, centred 1700 mm from the window wall (proposed)
    { id: "vanity", kind: "vanity_recorded", x: 1.85, y: 1.7, rotation: 270, productIdentity: structuredClone(reusedVanity), selectionStatus: "reused" },
    // centred over the vanity, back to the same face; screwed up last, after the tiles
    { id: "shaving_cabinet", kind: "shaving_cabinet_recorded", x: 2.0, y: 1.7, rotation: 270, productIdentity: structuredClone(reusedCabinet), selectionStatus: "reused" },
    { id: "toilet", kind: "toilet_proxy", x: 1.7, y: 2.6, rotation: 270, productIdentity: structuredClone(toiletSuite), selectionStatus: "reused" },
    { id: "screen", kind: "screen_proposed", x: 0.45, y: 1.2, rotation: 0 },
  ],
  underlay: null,
});

export const bathroomKinds: ProjectKind[] = [
  ...purchasedFittings.map((f): ProjectKind => ({
    entry: {
      kind: f.kind, label: f.label, w: f.size.w, d: f.size.d, h: f.size.h, color: "#b9bbbb", category: "bath",
      ...(f.size.elevation ? { elevation: f.size.elevation } : {}),
      ...(f.outline ? { outline: structuredClone(f.outline) } : {}),
    } satisfies CatalogEntry,
    ...(f.parts.length ? { parts: structuredClone(f.parts) } : {}),
  })),
  { entry: { kind: "vanity_recorded", label: "Vanity", w: VANITY.w, d: VANITY.d, h: VANITY.h, color: "#f4f4f1", category: "bath" }, parts: structuredClone(vanity) },
  { entry: { kind: "shaving_cabinet_recorded", label: "Shaving cabinet", w: CABINET.w, d: CABINET.d, h: CABINET.h, elevation: CABINET.elevation, color: "#c9d6dc", category: "bath" }, parts: structuredClone(shavingCabinet) },
  { entry: { kind: "toilet_proxy", label: "Toilet", w: 0.48, d: 0.7, h: 0.8, color: "#e2ded4", category: "bath" } },
  // owner: fixed glass panel 900 wide × 2000 high, 1200 mm from the window wall (face not stated);
  // workbook: 10 mm clear toughened, stainless wall channel and brace bar
  { entry: { kind: "screen_proposed", label: "Fixed glass screen", w: 0.9, d: 0.01, h: 2, color: "#77b8d6", category: "bath" } },
];

export const bathroomNotes = (): Note[] => {
  const at = Date.now();
  return [
    { id: "note-concept", author: "human", text: "Approximate concept sample for exploring a bathroom layout. Dimensions and geometry have been simplified for this editor.", at },
    { id: "note-placeholders", author: "human", text: "Wall sizes, opening details, fixture positions, and clearances include placeholders or proposals. Confirm them before relying on the plan.", at: at + 1 },
    { id: "note-limits", author: "human", text: "This sample is not measured set-out or a trade drawing. Drainage, services and falls are not represented; construction layers are recorded with their unknown thicknesses left unknown.", at: at + 2 },
    {
      id: "note-purchased", author: "agent", at: at + 3,
      text: "Purchased fittings, from photographed labels and the manufacturer's own specification drawing or sheet for the exact model: bath SB184-1000GW (Enflair drawing: 1000 mm sides, curved front 1090 mm from the corner, 630 mm high, waste 520 mm from the corner); Enflair K1132-31 trim (set drawing: plate Ø65 × 4 mm, handle 105.5 mm, body (61) mm) with K1132 inner part, K1150-31-0-150 spout (drawing: plate Ø65, 150 mm from the plate face, Ø24, 45 mm drop); Enflair K1110-31 basin mixer (drawing: 148 mm high, flange Ø48 × 5.5, overall 145 mm, spout Ø20); Enflair K1130 shower/bath mixer inner part (outside part not photographed, not drawn); Y1173-31-11-250 shower (drawing: rail 981 mm Ø22, head Ø250, arm 427 mm with unnamed datum, handpiece 210.3 × Ø106); Ahrok SDP-40BN 40 mm bath waste (carton only; no manufacturer sheet); two Thermorail VS900HBN 142 × 900 × 100 mm, tube Ø38, 780 mm centres, 24 W (Thermogroup sheet; feet 750 mm above the floor tiles, owner, proposed); OJ MWD5-1999-CBP3 thermostat (brochure does not name the CBP3 cover; plate size stays a placeholder). Wall-fitting mounting heights stay proposed: the room has no wall anchors and no surveyed finished faces, so #60 installation is not used and the catalogue elevation stopgap remains. Remaining placeholders are listed as stillNeedsCaptainsMeasurement.",
    },
    {
      id: "note-sequence", author: "human", at: at + 6,
      text: "Construction order: (1) remove the asbestos wall sheeting first (under the 10 m² homeowner limit: whole, wetted, bagged, no power tools), clean up, then strip the walls to the timber frame and the floor right back to the concrete slab (about 120 mm below the current tile); (2) plumbing and electrical rough-in, with both drains' puddle flanges set and a frame piece behind the shaving cabinet's marked hanging plate if there is none, and 6 mm Villaboard lined behind it wall by wall; (3) waterproofing on the slab and walls, then cure; (4) the heating cable, laid by the owner in a snaking pattern and tested by the electrician before the screed; (5) the tiler's own screed and falls, then adhesive and tiles; (6) fit-out, with the reused vanity back in and the shaving cabinet screwed to the wall through wall plugs last (bottom edge 1200 mm), once everything else is fitted. A thin timber trim panel goes above the tiles later.",
    },
    {
      id: "note-tiles", author: "human", at: at + 7,
      text: "Tiles (owner, 5 Oct 2026): beige 300 × 600 sandy matte on the whole floor, and on the whole window wall from the floor up, around the window frame, to the top of the fourth course, with the 600 mm edge vertical so its courses match the other walls; on the floor the long side runs toward the window wall. The left, right and door walls are 600 × 600 white gloss with a few light grey streaks. Every wall gets four full 600 mm courses on a thin joint of silicone or tile glue at the floor (about 2416 mm in all with 4 mm joints); the rest of the height is a timber trim, later. Joints about 4 mm. To keep cuts down, full tiles start at the door: at the doorway on the floor, at the door-wall corner on the side walls, at the door's jamb on the door wall, and at the corner nearer the door on the window wall.",
    },
    {
      id: "note-tiles-open", author: "agent", at: at + 8,
      text: "Still to confirm: the slab level after demolition (about 120 mm below the current tile, estimated); the finished-level target (set to the current tile level); the tile thickness (10 mm porcelain, estimated); the tiler's wall adhesive bed (4 mm, estimated); the frame positions (estimated); the width of the silicone or glue joint under the bottom course (4 mm assumed); the wall height (about 2700 mm from the current floor to the cornice, owner's estimate; about 2850 mm from the slab after stripping, which would put the slab nearer 150 mm down than 120 mm). Four courses reach about 2416 mm above the finished floor, leaving about 284 mm to the cornice for the timber trim. No wall membrane is recorded: only the floor was named.",
    },
    {
      id: "note-drains", author: "human", at: at + 9,
      text: "Drains (bought from Surreal Solutions, packing slip INV-211061, 24 Sep 2026): Lauxes Aluminium Brushed Nickel Next Gen 35 Custom, 1000 × 100 × 35 mm, with 1× EC35-BN and 1× WO50-BN, along the left wall of the shower opposite the bath and beneath the shower head, a small distance off the wall and centred on the shower; and a KANO 316 Brushed Nickel Tile Insert Waste 120×120, centred in the dry area (surrealsolutions.com.au/shop/kano-316-brushed-nickel-tile-insert-smart-waste/). Owner, 5 Oct 2026: delivered (channel, grate, end cap, Kano insert waste and packing slip photographed); both outlet pieces found in the boxes; the Kano outlet is 50 mm. BuildMat's Next Gen 35 listing: 35 mm deep × 100 mm wide, the waste outlet can be positioned anywhere along the bottom tray, and 1.0/1.6/2.0 m cut lengths come with a pair of thin end caps and one waste outlet (40, 50, 72 or 80 mm).",
    },
    {
      id: "note-drains-open", author: "agent", at: at + 10,
      text: "Drains, still open: the gap from the left wall (recorded as the channel centreline about 75 mm in front of the estimated finished wall face, so its 100 mm body stands about 25 mm off the tile); where the 50 mm outlet sits along the channel (it can go anywhere; set it with the plumber's pipe run); the puddle flanges for the two 50 mm outlets, which neither item includes (usually the plumber's, to confirm); the falls in the shower and dry area and the finished level at each drain (none recorded, so the fall planes stay unresolved and the finished floor is the flat target). The product sheets could not be read from here; sizes come from the owner.",
    },
    {
      id: "note-screen", author: "human", at: at + 5,
      text: "Shower screen: fixed glass panel, 900 mm wide × 2000 mm high (owner, 5 Oct 2026; an earlier note said 2100), set 1200 mm from the window wall. Workbook: 10 mm clear toughened, stainless wall channel and brace bar (an earlier note said black clips). Which face the 1200 mm is measured to and where the brace bar fixes are not recorded.",
    },
    {
      id: "note-vanity", author: "human", at: at + 11,
      text: "Reused vanity and shaving cabinet (owner's tape and photos, 5 Oct 2026). Vanity 910 W × 850 H × 465 D: gloss white, floor-standing on a plinth, two doors on the left and three drawers on the right facing it, ceramic top with an integrated rectangular basin and one tap hole. Inside, a bottle trap behind the doors drops through the cabinet floor, and braided hoses run to the mixer. Shaving cabinet 750 W × 620 H × 160 D: two mirror doors, white carcass, two adjustable shelves, no light; it screws to the wall through wall plugs and goes up last. The only power point in the room now is a double GPO on the wall just right of the basin, a little above the vanity top. Owner, 5 Oct 2026: the vanity set-up moves about 300 mm to the right (facing it) and otherwise stays as it is: the waste and water points move about 300 mm right of where they are now, so the trap and hoses keep the same place behind the doors and the waste still goes down through the cabinet floor; the shaving cabinet moves the same 300 mm at the same height, its bottom edge 1200 mm to clear the tap; the GPO moves the same 300 mm right at its present height, so it is near both the vanity and the bidet seat. The owner will mark where the cabinet's hanging plate goes, and a frame piece goes in behind it if there is none.",
    },
    {
      id: "note-vanity-open", author: "agent", at: at + 12,
      text: "Vanity and cabinet, still open: (1) the present positions of the waste, water points, cabinet and GPO are not measured, so the 300 mm moves are recorded as notes, not drawn; the plan's vanity, 1700 mm from the window wall to its centre, is a proposal and has not been checked against the old position plus 300 mm. Measure them before strip-out so the plumber and electrician can set them out. (2) The frame piece behind the cabinet's hanging plate goes in before the Villaboard, once the plate's position is marked. (3) The electrician confirms the moved GPO and the bidet seat's supply (the workbook's 1800 W sizes the circuit). The door bay, drawer, plinth, top and basin sizes in the 3D model are read off the photos, not measured.",
    },
    {
      id: "note-purchased-open", author: "agent", at: at + 4,
      text: "Open points from the labels and sheets: (1) the K1130 shower/bath mixer photo is its inner part only; no outside part (handle trim) was seen, so none is drawn. The K1130-##+KDPP30 drawing (Ø95 plate, 107 mm handle, 103 mm projection) is not entered as a kind. (2) K1130 and K1132 labels say max 500 kPa and 80 °C; the shower mixer instruction sheet says 0.05–1 MPa and 0–75 °C. Treat the lower figures as the limit until the supplier confirms. (3) The sheet's 45 mm and 60 mm dimensions have no clear datum; they are not entered as a rough-in depth. (4) VS900HBN is 12 V; each rail came with its own transformer, and both go up in the ceiling space for access (owner, 5 Oct 2026); each rail's concealed 12 V lead runs up inside the wall to its transformer, and the electrician wires the mains side. (5) The thermostat (IP21) goes outside the bathroom on the hallway wall, next to the light switch, which is on the right as you look into the bathroom, about 850 mm off the floor (owner, 5 Oct 2026); it is not drawn here; its CBP3 cover size is not on the OJ brochure. (6) Heating cable SCK0765L: 765 W at 18 W/m, 42.5 m, 240 V AC 3.2 A, 75.3 Ω, for 3.7–5.1 m² (about 87–120 mm spacing); the cable cannot be shortened. Owner, 5 Oct 2026: the electrician says the cable can run under the shower as needed to use its length. No route is drawn; use the heating tools for that. (7) Wall-fitting heights stay proposed until finished faces are surveyed; #60 installation is not applied. Remaining placeholders: stillNeedsCaptainsMeasurement.",
    },
  ];
};
