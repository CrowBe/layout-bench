import { validInstallation, installationReading, mirroringProblem, type FixtureInstallation } from "./installation";
/**
 * Single source of truth. The UI buttons and the WebMCP tools call THE SAME actions,
 * so human and agent truly co-edit one model. Vanilla zustand store (usable outside React).
 */

import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type {
  Heating,
  ActivityEntry,
  Item,
  Note,
  Opening,
  OpeningKind,
  PendingApproval,
  PlanModel,
  Room,
  Underlay,
  Wall,
  WallSide,
  WallSideName,
  BuildUpLayer,
  LayerKind,
  Quantity,
  ValueStatus,
  FixtureAnchor,
  ServicePoint,
  SheetRevision,
  StageExport,
  FloorAssembly,
  FloorLayer,
  FloorLayerKind,
  Drainage,
  Waste,
  FloorPlane,
  FloorControl,
  WallTiling,
  FloorTiling,
  TileOrientation,
  TileReferenceFace,
  TileFloorReference,
} from "./types";
import { emptyModel } from "./types";
import { validHeating, heatingEvidence, heatingProductWriteGuard, heatingShadowedRecordKeys } from "./heating";
import { LAYER_KINDS, VALUE_STATUSES, layerLabel, sideFaces } from "./faces";
import { fittedPose, placementLimitations, anchorPose, applyAnchors, faceChoices } from "./fixtures";
import { hostWasteInHostFrame, productCornerSide, applyCornerHandChange, derivedServicePointMutation, isDerivedServicePoint } from "./fittedWaste";
import { drainageProblems, planeSurface } from "./drainage";
import { DRAIN_CATEGORY, wasteLinkFromProduct, wasteProduct } from "./wasteProduct";
import { floorTileLayout } from "./floorTiling";
import { TILE_FLOOR_REFERENCES, TILE_ORIENTATIONS, TILE_ORIGIN_FROM, TILE_REFERENCES, tilingLayout } from "./tiling";
import { DEFAULT_DATUM, FLOOR_RANK, FLOOR_LAYER_KINDS, FLOOR_LAYER_LABELS, floorLevels, finishedLevel } from "./floor";
import { exactSnapshot, SELECTION_STATUSES, type SelectionStatus } from "./productIdentity";
import { heatingAlreadyOnProduct, heatingRevisionSummary, retargetHeatingInModel, specificationFromProduct } from "./heatingProduct";
import { productStore, registerHeatingRevisionHook, type LibraryProduct } from "./productLibrary";
import { checkModel } from "./issues";
import { productPlacement } from "./productPlacement";
import { previewProductUpdate, type ProductUpdatePreview } from "./productUpdates";
import { planningEvidence, revisionOf } from "./productRevision";
import { itemPolygon, outlineExtents, outlineProblems, pointNearPolygon, type Outline } from "./outline";
import { checkSheet, reconcile, revisionLetter, sheetById, type AckInput } from "../sheets/check";
import { renderFloorPlan } from "../sheets/floorPlan";
import { SNAP, dist, formatMm, quantize, segLen, segPoint } from "./geometry";
import { catalogForItem, catalogByKind, registerCatalogEntry, resetRuntimeCatalog, type CatalogEntry } from "./catalog";
import { defineCustomKind, FURNITURE_BUILDERS, resetCustomKinds, type PartSpec } from "../three/furniture";
import { DEMO_ID, DOCUMENT_VERSION, STORAGE_KEY, demoProject, emptyLibrary, parseImport, parseLibrary, type ProjectDocument, type ProjectKind } from "./projects";

export interface RefCandidate {
  id: string;
  label?: string;
  kind?: string;
}

export interface ActionResult {
  ok: boolean;
  summary: string;
  /** Set when a reference did not select exactly one entity. */
  candidates?: RefCandidate[];
  [key: string]: unknown;
}

export type CameraMode = "orbit" | "top" | "walk";
export type ViewMode = "2d" | "3d";

export interface EditorState {
  view: ViewMode;
  camera: CameraMode;
  selectedWallId: string | null;
  selectedItemId: string | null;
  selectedRoomId: string | null;
  selectedOpeningId: string | null;
  /** pointer snap step in metres for the 2D editor; 0 turns it off. Typed values and tools never snap. */
  snapStep: number;
  drawMode: "select" | "wall" | "room" | "place" | "heating";
  placingKind: string | null;
  pendingWallStart: { x: number; y: number } | null;
}

export interface AppState {
  projects: ProjectDocument[];
  activeProjectId: string | null;
  chooserOpen: boolean;
  saveError: string | null;
  kinds: ProjectKind[];
  model: PlanModel;
  notes: Note[];
  activity: ActivityEntry[];
  editor: EditorState;
  undoStack: PlanModel[];
  webmcpStatus: "off" | "live";
  lastChangeAt: number;
  /** destructive agent calls waiting for a human decision */
  approvals: PendingApproval[];
  /** when true, destructive tool calls are parked until the human approves them */
  requireApproval: boolean;
  /** cross-origin tools discovered on partner origins, by tool name */
  supplierTools: string[];
  /** bumped whenever a kind is added to the catalogue at runtime, so the UI re-renders */
  catalogRev: number;
}

let idCounter = 0;
export const uid = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

const noSelection = { selectedWallId: null, selectedItemId: null, selectedRoomId: null, selectedOpeningId: null };

const initialEditor: EditorState = {
  view: "2d",
  camera: "orbit",
  selectedWallId: null,
  selectedItemId: null,
  selectedRoomId: null,
  selectedOpeningId: null,
  snapStep: SNAP,
  drawMode: "select",
  placingKind: null,
  pendingWallStart: null,
};

export const store = createStore<AppState>(() => ({
  projects: [emptyLibrary().projects[0]],
  activeProjectId: null,
  chooserOpen: true,
  saveError: null,
  kinds: [],
  model: emptyModel(),
  notes: [],
  activity: [],
  editor: initialEditor,
  undoStack: [],
  webmcpStatus: "off",
  lastChangeAt: Date.now(),
  approvals: [],
  requireApproval: true,
  supplierTools: [],
  catalogRev: 0,
}));

let storageReady = false;

function restoreKinds(kinds: ProjectKind[]) {
  resetRuntimeCatalog();
  resetCustomKinds();
  for (const kind of kinds) {
    registerCatalogEntry(structuredClone(kind.entry));
    if (kind.parts?.length) defineCustomKind(kind.entry.kind, structuredClone(kind.parts));
  }
}

export function initializeProjects(): void {
  if (storageReady) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const loaded = raw ? parseLibrary(raw) : emptyLibrary();
    // Keep every saved project intact. Older libraries used Sunset Loft as the reserved sample;
    // it now remains an ordinary user project while the bathroom concept is added once.
    const library = loaded.projects.some((project) => project.id === DEMO_ID)
      ? loaded
      : { ...loaded, projects: [demoProject(), ...loaded.projects] };
    // The chooser is deliberate on each page load; saved documents stay in place until selected.
    store.setState({ projects: library.projects, activeProjectId: null, chooserOpen: true,
      saveError: null, model: emptyModel(), notes: [], kinds: [] });
    storageReady = true;
  } catch (error) {
    // Do not write over an unreadable or newer saved library.
    store.setState({ saveError: `${error instanceof Error ? error.message : String(error)} Export the original data before resetting storage.`,
      chooserOpen: true });
  }
}

store.subscribe((state, previous) => {
  if (!storageReady) return;
  if (state.activeProjectId && (state.model !== previous.model || state.notes !== previous.notes || state.kinds !== previous.kinds)) {
    const projects = state.projects.map((project) => project.id === state.activeProjectId
      ? { ...project, model: state.model, notes: state.notes, kinds: state.kinds }
      : project);
    store.setState({ projects });
    return;
  }
  if (state.projects !== previous.projects || state.activeProjectId !== previous.activeProjectId) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: DOCUMENT_VERSION,
        activeId: state.activeProjectId, projects: state.projects }));
      if (state.saveError) store.setState({ saveError: null });
    } catch (error) {
      store.setState({ saveError: `Local save failed: ${error instanceof Error ? error.message : String(error)}. Export this project before closing the page.` });
    }
  }
});

export const projects = {
  open(id: string): ActionResult {
    const state = store.getState();
    if (!storageReady) return fail("Saved library is unreadable. Download the original data or reset it before opening a project.");
    if (state.approvals.length) return fail("Resolve pending agent approvals before switching projects.");
    const project = state.projects.find((p) => p.id === id);
    if (!project) return fail("Project not found.");
    restoreKinds(project.kinds);
    store.setState({ activeProjectId: id, model: structuredClone(project.model), notes: structuredClone(project.notes),
      kinds: structuredClone(project.kinds), editor: { ...initialEditor }, undoStack: [], activity: [],
      chooserOpen: false, catalogRev: state.catalogRev + 1, lastChangeAt: Date.now() });
    return ok(`Opened ${project.model.name}.`);
  },
  create(name: string, fromDemo = false): ActionResult {
    if (!storageReady) return fail("Resolve the unreadable saved library before creating a project.");
    if (store.getState().approvals.length) return fail("Resolve pending agent approvals before creating projects.");
    const trimmed = name.trim();
    if (!trimmed) return fail("Enter a project name.");
    const base = fromDemo ? store.getState().projects.find((p) => p.id === DEMO_ID)! : null;
    const project: ProjectDocument = { version: DOCUMENT_VERSION, id: uid("project"),
      model: { ...(base ? structuredClone(base.model) : emptyModel()), name: trimmed },
      presentation: base?.presentation ?? "planning",
      notes: base ? structuredClone(base.notes) : [], kinds: base ? structuredClone(base.kinds) : [] };
    store.setState((s) => ({ projects: [...s.projects, project] }));
    return this.open(project.id);
  },
  remove(id: string): ActionResult {
    if (id === DEMO_ID) return fail("The Bathroom Concept sample cannot be deleted.");
    const state = store.getState();
    if (!state.projects.some((p) => p.id === id)) return fail("Project not found.");
    if (state.approvals.length) return fail("Resolve pending agent approvals before deleting projects.");
    store.setState({ projects: state.projects.filter((p) => p.id !== id),
      ...(state.activeProjectId === id ? { activeProjectId: null, model: emptyModel(), notes: [], kinds: [],
        chooserOpen: true, editor: { ...initialEditor }, undoStack: [] } : {}) });
    if (state.activeProjectId === id) restoreKinds([]);
    return ok("Project deleted.");
  },
  resetDemo(): ActionResult {
    if (store.getState().approvals.length) return fail("Resolve pending agent approvals before resetting the sample.");
    const state = store.getState();
    const fresh = demoProject();
    store.setState({ projects: state.projects.map((p) => p.id === DEMO_ID ? fresh : p),
      ...(state.activeProjectId === DEMO_ID ? { model: fresh.model, notes: fresh.notes, kinds: fresh.kinds,
        undoStack: [], editor: { ...initialEditor } } : {}) });
    if (state.activeProjectId === DEMO_ID) restoreKinds(fresh.kinds);
    return ok("Bathroom Concept reset to the shipped sample.");
  },
  setPresentation(presentation: "planning" | "styled"): ActionResult {
    const state = store.getState();
    if (!state.activeProjectId) return fail("Open a project before changing its presentation.");
    store.setState((s) => ({ projects: s.projects.map((project) => project.id === s.activeProjectId
      ? { ...project, presentation }
      : project) }));
    return ok(`Presentation set to ${presentation}.`);
  },
  export(id: string): string {
    const state = store.getState();
    const project = state.projects.find((p) => p.id === id);
    if (!project) throw new Error("Project not found.");
    return JSON.stringify(project, null, 2);
  },
  import(raw: string, name: string): ActionResult {
    if (!storageReady) return fail("Resolve the unreadable saved library before importing a project.");
    if (store.getState().approvals.length) return fail("Resolve pending agent approvals before importing projects.");
    try {
      const source = parseImport(raw);
      const trimmed = name.trim();
      if (!trimmed) return fail("Enter a name for the imported project.");
      const project: ProjectDocument = { ...structuredClone(source), id: uid("project"),
        model: { ...structuredClone(source.model), name: trimmed } };
      store.setState((s) => ({ projects: [...s.projects, project] }));
      return this.open(project.id);
    } catch (error) { return fail(`Import failed: ${error instanceof Error ? error.message : String(error)}`); }
  },
  exportOriginalStorage(): string | null { return localStorage.getItem(STORAGE_KEY); },
  resetUnreadableStorage(): void {
    localStorage.removeItem(STORAGE_KEY);
    storageReady = false;
    initializeProjects();
  },
  showChooser(): void {
    if (!store.getState().approvals.length) store.setState({ chooserOpen: true });
  },
};

export const useAppStore = <T>(selector: (s: AppState) => T): T => useStore(store, selector);

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

export function logActivity(source: ActivityEntry["source"], tool: string, summary: string, ok = true) {
  const entry: ActivityEntry = { id: uid("act"), at: Date.now(), source, tool, summary, ok };
  store.setState((s) => ({ activity: [...s.activity.slice(-199), entry] }));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function pushUndo() {
  store.setState((s) => ({ undoStack: [...s.undoStack.slice(-49), structuredClone(s.model)] }));
}

/** Carry issued sheet revisions into a model being restored or cleared: issued sheets cannot be un-issued. */
function withIssued(next: PlanModel, current: PlanModel): PlanModel {
  const revisions = current.sheetSet?.revisions ?? [];
  const stageExports = current.sheetSet?.stageExports;
  if (!revisions.length && !stageExports?.length) return next;
  return { ...next, sheetSet: { titleBlock: next.sheetSet?.titleBlock ?? current.sheetSet!.titleBlock, revisions, ...(stageExports ? {stageExports} : {}) } };
}

function setModel(model: PlanModel) {
  // anchored fixtures follow their wall faces (#5), whatever changed
  store.setState({ model: applyAnchors(model), lastChangeAt: Date.now() });
}

/** id -> settle(granted); kept out of the store because promises are not serialisable state. */
const approvalResolvers = new Map<string, (granted: boolean) => void>();

const bumpCatalog = () => store.setState((s) => ({ catalogRev: s.catalogRev + 1 }));

const ok = (summary: string, extra: Record<string, unknown> = {}): ActionResult => ({ ok: true, summary, ...extra });
const fail = (summary: string, extra: Record<string, unknown> = {}): ActionResult => ({ ok: false, summary, ...extra });

/**
 * Mutating tools resolve a reference to exactly one entity.
 * An exact id wins. Otherwise a room label, or an item kind or catalogue label,
 * may match when that full string (case-insensitive) picks out one entity.
 * Walls and openings have no separate name, so only an exact id selects them.
 * Anything else — including a substring that hits one or many ids or names — fails
 * and lists those candidates. Read-only measure uses the same resolver in forgiving
 * mode: the first id that equals the reference or contains it.
 */
type Resolved<T> = { ok: true; entity: T } | { ok: false; summary: string; candidates: RefCandidate[] };

function describeCandidate(candidate: RefCandidate): string {
  const bits = [candidate.id];
  if (candidate.kind) bits.push(`kind "${candidate.kind}"`);
  if (candidate.label) bits.push(`label "${candidate.label}"`);
  return bits.join(", ");
}

function unresolved(noun: string, ref: string, candidates: RefCandidate[]): { ok: false; summary: string; candidates: RefCandidate[] } {
  if (candidates.length === 0) return { ok: false, summary: `${noun} "${ref}" not found.`, candidates };
  const list = candidates.map(describeCandidate).join("; ");
  return {
    ok: false,
    summary: `${noun} "${ref}" is not an exact id or a unique name, so nothing was changed. Candidates: ${list}.`,
    candidates,
  };
}

function resolveRef<T>(
  noun: string,
  ref: string,
  entities: readonly T[],
  spec: {
    id: (entity: T) => string;
    names: (entity: T) => string[];
    partial: (entity: T, ref: string) => boolean;
    candidate: (entity: T) => RefCandidate;
  },
  forgiving = false,
): Resolved<T> {
  if (forgiving) {
    const hit = entities.find((entity) => spec.id(entity) === ref || spec.partial(entity, ref));
    if (hit) return { ok: true, entity: hit };
    return { ok: false, summary: `${noun} "${ref}" not found.`, candidates: [] };
  }
  const exact = entities.filter((entity) => spec.id(entity) === ref);
  if (exact.length === 1) return { ok: true, entity: exact[0] };
  if (exact.length > 1) return unresolved(noun, ref, exact.map(spec.candidate));
  const q = ref.toLowerCase();
  const named = entities.filter((entity) => spec.names(entity).some((name) => name.toLowerCase() === q));
  if (named.length === 1) return { ok: true, entity: named[0] };
  if (named.length > 1) return unresolved(noun, ref, named.map(spec.candidate));
  return unresolved(noun, ref, entities.filter((entity) => spec.partial(entity, ref)).map(spec.candidate));
}

function resolveWall(ref: string, forgiving = false): Resolved<Wall> {
  return resolveRef("Wall", ref, store.getState().model.walls, {
    id: (wall) => wall.id,
    names: () => [],
    partial: (wall, hint) => wall.id.includes(hint),
    candidate: (wall) => ({ id: wall.id }),
  }, forgiving);
}

/** Read-only wall lookup. Forgiving mode keeps measure's first substring match. */
export function lookupWall(ref: string, forgiving = false): Resolved<Wall> {
  return resolveWall(ref, forgiving);
}

export function lookupRoom(ref: string): Resolved<Room> {
  return resolveRoom(ref);
}

export function lookupItem(ref: string): Resolved<Item> {
  return resolveItem(ref);
}

function resolveRoom(ref: string): Resolved<Room> {
  return resolveRef("Room", ref, store.getState().model.rooms, {
    id: (room) => room.id,
    names: (room) => [room.label],
    partial: (room, hint) => room.id.includes(hint) || room.label.toLowerCase().includes(hint.toLowerCase()),
    candidate: (room) => ({ id: room.id, label: room.label }),
  });
}

function resolveItem(ref: string): Resolved<Item> {
  return resolveRef("Item", ref, store.getState().model.items, {
    id: (item) => item.id,
    names: (item) => {
      const label = catalogForItem(item)?.label;
      return label ? [item.kind, label] : [item.kind];
    },
    partial: (item, hint) => {
      const q = hint.toLowerCase();
      const label = catalogForItem(item)?.label ?? "";
      return item.id.includes(hint) || item.kind.toLowerCase().includes(q) || label.toLowerCase().includes(q);
    },
    candidate: (item) => {
      const label = catalogForItem(item)?.label;
      return { id: item.id, kind: item.kind, ...(label ? { label } : {}) };
    },
  });
}

function resolveOpening(ref: string): Resolved<Opening> {
  return resolveRef("Opening", ref, store.getState().model.openings, {
    id: (opening) => opening.id,
    names: () => [],
    partial: (opening, hint) => opening.id.includes(hint),
    candidate: (opening) => ({ id: opening.id, kind: opening.kind }),
  });
}

function rejected(hit: { summary: string; candidates: RefCandidate[] }): ActionResult {
  return fail(hit.summary, { candidates: hit.candidates });
}

// ---------------------------------------------------------------------------
// Precision and opening helpers
// ---------------------------------------------------------------------------

/**
 * Collects every input that carried detail finer than the stored 0.1 mm, so the result can
 * say what was rounded instead of changing a number silently.
 */
function rounding() {
  const notes: string[] = [];
  return {
    q(v: number, label: string): number {
      const out = quantize(v);
      if (Math.abs(out - v) > 1e-12) notes.push(`${label} ${v} m stored as ${out} m`);
      return out;
    },
    ok(summary: string, extra: Record<string, unknown> = {}): ActionResult {
      return notes.length
        ? ok(`${summary} Rounded to 0.1 mm: ${notes.join("; ")}.`, { ...extra, rounded: notes })
        : ok(summary, extra);
    },
  };
}

/** Anchor as a caller supplies it; see FixtureAnchor. */
export interface AnchorInput {
  wallId: string;
  side: WallSideName;
  face: string;
  gap?: number;
  from?: "a" | "b";
  distance: number;
  status: ValueStatus;
  source?: string;
  installation?: FixtureInstallation;
}

/** Service point as a caller supplies it. Omitted or null numbers are unknown. */
export interface ServicePointInput {
  id?: string;
  label: string;
  service: ServicePoint["service"];
  face: string;
  out?: number | null;
  outMax?: number | null;
  across?: number | null;
  up?: number | null;
  status: ValueStatus;
  source?: string;
}

/** A length with provenance as a caller supplies it. Omitted or null `value` means unknown. */
export interface QuantityInput {
  value?: number | null;
  status?: ValueStatus;
  source?: string;
}

export interface LayerInput {
  /** Keep an existing layer's id when re-sending it; omitted for a new layer. */
  id?: string;
  kind: LayerKind;
  name?: string;
  thickness?: QuantityInput | null;
}

/** Fields present replace what is stored; null clears a position back to unknown. */
export interface WallSidePatch {
  existing?: QuantityInput | null;
  frame?: QuantityInput | null;
  layers?: LayerInput[];
}

export interface FloorLayerInput {
  /** Keep an existing layer's id when re-sending it; omitted for a new layer. */
  id?: string;
  kind: FloorLayerKind;
  name?: string;
  thickness?: QuantityInput | null;
}

/** Fields present replace what is stored; null clears back to unknown. */
type HeatingQuantityKey = "length" | "ratedOutput" | "minSpacing" | "edgeClearance" | "depthFromBottom";
type HeatingSpecKey = "cableSpecification" | "thermostatSpecification";
export type HeatingPatch = { [K in Exclude<keyof Heating, HeatingQuantityKey | HeatingSpecKey>]?: Heating[K] | null } &
  { [K in HeatingQuantityKey]?: QuantityInput | null } & { clear?: boolean };

export interface FloorPatch {
  datum?: string;
  substrate?: string | null;
  substrateTop?: QuantityInput | null;
  /** finished floor level to aim for above the datum; the trade's screed and adhesive fill to it */
  finishedTarget?: QuantityInput | null;
  layers?: FloorLayerInput[];
}

export interface WasteInput {
  id?: string;
  label?: string;
  kind: "point" | "linear";
  /** Point waste: its position. Linear waste: first end. Plan metres. */
  x: number;
  y: number;
  /** Linear waste: second end. */
  x2?: number;
  y2?: number;
  /** Finished floor level at the waste, metres above the datum. */
  level?: QuantityInput | null;
  /** Linear waste: outlet position along the channel, metres from the first end. */
  outletAt?: QuantityInput | null;
  /**
   * Accepted "drain" library product id. Omitted keeps the waste's current product (matched by
   * id); null unlinks it.
   */
  product?: string | null;
}

export interface ControlInput {
  id?: string;
  label?: string;
  x: number;
  y: number;
  level: QuantityInput | null;
}

export interface PlaneInput {
  id?: string;
  label?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** A waste id or label the plane falls toward. */
  waste?: string | null;
  /** Rise per metre run away from the waste (0.0125 = 12.5 mm per m). */
  fall?: QuantityInput | null;
  controls?: ControlInput[];
}

/** Lists present replace what is stored. */
export interface DrainagePatch {
  wastes?: WasteInput[];
  planes?: PlaneInput[];
}

/** Floor proposal inputs in metres; null clears a field, omitted fields are retained. */
export interface FloorTilingPatch {
  tileLength?: QuantityInput | null; tileWidth?: QuantityInput | null; joint?: QuantityInput | null;
  originX?: QuantityInput | null; originY?: QuantityInput | null; axis?: "x" | "y" | null;
  originXFrom?: "west" | "east" | null; originYFrom?: "north" | "south" | null;
  zone?: string | null; note?: string | null; clear?: boolean;
}

/** Wall proposal inputs in metres; null clears a field, omitted fields are retained. */
export interface TilingPatch {
  tileLength?: QuantityInput | null;
  tileWidth?: QuantityInput | null;
  orientation?: TileOrientation | null;
  joint?: QuantityInput | null;
  reference?: TileReferenceFace | null;
  floor?: TileFloorReference | null;
  originFrom?: "a" | "b" | "centre" | "jamb-a" | "jamb-b" | null;
  /** the opening on this wall whose jamb a jamb origin is measured from */
  originOpening?: string | null;
  originAlong?: QuantityInput | null;
  originUp?: QuantityInput | null;
  tiledHeight?: QuantityInput | null;
  note?: string | null;
  /** true removes this side's tiling */
  clear?: boolean;
}

/** Where an opening's centre sits: a 0..1 fraction of the wall, or a distance from a named end. */
export interface OpeningPosition {
  t?: number;
  /** metres from the named wall end to the opening's centre */
  centre?: number;
  from?: "a" | "b";
}

export interface OpeningPatch extends OpeningPosition {
  width?: number;
  sill?: number;
  height?: number;
}

/** Centre distance from end A, at stored precision, or null when no usable position was given. */
function centreFromA(wall: Wall, at: OpeningPosition, r: ReturnType<typeof rounding>): number | null {
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  if (at.centre !== undefined && Number.isFinite(at.centre)) {
    const c = r.q(at.centre, `centre from ${at.from ?? "a"}`);
    return at.from === "b" ? quantize(len - c) : c;
  }
  if (at.t !== undefined && Number.isFinite(at.t)) return quantize(at.t * len);
  return null;
}

/** Keep the whole opening inside its wall. Returns the centre from end A, or null if it cannot fit. */
function clampCentre(wall: Wall, width: number, centre: number): number | null {
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  if (width > len - 0.02) return null;
  return Math.min(len - width / 2, Math.max(width / 2, centre));
}

function openingAnchor(o: Opening, wall: Wall): { end: "a" | "b"; distance: number } {
  const end = o.anchorEnd === "b" ? "b" : "a";
  const distance = Number.isFinite(o.anchorDistance)
    ? o.anchorDistance!
    : quantize(o.t * segLen(wall.ax, wall.ay, wall.bx, wall.by));
  return { end, distance };
}

function anchorCentreFromA(end: "a" | "b", distance: number, len: number): number {
  return end === "b" ? len - distance : distance;
}

/** The usual height for the kind, reduced so it always fits under the wall. */
function defaultHeight(kind: OpeningKind, wall: Wall, sill: number): number {
  return quantize(Math.min(kind === "door" ? 2.1 : 1.2, wall.height - sill));
}

const heightPrompt = (o: Opening): string =>
  `Height was not supplied, so ${formatMm(o.height)} mm is a default, not a measurement. Ask for the actual height, then call edit_opening with id "${o.id}" and height in metres.`;

// ---------------------------------------------------------------------------
// Shared actions (UI + WebMCP tools)
// ---------------------------------------------------------------------------

/** Validate an anchor as a caller supplied it. Nothing changes until the caller applies it. */
function buildAnchor(input: AnchorInput):
  | { ok: true; anchor: FixtureAnchor; r: ReturnType<typeof rounding>; wall: Wall }
  | { ok: false; result: ActionResult } {
  const no = (summary: string) => ({ ok: false as const, result: fail(summary) });
  const w = resolveWall(input?.wallId ?? "");
  if (!w.ok) return { ok: false, result: rejected(w) };
  const wall = w.entity;
  if (input.side !== "left" && input.side !== "right") return no(`Side must be "left" or "right" (walking from end A to end B).`);
  const faces = faceChoices(wall, input.side).map((f) => f.face);
  if (!faces.includes(input.face)) return no(`Face must be one of ${faces.join(", ")} for the ${input.side} side of ${wall.id}.`);
  if (!VALUE_STATUSES.includes(input.status)) return no(`Anchor needs a status: ${VALUE_STATUSES.join(", ")}.`);
  if (input.from !== undefined && input.from !== "a" && input.from !== "b") return no(`from must be "a" or "b".`);
  if (input.gap !== undefined && (typeof input.gap !== "number" || !Number.isFinite(input.gap))) return no("Gap must be a number of metres.");
  if (typeof input.distance !== "number" || !Number.isFinite(input.distance)) return no("Distance must be a number of metres.");
  const r = rounding();
  const gap = r.q(input.gap ?? 0, "gap");
  if (!(gap >= 0)) return no("Gap cannot be negative: the fixture's back would be inside the face.");
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  const distance = r.q(input.distance, "distance");
  if (!(distance >= 0 && distance <= len)) return no(`Distance must be within the ${formatMm(len)} mm wall.`);
  const anchor: FixtureAnchor = { wallId: wall.id, side: input.side, face: input.face, gap, from: input.from === "b" ? "b" : "a", distance, status: input.status, ...(input.source?.trim() ? { source: input.source.trim() } : {}) };
  return { ok: true, anchor, r, wall };
}

export const actions = {
  // ---- structure ----
  addWall(ax: number, ay: number, bx: number, by: number, thickness?: number, height?: number): ActionResult {
    const r = rounding();
    ax = r.q(ax, "ax"); ay = r.q(ay, "ay"); bx = r.q(bx, "bx"); by = r.q(by, "by");
    const thicknessDefaulted = thickness === undefined;
    const heightDefaulted = height === undefined;
    thickness = r.q(thickness ?? 0.15, "thickness"); height = r.q(height ?? 2.7, "height");
    const len = segLen(ax, ay, bx, by);
    if (len < 0.2) return fail(`Wall too short (${formatMm(len)} mm, min 200 mm).`);
    if (!(thickness > 0) || !(height > 0)) return fail("Wall thickness and height must be positive.");
    const wall: Wall = { id: uid("wall"), ax, ay, bx, by, thickness, height, thicknessDefaulted, heightDefaulted };
    pushUndo();
    setModel({ ...store.getState().model, walls: [...store.getState().model.walls, wall] });
    return r.ok(`Wall added (${formatMm(len)} mm).${thicknessDefaulted ? " Thickness is a default, not a measurement." : ""}${heightDefaulted ? " Height is a default, not a measurement." : ""}`, { id: wall.id, length: len, thicknessDefaulted, heightDefaulted });
  },

  editWall(id: string, patch: Partial<Pick<Wall, "ax" | "ay" | "bx" | "by" | "thickness" | "height">>): ActionResult {
    const hit = resolveWall(id);
    if (!hit.ok) return rejected(hit);
    const wall = hit.entity;
    const r = rounding();
    const next: Wall = { ...wall };
    for (const k of ["ax", "ay", "bx", "by", "thickness", "height"] as const) {
      if (patch[k] !== undefined) next[k] = r.q(patch[k]!, k);
    }
    if (patch.thickness !== undefined) next.thicknessDefaulted = false;
    if (patch.height !== undefined) next.heightDefaulted = false;
    if (!(next.thickness > 0) || !(next.height > 0)) return fail("Edit rejected: wall thickness and height must be positive.");
    const len = segLen(next.ax, next.ay, next.bx, next.by);
    if (len < 0.2) return fail("Edit rejected: wall would be shorter than 200 mm.");
    const attached = store.getState().model.openings.filter((o) => o.wallId === wall.id);
    const relocated: Opening[] = [];
    const moved: string[] = [];
    for (const opening of attached) {
      const anchor = openingAnchor(opening, wall);
      const centre = anchorCentreFromA(anchor.end, anchor.distance, len);
      if (centre < opening.width / 2 - 1e-9 || centre > len - opening.width / 2 + 1e-9) {
        return fail(
          `Edit rejected: opening ${opening.id} no longer fits on the ${formatMm(len)} mm wall at ${formatMm(anchor.distance)} mm from end ${anchor.end.toUpperCase()}.`,
          { openingId: opening.id, reason: "opening_no_fit" },
        );
      }
      const oldCentre = segPoint({ x: wall.ax, y: wall.ay }, { x: wall.bx, y: wall.by }, opening.t);
      const newCentre = segPoint({ x: next.ax, y: next.ay }, { x: next.bx, y: next.by }, centre / len);
      if (dist(oldCentre, newCentre) > 1e-6) moved.push(opening.id);
      relocated.push({ ...opening, anchorEnd: anchor.end, anchorDistance: anchor.distance, t: centre / len });
    }
    pushUndo();
    setModel({
      ...store.getState().model,
      walls: store.getState().model.walls.map((w) => (w.id === wall.id ? next : w)),
      openings: store.getState().model.openings.map((o) => relocated.find((nextOpening) => nextOpening.id === o.id) ?? o),
    });
    const note = moved.length ? ` Openings repositioned with their wall: ${moved.join(", ")}.` : "";
    return r.ok(`Wall ${wall.id} updated (${formatMm(len)} mm).${note}`, { id: wall.id, length: len, ...(moved.length ? { movedOpenings: moved } : {}) });
  },

  removeWall(id: string): ActionResult {
    const hit = resolveWall(id);
    if (!hit.ok) return rejected(hit);
    const wall = hit.entity;
    pushUndo();
    const model = store.getState().model;
    setModel({
      ...model,
      walls: model.walls.filter((w) => w.id !== wall.id),
      openings: model.openings.filter((o) => o.wallId !== wall.id),
    });
    return ok(`Wall ${wall.id} removed (its openings were removed too).`, { id: wall.id });
  },

  // ---- wall faces (#4) ----
  /**
   * Record one side's existing surface, frame face and proposed build-up. A value needs a
   * status; a missing value stays unknown and every face beyond it stays unresolved.
   * Nothing is converted: the existing surface never becomes a frame position.
   */
  setWallSide(wallId: string, side: WallSideName, patch: WallSidePatch): ActionResult {
    const hit = resolveWall(wallId);
    if (!hit.ok) return rejected(hit);
    const wall = hit.entity;
    if (side !== "left" && side !== "right") return fail(`Side must be "left" or "right" (walking from end A to end B), not "${side}".`);
    const r = rounding();
    const quantity = (label: string, q: QuantityInput | null | undefined, nonNegative: boolean): Quantity | string => {
      if (!q) return {};
      const out: Quantity = {};
      if (q.source) out.source = String(q.source);
      if (q.value === undefined || q.value === null) return out;
      if (typeof q.value !== "number" || !Number.isFinite(q.value)) return `${label} must be a number of metres.`;
      if (!q.status || !VALUE_STATUSES.includes(q.status)) return `${label} needs a status: ${VALUE_STATUSES.join(", ")}.`;
      if (nonNegative && q.value < 0) return `${label} cannot be negative.`;
      out.value = r.q(q.value, label);
      out.status = q.status;
      return out;
    };
    const current: WallSide = wall.sides?.[side] ?? { layers: [] };
    const next: WallSide = { ...current, layers: [...current.layers] };
    for (const key of ["existing", "frame"] as const) {
      if (patch[key] === undefined) continue;
      const q = quantity(`${key === "existing" ? "Existing surface" : "Frame face"} position`, patch[key], false);
      if (typeof q === "string") return fail(`Rejected: ${q}`);
      if (patch[key] === null || q.value === undefined && !q.source) delete next[key];
      else next[key] = q;
    }
    if (patch.layers !== undefined) {
      if (!Array.isArray(patch.layers)) return fail("Rejected: layers must be a list, ordered from the frame outward.");
      const layers: BuildUpLayer[] = [];
      for (const [i, l] of patch.layers.entries()) {
        if (!l || !LAYER_KINDS.includes(l.kind)) return fail(`Rejected: layer ${i + 1} kind must be one of ${LAYER_KINDS.join(", ")}.`);
        const name = (l.name ?? "").trim();
        const t = quantity(`${name || l.kind} thickness`, l.thickness, true);
        if (typeof t === "string") return fail(`Rejected: ${t}`);
        const prev = layers[i - 1];
        if (prev && LAYER_KINDS.indexOf(l.kind) < LAYER_KINDS.indexOf(prev.kind)) {
          return fail(`Rejected: ${l.kind} cannot sit outside ${prev.kind}. Order from the frame out: ${LAYER_KINDS.join(", ")}.`);
        }
        const keep = l.id && current.layers.some((c) => c.id === l.id) && !layers.some((c) => c.id === l.id);
        layers.push({ id: keep ? l.id! : uid("layer"), kind: l.kind, name, thickness: t });
      }
      next.layers = layers;
    }
    const sides = { ...wall.sides };
    if (!next.existing && !next.frame && next.layers.length === 0) delete sides[side];
    else sides[side] = next;
    const nextWall: Wall = { ...wall, sides };
    if (Object.keys(sides).length === 0) delete nextWall.sides;
    pushUndo();
    setModel({ ...store.getState().model, walls: store.getState().model.walls.map((w) => (w.id === wall.id ? nextWall : w)) });
    const faces = sideFaces(next);
    const unresolved = faces.filter((f) => !f.resolved).map((f) => f.label);
    const layerText = next.layers.length ? next.layers.map(layerLabel).join(" → ") : "no layers";
    return r.ok(
      `Wall ${wall.id} ${side} side: ${layerText}.${unresolved.length ? ` Unresolved: ${unresolved.join(", ")}.` : " All faces resolved."}`,
      { id: wall.id, side, faces },
    );
  },

  /** Proposed floor set-out: same action for Inspector and WebMCP, with undo/persistence. */
  setFloorTiling(roomRef: string, patch: FloorTilingPatch): ActionResult {
    const hit = resolveRoom(roomRef);
    if (!hit.ok) return rejected(hit);
    const room = hit.entity;
    const current: FloorTiling = patch.clear ? {} : { ...room.floorTiling };
    const r = rounding();
    for (const key of [
      "tileLength",
      "tileWidth",
      "joint",
      "originX",
      "originY",
    ] as const) {
      const v = patch[key];
      if (v === undefined) continue;
      if (v === null) {
        delete current[key];
        continue;
      }
      if (typeof v !== "object")
        return fail(`${key} must be a quantity with value and status.`);
      if (v.value === undefined || v.value === null) {
        delete current[key];
        continue;
      }
      if (
        typeof v.value !== "number" ||
        !Number.isFinite(v.value) ||
        !v.status ||
        !VALUE_STATUSES.includes(v.status)
      )
        return fail(
          `${key} needs a finite metre value and a valid provenance status.`,
        );
      if (!Number.isSafeInteger(Math.round(v.value * 10000)))
        return fail(`${key} exceeds the model’s 0.1 mm precision range.`);
      if (
        (key === "tileLength" || key === "tileWidth") &&
        quantize(v.value) <= 0
      )
        return fail(`${key} must be at least 0.1 mm.`);
      if (key === "joint" && v.value < 0)
        return fail("Joint cannot be negative.");
      current[key] = {
        value: r.q(v.value, key),
        status: v.status,
        ...(v.source ? { source: String(v.source) } : {}),
      };
    }
    for (const [key, allowed] of [["originXFrom", ["west", "east"]], ["originYFrom", ["north", "south"]]] as const) {
      const v = patch[key];
      if (v === undefined) continue;
      if (v === null) { delete current[key]; continue; }
      if (!(allowed as readonly string[]).includes(v)) return fail(`${key} must be ${allowed.join(" or ")}.`);
      (current as Record<string, unknown>)[key] = v;
    }
    if (patch.axis !== undefined) {
      if (patch.axis === null) delete current.axis;
      else if (patch.axis !== "x" && patch.axis !== "y")
        return fail("Axis must be x or y.");
      else current.axis = patch.axis;
    }
    if (patch.zone !== undefined) {
      if (patch.zone === null) delete current.zone;
      else if (
        patch.zone !== "room" &&
        !room.drainage?.planes.some((p) => p.id === patch.zone)
      )
        return fail("Zone must be room or a drainage plane in this room.");
      else current.zone = patch.zone;
    }
    if (patch.note !== undefined) {
      if (patch.note === null || !String(patch.note).trim())
        delete current.note;
      else current.note = String(patch.note).trim().slice(0, 500);
    }
    const nextRoom: Room = { ...room, floorTiling: current };
    if (!Object.keys(current).length) delete nextRoom.floorTiling;
    const model = {
      ...store.getState().model,
      rooms: store
        .getState()
        .model.rooms.map((r) => (r.id === room.id ? nextRoom : r)),
    };
    pushUndo();
    setModel(model);
    const layout = floorTileLayout(model, nextRoom);
    return r.ok(
      `${room.label}: proposed floor tile set-out. ${layout.missing.join("; ")}`,
      { id: room.id, tiling: nextRoom.floorTiling ?? null, ...layout },
    );
  },

  // ---- wall tiling (#9) ----
  /**
   * Record a proposed tile set-out on one side of a wall. Every length needs a status; nothing
   * is defaulted, and a missing input leaves the cuts unresolved and named. The set-out is
   * always a proposal: it is never recorded as built.
   */
  setWallTiling(wallId: string, side: WallSideName, patch: TilingPatch): ActionResult {
    const hit = resolveWall(wallId);
    if (!hit.ok) return rejected(hit);
    const wall = hit.entity;
    if (side !== "left" && side !== "right") return fail(`Side must be "left" or "right" (walking from end A to end B), not "${side}".`);
    const r = rounding();
    const current: WallTiling = patch.clear ? {} : { ...(wall.tiling?.[side] ?? {}) };
    const lengths: [keyof TilingPatch & keyof WallTiling, string, "positive" | "nonNegative" | "any"][] = [
      ["tileLength", "Tile length", "positive"], ["tileWidth", "Tile width", "positive"], ["joint", "Grout joint", "nonNegative"],
      ["originAlong", "Origin along", "any"], ["originUp", "Origin up", "any"], ["tiledHeight", "Tiled height", "positive"],
    ];
    for (const [key, label, rule] of lengths) {
      const q = patch[key] as QuantityInput | null | undefined;
      if (q === undefined) continue;
      if (q === null) { delete current[key]; continue; }
      if (typeof q !== "object") return fail(`Rejected: ${label} must be { value, status }.`);
      const out: Quantity = {};
      if (q.source) out.source = String(q.source);
      if (q.value !== undefined && q.value !== null) {
        if (typeof q.value !== "number" || !Number.isFinite(q.value)) return fail(`Rejected: ${label} must be a number of metres.`);
        if (!q.status || !VALUE_STATUSES.includes(q.status)) return fail(`Rejected: ${label} needs a status: ${VALUE_STATUSES.join(", ")}.`);
        if (rule === "positive" && !(quantize(q.value) > 0)) return fail(`Rejected: ${label} must be greater than zero (at least 0.1 mm).`);
        if (rule === "nonNegative" && q.value < 0) return fail(`Rejected: ${label} cannot be negative.`);
        out.value = r.q(q.value, label);
        out.status = q.status;
      }
      if (out.value === undefined && !out.source) delete current[key];
      else (current as Record<string, unknown>)[key] = out;
    }
    const choice = <K extends "orientation" | "reference" | "floor" | "originFrom">(key: K, allowed: readonly string[], label: string): string | null => {
      const v = patch[key];
      if (v === undefined) return null;
      if (v === null) { delete current[key]; return null; }
      if (!allowed.includes(v as string)) return `Rejected: ${label} must be one of ${allowed.join(", ")}.`;
      (current as Record<string, unknown>)[key] = v;
      return null;
    };
    for (const err of [
      choice("orientation", TILE_ORIENTATIONS, "orientation"),
      choice("reference", TILE_REFERENCES, "reference face"),
      choice("floor", TILE_FLOOR_REFERENCES, "floor reference"),
      choice("originFrom", TILE_ORIGIN_FROM, "originFrom"),
    ]) if (err) return fail(err);
    if (patch.originOpening !== undefined) {
      if (patch.originOpening === null) delete current.originOpening;
      else if (!store.getState().model.openings.some((o) => o.id === patch.originOpening && o.wallId === wall.id)) return fail(`Rejected: originOpening must be an opening on wall ${wall.id} (${store.getState().model.openings.filter((o) => o.wallId === wall.id).map((o) => o.id).join(", ") || "none"}).`);
      else current.originOpening = patch.originOpening;
    }
    if (current.originFrom?.startsWith("jamb") && !current.originOpening) return fail("Rejected: a jamb origin needs originOpening, an opening on this wall.");
    if (patch.note !== undefined) {
      if (patch.note === null || !String(patch.note).trim()) delete current.note; else current.note = String(patch.note).trim().slice(0, 500);
    }
    const tiling = { ...wall.tiling };
    if (Object.keys(current).length === 0) delete tiling[side]; else tiling[side] = current;
    const nextWall: Wall = { ...wall, tiling };
    if (Object.keys(tiling).length === 0) delete nextWall.tiling;
    pushUndo();
    const model = { ...store.getState().model, walls: store.getState().model.walls.map((w) => (w.id === wall.id ? nextWall : w)) };
    setModel(model);
    if (!nextWall.tiling?.[side]) return r.ok(`Wall ${wall.id} ${side} side: tiling cleared.`, { id: wall.id, side });
    const layout = tilingLayout(model, nextWall, side);
    const c = layout.cuts;
    const text = c
      ? ` Proposed cuts: end A ${formatMm(c.a.size)}, end B ${formatMm(c.b.size)}, bottom ${formatMm(c.bottom.size)}, top ${formatMm(c.top.size)} mm.`
      : "";
    return r.ok(
      `Wall ${wall.id} ${side} side tiling (proposed).${text}${layout.missing.length ? ` Unknown: ${layout.missing.join("; ")}.` : ""}`,
      { id: wall.id, side, tiling: current, resolved: layout.resolved, missing: layout.missing, cuts: layout.cuts ?? null },
    );
  },

  // ---- openings ----
  /**
   * Add a door or window. Position is either `t` (0..1 along the wall, to the centre) or a
   * distance from a named wall end to the centre. A height nobody supplied gets a default that
   * fits under the wall, is marked `heightDefaulted`, and the result asks for the real value.
   */
  addOpening(
    kind: OpeningKind,
    wallId: string,
    at: OpeningPosition,
    dims: { width?: number; sill?: number; height?: number } = {},
    swing?: { hinge?: "a" | "b"; side?: "left" | "right" },
  ): ActionResult {
    const hit = resolveWall(wallId);
    if (!hit.ok) return rejected(hit);
    const wall = hit.entity;
    const r = rounding();
    const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
    const w = r.q(dims.width ?? (kind === "door" ? 0.9 : 1.2), "width");
    const s = kind === "door" ? 0 : r.q(dims.sill ?? 0.9, "sill");
    if (!(w > 0) || s < 0) return fail("Width must be positive and sill cannot be negative.");
    const requested = centreFromA(wall, at, r);
    if (requested === null) return fail("Give the position as t (0..1) or as centre + from (\"a\" | \"b\").");
    const clamped = clampCentre(wall, w, requested);
    if (clamped === null) return fail(`Wall ${wall.id} is ${formatMm(len)} mm long — a ${formatMm(w)} mm ${kind} does not fit.`);
    const defaulted = dims.height === undefined;
    const h = defaulted ? defaultHeight(kind, wall, s) : r.q(dims.height!, "height");
    if (!(h > 0)) return fail(`The ${formatMm(s)} mm sill leaves no room under the ${formatMm(wall.height)} mm wall.`);
    if (s + h > wall.height + 1e-9) return fail(`${kind} (sill ${formatMm(s)} + height ${formatMm(h)} mm) exceeds wall height ${formatMm(wall.height)} mm.`);
    const anchorEnd = at.centre !== undefined && at.from === "b" ? "b" : "a";
    const anchorDistance = anchorEnd === "b" ? len - clamped : clamped;
    const opening: Opening = { id: uid(kind), kind, wallId: wall.id, t: clamped / len, anchorEnd, anchorDistance, width: w, sill: s, height: h,
      widthDefaulted: dims.width === undefined, heightDefaulted: defaulted };
    if (kind === "window") opening.sillDefaulted = dims.sill === undefined;
    if (kind === "door") {
      opening.hinge = swing?.hinge ?? "a";
      opening.side = swing?.side ?? "right";
    }
    pushUndo();
    setModel({ ...store.getState().model, openings: [...store.getState().model.openings, opening] });
    const moved = Math.abs(clamped - requested) > 1e-9 ? ` Moved from ${formatMm(requested)} mm so the opening fits inside the wall.` : "";
    const label = kind === "door" ? "Door" : "Window";
    return r.ok(
      `${label} added on wall ${wall.id}, centre ${formatMm(clamped)} mm from end A (${formatMm(len - clamped)} mm from end B).${moved}` +
        (defaulted ? ` ${heightPrompt(opening)}` : "") +
        (opening.widthDefaulted ? ` Width ${formatMm(w)} mm is a default, not a measurement.` : "") +
        (opening.sillDefaulted ? ` Sill ${formatMm(s)} mm is a default, not a measurement.` : ""),
      { id: opening.id, t: opening.t, centreFromA: clamped, widthDefaulted: opening.widthDefaulted,
        ...(kind === "window" ? { sillDefaulted: opening.sillDefaulted } : {}), heightDefaulted: defaulted },
    );
  },

  /** Exact numeric edit of an opening: position from a named wall end, width, sill, height. */
  editOpening(id: string, patch: OpeningPatch): ActionResult {
    const hit = resolveOpening(id);
    if (!hit.ok) return rejected(hit);
    const o = hit.entity;
    const wallHit = resolveWall(o.wallId);
    if (!wallHit.ok) return rejected(wallHit);
    const wall = wallHit.entity;
    const { openings } = store.getState().model;
    const r = rounding();
    const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
    const next: Opening = { ...o };
    if (patch.width !== undefined) { next.width = r.q(patch.width, "width"); next.widthDefaulted = false; }
    if (patch.sill !== undefined && o.kind === "window") { next.sill = r.q(patch.sill, "sill"); next.sillDefaulted = false; }
    if (patch.height !== undefined) {
      next.height = r.q(patch.height, "height");
      next.heightDefaulted = false;
    } else if (next.heightDefaulted) {
      next.height = defaultHeight(o.kind, wall, next.sill);
    }
    if (!(next.width > 0) || next.sill < 0 || !(next.height > 0)) return fail("Width and height must be positive and sill cannot be negative.");
    if (next.sill + next.height > wall.height + 1e-9) {
      return fail(`Edit rejected: sill ${formatMm(next.sill)} + height ${formatMm(next.height)} mm exceeds wall height ${formatMm(wall.height)} mm.`);
    }
    const hasPosition = patch.t !== undefined || patch.centre !== undefined;
    const oldAnchor = openingAnchor(o, wall);
    const requested = hasPosition ? centreFromA(wall, patch, r) : anchorCentreFromA(oldAnchor.end, oldAnchor.distance, len);
    if (requested === null) return fail("Give the position as t (0..1) or as centre + from (\"a\" | \"b\").");
    const clamped = clampCentre(wall, next.width, requested);
    if (clamped === null) return fail(`Edit rejected: a ${formatMm(next.width)} mm ${o.kind} does not fit on the ${formatMm(len)} mm wall.`);
    next.t = clamped / len;
    next.anchorEnd = hasPosition && patch.centre !== undefined
      ? (patch.from === "b" ? "b" : "a")
      : hasPosition ? "a" : oldAnchor.end;
    next.anchorDistance = next.anchorEnd === "b" ? len - clamped : clamped;
    pushUndo();
    setModel({ ...store.getState().model, openings: openings.map((x) => (x.id === o.id ? next : x)) });
    const moved = Math.abs(clamped - requested) > 1e-9 ? ` Moved from ${formatMm(requested)} mm so the opening fits inside the wall.` : "";
    return r.ok(
      `${o.kind} ${o.id}: centre ${formatMm(clamped)} mm from end A, width ${formatMm(next.width)}, sill ${formatMm(next.sill)}, height ${formatMm(next.height)} mm${next.heightDefaulted ? " (default)" : ""}.${moved}` +
        (next.heightDefaulted ? ` ${heightPrompt(next)}` : ""),
      { id: o.id, t: next.t, centreFromA: clamped },
    );
  },

  /** Flip which jamb a door hinges on and/or which way it swings. */
  setDoorSwing(id: string, hinge?: "a" | "b", side?: "left" | "right"): ActionResult {
    const hit = resolveOpening(id);
    if (!hit.ok) return rejected(hit);
    const o = hit.entity;
    const { openings } = store.getState().model;
    if (o.kind !== "door") return fail(`${o.id} is a window — only doors swing.`);
    const next = { ...o, hinge: hinge ?? o.hinge ?? "a", side: side ?? o.side ?? "right" };
    pushUndo();
    setModel({
      ...store.getState().model,
      openings: openings.map((x) => (x.id === o.id ? next : x)),
    });
    return ok(`Door ${o.id} hinges on "${next.hinge}" and swings to the "${next.side}".`, { id: o.id });
  },

  moveOpening(id: string, t: number): ActionResult {
    return this.editOpening(id, { t });
  },

  removeOpening(id: string): ActionResult {
    const hit = resolveOpening(id);
    if (!hit.ok) return rejected(hit);
    const o = hit.entity;
    const { openings } = store.getState().model;
    pushUndo();
    setModel({ ...store.getState().model, openings: openings.filter((x) => x.id !== o.id) });
    return ok(`${o.kind} ${o.id} removed.`, { id: o.id });
  },

  // ---- rooms ----
  addRoom(x: number, y: number, w: number, h: number, label: string, floor = "oak"): ActionResult {
    const r = rounding();
    x = r.q(x, "x"); y = r.q(y, "y"); w = r.q(w, "w"); h = r.q(h, "h");
    if (w < 0.5 || h < 0.5) return fail("Room must be at least 500 × 500 mm.");
    const room: Room = { id: uid("room"), x, y, w, h, label, floor };
    pushUndo();
    setModel({ ...store.getState().model, rooms: [...store.getState().model.rooms, room] });
    return r.ok(`Room "${label}" added (${formatMm(w)} × ${formatMm(h)} mm).`, { id: room.id });
  },

  updateRoom(idOrLabel: string, patch: Partial<Pick<Room, "x" | "y" | "w" | "h" | "label" | "floor">>): ActionResult {
    const hit = resolveRoom(idOrLabel);
    if (!hit.ok) return rejected(hit);
    const room = hit.entity;
    const r = rounding();
    const next: Room = { ...room };
    for (const k of ["x", "y", "w", "h"] as const) if (patch[k] !== undefined) next[k] = r.q(patch[k]!, k);
    if (patch.label !== undefined) next.label = patch.label;
    if (patch.floor !== undefined) next.floor = patch.floor;
    if (next.w < 0.5 || next.h < 0.5) return fail("Room must be at least 500 × 500 mm.");
    pushUndo();
    setModel({
      ...store.getState().model,
      rooms: store.getState().model.rooms.map((x) => (x.id === room.id ? next : x)),
    });
    return r.ok(`Room "${next.label}" updated (${formatMm(next.w)} × ${formatMm(next.h)} mm at ${formatMm(next.x)}, ${formatMm(next.y)}).`, { id: room.id });
  },

  /** Same canonical edit for UI and tools. Present fields replace; null restores unknown.
   * Snapshots are written only from a referenced accepted product; specification objects are not patch keys. */
  setRoomHeating(roomRef: string, patch: HeatingPatch): ActionResult {
    const hit = resolveRoom(roomRef);
    if (!hit.ok) return rejected(hit);
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return fail("Heating patch must be an object.");
    if ("cableSpecification" in patch || "thermostatSpecification" in patch) {
      return fail("Heating rejected: cableSpecification and thermostatSpecification are not patch keys; reference an accepted product id. The snapshot is written from that product.");
    }
    const room = hit.entity;
    const nextRoom = { ...room };
    if (patch.clear === true) delete nextRoom.heating;
    else {
      const library = productStore.getState().products;
      const validateProductId = (
        key: "cableProductId" | "thermostatProductId",
        category: "heating-cable" | "thermostat",
        value: string | null,
      ): string | null => {
        if (value === null) return null;
        if (typeof value !== "string" || !value.trim() || value.length > 200) {
          return `Heating rejected: ${key} must be an accepted ${category} id or null.`;
        }
        const product = library.find((p) => p.id === value);
        if (!product) return `Heating rejected: no accepted product "${value}" in this library.`;
        if (product.category !== category) {
          return `Heating rejected: "${value}" is category ${product.category}, not ${category}.`;
        }
        return null;
      };
      if (patch.cableProductId !== undefined) {
        const err = validateProductId("cableProductId", "heating-cable", patch.cableProductId);
        if (err) return fail(err);
      }
      if (patch.thermostatProductId !== undefined) {
        const err = validateProductId("thermostatProductId", "thermostat", patch.thermostatProductId);
        if (err) return fail(err);
      }
      const locked = heatingProductWriteGuard(room.heating, patch as Record<string, unknown>, library);
      if (locked) return fail(locked);
      const next: Heating = structuredClone(room.heating ?? { zoneIds: [], path: [], keepouts: [] });
      const bindProduct = (
        key: "cableProductId" | "thermostatProductId",
        specKey: "cableSpecification" | "thermostatSpecification",
        category: "heating-cable" | "thermostat",
        value: string | null,
      ): string | null => {
        if (value === null) {
          delete next[key];
          delete next[specKey];
          return null;
        }
        const product = library.find((p) => p.id === value)!;
        next[key] = product.id;
        next[specKey] = specificationFromProduct(product);
        return null;
      };
      if (patch.cableProductId !== undefined) {
        const err = bindProduct("cableProductId", "cableSpecification", "heating-cable", patch.cableProductId);
        if (err) return fail(err);
      }
      if (patch.thermostatProductId !== undefined) {
        const err = bindProduct("thermostatProductId", "thermostatSpecification", "thermostat", patch.thermostatProductId);
        if (err) return fail(err);
      }
      for (const key of ["manufacturer", "model", "productSource", "requirements", "screedLayerId", "length", "ratedOutput", "minSpacing", "edgeClearance", "depthFromBottom", "zoneIds", "path", "keepouts", "thermostatLocation"] as const) {
        if (patch[key] === undefined) continue;
        if (patch[key] === null) {
          if (key === "path" || key === "zoneIds" || key === "keepouts") Object.assign(next, { [key]: [] });
          else delete next[key];
        } else Object.assign(next, { [key]: structuredClone(patch[key]) });
      }
      // Tool/QuantityField null values mean unknown; persisted quantities omit them.
      for (const key of ["length", "ratedOutput", "minSpacing", "edgeClearance", "depthFromBottom"] as const) {
        const quantity = next[key];
        if (quantity && quantity.value === null) delete quantity.value;
      }
      const shadowed = heatingShadowedRecordKeys(next, library);
      if (shadowed.length) {
        return fail(`Heating rejected: ${shadowed.join(", ")} is locked to the heating-cable brief; pass ${shadowed.map((k) => `${k}:null`).join(", ")} to clear the shadowed record value.`);
      }
      if (!validHeating(next)) return fail("Heating rejected: finite non-negative quantities need provenance; paths need finite x/y; keep-outs need unique ids, labels and positive rectangles; product snapshots must match their category and name the accepted productId they were written from. Maximum 1000 points and 100 keep-outs.");
      for (const key of ["length", "minSpacing", "edgeClearance", "depthFromBottom"] as const) if (next[key]?.value !== undefined) next[key]!.value = quantize(next[key]!.value!);
      next.path = next.path.map((p) => ({ x: quantize(p.x), y: quantize(p.y) }));
      next.keepouts = next.keepouts.map((r) => ({ ...r, x: quantize(r.x), y: quantize(r.y), w: quantize(r.w), h: quantize(r.h) }));
      if (!validHeating(next)) return fail("Heating keep-out collapses at stored precision (0.1 mm).");
      nextRoom.heating = next;
    }
    pushUndo();
    setModel({ ...store.getState().model, rooms: store.getState().model.rooms.map((r) => r.id === room.id ? nextRoom : r) });
    return { ok: true, summary: `Room "${room.label}" proposed heating ${nextRoom.heating ? "updated" : "cleared"}; electrician/manufacturer review required. No electrical or compliance approval.`, id: room.id, ...heatingEvidence(nextRoom) };
  },

  // ---- floor assembly (#6) ----
  /**
   * Record a room's floor assembly: the datum, the stripped substrate's top, and the layers
   * above it. A value needs a status; a missing value stays unknown and every level above it
   * stays unresolved. Nothing is defaulted.
   */
  setRoomFloor(roomRef: string, patch: FloorPatch): ActionResult {
    const hit = resolveRoom(roomRef);
    if (!hit.ok) return rejected(hit);
    const room = hit.entity;
    const r = rounding();
    const quantity = (label: string, q: QuantityInput | null | undefined, nonNegative: boolean): Quantity | string => {
      if (!q) return {};
      const out: Quantity = {};
      if (q.source) out.source = String(q.source);
      if (q.value === undefined || q.value === null) return out;
      if (typeof q.value !== "number" || !Number.isFinite(q.value)) return `${label} must be a number of metres.`;
      if (!q.status || !VALUE_STATUSES.includes(q.status)) return `${label} needs a status: ${VALUE_STATUSES.join(", ")}.`;
      if (nonNegative && q.value < 0) return `${label} cannot be negative.`;
      out.value = r.q(q.value, label);
      out.status = q.status;
      return out;
    };
    const current: FloorAssembly = room.floorBuildUp ?? { datum: DEFAULT_DATUM, layers: [] };
    const next: FloorAssembly = { ...current, layers: [...current.layers] };
    if (patch.datum !== undefined) {
      const d = String(patch.datum).trim();
      if (!d) return fail("Rejected: datum needs a name, e.g. \"existing floor surface\".");
      next.datum = d;
    }
    if (patch.substrate !== undefined) {
      const text = patch.substrate === null ? "" : String(patch.substrate).trim();
      if (text) next.substrate = text; else delete next.substrate;
    }
    if (patch.substrateTop !== undefined) {
      const q = quantity("Substrate top", patch.substrateTop, false);
      if (typeof q === "string") return fail(`Rejected: ${q}`);
      if (patch.substrateTop === null || (q.value === undefined && !q.source)) delete next.substrateTop;
      else next.substrateTop = q;
    }
    if (patch.finishedTarget !== undefined) {
      const q = quantity("Finished level target", patch.finishedTarget, false);
      if (typeof q === "string") return fail(`Rejected: ${q}`);
      if (patch.finishedTarget === null || (q.value === undefined && !q.source)) delete next.finishedTarget;
      else next.finishedTarget = q;
    }
    if (patch.layers !== undefined) {
      if (!Array.isArray(patch.layers)) return fail("Rejected: layers must be a list, ordered from the substrate upward.");
      const layers: FloorLayer[] = [];
      for (const [i, l] of patch.layers.entries()) {
        if (!l || !FLOOR_LAYER_KINDS.includes(l.kind)) return fail(`Rejected: layer ${i + 1} kind must be one of ${FLOOR_LAYER_KINDS.join(", ")}.`);
        const name = (l.name ?? "").trim();
        const t = quantity(`${name || FLOOR_LAYER_LABELS[l.kind]} thickness`, l.thickness, true);
        if (typeof t === "string") return fail(`Rejected: ${t}`);
        const prev = layers[i - 1];
        if (prev && FLOOR_RANK[l.kind] < FLOOR_RANK[prev.kind]) {
          return fail(`Rejected: ${l.kind} cannot sit above ${prev.kind}. Order from the substrate up: waterproofing and screed (either way round), adhesive, tile.`);
        }
        const keep = l.id && current.layers.some((c) => c.id === l.id) && !layers.some((c) => c.id === l.id);
        layers.push({ id: keep ? l.id! : uid("floor"), kind: l.kind, name, thickness: t });
      }
      next.layers = layers;
    }
    const empty = !next.substrateTop && !next.finishedTarget && !next.substrate && next.layers.length === 0 && next.datum === DEFAULT_DATUM;
    const nextRoom: Room = { ...room };
    if (empty) delete nextRoom.floorBuildUp; else nextRoom.floorBuildUp = next;
    pushUndo();
    setModel({ ...store.getState().model, rooms: store.getState().model.rooms.map((x) => (x.id === room.id ? nextRoom : x)) });
    const levels = floorLevels(next);
    const finished = finishedLevel(next);
    return r.ok(
      `Room "${room.label}" floor (datum: ${next.datum}): ${finished.resolved ? `finished level ${formatMm(finished.top!)} mm.` : `finished level unresolved (missing ${finished.missing.join(", ")}).`}`,
      { id: room.id, datum: next.datum, levels },
    );
  },

  // ---- drainage (#7) ----
  /**
   * Record a room's proposed wastes and floor planes. Lists replace what is stored (send an id
   * to keep one). A level or fall needs a status; a missing one stays unknown and the plane
   * that needs it stays unresolved. Geometry and references are checked; levels are not
   * judged here (get_issues reports contradictions).
   */
  setRoomDrainage(roomRef: string, patch: DrainagePatch): ActionResult {
    const hit = resolveRoom(roomRef);
    if (!hit.ok) return rejected(hit);
    const room = hit.entity;
    const r = rounding();
    const num = (label: string, v: unknown): number | string =>
      typeof v === "number" && Number.isFinite(v) ? r.q(v, label) : `${label} must be a number of metres.`;
    const quantity = (label: string, q: QuantityInput | null | undefined): Quantity | string => {
      if (!q) return {};
      const out: Quantity = {};
      if (q.source) out.source = String(q.source);
      if (q.value === undefined || q.value === null) return out;
      if (typeof q.value !== "number" || !Number.isFinite(q.value)) return `${label} must be a number.`;
      if (!q.status || !VALUE_STATUSES.includes(q.status)) return `${label} needs a status: ${VALUE_STATUSES.join(", ")}.`;
      out.value = r.q(q.value, label);
      out.status = q.status;
      return out;
    };
    const current: Drainage = room.drainage ?? { wastes: [], planes: [] };
    const next: Drainage = { wastes: [...current.wastes], planes: [...current.planes] };
    const used = new Set<string>();
    /** ids as the caller wrote them -> stored ids, so a plane can name a waste sent in the same call */
    const sent = new Map<string, string>();
    const keepId = (id: string | undefined, _existing: { id: string }[], prefix: string) => {
      const usable = id && /^[\w.-]{1,40}$/.test(id) && !used.has(id);
      const out = usable ? id! : uid(prefix);
      used.add(out);
      return out;
    };
    if (patch.wastes !== undefined) {
      if (!Array.isArray(patch.wastes)) return fail("Rejected: wastes must be a list.");
      const wastes: Waste[] = [];
      for (const [i, w] of patch.wastes.entries()) {
        if (!w || (w.kind !== "point" && w.kind !== "linear")) return fail(`Rejected: waste ${i + 1} kind must be point or linear.`);
        const label = (w.label ?? "").trim() || `${w.kind === "linear" ? "Linear waste" : "Waste"} ${i + 1}`;
        const ax = num(`${label} x`, w.x), ay = num(`${label} y`, w.y);
        const bx = w.kind === "linear" ? num(`${label} x2`, w.x2) : ax;
        const by = w.kind === "linear" ? num(`${label} y2`, w.y2) : ay;
        for (const v of [ax, ay, bx, by]) if (typeof v === "string") return fail(`Rejected: ${v}`);
        if (w.kind === "linear" && Math.hypot((bx as number) - (ax as number), (by as number) - (ay as number)) < 0.01) return fail(`Rejected: ${label} needs two different ends.`);
        const level = quantity(`${label} level`, w.level);
        if (typeof level === "string") return fail(`Rejected: ${level}`);
        const outletAt = quantity(`${label} outlet position`, w.outletAt);
        if (typeof outletAt === "string") return fail(`Rejected: ${outletAt}`);
        if (w.kind !== "linear" && (outletAt.value !== undefined || outletAt.source)) return fail(`Rejected: ${label} is a point waste; outletAt is for linear wastes (a point waste's outlet comes from its product).`);
        const waste: Waste = { id: keepId(w.id, current.wastes, "waste"), label, kind: w.kind, ax: ax as number, ay: ay as number, bx: bx as number, by: by as number };
        if (level.value !== undefined || level.source) waste.level = level;
        if (outletAt.value !== undefined || outletAt.source) waste.outletAt = outletAt;
        const prior = w.id ? current.wastes.find((x2) => x2.id === w.id) : undefined;
        if (w.product === undefined) {
          if (prior?.product) waste.product = prior.product;
        } else if (w.product !== null) {
          const ref = String(w.product);
          const product = productStore.getState().products.find((p) => p.id === ref);
          if (!product) return fail(`Rejected: ${label} product "${ref}" is not an accepted product in this browser's library.`);
          if (product.category !== DRAIN_CATEGORY) return fail(`Rejected: ${label} product "${ref}" is a ${product.category} brief, not a drain.`);
          waste.product = prior?.product?.productId === product.id ? prior.product : wasteLinkFromProduct(product);
        }
        if (w.id) sent.set(w.id, waste.id);
        wastes.push(waste);
      }
      next.wastes = wastes;
    }
    if (patch.planes !== undefined) {
      if (!Array.isArray(patch.planes)) return fail("Rejected: planes must be a list.");
      const planes: FloorPlane[] = [];
      for (const [i, p] of patch.planes.entries()) {
        if (!p) return fail(`Rejected: plane ${i + 1} is empty.`);
        const label = (p.label ?? "").trim() || `Plane ${i + 1}`;
        const [x, y, w, h] = [num(`${label} x`, p.x), num(`${label} y`, p.y), num(`${label} width`, p.w), num(`${label} depth`, p.h)];
        for (const v of [x, y, w, h]) if (typeof v === "string") return fail(`Rejected: ${v}`);
        if ((w as number) <= 0 || (h as number) <= 0) return fail(`Rejected: ${label} needs a positive width and depth.`);
        let wasteId: string | undefined;
        if (p.waste) {
          const ref = String(p.waste).toLowerCase();
          const hits = next.wastes.filter((x2) => x2.id === (sent.get(String(p.waste)) ?? p.waste) || x2.label.toLowerCase() === ref);
          if (hits.length !== 1) return fail(`Rejected: ${label} falls to "${p.waste}", which ${hits.length ? "is ambiguous; use its id" : "is not one of this room's wastes"}. Wastes: ${next.wastes.map((x2) => `${x2.id} (${x2.label})`).join(", ") || "none"}.`);
          wasteId = hits[0].id;
        }
        const fall = quantity(`${label} fall`, p.fall);
        if (typeof fall === "string") return fail(`Rejected: ${fall}`);
        const controls: FloorControl[] = [];
        for (const [j, c] of (p.controls ?? []).entries()) {
          const cl = (c.label ?? "").trim() || `Level ${j + 1}`;
          const cx = num(`${cl} x`, c.x), cy = num(`${cl} y`, c.y);
          if (typeof cx === "string") return fail(`Rejected: ${cx}`);
          if (typeof cy === "string") return fail(`Rejected: ${cy}`);
          const lv = quantity(`${cl} level`, c.level);
          if (typeof lv === "string") return fail(`Rejected: ${lv}`);
          controls.push({ id: keepId(c.id, current.planes.flatMap((q) => q.controls), "ctl"), label: cl, x: cx, y: cy, level: lv });
        }
        const plane: FloorPlane = { id: keepId(p.id, current.planes, "plane"), label, x: x as number, y: y as number, w: w as number, h: h as number, controls };
        if (wasteId) plane.wasteId = wasteId;
        if (fall.value !== undefined || fall.source) plane.fall = fall;
        planes.push(plane);
      }
      next.planes = planes;
    }
    // a waste removed while a plane still falls to it would leave a dangling reference
    for (const p of next.planes) {
      if (p.wasteId && !next.wastes.some((w) => w.id === p.wasteId)) {
        if (patch.planes === undefined) return fail(`Rejected: plane "${p.label}" still falls to a waste that this change removes. Send planes too.`);
      }
    }
    const nextRoom: Room = { ...room };
    if (next.wastes.length === 0 && next.planes.length === 0) delete nextRoom.drainage; else nextRoom.drainage = next;
    pushUndo();
    setModel({ ...store.getState().model, rooms: store.getState().model.rooms.map((x) => (x.id === room.id ? nextRoom : x)) });
    const resolved = next.planes.filter((p) => planeSurface(next, p).resolved).length;
    const errors = drainageProblems(nextRoom).filter((p) => p.severity === "error").length;
    return r.ok(
      `Room "${room.label}" drainage: ${next.wastes.length} waste${next.wastes.length === 1 ? "" : "s"}, ${next.planes.length} plane${next.planes.length === 1 ? "" : "s"} (${resolved} resolved)${errors ? `; ${errors} error${errors === 1 ? "" : "s"} to fix, see get_floor_heights` : ""}.`,
      { id: room.id, wastes: next.wastes, planes: next.planes },
    );
  },

  /** Re-pin a waste's drain product to the latest accepted revision in its series (#82, #53). */
  updateWasteProduct(roomRef: string, wasteRef: string): ActionResult {
    const hit = resolveRoom(roomRef);
    if (!hit.ok) return rejected(hit);
    const room = hit.entity;
    const ref = String(wasteRef).toLowerCase();
    const wastes = room.drainage?.wastes ?? [];
    const matches = wastes.filter((w) => w.id === wasteRef || w.label.toLowerCase() === ref);
    if (matches.length !== 1) return fail(`Rejected: ${matches.length ? `"${wasteRef}" is ambiguous; use its id` : `no waste "${wasteRef}" in ${room.label}`}. Wastes: ${wastes.map((w) => `${w.id} (${w.label})`).join(", ") || "none"}.`);
    const waste = matches[0];
    const info = wasteProduct(waste);
    if (!info) return fail(`Rejected: waste "${waste.label}" has no drain product linked.`);
    if (!info.update) return fail(`Waste "${waste.label}" already uses the latest accepted revision of ${info.name}.`);
    const product = productStore.getState().products.find((p) => p.id === info.update!.productId)!;
    const next: Waste = { ...waste, product: wasteLinkFromProduct(product) };
    const nextRoom: Room = { ...room, drainage: { ...room.drainage!, wastes: wastes.map((w) => (w.id === waste.id ? next : w)) } };
    pushUndo();
    setModel({ ...store.getState().model, rooms: store.getState().model.rooms.map((x) => (x.id === room.id ? nextRoom : x)) });
    return { ok: true, summary: `Waste "${waste.label}" now uses ${info.name} revision ${info.update.revision} (was ${info.revision ?? "unnumbered"}).`, data: { id: waste.id, product: next.product } };
  },

  removeRoom(idOrLabel: string): ActionResult {
    const hit = resolveRoom(idOrLabel);
    if (!hit.ok) return rejected(hit);
    const room = hit.entity;
    pushUndo();
    setModel({ ...store.getState().model, rooms: store.getState().model.rooms.filter((r) => r.id !== room.id) });
    return ok(`Room "${room.label}" removed.`, { id: room.id });
  },

  // ---- furniture ----
  placeItem(kind: string, x: number, y: number, rotation = 0): ActionResult {
    const cat = catalogByKind(kind);
    if (!cat) return fail(`Unknown furniture kind "${kind}". Use get_item_catalog.`);
    if(cat.installationMounting) return fail("This mounted product needs explicit placement with place_product and its room/floor datum; generic catalogue drop would omit that evidence.");
    const r = rounding();
    const item: Item = { id: uid("item"), kind: cat.kind, x: r.q(x, "x"), y: r.q(y, "y"), rotation };
    pushUndo();
    setModel({ ...store.getState().model, items: [...store.getState().model.items, item] });
    return r.ok(`${cat.label} placed at (${formatMm(item.x)}, ${formatMm(item.y)}) mm.`, { id: item.id });
  },

  moveItem(idOrKind: string, x?: number, y?: number, rotation?: number): ActionResult {
    const hit = resolveItem(idOrKind);
    if (!hit.ok) return rejected(hit);
    const item = hit.entity;
    if (item.fittedTo && (x !== undefined || y !== undefined || rotation !== undefined)) {
      return fail(`${item.id} is fitted inside ${item.fittedTo.hostId}; it moves and turns with it. Change its place in the host with fit_item, or release it first.`);
    }
    if (item.anchor && (x !== undefined || y !== undefined || rotation !== undefined)) {
      return fail(`${item.id} is set out from wall ${item.anchor.wallId} (${item.anchor.face} face); its position follows that face. Change it with anchor_fixture, or release the anchor first.`, { id: item.id, reason: "anchored" });
    }
    const r = rounding();
    const next: Item = {
      ...item,
      x: x !== undefined ? r.q(x, "x") : item.x,
      y: y !== undefined ? r.q(y, "y") : item.y,
      rotation: rotation !== undefined ? rotation : item.rotation,
    };
    pushUndo();
    setModel({
      ...store.getState().model,
      items: store.getState().model.items.map((i) => (i.id === item.id ? next : i)),
    });
    return r.ok(`Item ${item.id} moved to (${formatMm(next.x)}, ${formatMm(next.y)}) mm.`, { id: item.id });
  },

  // ---- trade sheets (#29) ----
  setSheetInfo(info: { project?: string; site?: string; preparedBy?: string }): ActionResult {
    const model = store.getState().model;
    const current = model.sheetSet ?? { titleBlock: {}, revisions: [] };
    const titleBlock = { ...current.titleBlock };
    for (const k of ["project", "site", "preparedBy"] as const) {
      const v = info?.[k];
      if (typeof v === "string") titleBlock[k] = v.trim().slice(0, 120);
    }
    pushUndo();
    setModel({ ...model, sheetSet: { ...current, titleBlock } });
    return ok(`Title block: ${titleBlock.project || "?"} · ${titleBlock.site || "?"} · prepared by ${titleBlock.preparedBy || "?"}.`, { titleBlock });
  },

  /**
   * Issue a sheet. Refused, with every open blocking finding and how to close it, until each
   * is fixed or acknowledged with a reason. An issued sheet records a revision carrying those
   * acknowledgements, and prints them.
   */
  exportSheet(sheet: string, opts: { acknowledge?: AckInput[]; note?: string; by?: "human" | "agent" } = {}): ActionResult {
    if (!sheetById(sheet)) return fail(`No sheet "${sheet}".`);
    const model = store.getState().model;
    const findings = checkSheet(model, sheet);
    const result = reconcile(findings, Array.isArray(opts.acknowledge) ? opts.acknowledge : [], opts.by ?? "agent");
    if (!result.ok) {
      return fail(
        `Not issued. ${result.open.length} blocking finding(s) open${result.problems.length ? `; ${result.problems.join(" ")}` : ""}. Fix each one (see fix), or acknowledge it with { code, ref, reason } if you are confident the rule is wrong here; the reason is printed on the sheet.`,
        { open: result.open, problems: result.problems, advisory: findings.filter((f) => f.severity === "advisory").length },
      );
    }
    const current = model.sheetSet ?? { titleBlock: {}, revisions: [] };
    const rev = revisionLetter(current.revisions.length);
    const revision: SheetRevision = {
      rev, date: new Date().toISOString().slice(0, 10), sheet,
      ...(opts.note?.trim() ? { note: opts.note.trim().slice(0, 160) } : {}),
      acknowledged: result.acknowledged,
    };
    const svg = renderFloorPlan(model, { sheet, findings, revision });
    revision.content = { svg, modelEvidence: planningEvidence(model), productRefs: model.items.map(item => ({ itemId: item.id, productId: item.productId, ...(item.productSnapshot ? { revision: revisionOf(item.productSnapshot).number } : {}) })) };
    // an issued revision has left the building: it is not undoable, and undo keeps it (see withIssued)
    setModel({ ...model, sheetSet: { ...current, revisions: [...current.revisions, revision] } });
    const advisory = findings.filter((f) => f.severity === "advisory").length;
    return ok(
      `Issued ${sheetById(sheet)!.number} rev ${rev}${revision.acknowledged.length ? `, past ${revision.acknowledged.length} acknowledged finding(s) printed on the sheet` : ""}. ${advisory} unresolved item(s) are listed on it.`,
      { rev, svg, acknowledged: revision.acknowledged, advisory },
    );
  },

  // ---- fixtures (#5) ----
  /**
   * Set a fixture out from a wall face, or release it (anchor null). Its position is then
   * derived from that face. An unresolved face keeps the anchor but leaves the fixture where
   * it is, and says what is missing.
   */
  anchorFixture(itemRef: string, input: AnchorInput | null): ActionResult {
    const hit = resolveItem(itemRef);
    if (!hit.ok) return rejected(hit);
    const item = hit.entity;
    if (input !== null && item.fittedTo) return fail(`${item.id} is fitted inside ${item.fittedTo.hostId}; release it with fit_item before setting it out from a wall.`);
    if (input === null) {
      const next: Item = { ...item };
      delete next.anchor;
      pushUndo();
      setModel({ ...store.getState().model, items: store.getState().model.items.map((i) => (i.id === item.id ? next : i)) });
      return ok(`${item.id} released; it stays at (${formatMm(item.x)}, ${formatMm(item.y)}) mm and moves freely.`, { id: item.id });
    }
    const built = buildAnchor(input);
    if (!built.ok) return built.result;
    const { anchor, r, wall } = built;
    let next: Item = { ...item, anchor };
    // Live nearer end ≠ stored corner: refuse. Re-place the bath; do not mirror across.
    if (item.corner) {
      const side = productCornerSide(anchor, wall);
      const changed = applyCornerHandChange(next, side);
      if (!changed.ok) return fail(changed.summary);
      next = changed.item;
    }
    pushUndo();
    setModel({ ...store.getState().model, items: store.getState().model.items.map((i) => (i.id === item.id ? next : i)) });
    const pose = anchorPose(store.getState().model, next);
    return r.ok(
      pose.resolved
        ? `${item.id} set ${formatMm(anchor.gap)} mm off the ${anchor.face} face of ${wall.id} (${anchor.side}), centre ${formatMm(anchor.distance)} mm from end ${anchor.from.toUpperCase()}.`
        : `${item.id} anchored, but its position is unresolved: missing ${pose.missing.join(", ")}. It stays where it was until those are entered.`,
      { id: item.id, resolved: pose.resolved, ...(pose.resolved ? { x: pose.x, y: pose.y, rotation: pose.rotation } : { missing: pose.missing }) },
    );
  },

  setServicePoint(itemRef: string, input: ServicePointInput): ActionResult {
    const hit = resolveItem(itemRef);
    if (!hit.ok) return rejected(hit);
    const item = hit.entity;
    if (!input?.label?.trim()) return fail("Give the service point a label, e.g. \"Floor waste\".");
    if (!["waste", "water", "power"].includes(input.service)) return fail("Service must be waste, water or power.");
    if (!["existing", "frame", "board", "finished"].includes(input.face) && !store.getState().model.walls.some((w) => (["left", "right"] as const).some((sd) => w.sides?.[sd]?.layers.some((l) => l.id === input.face)))) {
      return fail("Face must be existing, frame, board, finished or a layer id.");
    }
    if (!VALUE_STATUSES.includes(input.status)) return fail(`Service point needs a status: ${VALUE_STATUSES.join(", ")}.`);
    const r = rounding();
    for (const k of ["out", "outMax", "across", "up"] as const) {
      const v = input[k];
      if (v !== undefined && v !== null && (typeof v !== "number" || !Number.isFinite(v))) return fail(`${k} must be a number of metres, or left out when unknown.`);
    }
    const num = (v: number | null | undefined, label: string) => (typeof v === "number" ? r.q(v, label) : undefined);
    const out = num(input.out, "out");
    const outMax = num(input.outMax, "outMax");
    if (out !== undefined && outMax !== undefined && outMax < out) return fail("outMax must not be less than out.");
    const up = num(input.up, "up");
    if (up !== undefined && up < 0) return fail("Up is measured above the finished floor and cannot be negative.");
    const existing = item.servicePoints ?? [];
    if (input.id !== undefined && (typeof input.id !== "string" || !/^[A-Za-z0-9_:-]{1,40}$/.test(input.id))) return fail("id must be 1–40 letters, digits, _, : or -.");
    const id = input.id ?? uid("sp");
    const prior = existing.find((p) => p.id === id);
    const derivedWrite = prior ? derivedServicePointMutation(prior, { status: input.status, source: input.source }) : { ok: true as const };
    if (!derivedWrite.ok) return fail(derivedWrite.summary);
    const priorDerived = !!(prior && isDerivedServicePoint(prior));
    const siteSource = input.source?.trim() ?? "";
    const point: ServicePoint = {
      id, label: input.label.trim(), service: input.service, face: input.face,
      ...(out !== undefined ? { out } : {}), ...(outMax !== undefined ? { outMax } : {}),
      ...(num(input.across, "across") !== undefined ? { across: num(input.across, "across") } : {}),
      ...(up !== undefined ? { up } : {}),
      status: input.status,
      ...(siteSource ? { source: siteSource } : {}),
    };
    const next: Item = { ...item, servicePoints: existing.some((p) => p.id === id) ? existing.map((p) => (p.id === id ? point : p)) : [...existing, point] };
    pushUndo();
    setModel({ ...store.getState().model, items: store.getState().model.items.map((i) => (i.id === item.id ? next : i)) });
    const replaced = priorDerived
      ? ` Replaced derived host-frame conversion with a ${input.status} site datum.`
      : "";
    return r.ok(`${point.label} ${existing.some((p) => p.id === id) ? "updated" : "added"} on ${item.id}.${replaced}`, { id: item.id, pointId: id });
  },

  removeServicePoint(itemRef: string, pointId: string): ActionResult {
    const hit = resolveItem(itemRef);
    if (!hit.ok) return rejected(hit);
    const item = hit.entity;
    const prior = (item.servicePoints ?? []).find((p) => p.id === pointId);
    if (!prior) return fail(`No service point "${pointId}" on ${item.id}.`);
    const derivedWrite = derivedServicePointMutation(prior);
    if (!derivedWrite.ok) return fail(derivedWrite.summary);
    pushUndo();
    const next: Item = { ...item, servicePoints: item.servicePoints!.filter((p) => p.id !== pointId) };
    setModel({ ...store.getState().model, items: store.getState().model.items.map((i) => (i.id === item.id ? next : i)) });
    return ok(`Service point ${pointId} removed from ${item.id}.`);
  },

  /**
   * Place an accepted library product against a wall face. Its envelope must be known; its
   * published rough-in points are copied onto the fixture, each still naming its datum. A point
   * whose datum this plan cannot express is copied with that axis unknown.
   */
  placeProduct(product: LibraryProduct, anchorInput: AnchorInput): ActionResult {
    const built = buildAnchor(anchorInput);
    if (!built.ok) return built.result;
    const placement = productPlacement(product, built.anchor, built.wall, anchorInput.installation);
    if (!placement.ok) return fail(placement.summary);
    for (const entry of [...placement.additionalEntries, placement.entry]) {
      const result = this.defineItemKind(entry);
      if (!result.ok) return result;
    }
    const item: Item = {
      id: uid("item"), kind: placement.entry.kind, x: 0, y: 0, rotation: 0,
      anchor: built.anchor, productId: product.id, productIdentity: exactSnapshot(product),
      productSnapshot: structuredClone(product), productGeometry: structuredClone(placement.entry),
      productSpecification: structuredClone({ category: product.category, fields: product.fields, recordingMode: product.recordingMode, acceptedAt: product.acceptedAt }),
      selectionStatus: "unknown", servicePoints: placement.servicePoints,
      ...(placement.installationGeometry ? { installationGeometry: structuredClone(placement.installationGeometry) } : {}),
      ...(anchorInput.installation ? { installation: structuredClone(anchorInput.installation) } : {}),
      ...(placement.corner ? { corner: placement.corner } : {}),
    };
    pushUndo(); setModel({ ...store.getState().model, items: [...store.getState().model.items, item] });
    const pose = anchorPose(store.getState().model,item);
    const simplified = placementLimitations(item);
    return built.r.ok(`${placement.entry.label} placed; ${pose.resolved ? "anchor resolved" : `anchor unresolved: ${pose.missing.join(", ")}`}.${simplified.length ? ` Limitation: ${simplified.join(" ")}` : ""}`, { id: item.id, kind: item.kind, resolved: pose.resolved });
  },

  recordStageExport(output: StageExport) {
    const model=store.getState().model;
    setModel({...model,sheetSet:{...(model.sheetSet ?? {titleBlock:{},revisions:[]}),stageExports:[...(model.sheetSet?.stageExports??[]),structuredClone(output)]}});
  },

  /** Read-only preview; acceptance and selected instance updates are separate human decisions. */
  previewProductRevision(productId: string, selected: string[]): ProductUpdatePreview | null {
    const product = productStore.getState().products.find(p => p.id === productId);
    return product ? previewProductUpdate(store.getState().model, product, selected, productStore.getState().products) : null;
  },

  /** Human page action only. Recompute evidence and selection; never trust supplied projection rows.
   * Also retargets `room.heating` product references and rewrites their snapshots from the accepted product. */
  applyProductRevision(preview: ProductUpdatePreview): ActionResult {
    const next = this.previewProductRevision(preview.targetId, preview.selected);
    if (!next || next.fingerprint !== preview.fingerprint) return fail("The project or accepted evidence changed. Preview the selected instances again before applying.");
    const product = productStore.getState().products.find((p) => p.id === next.targetId);
    if (!next.applicable) {
      if (!product || next.selected.length > 0) return fail("Selected instances have unresolved update prerequisites; review the preview before applying.");
      const heatingRooms = store.getState().model.rooms.filter((r) => r.heating);
      if (heatingRooms.length && heatingRooms.every((r) => heatingAlreadyOnProduct(r.heating!, product))) {
        return ok("0 selected instance(s) updated. Issued outputs remain historical.", { ids: next.selected });
      }
      const heating = retargetHeatingInModel(store.getState().model, product);
      if (!heating.rooms.length) return fail("Selected instances have unresolved update prerequisites; review the preview before applying.");
      pushUndo();
      setModel(heating.model);
      return ok(`0 selected instance(s) updated. ${heatingRevisionSummary(product, heating.rooms, heating.changed, heating.cleared)} Issued outputs remain historical.`, { ids: next.selected });
    }
    for (const entry of next.entries) {
      const result = this.defineItemKind(entry);
      if (!result.ok) return result;
    }
    const at = Date.now();
    let model = { ...next.model, items: next.model.items.map(item => {
      const row = next.rows.find(row => row.id === item.id);
      return row ? { ...item, productUpdates: [...(item.productUpdates ?? []), { from: row.before.productId!, to: next.targetId, at, preserved: row.preserved, unresolved: row.unresolved }] } : item;
    }) };
    const heating = product && model.rooms.some((r) => r.heating && !heatingAlreadyOnProduct(r.heating, product))
      ? retargetHeatingInModel(model, product)
      : { model, rooms: [] as string[], changed: [] as Array<"cable" | "thermostat">, cleared: [] as [] };
    model = heating.model;
    pushUndo(); setModel(model);
    const heatingLine = product && heating.rooms.length ? ` ${heatingRevisionSummary(product, heating.rooms, heating.changed, heating.cleared)}` : "";
    return ok(`${next.rows.length} selected instance(s) updated explicitly. Preserved project confirmations and reconciliation notes remain in instance history. Issued outputs remain historical.${heatingLine}`, { ids: next.selected });
  },

  setFixtureInstallation(itemRef: string, placement: FixtureInstallation): ActionResult {
    const hit=resolveItem(itemRef);if(!hit.ok)return rejected(hit);
    if(!validInstallation(placement))return fail("Invalid installation placement: height is metres above a named floor datum with status and source.");
    const it=hit.entity;
    if(placement.mirror){const problem=mirroringProblem(it.productIdentity ?? {},it.installationGeometry);if(problem)return fail(problem);}
    if(placement.mounting!==it.installation?.mounting && it.installation) return fail("Mounting mode is part of the placed product contract; place a supported mounting variant instead.");
    pushUndo();setModel({...store.getState().model,items:store.getState().model.items.map(x=>x.id===it.id?{...x,installation:structuredClone(placement)}:x)});
    const next=store.getState().model.items.find(x=>x.id===it.id)!;const r=installationReading(store.getState().model,next);
    return {ok:true,summary:r.resolved?`Explicit installation placement updated.${r.limitations.length?` Limitation: ${r.limitations.join(" ")}`:""}`:`Placement retained with unresolved datum: ${r.missing.join(", ")}.`,id:it.id};
  },

  setFixtureSelection(itemRef: string, status: SelectionStatus): ActionResult {
    const hit = resolveItem(itemRef);
    if (!hit.ok) return rejected(hit);
    if (!SELECTION_STATUSES.includes(status)) return fail("Selection must be unknown, proposed, purchased or reused.");
    pushUndo();
    setModel({ ...store.getState().model, items: store.getState().model.items.map(i => i.id === hit.entity.id ? { ...i, selectionStatus: status } : i) });
    return ok(`Selection for ${hit.entity.id}: ${status}.`, { id: hit.entity.id, selectionStatus: status });
  },

  removeItem(idOrKind: string): ActionResult {
    const hit = resolveItem(idOrKind);
    if (!hit.ok) return rejected(hit);
    const item = hit.entity;
    // what is fitted inside a fixture goes with it
    const goes = new Set([item.id, ...store.getState().model.items.filter((i) => i.fittedTo?.hostId === item.id).map((i) => i.id)]);
    pushUndo();
    setModel({ ...store.getState().model, items: store.getState().model.items.filter((i) => !goes.has(i.id)) });
    return ok(goes.size > 1 ? `Item ${item.id} removed, with ${goes.size - 1} fitted inside it.` : `Item ${item.id} removed.`, { id: item.id });
  },

  /**
   * Fit an accessory (a bath waste, a basket) inside a host fixture, at `across` the host's
   * centreline and `out` from its back edge, in metres. Its centre must lie inside the host's
   * footprint. Pass `atHostWaste` to use the host's resolved waste point in that same frame
   * instead of an arbitrary place. Pass null as the host to release it where it stands.
   */
  fitItem(accessoryRef: string, hostRef: string | null, across?: number, out?: number, atHostWaste = false): ActionResult {
    const acc = resolveItem(accessoryRef);
    if (!acc.ok) return rejected(acc);
    const item = acc.entity;
    if (hostRef === null) {
      if (!item.fittedTo) return fail(`${item.id} is not fitted inside anything.`);
      pushUndo();
      setModel({ ...store.getState().model, items: store.getState().model.items.map((i) => { if (i.id !== item.id) return i; const { fittedTo: _released, ...rest } = i; return rest; }) });
      return ok(`${item.id} released; it stays where it is.`, { id: item.id });
    }
    const hostHit = resolveItem(hostRef);
    if (!hostHit.ok) return rejected(hostHit);
    const host = hostHit.entity;
    if (host.id === item.id) return fail("A fixture cannot be fitted inside itself.");
    if (host.fittedTo) return fail(`${host.id} is itself fitted inside ${host.fittedTo.hostId}; fit to the outer fixture.`);
    if (store.getState().model.items.some((i) => i.fittedTo?.hostId === item.id)) return fail(`${item.id} is a host for other accessories; fit it only after releasing them.`);
    if (item.anchor) return fail(`${item.id} is set out from a wall face; release its anchor before fitting it inside a fixture.`);
    let acrossM = across, outM = out;
    if (atHostWaste) {
      const pt = hostWasteInHostFrame(host, catalogByKind, store.getState().model);
      if (!pt.resolved || pt.across === undefined || pt.out === undefined) {
        return fail(`${host.id} has no resolved waste point in its own frame: missing ${pt.missing.join(", ")}. No position is invented.`);
      }
      acrossM = pt.across;
      outM = pt.out;
    }
    if (typeof acrossM !== "number" || typeof outM !== "number" || !Number.isFinite(acrossM) || !Number.isFinite(outM)) return fail("Give across (metres from the host's centreline, left negative) and out (metres from the host's back edge), or set atHostWaste to use the host's waste point.");
    const r = rounding();
    const fitted: Item = { ...item, fittedTo: { hostId: host.id, across: r.q(acrossM, "across"), out: r.q(outM, "out") } };
    const pose = fittedPose(fitted, host);
    if (!pose) return fail(`${host.id} has no known footprint to fit into.`);
    const poly = itemPolygon(host);
    if (!poly || !pointNearPolygon({ x: pose.x, y: pose.y }, poly, 0)) return fail(`That point is outside ${host.id}'s footprint (its real outline, not its box). Choose a point inside it.`);
    pushUndo();
    setModel({ ...store.getState().model, items: store.getState().model.items.map((i) => (i.id === item.id ? { ...fitted, ...pose } : i)) });
    return r.ok(
      atHostWaste
        ? `${item.id} fitted inside ${host.id} at its waste point, ${formatMm(fitted.fittedTo!.across)} mm across and ${formatMm(fitted.fittedTo!.out)} mm from its back edge.`
        : `${item.id} fitted inside ${host.id}, ${formatMm(fitted.fittedTo!.across)} mm across and ${formatMm(fitted.fittedTo!.out)} mm from its back edge.`,
      { id: item.id, hostId: host.id },
    );
  },

  // ---- model / view ----
  setPlanName(name: string): ActionResult {
    pushUndo();
    setModel({ ...store.getState().model, name });
    return ok(`Plan renamed to "${name}".`);
  },

  clearModel(): ActionResult {
    pushUndo();
    setModel(withIssued(emptyModel(), store.getState().model));
    store.setState({ notes: [] });
    return ok("Model cleared. Blank canvas ready.");
  },

  build3d(): ActionResult {
    const m = store.getState().model;
    if (m.walls.length === 0) return fail("Nothing to build: the plan has no walls yet.");
    store.setState((s) => ({ editor: { ...s.editor, view: "3d" } }));
    return ok(`3D model built: ${m.walls.length} walls, ${m.openings.length} openings, ${m.items.length} items.`);
  },

  setCamera(mode: CameraMode): ActionResult {
    if (!["orbit", "top", "walk"].includes(mode)) return fail(`Unknown camera "${mode}". Use orbit | top | walk.`);
    store.setState((s) => ({ editor: { ...s.editor, view: "3d", camera: mode } }));
    return ok(`Camera set to ${mode}.`);
  },

  setView(view: ViewMode) {
    store.setState((s) => ({ editor: { ...s.editor, view } }));
  },

  // ---- collaboration ----
  leaveNote(author: "human" | "agent", text: string): ActionResult {
    const note: Note = { id: uid("note"), author, text, at: Date.now() };
    store.setState((s) => ({ notes: [...s.notes, note] }));
    return ok(`Note saved (${author}): "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}"`, { id: note.id });
  },

  // ---- underlay ----
  setUnderlay(underlay: Underlay | null) {
    setModel({ ...store.getState().model, underlay });
  },

  calibrateUnderlay(u1: number, v1: number, u2: number, v2: number, meters: number, opacity?: number): ActionResult {
    const m = store.getState().model;
    const u = m.underlay;
    if (!u) return fail("No underlay loaded — ask the human to upload the plan image first (sidebar → Blueprint underlay).");
    // world distance between the two fractional image points at the CURRENT scale
    const frac = Math.hypot((u2 - u1) * u.w, (v2 - v1) * u.h);
    if (frac < 1e-6) return fail("The two calibration points coincide.");
    if (!(meters > 0)) return fail("meters must be positive.");
    const scale = meters / frac;
    const newW = u.w * scale;
    const newH = u.h * scale;
    // keep image point 1 fixed in world space
    const p1x = u.x + u1 * u.w;
    const p1y = u.y + v1 * u.h;
    setModel({
      ...m,
      underlay: { ...u, x: p1x - u1 * newW, y: p1y - v1 * newH, w: newW, h: newH, opacity: opacity ?? u.opacity },
    });
    return ok(
      `Underlay calibrated: ${u.w.toFixed(2)} → ${newW.toFixed(2)} m wide (×${scale.toFixed(3)}). Image point (${u1}, ${v1}) stays at world (${p1x.toFixed(2)}, ${p1y.toFixed(2)}).`,
      { w: newW, h: newH, scale },
    );
  },

  // ---- human-in-the-loop approval ----
  setRequireApproval(on: boolean) {
    store.setState({ requireApproval: on });
    logActivity("human", "approval_policy", on ? "Destructive agent actions now need your approval." : "Approval gate switched off.", true);
  },

  /**
   * Park a destructive agent call until the human approves it. Resolves true/false.
   * Honours the AbortSignal WebMCP hands to execute(), so an agent that gives up
   * releases the request instead of leaving it hanging on the page.
   */
  requestApproval(tool: string, request: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<boolean> {
    const entry: PendingApproval = { id: uid("appr"), tool, request, args, at: Date.now() };
    store.setState((s) => ({ approvals: [...s.approvals, entry] }));
    logActivity("agent", tool, `Waiting for your approval: ${request}`, true);
    return new Promise<boolean>((resolve) => {
      const settle = (granted: boolean) => {
        if (!approvalResolvers.has(entry.id)) return;
        approvalResolvers.delete(entry.id);
        store.setState((s) => ({ approvals: s.approvals.filter((a) => a.id !== entry.id) }));
        resolve(granted);
      };
      approvalResolvers.set(entry.id, settle);
      signal?.addEventListener("abort", () => settle(false), { once: true });
    });
  },

  resolveApproval(id: string, granted: boolean): ActionResult {
    const entry = store.getState().approvals.find((a) => a.id === id);
    const settle = approvalResolvers.get(id);
    if (!entry || !settle) return fail("That request is no longer pending.");
    settle(granted);
    logActivity("human", entry.tool, granted ? `Approved: ${entry.request}` : `Rejected: ${entry.request}`, granted);
    return ok(granted ? "Approved." : "Rejected.");
  },

  /**
   * Adopt a product from the partner origin into this plan's catalogue, keeping the
   * supplier's real dimensions so the constraint checker judges it like anything else.
   */
  importSupplierProduct(p: {
    sku: string;
    name: string;
    category: string;
    w: number;
    d: number;
    h: number;
    color: string;
  }): ActionResult {
    const kind = `nordika:${p.sku}`;
    const known: CatalogEntry["category"][] = ["living", "bedroom", "kitchen", "bath", "office", "decor"];
    const category = known.includes(p.category as CatalogEntry["category"])
      ? (p.category as CatalogEntry["category"])
      : p.category === "dining"
        ? "kitchen"
        : "decor";
    registerCatalogEntry({ kind, label: p.name, w: p.w, d: p.d, h: p.h, color: p.color, category });
    store.setState((s) => ({ kinds: [...s.kinds.filter((k) => k.entry.kind !== kind),
      { entry: { kind, label: p.name, w: p.w, d: p.d, h: p.h, color: p.color, category } }] }));
    bumpCatalog();
    return ok(`${p.name} imported from the supplier (${p.w} × ${p.d} m).`, { kind });
  },

  /**
   * Register a piece of furniture that is not in the catalogue — the escape hatch that lets an
   * agent match what a plan actually draws instead of approximating with the nearest stock item.
   * `parts` is optional: without it the piece is blocked out from its footprint.
   */
  defineItemKind(spec: {
    kind: string;
    label: string;
    w: number;
    d: number;
    h: number;
    color?: string;
    category?: string;
    elevation?: number;
    parts?: PartSpec[];
    outline?: Outline;
    installationMounting?: "wall";
  }): ActionResult {
    const kind = spec.kind.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_");
    if (!kind) return fail("A kind id is required.");
    if (FURNITURE_BUILDERS[kind]) return fail(`"${kind}" is a built-in kind — pick another id or use place_item.`);
    if (!(spec.w > 0 && spec.d > 0 && spec.h > 0)) return fail("w, d and h must all be positive metres.");
    if (spec.elevation !== undefined && !(Number.isFinite(spec.elevation) && spec.elevation >= 0)) return fail("elevation must be a metre height above the finished floor, 0 or more.");
    if (spec.outline !== undefined) {
      const problems = outlineProblems(spec.outline, spec.w, spec.d);
      if (problems.length) return fail(`Outline rejected: ${problems.join("; ")}.`);
    }
    const outline = {
      ...(spec.outline ? { outline: structuredClone(spec.outline) } : {}),
      ...(spec.elevation ? { elevation: spec.elevation } : {}),
      ...(spec.installationMounting ? { installationMounting: spec.installationMounting } : {}),
      ...(spec.parts?.some((p) => p.stopgap) ? { stopgap: true } : {}),
    };
    const known: CatalogEntry["category"][] = ["living", "bedroom", "kitchen", "bath", "office", "decor"];
    const category = known.includes(spec.category as CatalogEntry["category"])
      ? (spec.category as CatalogEntry["category"])
      : "decor";
    const color = spec.color ?? "#9a9186";
    const existing = catalogByKind(kind);
    if (existing) {
      existing.label = spec.label;
      existing.w = spec.w;
      existing.d = spec.d;
      existing.h = spec.h;
      existing.color = color;
      existing.category = category;
      if(spec.installationMounting)existing.installationMounting=spec.installationMounting;
      if (spec.outline) existing.outline = structuredClone(spec.outline);
      else delete existing.outline;
      if (spec.elevation) existing.elevation = spec.elevation;
      else delete existing.elevation;
      if (spec.parts?.some((p) => p.stopgap)) existing.stopgap = true;
      else delete existing.stopgap;
    } else {
      registerCatalogEntry({ kind, label: spec.label, w: spec.w, d: spec.d, h: spec.h, color, category, ...outline });
    }
    if (spec.parts?.length) defineCustomKind(kind, spec.parts);
    store.setState((s) => ({ kinds: [...s.kinds.filter((k) => k.entry.kind !== kind),
      { entry: { kind, label: spec.label, w: spec.w, d: spec.d, h: spec.h, color, category, ...outline },
        ...(spec.parts?.length ? { parts: structuredClone(spec.parts) } : {}) }] }));
    bumpCatalog();
    return ok(
      `"${spec.label}" defined as ${kind} (${spec.w} × ${spec.d} × ${spec.h} m${spec.outline ? ", with its plan outline" : ""}${spec.parts?.length ? `, ${spec.parts.length} parts` : spec.outline ? ", extruded from its outline" : ", blocked out from its footprint"}). Place it with place_item.`,
      { kind },
    );
  },

  setSupplierTools(names: string[]) {
    store.setState({ supplierTools: names });
  },

  // ---- selection / editor ----
  selectWall(id: string | null) {
    store.setState((s) => ({ editor: { ...s.editor, ...noSelection, selectedWallId: id } }));
  },
  selectItem(id: string | null) {
    store.setState((s) => ({ editor: { ...s.editor, ...noSelection, selectedItemId: id } }));
  },
  selectRoom(id: string | null) {
    store.setState((s) => ({ editor: { ...s.editor, ...noSelection, selectedRoomId: id } }));
  },
  selectOpening(id: string | null) {
    store.setState((s) => ({ editor: { ...s.editor, ...noSelection, selectedOpeningId: id } }));
  },
  clearSelection() {
    store.setState((s) => ({ editor: { ...s.editor, ...noSelection } }));
  },
  setSnapStep(step: number) {
    store.setState((s) => ({ editor: { ...s.editor, snapStep: Math.max(0, step) } }));
  },
  setDrawMode(mode: EditorState["drawMode"], placingKind: string | null = null) {
    store.setState((s) => ({ editor: { ...s.editor, drawMode: mode, placingKind, pendingWallStart: null } }));
  },
  setPendingWallStart(p: { x: number; y: number } | null) {
    store.setState((s) => ({ editor: { ...s.editor, pendingWallStart: p } }));
  },

  undo(): ActionResult {
    const { undoStack } = store.getState();
    if (undoStack.length === 0) return fail("Nothing to undo.");
    const prev = undoStack[undoStack.length - 1];
    store.setState({ undoStack: undoStack.slice(0, -1) });
    setModel(withIssued(prev, store.getState().model));
    return ok("Undone.");
  },

  loadModel(model: PlanModel) {
    pushUndo();
    setModel(model);
  },

  setWebmcpStatus(status: "off" | "live") {
    store.setState({ webmcpStatus: status });
  },
};

registerHeatingRevisionHook((_fromProductId, product) => {
  const heating = retargetHeatingInModel(store.getState().model, product);
  if (!heating.rooms.length) return undefined;
  pushUndo();
  setModel(heating.model);
  return heatingRevisionSummary(product, heating.rooms, heating.changed, heating.cleared);
});

// Convenience re-exports for tools
export { checkModel };
export const getModel = (): PlanModel => store.getState().model;
