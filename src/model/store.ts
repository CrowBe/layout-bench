/**
 * Single source of truth. The UI buttons and the WebMCP tools call THE SAME actions,
 * so human and agent truly co-edit one model. Vanilla zustand store (usable outside React).
 */

import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type {
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
  FloorAssembly,
  FloorLayer,
  FloorLayerKind,
  Drainage,
  Waste,
  FloorPlane,
  FloorControl,
  WallTiling,
  TileOrientation,
  TileReferenceFace,
  TileFloorReference,
} from "./types";
import { emptyModel } from "./types";
import { checkModel } from "./issues";
import { LAYER_KINDS, VALUE_STATUSES, layerLabel, sideFaces } from "./faces";
import { anchorPose, applyAnchors, faceChoices, facingRotation } from "./fixtures";
import { sideNormal } from "./faces";
import { drainageProblems, planeSurface } from "./drainage";
import { TILE_FLOOR_REFERENCES, TILE_ORIENTATIONS, TILE_ORIGIN_FROM, TILE_REFERENCES, tilingLayout } from "./tiling";
import { DEFAULT_DATUM, FLOOR_RANK, FLOOR_LAYER_KINDS, FLOOR_LAYER_LABELS, floorLevels, finishedLevel } from "./floor";
import type { LibraryProduct } from "./productLibrary";
import { categoryById, cornerBathOutline, envelopeOf } from "./products";
import { outlineExtents, outlineProblems, type Outline } from "./outline";
import { checkSheet, reconcile, revisionLetter, sheetById, type AckInput } from "../sheets/check";
import { renderFloorPlan } from "../sheets/floorPlan";
import { SNAP, dist, formatMm, quantize, segLen, segPoint } from "./geometry";
import { catalogByKind, registerCatalogEntry, resetRuntimeCatalog, type CatalogEntry } from "./catalog";
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
  drawMode: "select" | "wall" | "room" | "place";
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
  if (!revisions.length) return next;
  return { ...next, sheetSet: { titleBlock: next.sheetSet?.titleBlock ?? current.sheetSet!.titleBlock, revisions } };
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
      const label = catalogByKind(item.kind)?.label;
      return label ? [item.kind, label] : [item.kind];
    },
    partial: (item, hint) => {
      const q = hint.toLowerCase();
      const label = catalogByKind(item.kind)?.label ?? "";
      return item.id.includes(hint) || item.kind.toLowerCase().includes(q) || label.toLowerCase().includes(q);
    },
    candidate: (item) => {
      const label = catalogByKind(item.kind)?.label;
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
export interface FloorPatch {
  datum?: string;
  substrate?: string | null;
  substrateTop?: QuantityInput | null;
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

/**
 * Wall tile set-out (#9) as a caller supplies it. Fields present replace what is stored;
 * null clears one back to unknown. Lengths are metres and need a status.
 */
export interface TilingPatch {
  tileLength?: QuantityInput | null;
  tileWidth?: QuantityInput | null;
  orientation?: TileOrientation | null;
  joint?: QuantityInput | null;
  reference?: TileReferenceFace | null;
  floor?: TileFloorReference | null;
  originFrom?: "a" | "b" | "centre" | null;
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

/** Which back corner of a placed corner bath is square: the end of the wall it sits nearer. */
function cornerSide(anchor: FixtureAnchor, wall: Wall): "left" | "right" {
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  const alongFromA = anchor.from === "b" ? len - anchor.distance : anchor.distance;
  const cornerAtA = alongFromA <= len - alongFromA;
  const n = sideNormal(wall, anchor.side);
  const rot = (-facingRotation(n) * Math.PI) / 180;
  const towardB = Math.cos(rot) * (wall.bx - wall.ax) + Math.sin(rot) * (wall.by - wall.ay) > 0;
  return cornerAtA === towardB ? "left" : "right";
}

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
    const empty = !next.substrateTop && !next.substrate && next.layers.length === 0 && next.datum === DEFAULT_DATUM;
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
        const waste: Waste = { id: keepId(w.id, current.wastes, "waste"), label, kind: w.kind, ax: ax as number, ay: ay as number, bx: bx as number, by: by as number };
        if (level.value !== undefined || level.source) waste.level = level;
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
    // a handed corner fixture moved into the other corner swaps hands, and its points mirror
    if (item.corner) {
      const side = cornerSide(anchor, wall);
      if (side !== item.corner.side) {
        next = {
          ...next, kind: item.corner[side], corner: { ...item.corner, side },
          ...(item.servicePoints ? { servicePoints: item.servicePoints.map((p) => (p.across === undefined ? p : { ...p, across: quantize(-p.across) })) } : {}),
        };
      }
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
    const point: ServicePoint = {
      id, label: input.label.trim(), service: input.service, face: input.face,
      ...(out !== undefined ? { out } : {}), ...(outMax !== undefined ? { outMax } : {}),
      ...(num(input.across, "across") !== undefined ? { across: num(input.across, "across") } : {}),
      ...(up !== undefined ? { up } : {}),
      status: input.status, ...(input.source?.trim() ? { source: input.source.trim() } : {}),
    };
    const next: Item = { ...item, servicePoints: existing.some((p) => p.id === id) ? existing.map((p) => (p.id === id ? point : p)) : [...existing, point] };
    pushUndo();
    setModel({ ...store.getState().model, items: store.getState().model.items.map((i) => (i.id === item.id ? next : i)) });
    return r.ok(`${point.label} ${existing.some((p) => p.id === id) ? "updated" : "added"} on ${item.id}.`, { id: item.id, pointId: id });
  },

  removeServicePoint(itemRef: string, pointId: string): ActionResult {
    const hit = resolveItem(itemRef);
    if (!hit.ok) return rejected(hit);
    const item = hit.entity;
    if (!(item.servicePoints ?? []).some((p) => p.id === pointId)) return fail(`No service point "${pointId}" on ${item.id}.`);
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
    const cat = categoryById(product.category);
    const env = cat ? envelopeOf(cat, product.fields) : null;
    if (!env) return fail(`${product.manufacturer} ${product.model} has no known overall size, so it cannot be placed without inventing one.`);
    // validate everything before anything changes, then apply as one undo step
    const built = buildAnchor(anchorInput);
    if (!built.ok) return built.result;
    const { anchor } = built;
    const label = `${product.manufacturer} ${product.model}`;
    const corner = product.category === "bath" && product.fields.shape?.value === "corner-round" ? cornerSide(anchor, built.wall) : null;
    // a corner bath gets its real outline, mirrored to the corner it sits in; the box is
    // the larger of the printed sizes and the outline, so clearance is never understated
    const outline = corner ? cornerBathOutline(product.fields, env.w, env.d, corner) : null;
    let box = { ...env };
    if (outline) {
      const e = outlineExtents(outline);
      box = { w: Math.max(env.w, e.maxX - e.minX), d: Math.max(env.d, e.maxY - e.minY), h: env.h };
    }
    // both hands are defined, so the bath can move to the other corner later (see anchorFixture)
    const handed = (side: "left" | "right") => (box.w !== env.w || box.d !== env.d || side !== corner ? cornerBathOutline(product.fields, box.w, box.d, side) : outline);
    const kindFor = (side: "left" | "right" | null) => `product_${product.id}${side ? `_${side}` : ""}`;
    if (corner && outline) {
      const other = corner === "left" ? "right" : "left";
      const r = this.defineItemKind({ kind: kindFor(other), label, w: box.w, d: box.d, h: box.h, category: "bath", outline: handed(other)! });
      if (!r.ok) return r;
    }
    const shaped = corner && outline ? handed(corner) : null;
    const defined = this.defineItemKind({
      kind: kindFor(corner && outline ? corner : null), label, w: box.w, d: box.d, h: box.h, category: "bath",
      ...(shaped ? { outline: shaped } : {}),
    });
    if (!defined.ok) return defined;
    const source = `${label}, product library ${product.id} (published)`;
    const servicePoints: ServicePoint[] = (product.roughIn ?? []).map((rp) => {
      // from the fixture end: convert to the centreline only when the product says which end
      // a corner bath's "end" is its back edge on the other wall: the corner it sits in
      const end = corner ?? product.fields.wasteEnd?.value;
      const across = rp.across?.from === "fixture-centreline" ? rp.across.value
        : rp.across?.from === "fixture-end" && rp.across.value !== undefined && (end === "left" || end === "right")
          ? quantize(end === "left" ? -box.w / 2 + rp.across.value : box.w / 2 - rp.across.value)
          : undefined;
      let face = "finished";
      let out: number | undefined;
      let outMax: number | undefined;
      if (rp.out?.from === "finished-wall") {
        out = rp.out.value ?? rp.out.min;
        outMax = rp.out.max !== undefined && rp.out.min !== undefined ? rp.out.max : undefined;
      } else if (rp.out?.from === "fixture-side") {
        // measured from the fixture's back edge, which sits `gap` in front of the anchor face
        face = anchor.face;
        out = rp.out.value !== undefined ? quantize(rp.out.value + anchor.gap) : undefined;
      }
      const up = rp.up?.from === "finished-floor" ? rp.up.value : undefined;
      const unconverted = [rp.across && across === undefined ? `across from ${rp.across.from}` : "", rp.out && out === undefined ? `out from ${rp.out.from}` : ""].filter(Boolean);
      return {
        id: rp.id, label: rp.label, service: rp.service, face,
        ...(out !== undefined ? { out } : {}), ...(outMax !== undefined ? { outMax } : {}),
        ...(across !== undefined ? { across } : {}), ...(up !== undefined ? { up } : {}),
        status: "published" as const,
        source: unconverted.length ? `${source}; not converted: ${unconverted.join(", ")}` : source,
      };
    });
    const item: Item = {
      id: uid("item"), kind: defined.kind as string, x: 0, y: 0, rotation: 0, anchor, productId: product.id, servicePoints,
      ...(corner && outline ? { corner: { left: kindFor("left"), right: kindFor("right"), side: corner } } : {}),
    };
    pushUndo();
    setModel({ ...store.getState().model, items: [...store.getState().model.items, item] });
    const pose = anchorPose(store.getState().model, item);
    return built.r.ok(
      `${label} placed${pose.resolved ? ` ${formatMm(anchor.gap)} mm off the ${anchor.face} face of ${anchor.wallId} (${anchor.side}), centre ${formatMm(anchor.distance)} mm from end ${anchor.from.toUpperCase()}` : `, but its position is unresolved: missing ${pose.missing.join(", ")}`}. ${servicePoints.length} service point(s) copied from the library.`,
      { id: item.id, kind: item.kind, resolved: pose.resolved },
    );
  },

  removeItem(idOrKind: string): ActionResult {
    const hit = resolveItem(idOrKind);
    if (!hit.ok) return rejected(hit);
    const item = hit.entity;
    pushUndo();
    setModel({ ...store.getState().model, items: store.getState().model.items.filter((i) => i.id !== item.id) });
    return ok(`Item ${item.id} removed.`, { id: item.id });
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
    parts?: PartSpec[];
    outline?: Outline;
  }): ActionResult {
    const kind = spec.kind.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_");
    if (!kind) return fail("A kind id is required.");
    if (FURNITURE_BUILDERS[kind]) return fail(`"${kind}" is a built-in kind — pick another id or use place_item.`);
    if (!(spec.w > 0 && spec.d > 0 && spec.h > 0)) return fail("w, d and h must all be positive metres.");
    if (spec.outline !== undefined) {
      const problems = outlineProblems(spec.outline, spec.w, spec.d);
      if (problems.length) return fail(`Outline rejected: ${problems.join("; ")}.`);
    }
    const outline = spec.outline ? { outline: structuredClone(spec.outline) } : {};
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
      if (spec.outline) existing.outline = structuredClone(spec.outline);
      else delete existing.outline;
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

// Convenience re-exports for tools
export { checkModel };
export const getModel = (): PlanModel => store.getState().model;
