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
}

/** Walking the wall from end A to end B on the plan (x right, y down): the side on your left or right. */
export type WallSideName = "left" | "right";

/** How a value came to be. There is no "default": an unsupplied value is simply absent. */
export type ValueStatus = "site-confirmed" | "measured" | "proposed" | "estimated";

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

export interface Room {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  floor: string; // floor finish key, e.g. "oak" | "tile" | "concrete" | "carpet"
}

export interface Item {
  id: string;
  kind: string; // catalog key
  x: number; // center
  y: number;
  rotation: number; // degrees, counterclockwise
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
