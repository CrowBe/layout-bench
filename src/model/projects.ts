import { validInstallation, validInstallationGeometry } from "./installation";
import { SELECTION_STATUSES, isExactProduct } from "./productIdentity";
import { isProductSpecification } from "./productMeasurements";
import { validProductSnapshot } from "./productRevision";
import type { CatalogEntry } from "./catalog";
import type { PartSpec } from "../three/furniture";
import type { Note, PlanModel } from "./types";
import { seedBathroom, bathroomKinds, bathroomNotes } from "./seed-bathroom";
import { validHeating } from "./heating";
import { validWasteProductLink } from "./wasteProduct";
import { quantize } from "./geometry";
import { outlineProblems, type Outline } from "./outline";

export const STORAGE_KEY = "alza.projects.v1";
export const DOCUMENT_VERSION = 2;
export const DEMO_ID = "bathroom-concept";

export interface ProjectKind {
  entry: CatalogEntry;
  parts?: PartSpec[];
}

export interface ProjectDocument {
  version: 2;
  id: string;
  model: PlanModel;
  presentation: "planning" | "styled";
  notes: Note[];
  kinds: ProjectKind[];
  /** Bathroom Concept only: fingerprint of the shipped sample this copy was loaded from. */
  sampleFingerprint?: string;
}

export interface ProjectLibrary {
  version: 2;
  activeId: string | null;
  projects: ProjectDocument[];
}

/**
 * The shipped sample, in the form a saved copy takes after a save and reload, stamped with its
 * fingerprint so a later load can tell an unedited copy of an older sample from an edited one.
 */
export const demoProject = (): ProjectDocument => {
  const project = parseProject(JSON.parse(JSON.stringify({
    version: DOCUMENT_VERSION, id: DEMO_ID, model: seedBathroom(), presentation: "planning", notes: bathroomNotes(), kinds: structuredClone(bathroomKinds),
  })));
  return { ...project, sampleFingerprint: sampleFingerprint(project) };
};

/** FNV-1a over the model, notes (without their creation times) and kinds. Presentation is a view setting. */
export function sampleFingerprint(project: ProjectDocument): string {
  const text = JSON.stringify([project.model, project.notes.map(({ at: _at, ...note }) => note), project.kinds]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

let shippedFingerprint: string | null = null;

/**
 * How a saved Bathroom Concept compares with the sample this build ships: the same, an unedited
 * copy of an older sample (safe to replace), or an edited or unidentifiable older copy (only a
 * person may reset it).
 */
export function sampleStatus(project: ProjectDocument): "current" | "outdated" | "outdated-edited" {
  shippedFingerprint ??= demoProject().sampleFingerprint!;
  const content = sampleFingerprint(project);
  if (content === shippedFingerprint) return "current";
  return project.sampleFingerprint === content ? "outdated" : "outdated-edited";
}
export const emptyLibrary = (): ProjectLibrary => ({ version: DOCUMENT_VERSION, activeId: null, projects: [demoProject()] });

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const point = (v: unknown, fields: string[]) => object(v) && typeof v.id === "string" && fields.every((k) => finite(v[k]));

const LIBRARY_UNREADABLE = "Unsupported or unreadable saved library. Original browser data was kept.";

/** Wall faces (#4): each recorded side carries a layer list; quantities are optional objects. */
const quantity = (v: unknown) => v === undefined || (object(v) && (v.value === undefined || finite(v.value)));
const wallSides = (v: unknown) => object(v) && Object.entries(v).every(([side, spec]) =>
  (side === "left" || side === "right") && object(spec) && quantity(spec.existing) && quantity(spec.frame) &&
  Array.isArray(spec.layers) && spec.layers.every((l) => object(l) && typeof l.id === "string" && typeof l.kind === "string" && quantity(l.thickness)));

/** Wall tiling (#9): per side, optional quantities and enumerated choices; nothing else is read. */
const oneOf = (v: unknown, allowed: string[]) => v === undefined || (typeof v === "string" && allowed.includes(v));
const wallTiling = (v: unknown) => v === undefined || (object(v) && Object.entries(v).every(([side, t]) =>
  (side === "left" || side === "right") && object(t) &&
  ["tileLength", "tileWidth", "joint", "originAlong", "originUp", "tiledHeight"].every((k) => quantity(t[k])) &&
  oneOf(t.orientation, ["landscape", "portrait"]) && oneOf(t.reference, ["board", "finished"]) &&
  oneOf(t.floor, ["finished", "screed", "substrate", "datum"]) && oneOf(t.originFrom, ["a", "b", "centre", "jamb-a", "jamb-b"]) &&   (t.originOpening === undefined || typeof t.originOpening === "string") &&
  (t.note === undefined || typeof t.note === "string") && (t.color === undefined || typeof t.color === "string")));

const floorTiling = (v: unknown) => v === undefined || (object(v) &&
  ["tileLength", "tileWidth", "joint", "originX", "originY"].every(k => quantity(v[k])) &&
  oneOf(v.axis, ["x", "y"]) && oneOf(v.originXFrom, ["west", "east"]) && oneOf(v.originYFrom, ["north", "south"]) && (v.zone === undefined || typeof v.zone === "string") &&
  (v.note === undefined || typeof v.note === "string") && (v.color === undefined || typeof v.color === "string"));

/** Floor assembly (#6): datum, optional substrate top, and a layer list with optional quantities. */
const floorBuildUp = (v: unknown) => v === undefined || (object(v) && typeof v.datum === "string" && quantity(v.substrateTop) && quantity(v.finishedTarget) &&
  Array.isArray(v.layers) && v.layers.every((l) => object(l) && typeof l.id === "string" && typeof l.kind === "string" && quantity(l.thickness)));

/** Drainage (#7): wastes with plan coordinates, planes with rectangles, controls with positions and levels. */
const drainage = (v: unknown) => v === undefined || (object(v) && Array.isArray(v.wastes) && Array.isArray(v.planes) &&
  v.wastes.every((w) => point(w, ["ax", "ay", "bx", "by"]) && (w.kind === "point" || w.kind === "linear") && typeof w.label === "string" && quantity(w.level) && quantity(w.outletAt) && validWasteProductLink(w.product)) &&
  v.planes.every((p) => point(p, ["x", "y", "w", "h"]) && typeof p.label === "string" && quantity(p.fall) &&
    (p.wasteId === undefined || typeof p.wasteId === "string") &&
    Array.isArray(p.controls) && (p.controls as Record<string, unknown>[]).every((c) => point(c, ["x", "y"]) && typeof c.label === "string" && quantity(c.level))));

/** Fixture set-out (#5): every field the derivation reads, with the values it allows. */
const STATUS = ["site-confirmed", "measured", "published", "proposed", "estimated"];
const SERVICE_POINT_STATUS = [...STATUS, "derived"];
const optionalFinite = (v: unknown) => v === undefined || finite(v);
const validAnchor = (v: unknown) => object(v) && typeof v.wallId === "string" && typeof v.face === "string" &&
  (v.side === "left" || v.side === "right") && (v.from === "a" || v.from === "b") && typeof v.status === "string" && STATUS.includes(v.status) &&
  finite(v.gap) && finite(v.distance);
const validServicePoint = (v: unknown) => object(v) && typeof v.id === "string" && typeof v.label === "string" && typeof v.face === "string" &&
  (v.service === "waste" || v.service === "water" || v.service === "power") && typeof v.status === "string" && SERVICE_POINT_STATUS.includes(v.status) &&
  optionalFinite(v.out) && optionalFinite(v.outMax) && optionalFinite(v.across) && optionalFinite(v.up) &&
  (v.axisEvidence === undefined || object(v.axisEvidence) && isProductSpecification({ category: "service", fields: v.axisEvidence, acceptedAt: 0 }));

/** Trade sheets (#29): every field the checker and renderer read. */
const optionalString = (v: unknown) => v === undefined || typeof v === "string";
const validSheetSet = (v: unknown) => object(v) && object(v.titleBlock) &&
  ["project", "site", "preparedBy"].every((k) => optionalString((v.titleBlock as Record<string, unknown>)[k])) &&
  (v.stageExports === undefined || Array.isArray(v.stageExports) && v.stageExports.every(e=>object(e) && typeof e.label === "string" && typeof e.date === "string" && typeof e.svg === "string" && typeof e.specHtml === "string" && typeof e.modelEvidence === "string" && finite(e.at) && optionalString(e.note) && (e.elevations === undefined || Array.isArray(e.elevations) && e.elevations.every(x=>object(x) && typeof x.surface === "string" && typeof x.room === "string" && typeof x.svg === "string")) && (e.planOmitted === undefined || typeof e.planOmitted === "boolean") && Array.isArray(e.elements) && e.elements.every(id=>typeof id === "string") && Array.isArray(e.acknowledged) && e.acknowledged.every(a=>object(a) && typeof a.code === "string" && typeof a.ref === "string" && typeof a.reason === "string" && ["human","agent"].includes(String(a.by))))) &&
  Array.isArray(v.revisions) && v.revisions.every((r: unknown) => object(r) && typeof r.rev === "string" && typeof r.sheet === "string" &&
    typeof r.date === "string" && optionalString(r.note) && Array.isArray(r.acknowledged) &&
    (r.content === undefined || object(r.content) && typeof r.content.svg === "string" && typeof r.content.modelEvidence === "string" && Array.isArray(r.content.productRefs) && r.content.productRefs.every(p => object(p) && typeof p.itemId === "string" && optionalString(p.productId) && (p.revision === undefined || Number.isInteger(p.revision) && (p.revision as number) > 0))) &&
    r.acknowledged.every((a: unknown) => object(a) && typeof a.code === "string" && typeof a.ref === "string" && typeof a.reason === "string" && (a.by === "human" || a.by === "agent")));

/** Fixture outlines (#37): points the renderer and checks read. */
const pointXY = (p: unknown) => object(p) && finite(p.x) && finite(p.y);
const validOutline = (entry: Record<string, unknown>) => {
  const o = entry.outline;
  if (o === undefined) return true;
  if (!(object(o) && pointXY(o.start) && Array.isArray(o.segments) &&
    o.segments.every((s: unknown) => object(s) && pointXY(s.to) && (s.via === undefined || pointXY(s.via))))) return false;
  // the same rules define_item_kind applies: inside its box, touching its back, enclosing area
  return outlineProblems(o as unknown as Outline, entry.w as number, entry.d as number).length === 0;
};

type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/**
 * Project documents only. v1 and v2 share a model; this step reserves the version.
 * A later schema change adds migrateProjectV2ToV3 here and reads `model` — it must
 * not be registered on the library wrapper, which has no model.
 */
function migrateProjectV1ToV2(doc: Record<string, unknown>): Record<string, unknown> {
  if (!object(doc.model)) throw new Error("Unsupported project document version.");
  return { ...doc, version: 2 };
}

/**
 * Library wrapper only. Re-versions the envelope and leaves each project untouched;
 * parseLibrary then runs the project steps on `projects`.
 */
function migrateLibraryV1ToV2(doc: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(doc.projects)) throw new Error(LIBRARY_UNREADABLE);
  return { ...doc, version: 2 };
}

/** One step per older version, applied in order before validation. */
const projectMigrations: Record<number, Migration> = {
  1: migrateProjectV1ToV2,
};

const libraryMigrations: Record<number, Migration> = {
  1: migrateLibraryV1ToV2,
};

function applyMigrations(doc: Record<string, unknown>, steps: Record<number, Migration>, unsupported: string): Record<string, unknown> {
  const version = doc.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > DOCUMENT_VERSION) {
    throw new Error(unsupported);
  }
  let current = doc;
  let v = version;
  while (v < DOCUMENT_VERSION) {
    const step = steps[v];
    if (!step) throw new Error(unsupported);
    current = step(current);
    const next = current.version;
    if (typeof next !== "number" || next !== v + 1) throw new Error(unsupported);
    v = next;
  }
  return current;
}

export function parseProject(value: unknown): ProjectDocument {
  if (!object(value)) throw new Error("Unsupported project document version.");
  const migrated = applyMigrations(value, projectMigrations, "Unsupported project document version.");
  if (migrated.version !== DOCUMENT_VERSION) throw new Error("Unsupported project document version.");
  const { id, model, notes, kinds } = migrated;
  if (typeof id !== "string" || !id.trim() || !object(model) || typeof model.name !== "string" ||
      !Array.isArray(model.walls) || !Array.isArray(model.openings) || !Array.isArray(model.rooms) ||
      !Array.isArray(model.items) || !Array.isArray(notes) || !Array.isArray(kinds)) {
    throw new Error("Project document is incomplete or unreadable.");
  }
  if (!model.walls.every((v) => point(v, ["ax", "ay", "bx", "by", "thickness", "height"]) && (v.sides === undefined || wallSides(v.sides)) && wallTiling(v.tiling)) ||
      !model.openings.every((v) => point(v, ["t", "width", "sill", "height"]) && typeof v.wallId === "string" && (v.kind === "door" || v.kind === "window")) ||
      !model.rooms.every((v) => point(v, ["x", "y", "w", "h"]) && typeof v.label === "string" && typeof v.floor === "string" && floorBuildUp(v.floorBuildUp) && drainage(v.drainage) && validHeating(v.heating) && floorTiling(v.floorTiling)) ||
      !model.items.every((v) => point(v, ["x", "y", "rotation"]) && typeof v.kind === "string" &&
        (v.anchor === undefined || validAnchor(v.anchor)) &&
        (v.fittedTo === undefined || (object(v.fittedTo) && typeof v.fittedTo.hostId === "string" && finite(v.fittedTo.across) && finite(v.fittedTo.out))) &&
        (v.installation === undefined || validInstallation(v.installation)) && (v.installationGeometry === undefined || validInstallationGeometry(v.installationGeometry)) &&
        oneOf(v.selectionStatus, SELECTION_STATUSES) && (v.productIdentity === undefined || isExactProduct(v.productIdentity)) &&
        (v.productSpecification === undefined || isProductSpecification(v.productSpecification)) &&
        (v.productSnapshot === undefined || validProductSnapshot(v.productSnapshot)) &&
        (v.productGeometry === undefined || object(v.productGeometry) && v.productGeometry.kind === v.kind && typeof v.productGeometry.label === "string" && typeof v.productGeometry.color === "string" && ["w","d","h"].every(key => finite(v.productGeometry![key]) && (v.productGeometry![key] as number) > 0) && validOutline(v.productGeometry)) &&
        (v.productUpdates === undefined || Array.isArray(v.productUpdates) && v.productUpdates.every((u: unknown) => object(u) && typeof u.from === "string" && typeof u.to === "string" && finite(u.at) && Array.isArray(u.preserved) && u.preserved.every(s => typeof s === "string") && Array.isArray(u.unresolved) && u.unresolved.every(s => typeof s === "string"))) &&
        (v.corner === undefined || (object(v.corner) && typeof v.corner.left === "string" && typeof v.corner.right === "string" && (v.corner.side === "left" || v.corner.side === "right"))) &&
        (v.servicePoints === undefined || (Array.isArray(v.servicePoints) && v.servicePoints.every(validServicePoint)))) ||
      !notes.every((v) => object(v) && typeof v.id === "string" && typeof v.text === "string" && finite(v.at) && (v.author === "human" || v.author === "agent")) ||
      !kinds.every((v) => object(v) && object(v.entry) && typeof v.entry.kind === "string" && typeof v.entry.label === "string" && ["w", "d", "h"].every((k) => finite((v.entry as Record<string, unknown>)[k])) && (v.parts === undefined || Array.isArray(v.parts)) && (v.entry.elevation === undefined || finite(v.entry.elevation) && v.entry.elevation >= 0) && oneOf(v.entry.installationMounting,["wall"]) && validOutline(v.entry as Record<string, unknown>)) ||
      !(model.sheetSet === undefined || validSheetSet(model.sheetSet)) ||
      !(model.underlay === null || (object(model.underlay) && typeof model.underlay.dataUrl === "string" && ["opacity", "x", "y", "w", "h"].every((k) => finite((model.underlay as Record<string, unknown>)[k]))))) {
    throw new Error("Project document contains invalid model data.");
  }
  // v1 documents written before opening anchors stored only t. Derive an end A
  // distance from that legacy fraction while retaining t for renderers; this
  // preserves position but does not establish surveyed provenance.
  const project = migrated as unknown as ProjectDocument;
  const walls = new Map(project.model.walls.map((wall) => [wall.id, wall]));
  const openings = project.model.openings.map((opening) => {
    const wall = walls.get(opening.wallId);
    if (!wall || ((opening.anchorEnd === "a" || opening.anchorEnd === "b") &&
        typeof opening.anchorDistance === "number" && Number.isFinite(opening.anchorDistance))) return opening;
    return { ...opening, anchorEnd: "a" as const, anchorDistance: quantize(opening.t * Math.hypot(wall.bx - wall.ax, wall.by - wall.ay)) };
  });
  const presentation = migrated.presentation ?? (id === DEMO_ID ? "styled" : "planning");
  if (presentation !== "planning" && presentation !== "styled") {
    throw new Error("Project presentation must be planning or styled.");
  }
  return { ...project, presentation, model: { ...project.model, openings } };
}

export function parseLibrary(raw: string): ProjectLibrary {
  const value: unknown = JSON.parse(raw);
  if (!object(value) || typeof value.version !== "number" || !Array.isArray(value.projects) ||
      !(value.activeId === null || typeof value.activeId === "string")) {
    throw new Error(LIBRARY_UNREADABLE);
  }
  let migrated: Record<string, unknown>;
  try {
    migrated = applyMigrations(value, libraryMigrations, LIBRARY_UNREADABLE);
  } catch (error) {
    if (error instanceof Error && error.message === "Unsupported project document version.") {
      throw new Error(LIBRARY_UNREADABLE);
    }
    throw error;
  }
  const { activeId, projects: storedProjects } = migrated;
  if (migrated.version !== DOCUMENT_VERSION || !Array.isArray(storedProjects) ||
      !(activeId === null || typeof activeId === "string")) {
    throw new Error(LIBRARY_UNREADABLE);
  }
  const projects = storedProjects.map(parseProject);
  if (new Set(projects.map((p) => p.id)).size !== projects.length ||
      (activeId !== null && !projects.some((p) => p.id === activeId))) {
    throw new Error("Saved library has missing or duplicate projects. Original browser data was kept.");
  }
  return { version: DOCUMENT_VERSION, activeId, projects };
}

export function parseImport(raw: string): ProjectDocument {
  const value: unknown = JSON.parse(raw);
  return parseProject(value);
}
