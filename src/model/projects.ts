import type { CatalogEntry } from "./catalog";
import type { PartSpec } from "../three/furniture";
import type { Note, PlanModel } from "./types";
import { seedBathroom, bathroomKinds, bathroomNotes } from "./seed-bathroom";
import { quantize } from "./geometry";

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
}

export interface ProjectLibrary {
  version: 2;
  activeId: string | null;
  projects: ProjectDocument[];
}

export const demoProject = (): ProjectDocument => ({
  version: DOCUMENT_VERSION, id: DEMO_ID, model: seedBathroom(), presentation: "planning", notes: bathroomNotes(), kinds: structuredClone(bathroomKinds),
});
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
  if (!model.walls.every((v) => point(v, ["ax", "ay", "bx", "by", "thickness", "height"]) && (v.sides === undefined || wallSides(v.sides))) ||
      !model.openings.every((v) => point(v, ["t", "width", "sill", "height"]) && typeof v.wallId === "string" && (v.kind === "door" || v.kind === "window")) ||
      !model.rooms.every((v) => point(v, ["x", "y", "w", "h"]) && typeof v.label === "string" && typeof v.floor === "string") ||
      !model.items.every((v) => point(v, ["x", "y", "rotation"]) && typeof v.kind === "string") ||
      !notes.every((v) => object(v) && typeof v.id === "string" && typeof v.text === "string" && finite(v.at) && (v.author === "human" || v.author === "agent")) ||
      !kinds.every((v) => object(v) && object(v.entry) && typeof v.entry.kind === "string" && typeof v.entry.label === "string" && ["w", "d", "h"].every((k) => finite((v.entry as Record<string, unknown>)[k])) && (v.parts === undefined || Array.isArray(v.parts))) ||
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
