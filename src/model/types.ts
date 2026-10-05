import type { FixtureInstallation, InstallationGeometry } from "./installation";
import type { ExactProduct, SelectionStatus } from "./productIdentity";
import type { ProductSpecification } from "./productMeasurements";
import type { FieldValue } from "./products";

/** Domain model — all units are meters, plan lives on the XY plane (y grows downward in 2D view). */

export interface Wall {
  id: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  thickness: number; // meters, e.g. 0.15
  height: number; // meters, e.g. 2.7
  /** Missing on older projects means provenance is unknown, not measured. */
  thicknessDefaulted?: boolean;
  heightDefaulted?: boolean;
  /** Reference faces per side (#4). Missing side means nothing is recorded, not zero. */
  sides?: Partial<Record<WallSideName, WallSide>>;
  /** Proposed wall tile set-out per side (#9). Missing side means nothing is proposed. */
  tiling?: Partial<Record<WallSideName, WallTiling>>;
}

/** Long edge horizontal ("landscape") or vertical ("portrait"). */
export type TileOrientation = "landscape" | "portrait";
/** The face of each wall meeting this one that the tiled run is cut to (#9). */
export type TileReferenceFace = "board" | "finished";
/** The floor level the first course is measured from (#9). */
export type TileFloorReference = "finished" | "screed" | "substrate" | "datum";

/**
 * A proposed tile set-out on one side of a wall (#9). Every length is user-entered with a
 * status; nothing is defaulted. The pattern is always a proposal for review, never as-built.
 *
 * The origin is one full tile `originAlong` from `originFrom`: from end A's limit face to the
 * tile's A-side edge, from end B's limit face to its B-side edge (both positive into the run),
 * or from the run's centre to its A-side edge (negative toward A). From an opening's jamb
 * (jamb-a: the jamb nearer end A, tiles running toward A; jamb-b likewise toward B) it is
 * the distance from that jamb to the tile's edge facing it. Its bottom edge is one full
 * course `originUp` above the floor reference.
 */
export interface WallTiling {
  /** longer tile edge, metres */
  tileLength?: Quantity;
  /** shorter tile edge, metres */
  tileWidth?: Quantity;
  orientation?: TileOrientation;
  joint?: Quantity;
  reference?: TileReferenceFace;
  floor?: TileFloorReference;
  /** jamb-a / jamb-b: from that jamb of `originOpening`, tiles running away from the opening toward that end */
  originFrom?: "a" | "b" | "centre" | "jamb-a" | "jamb-b";
  /** the opening a jamb origin is measured from */
  originOpening?: string;
  originAlong?: Quantity;
  originUp?: Quantity;
  /** top of the tiling above the floor reference */
  tiledHeight?: Quantity;
  note?: string;
  /** the tile's colour in the 3D view (CSS colour); appearance only, never a dimension */
  color?: string;
}

/** Walking the wall from end A to end B on the plan (x right, y down): the side on your left or right. */
export type WallSideName = "left" | "right";

/** How a value came to be. "published" is a manufacturer or retailer figure. There is no "default": an unsupplied value is simply absent. */
export type ValueStatus = "site-confirmed" | "measured" | "published" | "proposed" | "estimated";

/** A length with its provenance. No `value` means unknown. */
export interface Quantity {
  value?: number; // metres
  status?: ValueStatus;
  source?: string;
}

export type LayerKind = "board" | "waterproofing" | "adhesive" | "tile";

export interface BuildUpLayer {
  id: string;
  kind: LayerKind;
  name: string; // e.g. "Villaboard 6 mm"
  thickness: Quantity;
}

export type FloorLayerKind = "waterproofing" | "screed" | "adhesive" | "tile";

export interface FloorLayer {
  id: string;
  kind: FloorLayerKind;
  name: string; // e.g. "Sand/cement screed"
  thickness: Quantity;
}

/**
 * A room's proposed floor assembly (#6). Levels are metres, up positive, from a named datum
 * (by default the existing floor surface, 0). `substrateTop` is the top of the stripped
 * substrate as an offset from the datum (negative when the old finish is removed).
 */
export interface FloorAssembly {
  datum: string;
  /** What the substrate is, as found; free text, never assumed. */
  substrate?: string;
  substrateTop?: Quantity;
  /**
   * The finished floor level to aim for, above the datum, when the trade chooses the screed and
   * adhesive themselves. Levels with unknown layers below them are read down from it.
   */
  finishedTarget?: Quantity;
  /** Ordered from the substrate upward. */
  layers: FloorLayer[];
}

/** One side of a wall. Positions are offsets from the drawn line toward this side, in metres. */
export interface WallSide {
  /** The existing surface as surveyed. Kept as a measured reference; never converted to a frame position. */
  existing?: Quantity;
  /** The frame face after strip-out. Usually behind the existing surface (a smaller offset). */
  frame?: Quantity;
  /** Proposed build-up, ordered from the frame outward. */
  layers: BuildUpLayer[];
}

export type OpeningKind = "door" | "window";

export interface Opening {
  id: string;
  kind: OpeningKind;
  wallId: string;
  /** position along the wall, 0..1, measured to the CENTER of the opening */
  t: number;
  /** Named end from which the surveyed centre distance is measured. */
  anchorEnd?: "a" | "b";
  /** Centre distance from anchorEnd in metres. Older documents omit this and are migrated. */
  anchorDistance?: number;
  width: number; // meters (the clear span of the vano)
  sill: number; // height of the bottom edge (0 for doors, ~0.9 for windows)
  height: number; // clear height of the opening
  /** Missing on older projects means provenance is unknown, not measured. */
  widthDefaulted?: boolean;
  sillDefaulted?: boolean; // windows only
  /**
   * true while `height` is a default nobody supplied. Cleared the moment a real height is
   * entered. get_issues reports it so an agent asks the human instead of trusting it.
   */
  heightDefaulted?: boolean;
  /** doors only — which jamb carries the hinges (default "a", the wall's A end) */
  hinge?: "a" | "b";
  /**
   * doors only — which side of the wall the leaf swings to, walking from the wall's
   * A endpoint to its B endpoint on the plan (default "right").
   */
  side?: "left" | "right";
}

export const THERMOSTAT_LOCATION_KINDS = ["wet-room", "outside-wet-room"] as const;
export type ThermostatLocationKind = (typeof THERMOSTAT_LOCATION_KINDS)[number];

/** User-entered thermostat location. Kind is not inferred from the IP code. */
export interface ThermostatLocation {
  description: string;
  /** Absent or blank until a real source is entered; the IP-vs-location check stays required. */
  source?: string;
  /** Absent = unknown; the IP-vs-location check stays required. */
  kind?: ThermostatLocationKind;
}

/**
 * Proposed heating only. No unsupplied product value has a default. Lengths in metres; output in W.
 * Length, rated output and coverage are read from a referenced heating-cable brief when present;
 * they are not copied onto this record.
 */
export interface Heating {
  manufacturer?: string;
  model?: string;
  productSource?: string;
  requirements?: string;
  /** Heating-record length only while the referenced brief has no numeric cableLength. */
  length?: Quantity;
  ratedOutput?: Quantity;
  minSpacing?: Quantity;
  /**
   * Entered clearance from the selected zone boundary or keep-out rectangle.
   * Zone rectangles follow the room/plane as stored (the sample room is the existing internal
   * surface). The intended trade datum for a wall setback is the finished wall face; that
   * conversion is not applied here.
   */
  edgeClearance?: Quantity;
  /**
   * Height of the cable centre above the bottom face of the selected screed layer (top of the
   * layer below / subfloor stack). Not the underside of the tile, unless that face is the screed top.
   */
  depthFromBottom?: Quantity;
  screedLayerId?: string;
  /** Room id means the whole room; otherwise ids of this room's drainage planes. */
  zoneIds: string[];
  path: { x: number; y: number }[];
  keepouts: { id: string; label: string; x: number; y: number; w: number; h: number; source?: string }[];
  /** Accepted heating-cable product in this browser's library. Live fields win over the snapshot. */
  cableProductId?: string;
  /** Travels with the project when the library is absent. */
  cableSpecification?: ProductSpecification;
  thermostatProductId?: string;
  thermostatSpecification?: ProductSpecification;
  thermostatLocation?: ThermostatLocation;
}

export interface Room {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  floor: string; // floor finish key, e.g. "oak" | "tile" | "concrete" | "carpet"
  /** Proposed floor assembly and level datum (#6). Absent = nothing recorded. */
  floorBuildUp?: FloorAssembly;
  /** Proposed wastes and sloped floor planes (#7). Absent = nothing recorded. */
  drainage?: Drainage;
  heating?: Heating;
  /** Proposed floor tile pattern, always derived at finished wall faces (#10). */
  floorTiling?: FloorTiling;
}

/** One rectangular room floor or an explicit drainage plane, clipped at finished faces.
 * originX/Y locate a tile's upper-left edge from the finished west/north faces.
 * axis x lays the long edge along plan X, axis y along plan Y. Missing stays unknown.
 */
export interface FloorTiling {
  tileLength?: Quantity;
  tileWidth?: Quantity;
  joint?: Quantity;
  axis?: "x" | "y";
  zone?: "room" | string;
  originX?: Quantity;
  originY?: Quantity;
  /** which finished face originX is measured from (default west: a tile's west edge; east: its east edge) */
  originXFrom?: "west" | "east";
  /** which finished face originY is measured from (default north: a tile's north edge; south: its south edge) */
  originYFrom?: "north" | "south";
  note?: string;
  /** the tile's colour in the 3D view (CSS colour); appearance only, never a dimension */
  color?: string;
}

/**
 * A floor waste (#7), in plan metres. A point waste has a = b. `level` is the finished floor
 * level at the waste, metres above the room's floor datum; unknown stays unknown.
 */
export interface Waste {
  id: string;
  label: string;
  kind: "point" | "linear";
  ax: number;
  ay: number;
  bx: number;
  by: number;
  level?: Quantity;
}

/** A level entered at a plan position on a plane: metres above the datum. */
export interface FloorControl {
  id: string;
  label: string;
  x: number;
  y: number;
  level: Quantity;
}

/**
 * A rectangular region of floor with one explicit slope. `fall` is a ratio (metres of rise
 * per metre run: 0.0125 = 12.5 mm per m), rising away from `wasteId`. Without a fall a plane
 * can still be derived from its waste level plus one control level, or from three controls.
 */
export interface FloorPlane {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  wasteId?: string;
  fall?: Quantity;
  controls: FloorControl[];
}

export interface Drainage {
  wastes: Waste[];
  planes: FloorPlane[];
}

export interface Item {
  /** Accepted catalogue evidence and geometry pinned to this instance, independent of library edits. */
  productSnapshot?: import("./productLibrary").LibraryProduct;
  productGeometry?: import("./catalog").CatalogEntry;
  productUpdates?: { from: string; to: string; at: number; preserved: string[]; unresolved: string[] }[];
  id: string;
  kind: string; // catalog key
  x: number; // center
  y: number;
  rotation: number; // degrees, counterclockwise
  /** Set out from a wall face (#5). While set, x, y and rotation are derived from it. */
  anchor?: FixtureAnchor;
  /** Service connections (#5): entered, or copied from a library product's rough-in. */
  servicePoints?: ServicePoint[];
  installation?: FixtureInstallation;
  installationGeometry?: InstallationGeometry;
  /**
   * An accessory fitted inside another fixture (a bath waste, a basket): where it sits in its
   * host's own frame, across the host's centreline and out from the host's back edge, in metres.
   * Its x, y and rotation are derived from the host, so it moves and turns with it.
   */
  fittedTo?: { hostId: string; across: number; out: number };
  /** The product-library entry this fixture was placed from. */
  productId?: string;
  /** Exact identity evidence at placement; travels with project export/import. */
  productIdentity?: ExactProduct;
  /** Accepted evidence snapshot travels with the project, independently of browser library. */
  productSpecification?: ProductSpecification;
  /** Project decision, independent of research acceptance. Missing legacy state is unknown. */
  selectionStatus?: SelectionStatus;
  /**
   * A corner fixture that comes in a left and a right hand (#37): the kind for each, and which
   * one is in use (the stored hand). Re-anchor is refused when that hand disagrees with the wall,
   * or for derived corner waste; re-place the bath.
   */
  corner?: { left: string; right: string; side: "left" | "right" };
}

/**
 * Where a fixture's back sits: `gap` in front of a named face of one wall side, with its
 * centreline `distance` from a named wall end. Its position follows the face, so a fixture
 * set against the tile face moves when the build-up changes; one set against the frame does not.
 */
export interface FixtureAnchor {
  wallId: string;
  side: WallSideName;
  /** "existing" | "frame" | "board" | "finished" | a layer id */
  face: string;
  gap: number; // metres from the face to the fixture's back
  from: "a" | "b";
  distance: number; // metres from that wall end to the fixture centreline
  status: ValueStatus;
  source?: string;
}

/**
 * A service connection on a fixture. `out` is measured from a named face of the anchor wall
 * side (a range when `outMax` is set, e.g. an S-trap set-out); `across` from the fixture
 * centreline, facing the fixture, left negative; `up` above the finished floor. A missing
 * value is unknown and leaves the point unresolved.
 */
export interface ServicePoint {
  id: string;
  label: string;
  service: "waste" | "water" | "power";
  face: string;
  out?: number;
  outMax?: number;
  across?: number;
  up?: number;
  /** Converted host-frame coordinates are `derived`, never `published`. Published stays on the source-datum evidence. */
  status: ValueStatus | "derived";
  /** Present when across/out were converted from another datum (e.g. corner bisector). */
  basis?: "derived";
  source?: string;
  /** Original per-axis evidence; unsupported datums never become resolved coordinates. */
  axisEvidence?: { across?: FieldValue; out?: FieldValue; outMax?: FieldValue; up?: FieldValue };
}

export interface Underlay {
  dataUrl: string;
  opacity: number; // 0..1
  /** world-rect the image covers */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Pixel size of the copy THIS PAGE holds. The upload re-encodes to ≤1600 px, so it
   * rarely matches the file the human also pasted into their agent's conversation —
   * which is why get_underlay tells the agent to work in fractions, not pixels.
   */
  pw?: number;
  ph?: number;
}

/**
 * A destructive tool call an agent has asked for, parked until the human decides.
 * The WebMCP explainer flags user confirmation as an open question
 * (webmachinelearning/webmcp — "a way for a tool to prompt the user for confirmation");
 * this is the app's answer to it.
 */
export interface PendingApproval {
  id: string;
  tool: string;
  /** plain-language sentence shown to the human */
  request: string;
  args: Record<string, unknown>;
  at: number;
}

export interface Note {
  id: string;
  author: "human" | "agent";
  text: string;
  at: number; // epoch ms
}

export interface PlanModel {
  name: string;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  items: Item[];
  underlay: Underlay | null;
  /** Trade sheets (#29): title block and the revisions issued so far. */
  sheetSet?: SheetSet;
}

/** A blocking sheet finding someone chose to issue past, with the reason printed on the sheet. */
export interface Acknowledgement {
  code: string;
  ref: string;
  reason: string;
  by: "human" | "agent";
}

export interface SheetRevision {
  rev: string; // A, B, C…
  date: string; // YYYY-MM-DD
  sheet: string;
  note?: string;
  acknowledged: Acknowledgement[];
  /** Immutable issued content and the exact planning evidence it represents. Legacy records omit it. */
  content?: { svg: string; modelEvidence: string; productRefs: { itemId: string; productId?: string; revision?: number }[] };
}

export interface StageExport {
  label: string; date: string; svg: string; specHtml: string; elements: string[]; at: number; modelEvidence: string; acknowledged: Acknowledgement[]; note?: string;
  /** one elevation per wall side shown, from the same visible set; absent on older exports */
  elevations?: { surface: string; room: string; svg: string }[];
  /** the plan diagram was not requested; svg still holds it for older readers */
  planOmitted?: boolean;
}

export interface SheetSet {
  titleBlock: { project?: string; site?: string; preparedBy?: string };
  revisions: SheetRevision[];
  stageExports?: StageExport[];
}

export interface ActivityEntry {
  id: string;
  at: number;
  source: "human" | "agent" | "system";
  tool: string;
  summary: string;
  ok: boolean;
}

export type IssueSeverity = "error" | "warning";

export interface Issue {
  severity: IssueSeverity;
  code: string;
  message: string;
  refs: string[]; // entity ids involved
}

export const emptyModel = (): PlanModel => ({
  name: "Untitled plan",
  walls: [],
  openings: [],
  rooms: [],
  items: [],
  underlay: null,
});
