import type { CatalogEntry } from "./catalog";
import { categoryById, cornerBathOutline, type FieldValue, type ReferenceId, type SourceRef } from "./products";
import { formatMm, quantize } from "./geometry";
import { outlineExtents, type Outline } from "./outline";
import type { ExactProduct, ProductComponent } from "./productIdentity";
import { unknownMeasurementFields, CARTON_LABEL_SOURCE, type MeasurementRecord, type ProductSpecification } from "./productMeasurements";
import type { PartSpec } from "../three/furniture";
import type { ProjectKind } from "./projects";
import type { Heating, Item, Note, PlanModel, Quantity, ValueStatus, Wall, WallSide, WallTiling } from "./types";
import { cornerBisectorToHostFrame } from "./fittedWaste";
import { KANO_316_INSERT, KANO_LABEL, LAUXES_LABEL, LAUXES_NEXT_GEN_35, kano316Insert, lauxesNextGen35 } from "./sampleWasteBodies";

/**
 * A rough bathroom concept sample. Geometry and placements are illustrative, not set-out.
 * Purchased fitting sizes come from the manufacturer's own specification drawing or sheet
 * when that sheet names the exact model; a carton label; or a human measurement. Only the
 * towel-rail foot (750 mm), thermostat (1000 mm), bath set plate centre (750 mm), shower lower
 * bracket (1200 mm) and shower mixer plate centre (1000 mm) have an owner proposal behind them;
 * the basin-mixer deck 850 mm stays an unsourced placeholder (value null on the measure; the
 * drawn stand-in lives only on the kind's size and elevation). The room
 * has no wall anchors and no surveyed finished faces, so #60 installation placement is not
 * used and the catalogue `elevation` stopgap remains. A value with no manufacturer sheet
 * stays a labelled placeholder.
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
  /** Null plus a note is the repo convention for an unsourced figure; never a made-up number with status `proposed`. */
  value: number | null;
  status?: ValueStatus;
  sources?: SourceRef[];
  /** Carton/label figures use a string source, matching Quantity (e.g. SCK0765L `carton label`). */
  source?: string;
  /** Human evidence for a photographed carton or label (FieldValue `measurement`). */
  measurement?: MeasurementRecord;
  reference?: ReferenceId;
  note?: string;
}

/** Where each fitting's figures come from. "label" = printed on the carton or sticker. */
export interface PurchasedFitting {
  kind: string;
  label: string;
  /** product-brief category so measures round-trip on `item.productSpecification` */
  specCategory: string;
  /** what the photo shows; the code is the printed one, never a guess */
  product: ExactProduct;
  /** footprint w × d × h; `printed` names the ones copied from a label */
  size: { w: number; d: number; h: number; printed: ("w" | "d" | "h")[]; elevation?: number; elevationNote?: string; caveat?: string };
  /** envelope, extras and mounting height, each with status and a source URL when one exists */
  measures: FittingMeasure[];
  /** Canonical brief fields only. Project mounting heights and non-brief extras stay on `measures`. */
  specFields: Record<string, FieldValue>;
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
/** Carton/label print recorded as published with a string source, not a human MeasurementRecord. */
const publishedLabel = (key: string, value: number, source: string, reference: ReferenceId, note?: string): FittingMeasure =>
  ({ key, value, status: "published", source, reference, ...(note ? { note } : {}) });
const proposedDim = (key: string, value: number, note: string, reference?: ReferenceId): FittingMeasure =>
  ({ key, value, status: "proposed", note, ...(reference ? { reference } : {}) });
/** Unsourced figure: value stays null so the stage view prints the note, not a made-up number. */
const unsourced = (key: string, note: string, reference?: ReferenceId): FittingMeasure =>
  ({ key, value: null, note, ...(reference ? { reference } : {}) });

const LABEL_DATE = "2026-10-05";
const SPEC_ACCEPTED_AT = Date.parse("2026-10-05T00:00:00.000Z");
const pubLen = (value: number, source: SourceRef, reference: ReferenceId, note?: string): FieldValue =>
  ({ value, status: "published", sources: [source], reference, ...(note ? { note } : {}) });
const pubVal = (value: string, source: SourceRef, note?: string): FieldValue =>
  ({ value, status: "published", sources: [source], ...(note ? { note } : {}) });
const measuredQty = (value: number, unit: string, evidence: string, note?: string): FieldValue =>
  ({ value, status: "measured", measurement: { unit, date: LABEL_DATE, evidence, recordedBy: "human" }, ...(note ? { note } : {}) });
const measuredField = (value: string | number, unit: MeasurementRecord["unit"], evidence: string, note?: string): FieldValue =>
  ({ value, status: "measured", measurement: { unit, date: LABEL_DATE, evidence, recordedBy: "human" }, ...(note ? { note } : {}) });

export const specOf = (f: PurchasedFitting): ProductSpecification => {
  const cat = categoryById(f.specCategory);
  if (!cat) return { category: f.specCategory, fields: { ...f.specFields }, acceptedAt: SPEC_ACCEPTED_AT };
  const fields = unknownMeasurementFields(cat);
  const looked = "Not entered from the cited source.";
  for (const [k, v] of Object.entries(fields)) {
    if (v.value === null) fields[k] = { value: null, note: looked };
  }
  return { category: f.specCategory, fields: { ...fields, ...f.specFields }, acceptedAt: SPEC_ACCEPTED_AT };
};

/** A figure the captain still has to take: no manufacturer sheet, or no surveyed face for a height. */
export interface CaptainMeasurement {
  fitting: string;
  what: string;
  from: string;
}

const ENFLAIR_BATH = "https://enflair.com.au/products/angie-1000mm-corner-fit-japanese-soaking-bathtub-gloss-white";
const ENFLAIR_K1110 = "https://enflair.com.au/products/profile-iii-petite-basin-mixer-brushed-ss-nickel";
const ENFLAIR_KDPP32 = "https://ats.sydney/cdn/shop/files/K1132-_-150_KDPP32-ProfileIII150mmBasin_BathWallMixerSetwithRectangularPlate-specification.jpg?v=1757294155&width=2400";
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
// bisector, 520 mm from the corner. Along each wall that is 520/√2 (derived, not a sheet
// wasteFromEnd/wasteFromSide). The drawing's 1178 and 920 widths
// are not used: their extension lines do not show which edges they measure.
// Its outline is extruded in 3D with a recessed basin, so it has no hand-built parts. The
// outline comes from the same function the product library uses for a corner bath: 1000 mm
// sides mean a 1414 mm chord across the front, and the circular front passes 1090 mm out.
const BATH_LEG = 1;
const BATH_PROJECTION = 1.09;
const BATH_WASTE_FROM_CORNER = 0.52;
const BATH_FRONT_WIDTH = quantize(Math.SQRT2 * BATH_LEG);
const bathFields = {
  frontWidth: { value: Math.SQRT2 * BATH_LEG, status: "published" as const },
  frontProjection: { value: BATH_PROJECTION, status: "published" as const },
};

// A circular front through the sides' ends and that point runs about 18 mm past the 1000 mm
// square, so the bath's box is the curve's own extent; the sides stay 1000 mm along the walls.
const BATH_BOX = (({ maxX, minX }) => Math.ceil((maxX - minX) * 1000) / 1000)(outlineExtents(cornerBathOutline(bathFields, 10, 10, "right")!));
const bathOutline: Outline = cornerBathOutline(bathFields, BATH_BOX, BATH_BOX, "right")!;
/** Host-frame waste from the sheet's 520 mm on the bisector: along each wall = 520/√2. Quantized to the model's 0.1 mm so the sample sits on the derived host-frame point, not a 1 mm rounding of it. */
const bathWasteConverted = cornerBisectorToHostFrame(BATH_WASTE_FROM_CORNER, BATH_BOX, "right");
const bathWaste = { across: quantize(bathWasteConverted.across), out: quantize(bathWasteConverted.out) };
/** The square corner stays where it was drawn before: 2100 mm across, against the window wall. */
const BATH_CORNER = { x: 2.1, y: 0 };

// ---- Enflair bath wall set K1132-##-150+KDPP32: K1132-31 trim + K1150-31-0-150 spout ---------
// Owner, 7 Oct 2026: the set is the K1132-##-150+KDPP32, one rectangular plate shared by the
// mixer and the spout, and it moves from the window wall to the right wall (facing the window)
// so every fitting is on an internal wall. Set drawing: plate 200 × 65 × 4, spout and handle hub
// 120 mm apart on the plate's horizontal centreline, hub Ø45, Ø10 lever 107 mm from the top of
// the hub to its end, body (61) mm and spout 150 mm, both from the plate's wall-side face, Ø24.
// The 120 is centred on the plate (pixel check of the 2048 px drawing: plate 200 = 787 px, spout
// centreline 40.2 mm and hub centreline 159.8 mm from the plate's left end), so each sits 60 mm
// from the plate centre: derived, not printed. The 45 mm drop from the tube axis to the outlet
// face is not on this drawing; it is from the K1150-##-0-150 drawing of the held spout.
// Facing the wall the spout is on the left (toward the window wall), the lever on the right.
// Plate centre 750 mm above the finished floor and 500 mm from the window wall: owner, 7 Oct
// 2026, proposed, not surveyed (no wall anchor, so #60 installation is not used).
const SET_EL = 0.75; // plate centre, proposed
const SET_FROM_WINDOW = 0.5; // plate centre along the right wall from the window wall, proposed
const SET_PLATE_W = 0.2;
const SET_PLATE_H = 0.065;
const SET_PLATE_T = 0.004;
const SET_HALF_SPACING = 0.06; // 120 / 2: spout and hub each 60 mm from the plate centre (derived)
const MIXER_HUB_R = 0.0225; // Ø45 hub
const MIXER_HANDLE = 0.107; // from the top of the Ø45 hub to the lever end
const MIXER_BODY_PROJ = 0.061; // from the plate's wall-side face; includes the 4 mm plate
const SPOUT_REACH = 0.15; // wall-side of plate → outlet-face centre
const SPOUT_TUBE = 0.024;
const SPOUT_DROP = 0.045; // K1150 drawing: tube axis (plate centre) → outlet-face centre
// Envelope depth 162 mm = 150 + Ø24/2 to the outer lip (K1150 pixel check: lip ≈ 161.4 mm).
// Do not use 150 as the maximum projection.
const SPOUT_D = SPOUT_REACH + SPOUT_TUBE / 2;
const SET_WALL_Z = -SPOUT_D / 2;
/** Lever end: hub top (plate centre + 22.5) less 107 = 84.5 mm below the plate centre. */
const SET_HANDLE_BOTTOM = SET_EL + MIXER_HUB_R - MIXER_HANDLE;
const SET_ENVELOPE_H = quantize(SET_PLATE_H / 2 + (SET_EL - SET_HANDLE_BOTTOM)); // plate top to lever end
const SPOUT_OUTLET_EL = SET_EL - SPOUT_DROP; // outlet-face centre
const SET_HANDLE_Z = SET_WALL_Z + 0.05; // Ø10 lever centreline 50 mm from the plate's wall-side face (side view: 150 = 577 px, lever CL 193 px → 50.2 mm)
const SET_SPOUT_X = -SET_HALF_SPACING;
const SET_HUB_X = SET_HALF_SPACING;
const bathSet: PartSpec[] = [
  box(0, SET_EL - SET_PLATE_H / 2, SET_WALL_Z + SET_PLATE_T / 2, SET_PLATE_W, SET_PLATE_H, SET_PLATE_T), // 200 × 65 × 4 plate
  // lever hangs from the hub top down to its end
  box(SET_HUB_X, SET_HANDLE_BOTTOM, SET_HANDLE_Z, 0.01, MIXER_HANDLE, 0.01),
  // horizontal Ø24 from the plate's room-side face toward the bend
  box(SET_SPOUT_X, SET_EL - SPOUT_TUBE / 2, SET_WALL_Z + SET_PLATE_T + (SPOUT_REACH - SET_PLATE_T - SPOUT_TUBE / 2) / 2, SPOUT_TUBE, SPOUT_TUBE, SPOUT_REACH - SET_PLATE_T - SPOUT_TUBE / 2),
  // 45 mm drop from the tube axis down to the outlet-face centre, face centred on the 150 mm plane
  box(SET_SPOUT_X, SPOUT_OUTLET_EL, SET_WALL_Z + SPOUT_REACH, SPOUT_TUBE, SPOUT_DROP, SPOUT_TUBE),
];
// ---- Ahrok SDP-40BN bath waste, dome pop with pull-out basket, 40 mm -------------------------
// Fitted inside the bath. The 40 mm is the connection size printed on the carton; no manufacturer
// sheet was found. The visible dome, its height and where it sits in the tub stay placeholders.
const WASTE_EL = 0.59;
const waste: PartSpec[] = [
  tube(0, WASTE_EL, 0, 0.07, 0.012, { ...NICKEL, stopgap: true }),
  tube(0, WASTE_EL + 0.012, 0, 0.05, 0.008, { ...NICKEL, stopgap: true }),
];

// ---- Basin: Enflair K1110-31 petite basin mixer, on the vanity top ----------------------------
// Deck height 850 mm is an unsourced stand-in from the vanity's measured overall height, not a
// finished-floor tape and not an owner proposal (the finished floor does not exist yet). Drawing:
// top lever 120 mm forward from the back; overall 145 mm; spout Ø20 with 62 mm printed clearance
// to the underside of the outlet. The horizontal spout-axis height is not dimensioned on the
// sheet (not invented as 85 mm).
const BASIN_EL = 0.85;
const K1110_D = 0.145;
const K1110_BACK = -K1110_D / 2;
/** Body centreline 24 mm from the flange back: 145 starts at the Ø48 flange back; 112's left is this line (1057−898 px = 24.1 mm at 145 = 956 px). */
const K1110_BODY_Z = K1110_BACK + 0.024;
const basinMixer: PartSpec[] = [
  tube(0, BASIN_EL, K1110_BODY_Z, 0.048, 0.0055), // flange Ø48 × 5.5 mm, centred on the body
  tube(0, BASIN_EL + 0.0055, K1110_BODY_Z, 0.04, 0.1425), // body Ø40, 148 mm from the deck
  // 120 mm from the back of the square top (body back ≈ BODY_Z − 20 mm); stays on the centreline
  box(0, BASIN_EL + 0.136, K1110_BODY_Z - 0.020 + 0.06, 0.012, 0.012, 0.12),
  // spout Ø20: underside at the printed 62 mm clearance; 112 mm from the body centreline
  box(0, BASIN_EL + 0.062, K1110_BODY_Z + 0.056, 0.02, 0.02, 0.112),
];

// ---- Shower: Y1173-31-11-250 system. Its K1130 mixer trim is the separate kind below.
// Sheet: rail Ø22 × 981 mm, head Ø250 × 7 mm (53.1 with connector). 427 mm runs from the
// mounting/wall face to the rain-head connector centreline. Pixel reading of the 2048 px spec
// JPG: the 427 left extension is one continuous line at x=824 (y=130–710 and 1064–1185), also
// the wall-side face of both Ø55 roses and the left of 49, 10, 66 and 106.4. Riser left face is
// a separate line at x=864. Ø250 = 270 px (y=299, x=1150–1419) → 1.08 px/mm. 427 dim line y=132
// runs x=824–1284 (461 px ≈ 426.9 mm). From x=864 it would be 389.8 mm. 49 from x=824 to riser
// centre ≈876 is 48.4 mm. Handpiece, drawing B: 246.3 mm long, face Ø105, 45.4 mm deep.
// 106.4 mm is the holder's horizontal projection from the wall, not a height.
// Plan envelope depth is 427 + Ø250/2 = 552 mm (wall face to far edge of the head), named.
// Owner, 7 Oct 2026 (agreed default, raised from 400 so the head is not at 1.38 m): lower bracket
// centre 1200 mm above the finished floor tiles, proposed. The drawing's 500 mm bracket centres and
// 410.7 mm from the rail top to the upper rose put the lower rose 70.3 mm above the rail foot
// (981 − 410.7 − 500, derived), so the foot is 1129.7 mm and the G1/2 inlet, at the upper rose
// only, is 1700 mm.
const SHOWER_LOWER_BRACKET_EL = 1.2;
const SHOWER_H = 0.981;
const SHOWER_TOP_TO_UPPER_ROSE = 0.4107;
const SHOWER_BRACKET_CENTRES = 0.5;
const SHOWER_FOOT_TO_LOWER_ROSE = quantize(SHOWER_H - SHOWER_TOP_TO_UPPER_ROSE - SHOWER_BRACKET_CENTRES); // 0.0703, derived
const SHOWER_FOOT = quantize(SHOWER_LOWER_BRACKET_EL - SHOWER_FOOT_TO_LOWER_ROSE);
const SHOWER_INLET_EL = SHOWER_LOWER_BRACKET_EL + SHOWER_BRACKET_CENTRES;
const SHOWER_ARM = 0.427; // wall/mounting face to connector centreline
const HEAD_DIA = 0.25;
const SHOWER_ENVELOPE_D = SHOWER_ARM + HEAD_DIA / 2; // 0.552: wall face to far edge of Ø250 head
const HANDPIECE_L = 0.2463;
const HANDPIECE_DIA = 0.105;
const HANDPIECE_T = 0.0454;
const HOLDER_PROJ = 0.1064;
const LOWER_BRACKET = 0.066;
const RISER_CL = 0.049; // wall face to riser centreline
const SHOWER_WALL_Z = -SHOWER_ENVELOPE_D / 2;
const SHOWER_RISER_Z = SHOWER_WALL_Z + RISER_CL;
const SHOWER_CONNECTOR_Z = SHOWER_WALL_Z + SHOWER_ARM;
const shower: PartSpec[] = [
  box(0, SHOWER_FOOT, SHOWER_RISER_Z, 0.022, SHOWER_H, 0.022), // rail Ø22 × 981
  // arm ends at the head connector centre (the 427 mm right-hand end)
  box(0, SHOWER_FOOT + SHOWER_H - 0.022, (SHOWER_RISER_Z + SHOWER_CONNECTOR_Z) / 2, 0.022, 0.022, SHOWER_CONNECTOR_Z - SHOWER_RISER_Z),
  tube(0, SHOWER_FOOT + SHOWER_H - 0.053, SHOWER_CONNECTOR_Z, HEAD_DIA, 0.053), // Ø250 head, 53.1 with connector
  // holder: 106.4 mm from the wall face; Ø35 on the sheet. Height on the rail is illustrative.
  box(0, SHOWER_FOOT + 0.5, SHOWER_WALL_Z + HOLDER_PROJ / 2, 0.055, 0.035, HOLDER_PROJ),
  // handpiece drawing B: 246.3 × Ø105 × 45.4. Position on the rail is illustrative.
  box(0, SHOWER_FOOT + 0.4, SHOWER_WALL_Z + HOLDER_PROJ, HANDPIECE_DIA, HANDPIECE_L, HANDPIECE_T, { color: "#2e2c2a", roughness: 0.5 }),
];

// ---- Shower mixer trim: Enflair K1130-31 (Profile III shower/bath wall mixer) ---------------------
// Owner's copy of the Enflair K1130 drawing (7 Oct 2026; no web link): round plate Ø65 × 4, hub
// Ø45, Ø10 lever 107 mm from the top of the hub to its end, 103 mm overall, 65.5 mm from the lever's
// room face to the plate's room face. So the trim stands 69.5 mm off the wall face (65.5 + 4) and
// the body runs about 33.5 mm behind the plate (103 − 65.5 − 4, derived; not a published rough-in
// depth). Plate centre 1000 mm above the finished floor tiles: owner, 7 Oct 2026, proposed. Where
// it sits along the shower wall is not chosen; it is drawn 850 mm from the window wall.
const SHOWER_MIXER_EL = 1.0; // plate centre, proposed
const K1130_PLATE = 0.065;
const K1130_PLATE_T = 0.004;
const K1130_HUB = 0.045;
const K1130_HANDLE = 0.107; // from the top of the Ø45 hub to the lever end
const K1130_FRONT = 0.0655; // lever's room face to the plate's room face
const K1130_D = K1130_FRONT + K1130_PLATE_T; // 69.5: wall face to the lever's room face
const K1130_OVERALL = 0.103;
const K1130_HANDLE_BOTTOM = SHOWER_MIXER_EL + K1130_HUB / 2 - K1130_HANDLE;
const K1130_ENVELOPE_H = quantize(K1130_PLATE / 2 + (SHOWER_MIXER_EL - K1130_HANDLE_BOTTOM));
const K1130_BACK = -K1130_D / 2;
const showerMixer: PartSpec[] = [
  // a cylinder's axis is vertical, so a square plate stands in for the Ø65 round plate
  box(0, SHOWER_MIXER_EL - K1130_PLATE / 2, K1130_BACK + K1130_PLATE_T / 2, K1130_PLATE, K1130_PLATE, K1130_PLATE_T),
  // Ø45 hub, drawn square, from the plate to the lever
  box(0, SHOWER_MIXER_EL - K1130_HUB / 2, K1130_BACK + K1130_PLATE_T + (K1130_FRONT - 0.01) / 2, K1130_HUB, K1130_HUB, K1130_FRONT - 0.01),
  // Ø10 lever at the front, hanging from the hub top to its end
  box(0, K1130_HANDLE_BOTTOM, K1130_D / 2 - 0.005, 0.01, K1130_HANDLE, 0.01),
];

// ---- Thermorail VS900HBN, 12 V vertical rail, concealed wiring: 142 × 900 × 100 mm -------------
// Manufacturer sheet: tube Ø38, 780 mm mounting centres, 24 W. Carton agrees W142 × H900 × D100.
// Owner: the foot is 750 mm above the finished floor tiles (proposed, not surveyed).
const RAIL_FOOT = 0.75;
const RAIL_TUBE = 0.038;
const RAIL_ENV_D = 0.1; // sheet Size D100; back at −d/2, front at +d/2
const RAIL_Z = RAIL_ENV_D / 2 - RAIL_TUBE / 2; // the upright's front at the 100 mm projection
const RAIL_BACK = -RAIL_ENV_D / 2;
const RAIL_ROSE_DIA = 0.032; // sheet side view: 32 mm vertical on the rose (diameter)
const RAIL_STEM_DIA = 0.025; // sheet side view: 25 mm vertical on the stem (section), not length
const RAIL_ROSE_T = 0.006; // drawn stand-in; rose thickness is not on the sheet (thin disc at the wall)
const RAIL_STEM_L = 0.056; // D100 − Ø38 − 6 mm rose stand-in, so the Ø25 stem meets the tube; not a sheet length
const RAIL_CAP_D = 0.042; // sheet side view: 42 mm horizontal above the cap (wall-to-room depth)
const RAIL_CAP_H = 0.042; // drawn stand-in: side view draws a square on the 42 mm depth; height is not dimensioned
const RAIL_HOOK_CL = 0.052; // sheet front view: 52 mm horizontal from the rail centreline to the hook
const RAIL_HOOK_H = 0.019; // sheet front view: 19 mm vertical on the hook arm (section)
const RAIL_TOP = RAIL_FOOT + 0.9;
const railBracket = (up: number): PartSpec[] => [
  // Ø32 thin disc at the wall; thickness is the 6 mm stand-in
  tube(0, RAIL_FOOT + up - RAIL_ROSE_DIA / 2, RAIL_BACK + RAIL_ROSE_T / 2, RAIL_ROSE_DIA, RAIL_ROSE_DIA, { ...NICKEL, d: RAIL_ROSE_T }),
  // Ø25 stem spanning from the rose's room face to the tube back; length is not on the sheet
  tube(0, RAIL_FOOT + up - RAIL_STEM_DIA / 2, RAIL_BACK + RAIL_ROSE_T + RAIL_STEM_L / 2, RAIL_STEM_DIA, RAIL_STEM_DIA, { ...NICKEL, d: RAIL_STEM_L }),
];
// Front view T-hook both sides. 52 mm from centreline, 19 mm arm section. 142 mm is Size/carton overall, not a bar.
const RAIL_HOOK_ARM0 = RAIL_TUBE / 2;
const RAIL_HOOK_ARM1 = RAIL_HOOK_CL - RAIL_HOOK_H / 2;
const railHook = (side: 1 | -1): PartSpec[] => [
  box(side * (RAIL_HOOK_ARM0 + RAIL_HOOK_ARM1) / 2, RAIL_TOP - RAIL_HOOK_H, RAIL_Z, RAIL_HOOK_ARM1 - RAIL_HOOK_ARM0, RAIL_HOOK_H, RAIL_HOOK_H),
  box(side * RAIL_HOOK_CL, RAIL_TOP - RAIL_HOOK_H, RAIL_Z, RAIL_HOOK_H, RAIL_HOOK_H, RAIL_HOOK_H),
];
const rail: PartSpec[] = [
  tube(0, RAIL_FOOT, RAIL_Z, RAIL_TUBE, 0.9 - RAIL_CAP_H), // upright Ø38; remainder of H900 after the cap stand-in
  box(0, RAIL_TOP - RAIL_CAP_H, RAIL_ENV_D / 2 - RAIL_CAP_D / 2, RAIL_TUBE, RAIL_CAP_H, RAIL_CAP_D), // 42 mm deep; height is the square stand-in
  ...railHook(1), ...railHook(-1),
  // 780 mm centres; 60 mm from each end of the 900 mm overall is inferred (900 − 780) / 2, not a sheet figure
  ...railBracket(0.84), ...railBracket(0.06),
];

// ---- OJ Electronics MWD5-1999-CBP3 (Coldbuster 2" WiFi thermostat), flush --------------------
// Brochure lists OxD5 82×82×40, MxD5 84×84×40, MxD5-UA 115×84×40; it does not name the CBP3 cover,
// so the plate size stays a labelled placeholder. Owner: hallway wall, 1000 mm off the floor (7 Oct
// 2026, raised from about 850 to the bottom of the Coldbuster manual's 1000–1500 mm hardwired range).
const THERMO_EL = 1.0;
const thermostat: PartSpec[] = [
  box(0, THERMO_EL, 0, 0.085, 0.085, 0.012, { color: "#f1f4f5", roughness: 0.4 }),
  box(0, THERMO_EL + 0.025, 0.004, 0.05, 0.035, 0.004, { color: "#1b1d1f", roughness: 0.2 }),
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
    kind: "bath_sb184_1000gw", label: "Corner bath", specCategory: "bath",
    product: fitting("Angie Corner 1000mm Bath, GW", "SB184-1000GW", "Angie Corner 1000mm Bath, GW (SB184-1000GW)",
      "Carton label: 1 pc, 36 kg net, 46 kg gross, 1000 × 1000 × 630 mm. Enflair dimension drawing: 1000 mm sides, 1090 mm from the corner to the front of the curve, 630 mm high, 550 mm inside depth, 278 L, 36 kg net, Ø50 waste centred 520 mm from the corner, no overflow shown. The drawing notes slight variations; check the delivered bath. The drawing's 1178 and 920 widths are not used: their extension lines do not show which edges they measure.", "Enflair"),
    size: { w: BATH_BOX, d: BATH_BOX, h: 0.63, printed: ["h"], caveat: "1000 mm sides; the box is the extent of a circular front 1090 mm from the corner" },
    measures: [
      published("side", BATH_LEG, sheet(ENFLAIR_BATH, "SB184-1000 dimension drawing: 1000 mm along each wall side"), "fixture-side", "From the right-angle corner along each wall"),
      published("frontProjection", BATH_PROJECTION, sheet(ENFLAIR_BATH, "section A-A: 1090 mm from the corner to the front of the curve"), "other", "Along the bisector, from the right-angle corner to the front of the curve"),
      published("height", 0.63, sheet(ENFLAIR_BATH, "A-A: 630 mm overall height"), "fixture-bottom"),
      published("insideDepth", 0.55, sheet(ENFLAIR_BATH, "A-A: 550 mm inside depth"), "other", "Inside water depth on section A-A"),
      published("wasteFromCorner", BATH_WASTE_FROM_CORNER, sheet(ENFLAIR_BATH, "plan: Ø50 waste 520 mm from the corner on the bisector"), "other", "Waste centre on the bisector, from the right-angle corner"),
    ],
    specFields: {
      length: pubLen(BATH_LEG, sheet(ENFLAIR_BATH, "SB184-1000 dimension drawing: 1000 mm along each wall side"), "fixture-end", "Wall-side length from the right-angle corner"),
      width: pubLen(BATH_LEG, sheet(ENFLAIR_BATH, "SB184-1000 dimension drawing: 1000 mm along each wall side"), "fixture-side", "Wall-side width from the right-angle corner"),
      height: pubLen(0.63, sheet(ENFLAIR_BATH, "A-A: 630 mm overall height"), "finished-floor", "Product height to the rim, as published; not a project mounting height"),
      installation: pubVal("corner", sheet(ENFLAIR_BATH, "SB184-1000 dimension drawing: right-angle corner fit")),
      shape: pubVal("corner-round", sheet(ENFLAIR_BATH, "SB184-1000: two straight wall sides and a rounded front")),
      frontWidth: pubLen(BATH_FRONT_WIDTH, sheet(ENFLAIR_BATH, "derived: chord of the two 1000 mm wall sides"), "other", "Straight-line distance between the ends of the curved front"),
      frontProjection: pubLen(BATH_PROJECTION, sheet(ENFLAIR_BATH, "section A-A: 1090 mm from the corner to the front of the curve"), "other", "Along the bisector, from the right-angle corner to the front of the curve"),
      wasteFromCorner: pubLen(BATH_WASTE_FROM_CORNER, sheet(ENFLAIR_BATH, "plan: Ø50 waste 520 mm from the corner on the bisector"), "other", "Waste centre on the bisector, from the right-angle corner; not wasteFromEnd/wasteFromSide"),
      wasteHoleDiameter: pubLen(0.05, sheet(ENFLAIR_BATH, "plan: Ø50 waste hole"), "other", "Waste hole diameter; not a pipe connection or outlet size"),
      wasteConnectionDiameter: { value: null, note: "The Enflair drawing names a Ø50 waste hole, not a pipe connection or outlet size. No connection diameter is entered." },
      wasteFromEnd: { value: null, note: `Sheet gives 520 mm from the right-angle corner along the bisector, not from the end. Along each wall that is 520/√2 ≈ ${formatMm(bathWasteConverted.alongEachWall)} mm; that conversion is derived in the host-frame check, not entered as published wasteFromEnd.` },
      wasteFromSide: { value: null, note: `Sheet gives 520 mm from the right-angle corner along the bisector, not from the side. Along each wall that is 520/√2 ≈ ${formatMm(bathWasteConverted.alongEachWall)} mm; that conversion is derived in the host-frame check, not entered as published wasteFromSide.` },
      overflow: pubVal("no", sheet(ENFLAIR_BATH, "dimension drawing: no overflow shown")),
    },
    parts: [], outline: bathOutline, placement: { id: "bath", kind: "bath_sb184_1000gw", x: quantize(BATH_CORNER.x - BATH_BOX / 2), y: quantize(BATH_CORNER.y + BATH_BOX / 2), rotation: 0 },
  },
  {
    kind: "bath_set_k1132_150_kdpp32", label: "Bath mixer and spout", specCategory: "tapware",
    product: fitting("Profile III 150mm basin/bath wall mixer set with rectangular plate", "K1132-##-150+KDPP32", "Enflair K1132-31 trim and K1150-31-0-150 spout on one KDPP32 rectangular plate, brushed SS nickel",
      "Owner, 7 Oct 2026: the bath set is the K1132-##-150+KDPP32 (one 200 × 65 rectangular plate for mixer and spout). K1132-31 label: brushed SS nickel, max static inlet pressure 500 kPa, max hot water 80°, WaterMark AS 3718:2021 WM-080082. K1150-31-0-150 carton: 304 stainless steel, brushed SS nickel, 150 mm. Set drawing: WELS 5 star 4.5 L/min, 35 mm cartridge. Spout and hub 60 mm either side of the plate centre (derived from the drawing; the 120 is printed). The 45 mm drop to the outlet face is from the K1150 drawing.", "Enflair",
      [part("K1132 inner part (in-wall body)", "Its carton was photographed; its inlet spacing and concealed depth are not on the set drawing.")]),
    size: { w: SET_PLATE_W, d: SPOUT_D, h: SET_ENVELOPE_H, printed: [], elevation: SET_HANDLE_BOTTOM, elevationNote: "lever end (envelope bottom); plate centre is the owner's proposed 750 mm", caveat: "kind elevation is the lever end so the envelope contains the published lever; plate centre 750 mm is the owner's proposal (7 Oct 2026), not surveyed. Envelope depth 162 mm is 150 + Ø24/2 for the undimensioned outer lip" },
    measures: [
      published("plateWidth", SET_PLATE_W, sheet(ENFLAIR_KDPP32, "K1132-##-150+KDPP32 drawing: plate 200 mm wide"), "other", "Rectangular plate width, along the wall"),
      published("plateHeight", SET_PLATE_H, sheet(ENFLAIR_KDPP32, "K1132-##-150+KDPP32 drawing: plate 65 mm high"), "other", "Rectangular plate height"),
      published("plateThickness", SET_PLATE_T, sheet(ENFLAIR_KDPP32, "K1132-##-150+KDPP32 drawing: plate 4 mm"), "finished-wall", "Plate thickness from the wall-side face of the plate"),
      published("spoutToHub", 2 * SET_HALF_SPACING, sheet(ENFLAIR_KDPP32, "K1132-##-150+KDPP32 drawing: 120 mm between the spout and hub centrelines"), "other", "Spout centreline to hub centreline, on the plate's horizontal centreline. Centred on the plate (60 mm each side) is derived from the drawing, not printed"),
      published("hubDiameter", MIXER_HUB_R * 2, sheet(ENFLAIR_KDPP32, "K1132-##-150+KDPP32 drawing: hub Ø45"), "other", "Hub diameter; the 107 mm lever starts at the top of this hub"),
      published("handleDrop", MIXER_HANDLE, sheet(ENFLAIR_KDPP32, "K1132-##-150+KDPP32 drawing: 107 mm from the top of the Ø45 hub to the lever end, Ø10"), "other", "From the top of the Ø45 hub down to the lever end, not from the plate centre (hub radius 22.5 mm)"),
      published("bodyProjection", MIXER_BODY_PROJ, sheet(ENFLAIR_KDPP32, "K1132-##-150+KDPP32 drawing: 61 mm"), "finished-wall", "From the plate's wall-side face; includes the 4 mm plate. 61 and 150 share that left extension"),
      published("reach", SPOUT_REACH, sheet(ENFLAIR_KDPP32, "K1132-##-150+KDPP32 drawing: 150 mm from the plate's wall-side face to the outlet"), "finished-wall", "To the outlet-face centre; the outer lip is beyond this and is not dimensioned. Also printed 150 mm on the K1150 carton"),
      published("tubeDiameter", SPOUT_TUBE, sheet(ENFLAIR_KDPP32, "K1132-##-150+KDPP32 drawing: spout Ø24"), "other"),
      published("outletDrop", SPOUT_DROP, sheet(ENFLAIR_K1150, "K1150-##-0-150 drawing: 45 mm from the tube axis (plate centre) to the outlet-face centre, 15°"), "other", "Not on the set drawing; from the held spout's own K1150 drawing"),
      proposedDim("elevation", SET_EL, "Owner, 7 Oct 2026: plate centre 750 mm above the finished floor tiles. Proposed, not surveyed; no wall anchor, so #60 installation is not used. Kind elevation is the lever end (665.5 mm).", "finished-floor"),
      proposedDim("fromWindowWall", SET_FROM_WINDOW, "Owner, 7 Oct 2026: plate centred about 500 mm from the window wall along the right wall, halfway along the bath's 1000 mm side. Proposed; measured to the window wall's existing surface, not a surveyed finished face.", "other"),
    ],
    specFields: {
      width: pubLen(SET_PLATE_W, sheet(ENFLAIR_KDPP32, "K1132-##-150+KDPP32 drawing: plate 200 mm"), "fixture-end"),
      depth: pubLen(SPOUT_D, sheet(ENFLAIR_K1150, "derived: 150 mm to the outlet-face centre plus Ø24/2 for the outer lip; the lip itself is not dimensioned"), "fixture-side", "Maximum exposed projection: 150 mm is to the outlet-face centre, not the overall"),
      height: pubLen(SET_ENVELOPE_H, sheet(ENFLAIR_KDPP32, "derived: 65 mm plate, hub top 22.5 mm above the plate centre, lever 107 mm from the hub top"), "fixture-bottom", "From the lever end to the top of the plate, so the envelope contains the published lever"),
      mounting: pubVal("wall-exposed", sheet(ENFLAIR_KDPP32, "K1132-##-150+KDPP32 wall mixer set drawing")),
      waterConnection: pubVal("G1/2 in the plate", sheet(ENFLAIR_K1150, "K1150-##-0-150 drawing: G1/2 in the cover plate")),
      pressureMax: measuredQty(500, "kPa", "Photographed K1132-31 label: max static inlet pressure 500 kPa"),
      temperatureMax: measuredQty(80, "°C", "Photographed K1132-31 label: max hot water 80°"),
    },
    // back to the right wall's existing surface (x 2110), plate centre 500 mm from the window wall; spout toward the window
    parts: bathSet, placement: { id: "bath_mixer", kind: "bath_set_k1132_150_kdpp32", x: quantize(2.11 - SPOUT_D / 2), y: SET_FROM_WINDOW, rotation: 270 },
  },
  {
    kind: "waste_sdp40bn", label: "Bath waste", specCategory: "waste",
    product: fitting("Dome Pop Short Bath Waste 40mm, with pull out basket", "SDP-40BN", "Ahrok SDP-40BN dome pop short bath waste, 40 mm, pull-out basket, brushed nickel",
      "Carton label: WaterMark licence WM-022812, AS 1589-2001. No manufacturer sheet found for this code. Owner, 7 Oct 2026: ordered together with the bath, so taken to suit its Ø50 waste hole; checked on delivery.", "Ahrok"),
    size: { w: 0.07, d: 0.07, h: 0.02, printed: [], elevation: WASTE_EL, caveat: "dome size is a drawn stand-in only; 40 mm connection is from the photographed carton; its place is the drawing's waste point" },
    measures: [
      publishedLabel("connection", 0.04, "carton label", "fixture-centreline", "40 mm nominal pipe connection printed on the photographed carton. No manufacturer sheet found, so this is not entered as a published product-brief figure."),
      unsourced("domeDiameter", "Visible dome diameter. No manufacturer sheet; drawn stand-in 70 mm lives only on the kind size.", "other"),
      unsourced("domeHeight", "Dome height above the waste flange. No manufacturer sheet; drawn stand-in 20 mm lives only on the kind size.", "fixture-bottom"),
      unsourced("elevation", "Unsourced. Drawn stand-in 590 mm above finished floor lives only on the kind. Conflicts with the bath's published 630 mm overall height and 550 mm inside depth (inside floor would sit about 80 mm above the bath bottom). Measure from the bath floor / waste flange.", "finished-floor"),
    ],
    specFields: {
      outletDiameter: { value: null, note: "Carton prints 40 mm nominal connection; no manufacturer sheet, so not entered as a published figure" },
      outletSizeKind: { value: "connection", status: "published", source: "carton label", note: "Photographed carton: Dome Pop Short Bath Waste 40mm; 40 mm is the pipe connection, not a hole diameter" },
      style: measuredField("dome-pop", "choice", "Photographed carton: Dome Pop Short Bath Waste"),
      strainer: measuredField("pull-out basket", "text", "Photographed carton: with pull out basket"),
      certification: measuredField("WaterMark licence WM-022812, AS 1589-2001", "text", "Photographed SDP-40BN carton"),
    },
    // the drawing's waste point: on the bisector, 520 mm from the corner. Along each wall that
    // is 520/√2 (derived). Its hole is drawn Ø50; this waste's 40 mm is the pipe connection.
    parts: waste, placement: { id: "bath_waste", kind: "waste_sdp40bn", x: quantize(BATH_CORNER.x - BATH_BOX / 2 + bathWaste.across), y: quantize(BATH_CORNER.y + bathWaste.out), rotation: 0, fittedTo: { hostId: "bath", ...bathWaste } },
  },
  {
    kind: "mixer_k1110_31", label: "Basin mixer", specCategory: "tapware",
    product: fitting("Profile III petite basin mixer", "K1110-31", "Enflair K1110-31 petite basin mixer, brushed SS nickel",
      "Label: 6 L/min WELS licence 2054 (Jina Enterprises Pty Ltd), max static inlet pressure 500 kPa, max hot water 80°, WaterMark AS 3718:2021 WM-080082. The held unit's label (6 L/min, WELS 2054) differs from the current K1110 sheet (WELS 5 star, 4.5 L/min); it may be an earlier revision. Body centreline 24 mm from the flange back (145 starts at the Ø48 flange back; 112's left is that centreline).", "Enflair"),
    size: { w: 0.048, d: K1110_D, h: 0.148, printed: [], elevation: BASIN_EL, caveat: "elevation 850 mm is an unsourced drawn stand-in from the vanity's measured overall height, not a finished-floor tape and not an owner proposal; mixer sizes from the K1110 drawing" },
    measures: [
      published("height", 0.148, sheet(ENFLAIR_K1110, "K1110 drawing: 148 mm from the deck/flange to the top"), "fixture-bottom", "Overall height from the deck"),
      published("flangeDiameter", 0.048, sheet(ENFLAIR_K1110, "K1110 drawing: flange Ø48"), "other"),
      published("flangeThickness", 0.0055, sheet(ENFLAIR_K1110, "K1110 drawing: flange 5.5 mm"), "fixture-bottom"),
      published("bodyDiameter", 0.04, sheet(ENFLAIR_K1110, "K1110 drawing: body Ø40"), "other"),
      published("overallDepth", K1110_D, sheet(ENFLAIR_K1110, "K1110 drawing: 145 mm back-to-front"), "fixture-side"),
      published("leverProjection", 0.12, sheet(ENFLAIR_K1110, "K1110 drawing: top lever 120 mm forward from the back of the mixer"), "fixture-side", "Top lever, 120 mm from the back of the square top (body back); body centreline is 24 mm from the flange back"),
      published("spoutReach", 0.112, sheet(ENFLAIR_K1110, "K1110 drawing: 112 mm from the body centreline"), "fixture-side", "From the body centreline, which is 24 mm from the Ø48 flange back"),
      published("spoutDiameter", 0.02, sheet(ENFLAIR_K1110, "K1110 drawing: spout Ø20"), "other"),
      published("basinClearance", 0.062, sheet(ENFLAIR_K1110, "K1110 drawing: 62 mm under the spout; text says 60 mm approx."), "other", "Drawing 62 mm to the underside of the outlet; marketing text 60 mm approx. Drawing figure kept. The horizontal spout-axis height is not dimensioned on the sheet."),
      unsourced("elevation", "Unsourced. Drawn stand-in 850 mm to the deck/flange lives only on the kind. Taken from the vanity's measured overall height 850 mm (owner's tape 910 W × 850 H × 465 D, 5 Oct 2026); nobody proposed this as a finished-floor mounting height, and the finished floor does not exist yet.", "finished-floor"),
    ],
    specFields: {
      width: pubLen(0.048, sheet(ENFLAIR_K1110, "K1110 drawing: flange Ø48"), "fixture-end"),
      depth: pubLen(K1110_D, sheet(ENFLAIR_K1110, "K1110 drawing: 145 mm back-to-front from the Ø48 flange back"), "fixture-side"),
      height: pubLen(0.148, sheet(ENFLAIR_K1110, "K1110 drawing: 148 mm from the deck/flange to the top"), "fixture-bottom"),
      mounting: pubVal("deck", sheet(ENFLAIR_K1110, "K1110 petite basin mixer, deck-mounted")),
      tapHoles: measuredField(1, "count", "Photographed unit and K1110 drawing: single deck hole, flange Ø48"),
      holeLayout: pubVal("Single hole, flange Ø48", sheet(ENFLAIR_K1110, "K1110 drawing: flange Ø48")),
      pressureMax: measuredQty(500, "kPa", "Photographed K1110-31 label: max static inlet pressure 500 kPa"),
      temperatureMax: measuredQty(80, "°C", "Photographed K1110-31 label: max hot water 80°"),
    },
    parts: basinMixer, placement: { id: "basin_mixer", kind: "mixer_k1110_31", x: 2.02, y: 1.7, rotation: 270 },
  },
  {
    kind: "shower_y1173_31_11_250", label: "Shower system", specCategory: "shower-fittings",
    product: fitting("Profile round twin shower system with adjustable rail", "Y1173-31-11-250", "Y1173-31-11-250 twin shower, 250 mm rain head, 3F handpiece, brushed nickel",
      "Label: 9.0 L/min WELS licence 1281 (Kaiping Huipu Shower Metalwork Industrial Co Ltd), WaterMark AS/NZS 3662 WMKT25262. Brand is not printed on the label. Envelope from the Y1173 drawing: rail 981 mm, head Ø250. The 427 mm arm is from the mounting/wall face (the 427 left extension is the same line as the wall-side face of both Ø55 roses) to the head connector centreline. Plan depth is 427 + Ø250/2 = 552 mm to the far edge of the head.", "",
      [part("K1130 wall shower/bath mixer, inner part", "Its carton was photographed; the shower mixer instruction sheet shows its 45 mm and 60 mm dimensions without a clear datum.")]),
    size: { w: 0.25, d: SHOWER_ENVELOPE_D, h: SHOWER_H, printed: ["w"], elevation: SHOWER_FOOT, elevationNote: "rail foot, 70.3 mm below the lower bracket (derived); lower bracket is the owner's proposed 1200 mm", caveat: "plan depth 552 mm is the wall/mounting face to the far edge of the Ø250 head (427 + 125), named. Lower bracket 1200 mm is the owner's proposal (7 Oct 2026); no surveyed wall face" },
    measures: [
      published("headDiameter", HEAD_DIA, sheet(ENFLAIR_Y1173, "Y1173-##-11-250 drawing: rain head Ø250"), "other"),
      published("headThickness", 0.007, sheet(ENFLAIR_Y1173, "Y1173 drawing: head plate 7 mm; 53.1 mm with connector"), "other"),
      published("railHeight", SHOWER_H, sheet(ENFLAIR_Y1173, "Y1173 drawing: rail overall 981 mm"), "fixture-bottom"),
      published("railDiameter", 0.022, sheet(ENFLAIR_Y1173, "Y1173 drawing: rail Ø22"), "other"),
      published("armReach", SHOWER_ARM, sheet(ENFLAIR_Y1173, "Y1173 drawing: 427 mm from the mounting/wall face to the rain-head connector centreline"), "fixture-side", "From the mounting/wall face (the 427 left extension is the same continuous line as the wall-side face of both Ø55 roses, and the left of 49, 10, 66 and 106.4) to the head connector centreline"),
      published("riserCentre", RISER_CL, sheet(ENFLAIR_Y1173, "Y1173 drawing: 49 mm from the wall/mounting face to the riser centreline"), "fixture-side", "From the same wall/mounting face as 427"),
      published("handpieceLength", HANDPIECE_L, sheet(ENFLAIR_Y1173, "Y1173 drawing B: handpiece 246.3 mm overall length"), "fixture-bottom"),
      published("handpieceDiameter", HANDPIECE_DIA, sheet(ENFLAIR_Y1173, "Y1173 drawing B: face Ø105"), "other"),
      published("handpieceDepth", HANDPIECE_T, sheet(ENFLAIR_Y1173, "Y1173 drawing B: 45.4 mm deep"), "other"),
      published("holderProjection", HOLDER_PROJ, sheet(ENFLAIR_Y1173, "Y1173 drawing: 106.4 mm horizontal projection of the handpiece holder from the wall/mounting face"), "fixture-side", "Horizontal from the wall/mounting face, not a height. The 3D holder's height on the rail is illustrative."),
      published("lowerBracket", LOWER_BRACKET, sheet(ENFLAIR_Y1173, "Y1173 drawing: lower bracket 66 mm from the wall/mounting face to the clamp front, plate 10 mm, rose Ø55"), "fixture-side", "From the same wall/mounting face as 427, to the lower clamp's front face"),
      proposedDim("elevation", SHOWER_LOWER_BRACKET_EL, "Owner, 7 Oct 2026: lower bracket (rose) centre 1200 mm above the finished floor tiles. Proposed, not surveyed; no wall anchor, so #60 installation is not used. Rail foot 1129.7 mm and rail top 2110.7 mm follow from the drawing (derived). The G1/2 inlet is at the upper rose, 500 mm higher: 1700 mm.", "finished-floor"),
      proposedDim("inletHeight", SHOWER_INLET_EL, "Derived from the owner's proposed 1200 mm lower bracket plus the drawing's 500 mm bracket centres: G1/2 water point at the upper rose, 1700 mm above the finished floor tiles. Proposed, as its weakest input.", "finished-floor"),
    ],
    specFields: {
      width: pubLen(HEAD_DIA, sheet(ENFLAIR_Y1173, "Y1173-##-11-250 drawing: rain head Ø250"), "fixture-end"),
      depth: pubLen(SHOWER_ENVELOPE_D, sheet(ENFLAIR_Y1173, "derived: 427 mm wall-face to connector centreline plus Ø250/2 to the far edge of the head"), "fixture-side", "From the mounting/wall face to the far edge of the Ø250 head (427 + 125). Both figures are on the Y1173 drawing"),
      height: pubLen(SHOWER_H, sheet(ENFLAIR_Y1173, "Y1173 drawing: rail overall 981 mm"), "fixture-bottom"),
      fittingType: pubVal("system", sheet(ENFLAIR_Y1173, "Y1173-##-11-250 twin shower system")),
      mounting: pubVal("wall", sheet(ENFLAIR_Y1173, "Y1173 side view: wall roses Ø55")),
      headWidth: pubLen(HEAD_DIA, sheet(ENFLAIR_Y1173, "Y1173-##-11-250 drawing: rain head Ø250"), "fixture-centreline"),
      armProjection: pubLen(SHOWER_ARM, sheet(ENFLAIR_Y1173, "Y1173 drawing: 427 mm from the mounting/wall face to the rain-head connector centreline"), "fixture-side", "From the mounting/wall face (427 left extension = wall-side of both Ø55 roses) to the connector centreline"),
      railLength: pubLen(SHOWER_H, sheet(ENFLAIR_Y1173, "Y1173 drawing: rail overall 981 mm"), "fixture-bottom"),
      adjustment: pubVal("adjustable", sheet(ENFLAIR_Y1173, "Y1173: adjustable rail / slider")),
      waterEntry: pubVal("other", sheet(ENFLAIR_Y1173, "twin outlets: rain head and handpiece")),
      waterConnection: pubVal("G1/2 at the upper wall rose only; rain head and 3F handpiece", sheet(ENFLAIR_Y1173, "Y1173 drawing: G1/2 at the upper rose, 500 mm above the lower one")),
      fixingLayout: pubVal("Two wall roses Ø55 with 10 mm plates; 500 mm between bracket centres; upper rose 410.7 mm below the rail top; 49 mm from the wall/mounting face to the riser centreline", sheet(ENFLAIR_Y1173, "Y1173 drawing: 500 mm bracket centres, 410.7 mm from the top, roses Ø55, plates 10 mm, 49 mm to the riser")),
    },
    parts: shower, placement: { id: "shower_system", kind: "shower_y1173_31_11_250", x: SHOWER_ENVELOPE_D / 2, y: 0.6, rotation: 90 },
  },
  {
    kind: "mixer_k1130_31", label: "Shower mixer", specCategory: "tapware",
    product: fitting("Profile III shower/bath wall mixer", "K1130-31", "Enflair K1130-31 shower mixer trim, round Ø65 plate, brushed SS nickel",
      "Owner's copy of the Enflair K1130 drawing (7 Oct 2026; no web link): round plate Ø65 × 4, hub Ø45, Ø10 lever 107 mm from the top of the hub, 103 mm overall, 65.5 mm from the lever's room face to the plate. 35 mm cartridge. Supersedes the earlier K1130-##+KDPP30 (Ø95 plate) note. Its inner part carton was photographed and is listed on the shower system. Labels say max 500 kPa and 80 °C; the shower mixer instruction sheet says 0.05–1 MPa and 0–75 °C.", "Enflair"),
    size: { w: K1130_PLATE, d: K1130_D, h: K1130_ENVELOPE_H, printed: [], elevation: K1130_HANDLE_BOTTOM, elevationNote: "lever end (envelope bottom); plate centre is the owner's proposed 1000 mm", caveat: "plate centre 1000 mm is the owner's proposal (7 Oct 2026), not surveyed. Body depth behind the plate (about 33.5 mm) is derived, not a published rough-in depth. Position along the wall is a drawn stand-in" },
    measures: [
      publishedLabel("plateDiameter", K1130_PLATE, "Enflair K1130 drawing, owner's copy (7 Oct 2026): plate Ø65", "other", "Round cover plate diameter"),
      publishedLabel("plateThickness", K1130_PLATE_T, "Enflair K1130 drawing, owner's copy (7 Oct 2026): plate 4 mm", "finished-wall"),
      publishedLabel("hubDiameter", K1130_HUB, "Enflair K1130 drawing, owner's copy (7 Oct 2026): hub Ø45", "other"),
      publishedLabel("handleDrop", K1130_HANDLE, "Enflair K1130 drawing, owner's copy (7 Oct 2026): 107 mm from the top of the Ø45 hub to the lever end, Ø10", "other", "From the top of the hub, not from the plate centre (hub radius 22.5 mm)"),
      publishedLabel("projection", K1130_FRONT, "Enflair K1130 drawing, owner's copy (7 Oct 2026): 65.5 mm from the lever's room face to the plate's room face", "other", "Add the 4 mm plate for 69.5 mm from the wall face"),
      publishedLabel("overallDepth", K1130_OVERALL, "Enflair K1130 drawing, owner's copy (7 Oct 2026): 103 mm overall", "other", "Lever's room face to the back of the body; about 33.5 mm of it sits behind the plate (derived)"),
      proposedDim("elevation", SHOWER_MIXER_EL, "Owner, 7 Oct 2026: plate centre 1000 mm above the finished floor tiles. Proposed, not surveyed; no wall anchor, so #60 installation is not used.", "finished-floor"),
      unsourced("fromWindowWall", "Where the mixer sits along the shower wall is not chosen. Drawn stand-in 850 mm from the window wall lives only on the placement.", "other"),
    ],
    specFields: {
      width: { value: null, note: "Owner's copy of the Enflair K1130 drawing gives plate Ø65; it has no web link, so it is not entered as a published brief figure (the figures are on the measures)." },
      depth: { value: null, note: "Owner's copy of the Enflair K1130 drawing gives 65.5 mm lever to plate plus the 4 mm plate; no web link, so not entered as a published brief figure." },
      height: { value: null, note: "Derived from the owner's copy of the Enflair K1130 drawing (Ø65 plate, Ø45 hub, 107 mm lever); no web link, so not entered as a published brief figure." },
      pressureMax: measuredQty(500, "kPa", "Photographed K1130 inner-part label: max static inlet pressure 500 kPa"),
      temperatureMax: measuredQty(80, "°C", "Photographed K1130 inner-part label: max hot water 80°"),
    },
    // left wall, back to its existing surface; 850 mm from the window wall is a stand-in
    parts: showerMixer, placement: { id: "shower_mixer", kind: "mixer_k1130_31", x: K1130_D / 2, y: 0.85, rotation: 90 },
  },
  {
    kind: "towel_rail_vs900hbn", label: "Towel rail", specCategory: "towel-rail",
    product: fitting("VS900HBN", "VS900HBN", "Thermorail VS900HBN, 12 V vertical rail, round, brushed nickel, concealed wiring",
      "Carton label: 142 × 900 × 100 mm. Manufacturer sheet: W142 × H900 × D100, tube Ø38, 780 mm mounting centres, 24 W (this sheet; a product page that says 22 W is not used). Side view: 42 mm is the cap's wall-to-room depth (horizontal), 25 mm is the stem section (vertical), 32 mm is the rose diameter (vertical). Stem length, rose thickness and cap height are not dimensioned. Front view: hook 52 mm from the rail centreline, 19 mm arm section. 12 V: a transformer came with each rail (owner); both go up in the ceiling space for access later.", "Thermorail"),
    size: { w: 0.142, d: 0.1, h: 0.9, printed: ["w", "d", "h"], elevation: RAIL_FOOT, caveat: "foot 750 mm above the floor tiles (owner, proposed); no surveyed wall face" },
    measures: [
      published("width", 0.142, sheet(THERMO_VS900, "VS900HBN specification sheet: Size W142 × H900 × D100"), "fixture-end", "Overall / carton width. Not a 142 mm top bar."),
      published("depth", 0.1, sheet(THERMO_VS900, "VS900HBN specification sheet: D100"), "fixture-side"),
      published("height", 0.9, sheet(THERMO_VS900, "VS900HBN specification sheet: H900"), "fixture-bottom"),
      published("tubeDiameter", RAIL_TUBE, sheet(THERMO_VS900, "VS900HBN specification sheet: tube Ø38"), "other"),
      published("mountingCentres", 0.78, sheet(THERMO_VS900, "VS900HBN specification sheet: 780 mm between fixing centres"), "fixture-bottom", "780 mm centres. The 60 mm from each end of the 900 mm tube is inferred from (900 − 780) / 2, not a sheet dimension."),
      published("hookFromCentreline", RAIL_HOOK_CL, sheet(THERMO_VS900, "VS900HBN specification sheet front view: 52 mm horizontal from the rail centreline to the hook"), "fixture-end"),
      published("hookSection", RAIL_HOOK_H, sheet(THERMO_VS900, "VS900HBN specification sheet front view: 19 mm vertical on the hook arm"), "fixture-bottom", "Hook-arm section (vertical), not a bar length."),
      published("stemSection", RAIL_STEM_DIA, sheet(THERMO_VS900, "VS900HBN specification sheet side view: 25 mm vertical on the stem (section)"), "other", "Stem section, not length. The 25 mm arrows run along the stem's top and bottom edges."),
      published("roseDiameter", RAIL_ROSE_DIA, sheet(THERMO_VS900, "VS900HBN specification sheet side view: 32 mm vertical on the rose"), "other", "Rose diameter. Thickness is not dimensioned (thin disc)."),
      published("capDepth", RAIL_CAP_D, sheet(THERMO_VS900, "VS900HBN specification sheet side view: 42 mm horizontal above the cap"), "fixture-side", "Cap wall-to-room depth. Height is not dimensioned."),
      unsourced("stemLength", "Stem length is not on the sheet (25 mm is the section). Drawn spanning from the thin rose to the tube back inside D100.", "fixture-side"),
      unsourced("roseThickness", "Rose thickness is not on the sheet (32 mm is the diameter). Drawn as a thin disc at the wall.", "fixture-side"),
      unsourced("capHeight", "Cap height is not on the sheet (42 mm is the side-view depth). Drawn as a square on that 42 mm depth so the side view reads; the upright is the remainder of H900.", "fixture-bottom"),
      proposedDim("elevation", RAIL_FOOT, "Owner: foot 750 mm above the finished floor tiles. Proposed, not surveyed; no wall anchor, so #60 installation is not used.", "finished-floor"),
    ],
    specFields: {
      width: pubLen(0.142, sheet(THERMO_VS900, "VS900HBN specification sheet: Size W142 × H900 × D100"), "fixture-end"),
      depth: pubLen(0.1, sheet(THERMO_VS900, "VS900HBN specification sheet: D100"), "fixture-side"),
      height: pubLen(0.9, sheet(THERMO_VS900, "VS900HBN specification sheet: H900"), "fixture-bottom"),
      mounting: pubVal("wall", sheet(THERMO_VS900, "VS900HBN specification sheet: wall-mounted vertical rail")),
      fixingCentresHeight: pubLen(0.78, sheet(THERMO_VS900, "VS900HBN specification sheet: 780 mm between fixing centres"), "fixture-bottom"),
      fixingLayout: pubVal("780 mm vertical centres; Ø32 wall roses (thin discs; thickness not on the sheet); Ø25 stems (section; length not on the sheet); removable hook 52 mm from the rail centreline, 19 mm arm section; cap 42 mm wall-to-room (height not on the sheet)", sheet(THERMO_VS900, "VS900HBN specification sheet: 780 mm centres, Ø32 roses, Ø25 stem section, hook 52 mm from centreline, 19 mm arm section, 42 mm cap depth")),
      heating: pubVal("electric", sheet(THERMO_VS900, "VS900HBN specification sheet: 12 V, 24 W")),
      power: pubVal("required", sheet(THERMO_VS900, "VS900HBN specification sheet: 12 V electric")),
      powerConnection: pubVal("low-voltage", sheet(THERMO_VS900, "VS900HBN specification sheet: 12 V")),
      powerRequirements: pubVal("12 V, 24 W; concealed wiring; a transformer is supplied with each rail (owner: both transformers in the ceiling space).", sheet(THERMO_VS900, "VS900HBN specification sheet: 12 V, 24 W")),
    },
    parts: rail, placement: { id: "towel_rail", kind: "towel_rail_vs900hbn", x: 0.05, y: 1.825, rotation: 90 },
    // the owner bought two; the second hangs beside the first on the left wall, its foot also at 750
    extra: [{ id: "towel_rail_2", kind: "towel_rail_vs900hbn", x: 0.05, y: 1.575, rotation: 90 }],
  },
  {
    kind: "thermostat_mwd5_1999_cbp3", label: "Thermostat", specCategory: "thermostat",
    product: fitting("MWD5-1999-CBP3", "MWD5-1999-CBP3", "OJ Electronics Coldbuster 2\" WiFi thermostat, flush mount",
      "Label: incl. limitation sensor, 100–240 V AC / 16 A, 5–40 °C, housing IP21, flush mounting. The plate size is not printed. OJ Microline brochure lists OxD5 82×82×40, MxD5 84×84×40 and MxD5-UA 115×84×40 without naming the CBP3 cover, so none of those sizes is entered as this product.", "OJ Electronics"),
    size: { w: 0.085, d: 0.012, h: 0.085, printed: [], elevation: THERMO_EL, caveat: "plate size is a drawn stand-in only; CBP3 cover is not identified on the brochure. Height 1000 mm is the owner's hallway proposal; this fitting is not placed in the bathroom" },
    measures: [
      unsourced("width", "Cover-plate width. OJ brochure lists family sizes (OxD5 82×82×40, MxD5 84×84×40, MxD5-UA 115×84×40) without naming CBP3; none is used as this cover. Drawn stand-in 85 mm lives only on the kind size.", "other"),
      unsourced("height", "Cover-plate height. CBP3 cover not identified on the manufacturer brochure. Drawn stand-in 85 mm lives only on the kind size.", "other"),
      unsourced("projection", "Projection of the flush plate. Brochure build-in 22 mm is a family figure, not used as this cover. Drawn stand-in 12 mm lives only on the kind size.", "finished-wall"),
      proposedDim("elevation", THERMO_EL, "Owner, 7 Oct 2026: hallway wall outside the bathroom, next to the light switch, 1000 mm off the floor (raised from about 850 to the bottom of the Coldbuster in-screed manual's 1000–1500 mm range for a hardwired thermostat). Proposed, not surveyed. Not placed in this plan.", "finished-floor"),
    ],
    specFields: {
      width: { value: null, note: `CBP3 cover width is not named on the OJ Microline brochure (${OJ_MWD5}; OxD5 82×82×40, MxD5 84×84×40, MxD5-UA 115×84×40 listed without CBP3). Drawn stand-in lives only on the kind size.` },
      height: { value: null, note: `CBP3 cover height is not named on the OJ Microline brochure (${OJ_MWD5}). Drawn stand-in lives only on the kind size.` },
      depth: { value: null, note: `CBP3 cover projection is not named on the OJ Microline brochure (${OJ_MWD5}; family build-in 22 mm is not used). Drawn stand-in lives only on the kind size.` },
      mounting: measuredField("flush", "choice", "Photographed MWD5-1999-CBP3 label: flush mounting"),
      ratedVoltageMin: { value: 100, status: "published", source: CARTON_LABEL_SOURCE, note: "Photographed MWD5-1999-CBP3 carton label: 100–240 V AC" },
      ratedVoltageMax: { value: 240, status: "published", source: CARTON_LABEL_SOURCE, note: "Photographed MWD5-1999-CBP3 carton label: 100–240 V AC" },
      ratedCurrent: { value: 16, status: "published", source: CARTON_LABEL_SOURCE, note: "Photographed MWD5-1999-CBP3 carton label: 16 A" },
      tempRangeMin: measuredQty(5, "°C", "Photographed label: 5–40 °C"),
      tempRangeMax: measuredQty(40, "°C", "Photographed label: 5–40 °C"),
      ingressProtection: { value: "IP21", status: "published", source: CARTON_LABEL_SOURCE, note: "Photographed MWD5-1999-CBP3 carton label: housing IP21" },
      floorSensor: measuredField("included", "choice", "Photographed label: incl. limitation sensor"),
      connectivity: measuredField("wifi", "choice", "Photographed label / Coldbuster 2\" WiFi thermostat"),
    },
    // owner: on the hallway wall outside the bathroom, so it is not placed in this plan
    parts: thermostat,
  },
];

/** Remaining placeholders: no manufacturer sheet, or a height with no surveyed face. */
export const stillNeedsCaptainsMeasurement: CaptainMeasurement[] = [
  { fitting: "Bath set K1132-##-150+KDPP32", what: "Plate centre height (owner proposed 750 mm, 7 Oct 2026; not surveyed) and position along the right wall (owner proposed 500 mm from the window wall); in-wall body inlet spacing and concealed depth are not on the set drawing", from: "finished floor tiles, on the right-wall finished (tile) face once that face is surveyed; the window wall's finished face for the 500 mm" },
  { fitting: "Shower Y1173-31-11-250", what: "Height of the lower bracket (owner proposed 1200 mm, 7 Oct 2026; not surveyed). The G1/2 inlet at the upper rose follows 500 mm higher", from: "finished floor tiles, on the left-wall finished (tile) face once that face is surveyed" },
  { fitting: "Shower Y1173-31-11-250", what: "Height of the slider/holder on the 981 mm rail (3D position is illustrative; sheet 106.4 mm is the holder's horizontal projection from the wall/mounting face, not a height)", from: "the rail's lower end, or a named point on the finished wall" },
  { fitting: "Shower Y1173-31-11-250", what: "Position of the 3F handpiece on the rail (3D position is illustrative; drawing B sizes 246.3 × Ø105 × 45.4 mm are published)", from: "the rail's lower end, or a named point on the finished wall" },
  { fitting: "Towel rail VS900HBN (both)", what: "Height of the rail foot", from: "finished floor tiles, on the left-wall finished (tile) face (owner proposed 750 mm; not surveyed)" },
  { fitting: "Towel rail VS900HBN (both)", what: "Bracket end offsets along the 900 mm tube (60 mm, inferred from (900 − 780) / 2, not a sheet dimension)", from: "each end of the 900 mm tube, to the fixing centre (sheet publishes 780 mm centres only)" },
  { fitting: "Ahrok SDP-40BN bath waste", what: "Visible dome diameter and dome height above the waste flange (unsourced; drawn stand-ins live only on the kind size)", from: "the bath floor / waste flange of SB184-1000GW (no manufacturer sheet; carton names the 40 mm connection only)" },
  { fitting: "Ahrok SDP-40BN bath waste", what: "Fit of the 40 mm connection in the bath's Ø50 waste hole (owner, 7 Oct 2026: ordered with the bath, so expected to match; check on delivery)", from: "the Ø50 waste on the bath bisector, 520 mm from the right-angle corner" },
  { fitting: "Ahrok SDP-40BN bath waste", what: "Elevation of the waste dome (unsourced; drawn stand-in 590 mm above finished floor lives only on the kind). That figure conflicts with the bath's published 630 mm overall height and 550 mm inside depth", from: "the bath floor / waste flange; finished floor does not exist yet" },
  { fitting: "Basin mixer K1110-31", what: "Deck height above the finished floor (unsourced; drawn stand-in 850 mm lives only on the kind, taken from the vanity's measured overall height 850 mm; not an owner proposal and not a finished-floor tape)", from: "finished floor tiles once they exist, to the vanity deck / mixer flange" },
  { fitting: "OJ MWD5-1999-CBP3 thermostat", what: "Cover-plate width, height and projection of this exact CBP3 cover (unsourced; drawn stand-ins live only on the kind size)", from: "the CBP3 cover itself (brochure lists OxD5 / MxD5 / MxD5-UA sizes without naming CBP3)" },
  { fitting: "OJ MWD5-1999-CBP3 thermostat", what: "Mounting height to the plate", from: "hallway finished floor, next to the light switch (owner: 1000 mm, 7 Oct 2026; not surveyed)" },
  { fitting: "SCK0765L in-screed heating cable", what: "Keep-out for the toilet (not on the carton; route is unconstrained there)", from: "finished pan footprint, once the installer says whether cable stops short of it" },
  { fitting: "SCK0765L in-screed heating cable", what: "Keep-out for the vanity (not on the carton; route is unconstrained there)", from: "finished vanity footprint, once the installer says whether cable stops short of it" },
  { fitting: "SCK0765L in-screed heating cable", what: "Cable centre height in the screed (not on the carton)", from: "bottom face of the tiler's screed (top of the membrane / subfloor stack), not the underside of the tile unless that is the screed top" },
  { fitting: "SCK0765L in-screed heating cable", what: "Cover over the cable, minimum bend radius, and whether the Coldbuster in-screed manual (July 2023, taken as this cable's: it does not name SCK0765L) applies; the floor sensor's conduit position (manual: about 300 mm into the heated area, between runs)", from: "Coldbuster, for this exact cable; the electrician for the sensor conduit" },
  { fitting: "Shower mixer K1130-31", what: "Plate centre height (owner proposed 1000 mm, 7 Oct 2026; not surveyed), position along the shower wall (not chosen; drawn 850 mm from the window wall) and body depth behind the tile", from: "finished floor tiles, on the left-wall finished (tile) face" },
  { fitting: "Toilet Cygnet Over-height with SpaLet", what: "S-trap set-out for the new waste (sheet: 140–260 mm, 260 nominal) and the cold water (180 mm high, 180 mm left of centre) and SpaLet power (300 mm high, 330 mm left of centre) points at the moved position", from: "the finished wall behind the pan and the pan centreline, facing the toilet; finished floor for heights" },
  { fitting: "Shower screen (Future Glass fixed panel)", what: "Which face the 1200 mm from the window wall is measured to", from: "the window wall's finished (tile) face or its frame, to the panel's centreline" },
  { fitting: "Bath SB184-1000GW", what: "Check the delivered bath: 1000 mm wall sides, 1090 mm corner-to-front, 630 mm height, waste 520 mm from the corner", from: "the two wall sides and the right-angle corner (sheet notes slight variations)" },
  { fitting: "Room walls", what: "Survey finished wall faces (or confirm the frame after strip-out) so #60 installation can replace the catalogue elevation stopgap", from: "each room-facing wall: existing surface is measured; finished face is still estimated from the frame plus proposed layers" },
];

const captainsListText = (): string =>
  ["Still needs the captain's measurement:", ...stillNeedsCaptainsMeasurement.map((e, i) => `${i + 1}. ${e.fitting} — ${e.what}. From: ${e.from}.`)].join(" ");

/** Room inside faces (existing surfaces, owner survey #1) the sample route is set out from. */
const ROOM = { w: 2.11, h: 3.02 };
/** Kano 316 insert centre, centred in the dry area (proposed). */
const KANO_AT = { x: 1.055, y: 2.11 };
/**
 * Coldbuster in-screed manual (July 2023), p. 6: mark the heated area 100–200 mm from the walls;
 * Coldbuster recommends 100 mm. Entered as the edge clearance, so the check also holds the cable
 * 100 mm off every entered keep-out.
 */
export const SAMPLE_CABLE_EDGE_CLEARANCE_M = 0.1;
/** SCK0765L carton: heated length 42.5 m. */
const SAMPLE_CABLE_HEATED_LENGTH_M = 42.5;
const COLDBUSTER_MANUAL = "Coldbuster In Screed Heater Kit Installation Manual (July 2023)";
/** Owner, 7 Oct 2026: no cable under the bath. The bath's plan box out to the right wall's surface. */
export const sampleHeatingKeepouts = (): Heating["keepouts"] => [{
  id: "keepout_bath", label: "Bath",
  x: quantize(BATH_CORNER.x - BATH_BOX), y: 0, w: quantize(ROOM.w - (BATH_CORNER.x - BATH_BOX)), h: BATH_BOX,
  source: "Owner, 7 Oct 2026: floor under the bath left unheated so the heated area stays within the 5.1 m² the 42.5 m cable covers",
}];
/**
 * Proposed loop spacings. 105 mm in the dry area, 88 mm in the shower and beside the bath, both
 * inside the derived coverage/length range (3.7–5.1 m² / 42.5 m ≈ 87–120 mm) and the manual's
 * 70–120 mm for bathrooms (p. 7). Modelling choice, picked so the loop uses exactly 42.5 m.
 */
export const PROPOSED_CABLE_SPACING_DRY_M = 0.105;
export const PROPOSED_CABLE_SPACING_WET_M = 0.088;
export const PROPOSED_CABLE_SPACING_RATIONALE =
  "105 mm in the dry area and 88 mm in the shower and beside the bath (tighter where the floor is wet), both inside the derived coverage/length range (3.7–5.1 m² / 42.5 m ≈ 87–120 mm) and the Coldbuster manual's 70–120 mm for bathrooms (p. 7); the two spacings make the loop use exactly 42.5 m. Modelling choice, not a manufacturer or code spacing requirement.";

/**
 * East–west runs from the doorway (south) toward the window wall, thermostat end at the doorway.
 * The runs stay 100 mm off the walls and the bath keep-out (edge clearance), and 150 mm off the
 * left wall so they clear the linear drain (its 100 mm body sits against that wall). Runs either
 * side of the Kano waste are 225 mm apart, about 50 mm clear of its 120 mm grate each side (the
 * manual, p. 10: route round floor wastes, widening the loop). Beside the bath the runs stop
 * 100 mm short of it. The last run ends 1 mm past the line of the others so the plan length is
 * exactly 42.5 m.
 */
export function proposedSck0765lPath(): { x: number; y: number }[] {
  const clear = SAMPLE_CABLE_EDGE_CLEARANCE_M;
  const west = 0.15, east = quantize(ROOM.w - clear), north = clear;
  const bath = sampleHeatingKeepouts()[0];
  const bathRunEnd = quantize(bath.x - clear), bathRunFrom = quantize(bath.y + bath.h + clear);
  const kanoClear = 0.05 + KANO_316_INSERT.grateD / 2;
  const ys: number[] = [];
  for (let y = 2.855; y >= KANO_AT.y + kanoClear - 1e-9; y -= PROPOSED_CABLE_SPACING_DRY_M) ys.push(quantize(y));
  for (let y = KANO_AT.y - kanoClear; y >= bathRunFrom - 1e-9; y -= PROPOSED_CABLE_SPACING_DRY_M) ys.push(quantize(y));
  const wet: number[] = [];
  for (let y = north; y < ys[ys.length - 1] - PROPOSED_CABLE_SPACING_WET_M / 2; y += PROPOSED_CABLE_SPACING_WET_M) wet.push(quantize(y));
  ys.push(...wet.reverse());
  const pts: { x: number; y: number }[] = [];
  let x = west;
  ys.forEach((y, i) => {
    pts.push({ x, y });
    x = x === west ? (y >= bathRunFrom ? east : bathRunEnd) : west;
    pts.push({ x, y });
  });
  let plan = 0;
  for (let i = 1; i < pts.length; i++) plan += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  // the remainder of the 42.5 m heated length extends the last run in its own direction
  const last = pts[pts.length - 1], before = pts[pts.length - 2];
  last.x = quantize(last.x + Math.sign(last.x - before.x) * (SAMPLE_CABLE_HEATED_LENGTH_M - plan));
  return pts;
}

const cableCarton = (value: number | string, note: string, reference?: ReferenceId): FieldValue => ({
  value, status: "published", source: CARTON_LABEL_SOURCE, note: `SCK0765L in-screed heating cable carton: ${note}`,
  ...(reference ? { reference } : {}),
});

/** Stable ids the sample heating record references; they name the carton/label products, not a live library insert. */
export const SAMPLE_CABLE_PRODUCT_ID = "sample-sck0765l-carton";
export const SAMPLE_THERMOSTAT_PRODUCT_ID = "sample-mwd5-1999-cbp3";

/** Label figures are published from the carton; nothing here is derived or modelled. */
export const heatingCableSpecification = (): ProductSpecification => {
  const cat = categoryById("heating-cable")!;
  const fields = unknownMeasurementFields(cat);
  for (const [k, v] of Object.entries(fields)) {
    if (v.value === null) fields[k] = { value: null, note: "Not printed on the SCK0765L carton label." };
  }
  const spec: ProductSpecification = {
    category: "heating-cable",
    recordingMode: "human-measurement",
    acceptedAt: 0,
    fields: {
      ...fields,
      cableType: cableCarton("in-screed", "installation type in-screed"),
      cableLength: cableCarton(42.5, "heated length 42.5 m", "fixture-end"),
      outputPerMetre: cableCarton(18, "18 W/m"),
      totalPower: cableCarton(765, "765 W"),
      ratedVoltage: cableCarton(240, "240 V AC"),
      ratedCurrent: cableCarton(3.2, "3.2 A"),
      resistance: cableCarton(75.3, "75.3 Ω"),
      coverageAreaMin: cableCarton(3.7, "coverage 3.7–5.1 m², minimum"),
      coverageAreaMax: cableCarton(5.1, "coverage 3.7–5.1 m², maximum"),
    },
  };
  return Object.assign(spec, { model: "SCK0765L", productId: SAMPLE_CABLE_PRODUCT_ID });
};

export const thermostatSpecificationOf = (): ProductSpecification => {
  const spec = specOf(purchasedFittings.find((f) => f.specCategory === "thermostat")!);
  return Object.assign(spec, { manufacturer: "OJ Electronics", model: "MWD5-1999-CBP3", productId: SAMPLE_THERMOSTAT_PRODUCT_ID, acceptedAt: 0 });
};

// ---- Construction spec from the owner ------------------------------------------------------
// Survey (#1): existing internal surfaces 2110 × 3020 mm, measured. Each wall's drawn line sits
// 50 mm behind its existing surface. The frame is about 45 mm behind the surface where it was
// seen once: an estimate. Walls are stripped to the frame and lined with 6 mm Villaboard.
// Wall membrane (owner, 7 Oct 2026): the floor's Bastion liquid polyurethane, about 1.5 mm, full
// height over the wet area. Wall layers here are whole-wall, so its extent is a note, not a layer (#88).
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
/** 3D colours only, read off the owner's tile photos; not a product colour code. */
const WHITE_TILE = "#f2f2ef";
const BEIGE_TILE = "#d9c4a3";
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
  ? { tileLength: proposed(0.6), tileWidth: proposed(0.6), orientation: "landscape", joint: JOINT, floor: "finished", originUp: BASE_JOINT, tiledHeight: FOUR_COURSES, ...START[wall], note: `${WHITE}. Four full courses; full tiles start at the door end; timber trim above, later.`, color: WHITE_TILE }
  : { tileLength: proposed(0.6), tileWidth: proposed(0.3), orientation: "portrait", joint: JOINT, floor: "finished", originUp: BASE_JOINT, tiledHeight: FOUR_COURSES, ...START[wall], note: `${BEIGE}, the floor tile carried up the whole window wall from the floor, around the window frame, to the top of the fourth course: 600 mm edge vertical so its courses match the 600 mm courses on the other walls. Timber trim above, later.`, color: BEIGE_TILE };
const wall = (id: string, ax: number, ay: number, bx: number, by: number, tile: "white" | "beige"): Wall => ({
  // owner: about 2700 mm from the current floor to the cornice (about 2850 from the slab once stripped)
  id, ax, ay, bx, by, thickness: 0.1, height: 2.7,
  sides: { right: side(id, tile === "white" ? WHITE : BEIGE) }, tiling: { right: courses(id, tile) },
});

// ---- Reused toilet suite with Spalet E-bidet seat ------------------------------------------
// Owner: Reece listing 9509830 (Reece's product code, not the maker's). Markings from the unit:
// cistern TF-4325, WaterMark AS 1172.2 / WMK A21024, 4.5 L flush. Owner, 7 Oct 2026: American
// Standard's install and spec sheets for the Cygnet Hygiene Rim Over-height Square with SpaLet
// (M33158 Rev.03, Sep 2022): 700 deep, pan 365 wide, cistern 381 wide × 166 deep × 387 high,
// 857 overall, pan rim 450. The suite moves to the position on the plan (owner confirmed); its
// old waste is not reused.
const toiletSuite: ExactProduct = {
  manufacturer: "American Standard",
  model: "Cygnet Hygiene Rim Over-height Square close coupled back-to-wall toilet suite, bottom inlet, with SpaLet E-bidet seat",
  code: "9509830",
  physicalItem: {
    label: "American Standard Cygnet Over-height Square back-to-wall suite with SpaLet E-bidet seat (reused, moved)",
    notes: "Reece product code 9509830, from the owner's screenshot of the listing. Spalet seat label (photographed 5 Oct 2026): American Standard Spalet E-Bidet, full function with deodoriser, model type CEAS7SS1-0100510R0, product number SAR1101330, 230 V 50 Hz, rated 300 W, water pressure 0.06–0.75 MPa, IPX4, WaterMark WMTS-051 WM-022901. The workbook's 1800 W (from the installation sheet) is the figure to size the GPO circuit until the electrician says otherwise. Markings recorded from the pan and cistern: cistern TF-4325 (a model candidate), WaterMark AS 1172.2 / WMK A21024, 4.5 L. American Standard install and spec sheets (owner's copies, 7 Oct 2026; M33158 Rev.03): 700 mm deep, pan 365 mm wide, cistern 381 wide × 166 deep × 387 high, 857 mm overall, pan rim 450 mm; inlet valve 500 kPa; outlet universal S & P (S-trap set-out 140–260 mm from the finished wall to the waste centre, 260 nominal; P-trap 190 mm high); cold water point 180 mm high, 180 mm left of the pan centreline facing it; SpaLet power point 300 mm high, 330 mm left of centre; pan screwed to the floor with the supplied brackets and bedded in sealant. These replace the owner's earlier spec (cistern 385 × 165, seat about 480 wide). Workbook: seat 1800 W on a ~1.7 m cord. The toilet moves to the plan position (owner, 7 Oct 2026), so a new waste is cut there; the old one is not reused.",
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
        { id: "floor_membrane", kind: "waterproofing", name: "Membrane (Bastion liquid polyurethane)", thickness: { value: 0.0015, status: "estimated", source: "owner, 7 Oct 2026: liquid polyurethane, about 1.5 mm" } },
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
        { id: "linear_drain", label: LAUXES_LABEL, kind: "linear", ax: 0.05, ay: 0.1, bx: 0.05, by: 0.1 + LAUXES_NEXT_GEN_35.length, product: lauxesNextGen35() },
        { id: "square_waste", label: KANO_LABEL, kind: "point", ax: KANO_AT.x, ay: KANO_AT.y, bx: KANO_AT.x, by: KANO_AT.y, product: kano316Insert() },
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
      note: `${BEIGE}. Long side runs toward the window wall and continues up it. Full tiles start at the doorway.`, color: BEIGE_TILE,
    },
    heating: {
      productSource: "SCK0765L carton label",
      cableProductId: SAMPLE_CABLE_PRODUCT_ID,
      thermostatProductId: SAMPLE_THERMOSTAT_PRODUCT_ID,
      cableSpecification: heatingCableSpecification(),
      thermostatSpecification: thermostatSpecificationOf(),
      thermostatLocation: {
        description: "Hallway wall outside the bathroom, next to the light switch (right as you look into the bathroom), 1000 mm off the floor. Not drawn on this plan.",
        source: "Owner, 5 Oct 2026; height raised to 1000 mm, 7 Oct 2026",
        kind: "outside-wet-room",
      },
      screedLayerId: "floor_screed", zoneIds: ["bathroom"], path: proposedSck0765lPath(), keepouts: sampleHeatingKeepouts(),
      edgeClearance: { value: SAMPLE_CABLE_EDGE_CLEARANCE_M, status: "published", source: `${COLDBUSTER_MANUAL}, p. 6: mark 100–200 mm from the walls; Coldbuster recommends 100 mm. Taken as this cable's manual: it does not name SCK0765L` },
      requirements: `Owner lays it on the cured membrane, before the tiler's screed, fixed with Ametalin tape (polyurethane membrane; owner holds 100 m) at the run ends and every 1–1.5 m, per the Coldbuster in-screed manual (July 2023, taken as this cable's manual: it does not name SCK0765L). The electrician tests it before and after the screed (the manual's p. 16 record, for the warranty), wires the thermostat on an RCD circuit, and runs the floor sensor's conduit. Owner, 5 Oct 2026: the thermostat end is at the bathroom doorway, where the floor beyond is timber; the 3.0 m cold tail (manual; the manual's cable is Ø6 mm) goes down through it to under the house (on piers). Owner, 7 Oct 2026: the cable runs under the shower (the electrician approved it) but not under the bath, so the heated area stays within the 5.1 m² that 42.5 m covers. Proposed loop: east–west runs, 100 mm off the walls and the bath (manual, p. 6), 150 mm off the left wall to clear the linear drain, widened round the Kano waste (manual, p. 10); ${PROPOSED_CABLE_SPACING_RATIONALE} Plan length is exactly 42.5 m, equal to the published heated length (zero slack): any resolved fall makes the spatial route exceed 42.5 m once screed levels resolve. Not yet decided: keep-outs at the toilet (its pan is screwed to the floor through brackets) and the vanity; the route runs under both.`,
    },
  }],
  items: [
    ...purchasedFittings.flatMap((f) => [f.placement, ...(f.extra ?? [])].filter((p): p is Item_ => !!p).map((p): Item => ({
      ...p, productIdentity: structuredClone(f.product), productSpecification: specOf(f), selectionStatus: "purchased",
    }))),
    // back to the right wall's finished face, centred 1700 mm from the window wall (proposed)
    { id: "vanity", kind: "vanity_recorded", x: 1.85, y: 1.7, rotation: 270, productIdentity: structuredClone(reusedVanity), selectionStatus: "reused" },
    // centred over the vanity, back to the same face; screwed up last, after the tiles
    { id: "shaving_cabinet", kind: "shaving_cabinet_recorded", x: 2.0, y: 1.7, rotation: 270, productIdentity: structuredClone(reusedCabinet), selectionStatus: "reused" },
    { id: "toilet", kind: "toilet_proxy", x: 1.7, y: 2.6, rotation: 270, productIdentity: structuredClone(toiletSuite), selectionStatus: "reused" },
    { id: "screen", kind: "screen_proposed", x: 0.45, y: 1.2, rotation: 0 },
  ],
  underlay: null,
  // Names the sheets so the plan can be issued and stage views exported straight from the sample.
  // No site address is recorded, so the room stands in for the site.
  sheetSet: { titleBlock: { project: "Bathroom Concept", site: "Bathroom (no site address recorded)" }, revisions: [] },
});

// ---- Drawn stand-ins for the reused toilet suite and the fixed screen -----------------------
/**
 * Toilet: Cygnet Over-height with SpaLet, from American Standard's sheets (M33158 Rev.03): 700
 * deep, 857 overall, cistern 381 × 166 × 387 on top of the pan at 470, pan 365 wide, rim 450.
 * The envelope is 381 wide (the cistern, the widest part). The pan's curved shape, the seat's
 * thickness and the control housing are not drawn on the sheets, so those parts are stopgap
 * (dashed). Back at −d/2, front at +d/2.
 */
const TOILET = { w: 0.381, d: 0.7, h: 0.857 };
const CISTERN = { w: 0.381, d: 0.166, h: 0.387 };
const PAN = { w: 0.365, rim: 0.45 };
const SEAT_T = 0.02; // stand-in: seat thickness is not on the sheets
const toiletBack = -TOILET.d / 2;
const STOPGAP = { stopgap: true as const };
const toilet: PartSpec[] = [
  box(0, 0, 0, PAN.w, PAN.rim, TOILET.d, { ...GLAZE, ...STOPGAP }), // pan 365 wide, rim 450, 700 deep; drawn as a box, its curved shape is not drawn
  { shape: "cylinder", x: 0, y: PAN.rim, z: toiletBack + CISTERN.d + (TOILET.d - CISTERN.d) / 2, w: PAN.w, d: TOILET.d - CISTERN.d, h: SEAT_T, ...GLOSS, ...STOPGAP }, // SpaLet seat on the rim; thickness is a stand-in
  box(0, TOILET.h - CISTERN.h, toiletBack + CISTERN.d / 2, CISTERN.w, CISTERN.h, CISTERN.d, GLAZE), // cistern 381 × 166 × 387, top at 857
  box(0.15, PAN.rim, toiletBack + CISTERN.d + 0.04, 0.06, 0.05, 0.08, { color: "#d9dbdc", roughness: 0.4, ...STOPGAP }), // seat control housing: size not recorded
];
/**
 * Fixed screen: Future Glass single fixed panel (GW-F), 900 × 2000 (owner, 5 Oct 2026), 10 mm
 * glass (owner, 7 Oct 2026; the install guide does not give the thickness). Future Glass install
 * guide (2024): no wall channel and no brace bar; two wall clips on a plumb line 200 mm and
 * 1800 mm above the floor, and at the floor either a third clip or two 3 mm rubber blocks 80 mm
 * from each end of the panel (80 and 820 mm for this 900 panel). This sample draws the rubber
 * blocks. Clip and block sizes are not on the guide, so those parts are stopgap stand-ins kept
 * inside the 900 × 10 × 2000 envelope. The wall end is local −x.
 */
const SCREEN = { w: 0.9, h: 2, glass: 0.01 };
const SCREEN_CLIPS = [0.2, 1.8]; // guide: clip heights above the floor
const SCREEN_BLOCKS = [0.08, 0.82]; // guide: 80 mm from each end of the panel, from the wall end
const CLIP = { along: 0.03, h: 0.05 }; // stand-ins: clip size is not on the guide
const BLOCK = { along: 0.03, h: 0.003 }; // 3 mm blocks; length along the panel is a stand-in
const CLIP_STYLE = { color: "#c9cccd", metalness: 0.85, roughness: 0.25, ...STOPGAP };
const screen: PartSpec[] = [
  box(0, 0, 0, SCREEN.w, SCREEN.h, SCREEN.glass, { color: "#d4ecf2", roughness: 0.05, metalness: 0.1, opacity: 0.22 }),
  ...SCREEN_CLIPS.map((up) => box(-SCREEN.w / 2 + CLIP.along / 2, up - CLIP.h / 2, 0, CLIP.along, CLIP.h, SCREEN.glass, CLIP_STYLE)),
  ...SCREEN_BLOCKS.map((along) => box(-SCREEN.w / 2 + along, 0, 0, BLOCK.along, BLOCK.h, SCREEN.glass, { color: "#2e2c2a", roughness: 0.8, ...STOPGAP })),
];

export const bathroomKinds: ProjectKind[] = [
  ...purchasedFittings.map((f): ProjectKind => ({
    entry: {
      kind: f.kind, label: f.label, w: f.size.w, d: f.size.d, h: f.size.h, color: "#b9bbbb", category: "bath",
      ...(f.size.elevation ? { elevation: f.size.elevation } : {}),
      ...(f.size.elevationNote ? { elevationNote: f.size.elevationNote } : {}),
      ...(f.outline ? { outline: structuredClone(f.outline) } : {}),
      ...(f.parts.some((p) => p.stopgap) ? { stopgap: true } : {}),
    } satisfies CatalogEntry,
    ...(f.parts.length ? { parts: structuredClone(f.parts) } : {}),
  })),
  { entry: { kind: "vanity_recorded", label: "Vanity", w: VANITY.w, d: VANITY.d, h: VANITY.h, color: "#f4f4f1", category: "bath" }, parts: structuredClone(vanity) },
  { entry: { kind: "shaving_cabinet_recorded", label: "Shaving cabinet", w: CABINET.w, d: CABINET.d, h: CABINET.h, elevation: CABINET.elevation, color: "#c9d6dc", category: "bath" }, parts: structuredClone(shavingCabinet) },
  { entry: { kind: "toilet_proxy", label: "Toilet", w: TOILET.w, d: TOILET.d, h: TOILET.h, color: "#e2ded4", category: "bath" }, parts: structuredClone(toilet) },
  // owner: Future Glass fixed panel 900 wide × 2000 high × 10 mm, 1200 mm from the window wall
  // (face not stated); wall clips and floor rubber blocks per the Future Glass guide
  { entry: { kind: "screen_proposed", label: "Fixed glass screen", w: SCREEN.w, d: SCREEN.glass, h: SCREEN.h, color: "#77b8d6", category: "bath" }, parts: structuredClone(screen) },
];

export const bathroomNotes = (): Note[] => {
  const at = Date.now();
  return [
    { id: "note-concept", author: "human", text: "Approximate concept sample for exploring a bathroom layout. Dimensions and geometry have been simplified for this editor.", at },
    { id: "note-placeholders", author: "human", text: "Wall sizes, opening details, fixture positions, and clearances include placeholders or proposals. Confirm them before relying on the plan.", at: at + 1 },
    { id: "note-limits", author: "human", text: "This sample is not measured set-out or a trade drawing. Drainage, services and falls are not represented; construction layers are recorded with their unknown thicknesses left unknown.", at: at + 2 },
    {
      id: "note-purchased", author: "agent", at: at + 3,
      text: "Purchased fittings, from photographed labels and the manufacturer's own specification drawing or sheet for the exact model: bath SB184-1000GW (Enflair drawing: 1000 mm sides, curved front 1090 mm from the corner, 630 mm high, waste 520 mm from the corner); bath set K1132-##-150+KDPP32 on the right wall (set drawing: one rectangular plate 200 × 65 × 4 mm, spout and Ø45 hub 120 mm apart and 60 mm either side of the plate centre (derived), Ø10 lever 107 mm from the hub top, body 61 mm and spout 150 mm from the plate's wall-side face, Ø24; 45 mm drop to the outlet from the K1150 drawing; envelope 117 mm high and 162 mm deep), made up of the K1132-31 trim with its K1132 inner part and the K1150-31-0-150 spout; Enflair K1110-31 basin mixer (drawing: 148 mm high, flange Ø48 × 5.5, overall 145 mm from the flange back, body centreline 24 mm from that back, top lever 120 mm, spout 112 mm from the body centreline, Ø20, 62 mm clearance; held label 6 L/min WELS 2054 vs current sheet 4.5 L/min); Enflair K1130-31 shower mixer (owner's copy of the drawing: round plate Ø65 × 4, hub Ø45, lever 107 mm from the hub top, 69.5 mm off the wall face, 103 mm overall) with its inner part; Y1173-31-11-250 shower (drawing: rail 981 mm Ø22, head Ø250, 427 mm from the mounting/wall face to the head connector centreline, plan depth 552 mm to the far edge of the head, bracket centres 500 mm with the G1/2 inlet at the upper rose only, drawing B handpiece 246.3 × Ø105 × 45.4 mm); Ahrok SDP-40BN 40 mm bath waste (photographed carton prints a 40 mm nominal connection; no manufacturer sheet, so that figure is not entered as a published product-brief field; ordered with the bath); two Thermorail VS900HBN 142 × 900 × 100 mm, tube Ø38, 780 mm centres, Ø32 roses, Ø25 stem section, 42 mm cap depth, 24 W (Thermogroup sheet); OJ MWD5-1999-CBP3 thermostat (brochure does not name the CBP3 cover; plate size stays unsourced). Owner proposals (not surveyed): bath set plate centre 750 mm and 500 mm from the window wall, shower lower bracket 1200 mm (inlet 1700 mm), shower mixer plate centre 1000 mm, towel-rail feet 750 mm, thermostat 1000 mm. The basin-mixer deck 850 mm stays unsourced (value null; drawn stand-in on the kind). The room has no wall anchors and no surveyed finished faces, so #60 installation is not used and the catalogue elevation stopgap remains.",
    },
    { id: "note-captain", author: "agent", at: at + 13, text: captainsListText() },
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
      text: "Still to confirm: the slab level after demolition (about 120 mm below the current tile, estimated); the finished-level target (set to the current tile level); the tile thickness (10 mm porcelain, estimated); the tiler's wall adhesive bed (4 mm, estimated); the frame positions (estimated); the width of the silicone or glue joint under the bottom course (4 mm assumed); the wall height (about 2700 mm from the current floor to the cornice, owner's estimate; about 2850 mm from the slab after stripping, which would put the slab nearer 150 mm down than 120 mm). Four courses reach about 2416 mm above the finished floor, leaving about 284 mm to the cornice for the timber trim. Membrane (owner, 7 Oct 2026): Bastion liquid polyurethane, about 1.5 mm (estimated), on the slab and the walls. On the walls it runs full height across the wet area: the whole window wall, and the left and right walls from the window wall to 100 mm past the screen line; elsewhere a 150 mm strip at the floor (both agreed defaults, proposed). Wall layers in this model are whole-wall, so the wall membrane is recorded here and not drawn (#88). Still to confirm with the waterproofer: its datasheet film thickness, the bond breaker at the floor-wall joint, the water stop at the door, and whether the 1200 mm screen line is to the tile face or the frame.",
    },
    {
      id: "note-drains", author: "human", at: at + 9,
      text: "Drains (bought from Surreal Solutions, packing slip INV-211061, 24 Sep 2026): Lauxes Aluminium Brushed Nickel Next Gen 35 Custom, 1000 × 100 × 35 mm, with 1× EC35-BN and 1× WO50-BN, along the left wall of the shower opposite the bath and beneath the shower head, a small distance off the wall and centred on the shower; and a KANO 316 Brushed Nickel Tile Insert Waste 120×120, centred in the dry area (surrealsolutions.com.au/shop/kano-316-brushed-nickel-tile-insert-smart-waste/). Owner, 5 Oct 2026: delivered (channel, grate, end cap, Kano insert waste and packing slip photographed); both outlet pieces found in the boxes; the Kano outlet is 50 mm. BuildMat's Next Gen 35 listing: 35 mm deep × 100 mm wide, the waste outlet can be positioned anywhere along the bottom tray, and 1.0/1.6/2.0 m cut lengths come with a pair of thin end caps and one waste outlet (40, 50, 72 or 80 mm).",
    },
    {
      id: "note-drains-open", author: "agent", at: at + 10,
      text: "Drains, still open: the gap from the left wall (recorded as the channel centreline about 75 mm in front of the estimated finished wall face, so its 100 mm body stands about 25 mm off the tile); where the 50 mm outlet sits along the channel (Lauxes drills it wherever the plumber's pipe lands); the puddle flanges for the two outlets, which neither item includes (usually the plumber's, to confirm), and how the Kano's Ø90 spigot meets its 50 mm outlet; the falls in the shower and dry area and the finished level at each drain (none recorded, so the fall planes stay unresolved and the finished floor is the flat target). Depths (7 Oct 2026): the Lauxes 2026 catalogue confirms the Next Gen 35 (NXT35) at 100 × 35 mm; the WO50 outlet is 35 mm from its rim to the bottom of the pipe (owner's tape), so its bottom is about 70 mm below the grate (derived). The Kano 316 drawing gives a 20 mm tray and a Ø90 spigot 10 mm below it, 30 mm in all. With the slab about 120 mm below the finished floor (estimated), about 50 mm is left under the channel outlet for the membrane and the pipe bend: the plumber to check once the slab level is known.",
    },
    {
      id: "note-screen", author: "human", at: at + 5,
      text: "Shower screen: Future Glass single fixed panel (GW-F), 900 mm wide × 2000 mm high (owner, 5 Oct 2026; an earlier note said 2100), 10 mm glass (owner, 7 Oct 2026), set 1200 mm from the window wall. Future Glass install guide (2024): no wall channel and no brace bar. Two wall clips on a plumb line, 200 mm and 1800 mm above the floor (6 mm holes and anchors); at the floor either a third clip or two 3 mm rubber blocks 80 mm in from each end (80 and 820 mm for this panel), silicone both sides, 24 h to set and 48 h to cure. Put frame noggins behind the 200 and 1800 mm clip points before the Villaboard. Still open: which face the 1200 mm is measured to, and that the panel bought is the GW-F.",
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
      text: "Open points from the labels and sheets: (1) the bath set's in-wall body: inlet spacing, size and concealed depth are not on the set drawing; the K1130 body depth behind the plate (about 33.5 mm) is derived, not a published rough-in depth. (2) K1130 and K1132 labels say max 500 kPa and 80 °C; the shower mixer instruction sheet says 0.05–1 MPa and 0–75 °C. Treat the lower figures as the limit until the supplier confirms. (3) Where the shower mixer sits along the shower wall is not chosen (drawn 850 mm from the window wall). (4) VS900HBN is 12 V; each rail came with its own transformer, and both go up in the ceiling space for access (owner, 5 Oct 2026); each rail's concealed 12 V lead runs up inside the wall to its transformer, and the electrician wires the mains side. (5) The thermostat (IP21) goes outside the bathroom on the hallway wall, next to the light switch, which is on the right as you look into the bathroom, 1000 mm off the floor (owner, 7 Oct 2026, the bottom of the Coldbuster manual's 1000–1500 mm range for a hardwired thermostat); it is not drawn here; its CBP3 cover size is not on the OJ brochure. The floor sensor is included (owner). (6) Heating cable SCK0765L: 765 W at 18 W/m, 42.5 m, 240 V AC 3.2 A, 75.3 Ω, for 3.7–5.1 m² from the carton (published); derived spacing 3.7/42.5–5.1/42.5 m. Owner, 7 Oct 2026: no cable under the bath (entered as a keep-out); the 100 mm wall setback is the Coldbuster manual's recommendation (entered as the edge clearance). The proposed loop uses exactly 42.5 m (zero slack); any resolved fall exceeds that once screed levels resolve. The coverage check still warns: its area (5.33 m²) takes out only the bath keep-out, not the 100 mm setback; inside the setback and clear of the bath the heated area is about 4.3 m² (derived). The cable cannot be shortened. Toilet and vanity keep-outs are not decided. (7) Toilet (American Standard sheets, 7 Oct 2026): S-trap waste centre 140–260 mm from the finished wall (or P-trap 190 mm high), cold water 180 mm high and 180 mm left of the pan centreline, SpaLet power point 300 mm high and 330 mm left of centre; whether the seat needs its own outlet or reaches the moved vanity GPO is the electrician's call.",
    },
  ];
};
