import type { CatalogEntry } from "./catalog";
import type { PartSpec } from "../three/furniture";
import type { Note, PlanModel } from "./types";
import { seedLoft } from "./seed";

export const STORAGE_KEY = "alza.projects.v1";
export const DOCUMENT_VERSION = 1;
export const DEMO_ID = "sunset-loft";

export interface ProjectKind {
  entry: CatalogEntry;
  parts?: PartSpec[];
}

export interface ProjectDocument {
  version: 1;
  id: string;
  model: PlanModel;
  notes: Note[];
  kinds: ProjectKind[];
}

export interface ProjectLibrary {
  version: 1;
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

export function parseProject(value: unknown): ProjectDocument {
  if (!object(value) || value.version !== DOCUMENT_VERSION) throw new Error("Unsupported project document version.");
  const { id, model, notes, kinds } = value;
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
  // v1 documents written before opening anchors stored only t. Derive an end A
  // distance from that legacy fraction while retaining t for renderers; this
  // preserves position but does not establish surveyed provenance.
  const project = value as unknown as ProjectDocument;
  const walls = new Map(project.model.walls.map((wall) => [wall.id, wall]));
  for (const opening of project.model.openings) {
    const wall = walls.get(opening.wallId);
    if (!wall) continue;
    if ((opening.anchorEnd !== "a" && opening.anchorEnd !== "b") ||
        typeof opening.anchorDistance !== "number" || !Number.isFinite(opening.anchorDistance)) {
      opening.anchorEnd = "a";
      opening.anchorDistance = opening.t * Math.hypot(wall.bx - wall.ax, wall.by - wall.ay);
    }
  }
  return project;
}

export function parseLibrary(raw: string): ProjectLibrary {
  const value: unknown = JSON.parse(raw);
  if (!object(value) || value.version !== DOCUMENT_VERSION || !Array.isArray(value.projects) ||
      !(value.activeId === null || typeof value.activeId === "string")) {
    throw new Error("Unsupported or unreadable saved library. Original browser data was kept.");
  }
  const projects = value.projects.map(parseProject);
  if (!projects.some((p) => p.id === DEMO_ID) ||
      new Set(projects.map((p) => p.id)).size !== projects.length ||
      (value.activeId !== null && !projects.some((p) => p.id === value.activeId))) {
    throw new Error("Saved library has missing or duplicate projects. Original browser data was kept.");
  }
  return { version: DOCUMENT_VERSION, activeId: value.activeId, projects };
}

export function parseImport(raw: string): ProjectDocument {
  const value: unknown = JSON.parse(raw);
  return parseProject(value);
}
