import type { CatalogEntry } from "./catalog";
import type { PartSpec } from "../three/furniture";
import type { Note, PlanModel } from "./types";
import { seedLoft } from "./seed";

export const STORAGE_KEY = "alza.projects.v1";
export const DOCUMENT_VERSION = 2;
export const DEMO_ID = "sunset-loft";

export interface ProjectKind {
  entry: CatalogEntry;
  parts?: PartSpec[];
}

export interface ProjectDocument {
  version: 2;
  id: string;
  model: PlanModel;
  notes: Note[];
  kinds: ProjectKind[];
}

export interface ProjectLibrary {
  version: 2;
  activeId: string | null;
  projects: ProjectDocument[];
}

export const demoProject = (): ProjectDocument => ({
  version: DOCUMENT_VERSION, id: DEMO_ID, model: seedLoft(), notes: [], kinds: [],
});
export const emptyLibrary = (): ProjectLibrary => ({ version: DOCUMENT_VERSION, activeId: null, projects: [demoProject()] });

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const point = (v: unknown, fields: string[]) => object(v) && typeof v.id === "string" && fields.every((k) => finite(v[k]));

const LIBRARY_UNREADABLE = "Unsupported or unreadable saved library. Original browser data was kept.";

/**
 * v1 and v2 are the same model. The bump only reserves a version for later schema
 * changes; walls, openings, rooms, items, notes, kinds, and underlay stay as stored.
 */
function migrateV1ToV2(doc: Record<string, unknown>): Record<string, unknown> {
  return { ...doc, version: 2 };
}

/**
 * One step per older version, applied in order before validation.
 * A later schema adds the next function (migrateV2ToV3) to this map and bumps
 * DOCUMENT_VERSION; the loaders do not need to change.
 */
const migrations: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {
  1: migrateV1ToV2,
};

function migrateToCurrent(doc: Record<string, unknown>): Record<string, unknown> {
  const version = doc.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > DOCUMENT_VERSION) {
    throw new Error("Unsupported project document version.");
  }
  let current = doc;
  let v = version;
  while (v < DOCUMENT_VERSION) {
    const step = migrations[v];
    if (!step) throw new Error("Unsupported project document version.");
    current = step(current);
    const next = current.version;
    if (typeof next !== "number" || next !== v + 1) throw new Error("Unsupported project document version.");
    v = next;
  }
  return current;
}

export function parseProject(value: unknown): ProjectDocument {
  if (!object(value)) throw new Error("Unsupported project document version.");
  const migrated = migrateToCurrent(value);
  if (migrated.version !== DOCUMENT_VERSION) throw new Error("Unsupported project document version.");
  const { id, model, notes, kinds } = migrated;
  if (typeof id !== "string" || !id.trim() || !object(model) || typeof model.name !== "string" ||
      !Array.isArray(model.walls) || !Array.isArray(model.openings) || !Array.isArray(model.rooms) ||
      !Array.isArray(model.items) || !Array.isArray(notes) || !Array.isArray(kinds)) {
    throw new Error("Project document is incomplete or unreadable.");
  }
  if (!model.walls.every((v) => point(v, ["ax", "ay", "bx", "by", "thickness", "height"])) ||
      !model.openings.every((v) => point(v, ["t", "width", "sill", "height"]) && typeof v.wallId === "string" && (v.kind === "door" || v.kind === "window")) ||
      !model.rooms.every((v) => point(v, ["x", "y", "w", "h"]) && typeof v.label === "string" && typeof v.floor === "string") ||
      !model.items.every((v) => point(v, ["x", "y", "rotation"]) && typeof v.kind === "string") ||
      !notes.every((v) => object(v) && typeof v.id === "string" && typeof v.text === "string" && finite(v.at) && (v.author === "human" || v.author === "agent")) ||
      !kinds.every((v) => object(v) && object(v.entry) && typeof v.entry.kind === "string" && typeof v.entry.label === "string" && ["w", "d", "h"].every((k) => finite((v.entry as Record<string, unknown>)[k])) && (v.parts === undefined || Array.isArray(v.parts))) ||
      !(model.underlay === null || (object(model.underlay) && typeof model.underlay.dataUrl === "string" && ["opacity", "x", "y", "w", "h"].every((k) => finite((model.underlay as Record<string, unknown>)[k]))))) {
    throw new Error("Project document contains invalid model data.");
  }
  return migrated as unknown as ProjectDocument;
}

export function parseLibrary(raw: string): ProjectLibrary {
  const value: unknown = JSON.parse(raw);
  if (!object(value) || typeof value.version !== "number" || !Array.isArray(value.projects) ||
      !(value.activeId === null || typeof value.activeId === "string")) {
    throw new Error(LIBRARY_UNREADABLE);
  }
  let migrated: Record<string, unknown>;
  try {
    migrated = migrateToCurrent(value);
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
  if (!projects.some((p) => p.id === DEMO_ID) ||
      new Set(projects.map((p) => p.id)).size !== projects.length ||
      (activeId !== null && !projects.some((p) => p.id === activeId))) {
    throw new Error("Saved library has missing or duplicate projects. Original browser data was kept.");
  }
  return { version: DOCUMENT_VERSION, activeId, projects };
}

export function parseImport(raw: string): ProjectDocument {
  const value: unknown = JSON.parse(raw);
  return parseProject(value);
}
