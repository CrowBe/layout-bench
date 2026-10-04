import type { CatalogEntry } from "./catalog";
import { cornerBathOutline } from "./products";
import type { Outline } from "./outline";
import type { ExactProduct, ProductComponent } from "./productIdentity";
import type { PartSpec } from "../three/furniture";
import type { ProjectKind } from "./projects";
import type { Item, Note, PlanModel, Quantity, Wall, WallSide, WallTiling } from "./types";

/**
 * A rough bathroom concept sample. Geometry and placements are illustrative, not set-out.
 * The purchased fittings below are the exception in one respect only: their codes and any
 * dimension a label prints are copied as printed. Every other size, mounting height and
 * position is a placeholder and says so in the kind's label.
 */

type Item_ = Pick<Item, "id" | "kind" | "x" | "y" | "rotation"> & Partial<Pick<Item, "fittedTo">>;

const NICKEL = { color: "#b9bbbb", metalness: 0.85, roughness: 0.3 } as const;

const box = (x: number, y: number, z: number, w: number, h: number, d: number, style: Partial<PartSpec> = NICKEL): PartSpec =>
  ({ shape: "box", x, y, z, w, h, d, ...style });
const tube = (x: number, y: number, z: number, dia: number, h: number, style: Partial<PartSpec> = NICKEL): PartSpec =>
  ({ shape: "cylinder", x, y, z, w: dia, d: dia, h, ...style });

/** Where each fitting's figures come from. "label" = printed on the carton or sticker. */
export interface PurchasedFitting {
  kind: string;
  label: string;
  /** what the photo shows; the code is the printed one, never a guess */
  product: ExactProduct;
  /** footprint w × d × h; `printed` names the ones copied from a label */
  size: { w: number; d: number; h: number; printed: ("w" | "d" | "h")[]; elevation?: number; caveat?: string };
  parts: PartSpec[];
  /** real plan shape; drawn in 3D from the outline when there are no parts */
  outline?: Outline;
  /** present when the seed places it */
  placement?: Item_;
  /** further purchased units of the same fitting, placed separately */
  extra?: Item_[];
}

const fitting = (m: string, code: string, label: string, notes: string, manufacturer = "", components?: ProductComponent[]): ExactProduct =>
  ({ manufacturer, model: m, code, physicalItem: { label, notes }, ...(components ? { components, componentsStatus: "documented" as const } : {}) });

/** A part of a set that was seen, or not seen, in the photos. Its code and quantity stay unknown: nothing sourced says it ships with this fitting. */
const part = (name: string, note: string): ProductComponent =>
  ({ name, code: { state: "unknown", value: null, note }, quantity: null, provision: "unresolved", note });

// ---- Bath: Angie Corner 1000, SB184-1000GW ---------------------------------------------------
// Carton 1000 × 1000 × 630 mm, 36 kg net. Shape as reported by the owner: a right-angle isosceles
// triangle with a rounded hypotenuse. The 1000 mm legs sit along the two walls (right angle at
// the back-right, so the NE corner); the arc's bulge is a placeholder, not a measured sagitta.
// Its outline is extruded in 3D with a recessed basin, so it has no hand-built parts.
// The outline comes from the same function the product library uses for a corner bath: 1000 mm
// legs mean a 1414 mm chord across the front, and the bulge past the chord is the placeholder.
const BATH_LEG = 1;
const BATH_BULGE = 0.12;
const bathFields = {
  frontWidth: { value: Math.SQRT2 * BATH_LEG, status: "estimated" as const },
  frontProjection: { value: (Math.SQRT2 * BATH_LEG) / 2 + BATH_BULGE, status: "estimated" as const },
};
const bathOutline: Outline = cornerBathOutline(bathFields, BATH_LEG, BATH_LEG, "right")!;

// ---- Enflair wall set for the bath: K1132-31 outside part + K1150-31-0-150 spout ---------------
const wallMixer: PartSpec[] = [
  // a cylinder's axis is vertical, so a square plate stands in for the round trim
  box(0, 0.8, -0.03, 0.07, 0.07, 0.02),
  box(0.045, 0.825, 0.015, 0.1, 0.014, 0.014), // lever
];
const spout: PartSpec[] = [
  box(0, 0.8, -0.015, 0.045, 0.045, 0.03),
  box(0, 0.815, 0.075, 0.025, 0.025, 0.15), // 150 mm projection, as the label names it
];

// ---- Ahrok SDP-40BN bath waste, dome pop with pull-out basket, 40 mm -------------------------
// Fitted inside the bath. The 40 mm is the connection size printed on the carton; the visible
// dome, its height and where it sits in the tub are placeholders.
const waste: PartSpec[] = [
  tube(0, 0.59, 0, 0.07, 0.012),
  tube(0, 0.602, 0, 0.05, 0.008),
];

// ---- Basin: Enflair K1110-31 petite basin mixer, on the vanity top ----------------------------
const basinMixer: PartSpec[] = [
  tube(0, 0.85, -0.01, 0.035, 0.12),
  box(0, 0.94, 0.03, 0.02, 0.02, 0.1),
  box(0.03, 0.9, -0.01, 0.05, 0.012, 0.012), // lever
];

// ---- Shower: Y1173-31-11-250 system on a K1130 wall mixer -------------------------------------
// 250 mm rain head and 3F handpiece as printed; rail, arm reach and height are placeholders.
const shower: PartSpec[] = [
  box(0, 0.4, -0.185, 0.04, 1.6, 0.03), // rail
  box(0, 1.98, -0.07, 0.03, 0.03, 0.27), // arm
  tube(0, 1.96, 0.06, 0.25, 0.02), // 250 mm rain head
  box(0, 1.1, -0.15, 0.06, 0.1, 0.05), // slider
  tube(0, 0.98, -0.12, 0.05, 0.18, { color: "#2e2c2a", roughness: 0.5 }), // 3F handpiece
];

// ---- Thermorail VS900HBN, 12 V vertical rail, concealed wiring: 142 × 900 × 100 mm -------------
// The carton does not show its form. Two uprights and rungs are a stand-in inside that envelope.
const rail: PartSpec[] = [
  tube(-0.0545, 0.5, 0, 0.025, 0.9), tube(0.0545, 0.5, 0, 0.025, 0.9),
  ...[0.55, 0.7, 0.85, 1.0, 1.15, 1.3].map((y) => box(0, y, 0, 0.1, 0.02, 0.025)),
];

// ---- OJ Electronics MWD5-1999-CBP3 (Coldbuster 2" WiFi thermostat), flush --------------------
const thermostat: PartSpec[] = [
  box(0, 1.4, 0, 0.085, 0.085, 0.012, { color: "#f1f4f5", roughness: 0.4 }),
  box(0, 1.425, 0.007, 0.05, 0.035, 0.004, { color: "#1b1d1f", roughness: 0.2 }),
];

export const purchasedFittings: PurchasedFitting[] = [
  {
    kind: "bath_sb184_1000gw", label: "Corner bath",
    product: fitting("Angie Corner 1000mm Bath, GW", "SB184-1000GW", "Angie Corner 1000mm Bath, GW (SB184-1000GW)",
      "Carton label: 1 pc, 36 kg net, 46 kg gross, 1000 × 1000 × 630 mm. Owner: right-angle isosceles triangle, rounded hypotenuse. The arc depth and the bath's own height are unmeasured."),
    size: { w: 1, d: 1, h: 0.63, printed: ["w", "d", "h"], caveat: "carton size" },
    parts: [], outline: bathOutline, placement: { id: "bath", kind: "bath_sb184_1000gw", x: 1.6, y: 0.5, rotation: 0 },
  },
  {
    kind: "mixer_k1132_31", label: "Bath mixer",
    product: fitting("Profile III wall basin/bath mixer", "K1132-31", "Enflair K1132-31 outside part (K1132 inner part is the in-wall body)",
      "Label: brushed SS nickel, max static inlet pressure 500 kPa, max hot water 80°, WaterMark AS 3718:2021 WM-080082.", "Enflair",
      [part("K1132 inner part (in-wall body)", "Its carton was photographed; whether it is the body for this trim is not confirmed by a sourced sheet.")]),
    size: { w: 0.07, d: 0.06, h: 0.07, printed: [], elevation: 0.8, caveat: "size and height are placeholders" },
    parts: wallMixer, placement: { id: "bath_mixer", kind: "mixer_k1132_31", x: 1.85, y: 0.03, rotation: 0 },
  },
  {
    kind: "spout_k1150_31_0_150", label: "Bath spout",
    product: fitting("Profile III 150mm spout for basin/bath", "K1150-31-0-150", "Enflair K1150-31-0-150 spout (304SS, brushed SS nickel)",
      "Carton label: 304 stainless steel, brushed SS nickel, 150 mm.", "Enflair"),
    size: { w: 0.045, d: 0.15, h: 0.045, printed: ["d"], elevation: 0.8, caveat: "only the 150 mm reach is printed" },
    parts: spout, placement: { id: "bath_spout", kind: "spout_k1150_31_0_150", x: 1.55, y: 0.075, rotation: 0 },
  },
  {
    kind: "waste_sdp40bn", label: "Bath waste",
    product: fitting("Dome Pop Short Bath Waste 40mm, with pull out basket", "SDP-40BN", "Ahrok SDP-40BN dome pop short bath waste, 40 mm, pull-out basket, brushed nickel",
      "Carton label: WaterMark licence WM-022812, AS 1589-2001.", "Ahrok"),
    size: { w: 0.07, d: 0.07, h: 0.02, printed: [], elevation: 0.59, caveat: "dome size and its place in the tub are placeholders" },
    // 0.15 m across and 0.3 m from the back edge puts it inside the triangular bath, near the corner
    parts: waste, placement: { id: "bath_waste", kind: "waste_sdp40bn", x: 1.75, y: 0.3, rotation: 0, fittedTo: { hostId: "bath", across: 0.15, out: 0.3 } },
  },
  {
    kind: "mixer_k1110_31", label: "Basin mixer",
    product: fitting("Profile III petite basin mixer", "K1110-31", "Enflair K1110-31 petite basin mixer, brushed SS nickel",
      "Label: 6 L/min WELS licence 2054 (Jina Enterprises Pty Ltd), max static inlet pressure 500 kPa, max hot water 80°, WaterMark AS 3718:2021 WM-080082.", "Enflair"),
    size: { w: 0.08, d: 0.12, h: 0.13, printed: [], elevation: 0.85, caveat: "size is a placeholder; elevation is the vanity top" },
    parts: basinMixer, placement: { id: "basin_mixer", kind: "mixer_k1110_31", x: 2.02, y: 1.7, rotation: 270 },
  },
  {
    kind: "shower_y1173_31_11_250", label: "Shower system",
    product: fitting("Profile round twin shower system with adjustable rail", "Y1173-31-11-250", "Y1173-31-11-250 twin shower, 250 mm rain head, 3F handpiece, brushed nickel",
      "Label: 9.0 L/min WELS licence 1281 (Kaiping Huipu Shower Metalwork Industrial Co Ltd), WaterMark AS/NZS 3662 WMKT25262. Brand is not printed on the label.", "",
      [part("K1130 wall shower/bath mixer, inner part", "Its carton was photographed; the shower mixer instruction sheet shows its 45 mm and 60 mm dimensions without a clear datum."),
        part("K1130 outside part (handle trim)", "No carton for the trim was photographed; not confirmed as held.")]),
    size: { w: 0.25, d: 0.4, h: 2, printed: ["w"], caveat: "only the 250 mm head is printed; arm reach, rail and height are placeholders" },
    parts: shower, placement: { id: "shower_system", kind: "shower_y1173_31_11_250", x: 0.2, y: 0.6, rotation: 90 },
  },
  {
    kind: "towel_rail_vs900hbn", label: "Towel rail",
    product: fitting("VS900HBN", "VS900HBN", "Thermorail VS900HBN, 12 V vertical rail, round, brushed nickel, concealed wiring",
      "Carton label: 142 × 900 × 100 mm. 12 V: a low-voltage supply is needed and is not in the photos.", "Thermorail"),
    size: { w: 0.142, d: 0.1, h: 0.9, printed: ["w", "d", "h"], elevation: 0.5, caveat: "mounting height is a placeholder" },
    parts: rail, placement: { id: "towel_rail", kind: "towel_rail_vs900hbn", x: 0.05, y: 1.825, rotation: 90 },
    // the owner bought two; the second hangs beside the first on the left wall
    extra: [{ id: "towel_rail_2", kind: "towel_rail_vs900hbn", x: 0.05, y: 1.575, rotation: 90 }],
  },
  {
    kind: "thermostat_mwd5_1999_cbp3", label: "Thermostat",
    product: fitting("MWD5-1999-CBP3", "MWD5-1999-CBP3", "OJ Electronics Coldbuster 2\" WiFi thermostat, flush mount",
      "Label: incl. limitation sensor, 100–240 V AC / 16 A, 5–40 °C, housing IP21, flush mounting. The plate size is not printed.", "OJ Electronics"),
    size: { w: 0.085, d: 0.012, h: 0.085, printed: [], elevation: 1.4, caveat: "size and position are placeholders; IP21 may not suit this room" },
    parts: thermostat, placement: { id: "thermostat", kind: "thermostat_mwd5_1999_cbp3", x: 0.006, y: 2.1, rotation: 90 },
  },
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
const WHITE = "600 × 600 white gloss, a few light grey streaks";
const BEIGE = "300 × 600 sandy beige matte";
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
  frame: { value: 0.005, status: "estimated", source: "surface-to-frame about 45 mm, seen in one place (#1)" },
  layers: [
    { id: `${wall}_board`, kind: "board", name: "Villaboard 6 mm", thickness: proposed(0.006) },
    { id: `${wall}_adhesive`, kind: "adhesive", name: "Tile adhesive", thickness: unknown() },
    { id: `${wall}_tile`, kind: "tile", name: tile, thickness: unknown() },
  ],
});
/** Four full 600 mm courses on every wall, starting from the door end. */
const courses = (wall: string, tile: "white" | "beige"): WallTiling => tile === "white"
  ? { tileLength: proposed(0.6), tileWidth: proposed(0.6), orientation: "landscape", joint: JOINT, floor: "finished", originUp: BASE_JOINT, tiledHeight: FOUR_COURSES, ...START[wall], note: `${WHITE}. Four full courses; full tiles start at the door end; timber trim above, later.` }
  : { tileLength: proposed(0.6), tileWidth: proposed(0.3), orientation: "portrait", joint: JOINT, floor: "finished", originUp: BASE_JOINT, tiledHeight: FOUR_COURSES, ...START[wall], note: `${BEIGE}, the floor tile carried up the window wall: long side vertical so its courses match the 600 mm courses on the other walls. Timber trim above, later.` };
const wall = (id: string, ax: number, ay: number, bx: number, by: number, tile: "white" | "beige"): Wall => ({
  id, ax, ay, bx, by, thickness: 0.1, height: 2.4,
  sides: { right: side(id, tile === "white" ? WHITE : BEIGE) }, tiling: { right: courses(id, tile) },
});

export const seedBathroom = (): PlanModel => ({
  name: "Bathroom Concept",
  walls: [
    wall("wall_n", -0.05, -0.05, 2.16, -0.05, "beige"), // window wall
    wall("wall_e", 2.16, -0.05, 2.16, 3.07, "white"),
    wall("wall_s", 2.16, 3.07, -0.05, 3.07, "white"), // door wall
    wall("wall_w", -0.05, 3.07, -0.05, -0.05, "white"),
  ],
  openings: [
    // 1755 internal width, centred; sill 1520 above the existing floor (#1). The height is still a placeholder.
    { id: "window_n", kind: "window", wallId: "wall_n", t: 0.5, width: 1.755, sill: 1.52, height: 0.6 },
    // 800 jamb to jamb, one jamb 120 mm from the left wall (#1)
    { id: "door_s", kind: "door", wallId: "wall_s", t: 1.64 / 2.21, width: 0.8, sill: 0, height: 1.9, hinge: "b", side: "left" },
  ],
  rooms: [{
    id: "bathroom", x: 0, y: 0, w: 2.11, h: 3.02, label: "Bathroom", floor: "tile",
    // stripped back to the concrete footings layer; membrane on the concrete, the heating cable in the screed
    floorBuildUp: {
      datum: "existing floor surface", substrate: "concrete (footings layer, after strip-out)", substrateTop: unknown(),
      layers: [
        { id: "floor_membrane", kind: "waterproofing", name: "Waterproofing under the screed", thickness: unknown() },
        { id: "floor_screed", kind: "screed", name: "Screed (heating cable inside)", thickness: unknown() },
        { id: "floor_adhesive", kind: "adhesive", name: "Tile adhesive", thickness: unknown() },
        { id: "floor_tile", kind: "tile", name: BEIGE, thickness: unknown() },
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
      requirements: "Owner: laid in a snaking pattern on the membrane, before rough-in and screed. Route not drawn yet.",
    },
  }],
  items: [
    ...purchasedFittings.flatMap((f) => [f.placement, ...(f.extra ?? [])].filter((p): p is Item_ => !!p).map((p): Item => ({
      ...p, productIdentity: structuredClone(f.product), selectionStatus: "purchased",
    }))),
    { id: "vanity", kind: "vanity_recorded", x: 1.85, y: 1.7, rotation: 270 },
    { id: "toilet", kind: "toilet_proxy", x: 1.7, y: 2.6, rotation: 270 },
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
  { entry: { kind: "vanity_recorded", label: "Vanity", w: 0.91, d: 0.465, h: 0.85, color: "#b59c7f", category: "bath" } },
  { entry: { kind: "toilet_proxy", label: "Toilet", w: 0.48, d: 0.7, h: 0.8, color: "#e2ded4", category: "bath" } },
  // owner: fixed glass panel 900 wide × 2100 high, black clips, 1200 mm from the window wall (face not stated)
  { entry: { kind: "screen_proposed", label: "Fixed glass screen", w: 0.9, d: 0.01, h: 2.1, color: "#77b8d6", category: "bath" } },
];

export const bathroomNotes = (): Note[] => {
  const at = Date.now();
  return [
    { id: "note-concept", author: "human", text: "Approximate concept sample for exploring a bathroom layout. Dimensions and geometry have been simplified for this editor.", at },
    { id: "note-placeholders", author: "human", text: "Wall sizes, opening details, fixture positions, and clearances include placeholders or proposals. Confirm them before relying on the plan.", at: at + 1 },
    { id: "note-limits", author: "human", text: "This sample is not measured set-out or a trade drawing. Drainage, services and falls are not represented; construction layers are recorded with their unknown thicknesses left unknown.", at: at + 2 },
    {
      id: "note-purchased", author: "agent", at: at + 3,
      text: "Purchased fittings, from photographed labels (no dimensions inferred): bath SB184-1000GW (right-angle isosceles corner bath, 1000 mm legs, rounded hypotenuse; carton 1000 × 1000 × 630 mm, so height and arc depth are unmeasured); Enflair K1132-31 trim with K1132 inner part, K1150-31-0-150 spout; Enflair K1110-31 basin mixer; Enflair K1130 shower/bath mixer inner part; Y1173-31-11-250 shower system; Ahrok SDP-40BN 40 mm bath waste (fitted inside the bath); two Thermorail VS900HBN 142 × 900 × 100 mm; OJ MWD5-1999-CBP3 thermostat; in-screed heating cable SCK0765L. Models of these use placeholder shapes, reach and mounting heights; confirm each against its product sheet before ordering or setting out.",
    },
    {
      id: "note-sequence", author: "human", at: at + 6,
      text: "Construction order: (1) strip the walls to the timber frame and the floor back to the concrete footings layer; (2) fix 6 mm Villaboard to the frame; (3) waterproof the floor, under the screed; (4) lay the heating cable in a snaking pattern; (5) plumbing and electrical rough-in; (6) screed; (7) tiles. A thin timber trim panel goes above the tiles later.",
    },
    {
      id: "note-tiles", author: "human", at: at + 7,
      text: "Tiles: left, right and door walls 600 × 600 white gloss with a few light grey streaks. Floor and window wall 300 × 600 sandy beige matte: on the floor the long side runs toward the window wall, and it carries on up the window wall with the long side vertical so its courses match the other walls. Every wall gets four full 600 mm courses on a thin joint of silicone or tile glue at the floor (about 2416 mm in all with 4 mm joints); the rest of the height is a timber trim, later. Joints about 4 mm. To keep cuts down, full tiles start at the door: at the doorway on the floor, at the door-wall corner on the side walls, at the door's jamb on the door wall, and at the corner nearer the door on the window wall.",
    },
    {
      id: "note-tiles-open", author: "agent", at: at + 8,
      text: "Open before the tile cuts can be worked out: tile, adhesive, screed and membrane thicknesses, and the concrete level; whether the 4 mm is the joint (as recorded) or the adhesive bed; the width of the silicone or glue joint under the bottom course (4 mm assumed); the real ceiling height (the 2400 mm wall height is entered, not measured, and four courses reach about 2416 mm above the finished floor). No wall membrane is recorded: only the floor was named.",
    },
    {
      id: "note-screen", author: "human", at: at + 5,
      text: "Shower screen: fixed glass panel, 900 mm wide × 2100 mm high, fixed with black clips, set 1200 mm from the window wall. Which face the 1200 mm is measured to, the glass thickness and the clip positions are not recorded.",
    },
    {
      id: "note-purchased-open", author: "agent", at: at + 4,
      text: "Open points from the labels: (1) the K1130 shower/bath mixer photo is its inner part only; no outside part (handle trim) was seen, so none is drawn. (2) K1130 and K1132 labels say max 500 kPa and 80 °C; the shower mixer instruction sheet says 0.05–1 MPa and 0–75 °C. Treat the lower figures as the limit until the supplier confirms. (3) The sheet's 45 mm and 60 mm dimensions have no clear datum; they are not entered as a rough-in depth. (4) VS900HBN is 12 V; its supply or driver was not photographed. (5) The thermostat is IP21; check where it may go with the electrician. (6) Heating cable SCK0765L: 765 W at 18 W/m, 42.5 m, 240 V AC 3.2 A, 75.3 Ω, for 3.7–5.1 m² (about 87–120 mm spacing). No route is drawn; use the heating tools for that.",
    },
  ];
};
