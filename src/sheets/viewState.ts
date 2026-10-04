/**
 * Diagram view state (#41): which layers and objects of the canonical model a stage diagram
 * shows. It lives in its own store, per project, for this page session. It is never written
 * into the project model, its undo history or its saved document, so composing or switching a
 * stage cannot change or copy the renovation's geometry, fixtures, services or provenance.
 */

import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { PlanModel } from "../model/types";
import { catalogue, resolveVisible, suggest, viewFindings, type Catalogue, type Resolution } from "./stageView";
import type { SheetFinding } from "./check";
import type { LibraryProduct } from "../model/productLibrary";

export interface DiagramView {
  label: string;
  /** exactly the ids the caller gave: layer ids and/or element ids */
  visible: string[];
  at: number;
}

export interface ExportedView {
  modelEvidence?: string;
  projectId: string | null;
  label: string;
  date: string;
  svg: string;
  specHtml: string;
  elements: string[];
  at: number;
  elevations?: { surface: string; room: string; svg: string }[];
  planOmitted?: boolean;
}

interface ViewStoreState {
  /** current view per project id */
  views: Record<string, DiagramView>;
  /** views composed in this session per project, by label, so an agent can switch back */
  saved: Record<string, Record<string, DiagramView>>;
  lastExport: ExportedView | null;
}

export const viewStore = createStore<ViewStoreState>(() => ({ views: {}, saved: {}, lastExport: null }));
export const useDiagramView = (projectId: string | null) => useStore(viewStore, (s) => (projectId ? s.views[projectId] ?? null : null));
export const useLastExport = () => useStore(viewStore, (s) => s.lastExport);

const key = (projectId: string | null) => projectId ?? "(none)";

export type ApplyResult =
  | { ok: true; view: DiagramView; resolution: Resolution; catalogue: Catalogue }
  | { ok: false; summary: string; unknown: string[]; suggestions: Record<string, string[]> };

/**
 * Apply an explicit visible set. Every id must name a layer or element the model has now; any
 * unknown id rejects the whole call and leaves the current view as it was.
 */
export function applyView(projectId: string | null, model: PlanModel, label: unknown, visible: unknown): ApplyResult {
  const name = typeof label === "string" ? label.trim().slice(0, 80) : "";
  if (!name) return { ok: false, summary: "Give the view a label (e.g. \"3. Plumbing and electrical rough-in\").", unknown: [], suggestions: {} };
  if (!Array.isArray(visible) || visible.some((v) => typeof v !== "string")) return { ok: false, summary: "visible must be a list of layer or element ids from list_diagram_content.", unknown: [], suggestions: {} };
  const ids = [...new Set((visible as string[]).map((v) => v.trim()).filter(Boolean))];
  if (!ids.length) return { ok: false, summary: "visible is empty: name at least one layer or element id.", unknown: [], suggestions: {} };
  const cat = catalogue(model);
  const resolution = resolveVisible(model, ids, cat);
  if (resolution.unknown.length) {
    const suggestions = Object.fromEntries(resolution.unknown.map((u) => [u, suggest(cat, u)]));
    const empty = resolution.unknown.filter((u) => (cat.emptyLayers as string[]).includes(u));
    return {
      ok: false,
      summary: `Rejected: ${resolution.unknown.length} id(s) are not layers or objects in this model: ${resolution.unknown.join(", ")}.${empty.length ? ` (${empty.join(", ")}: a known layer kind with nothing recorded in this project yet.)` : ""} Nothing changed. Use ids from list_diagram_content; a layer the model does not have (e.g. heating cable) cannot be shown.`,
      unknown: resolution.unknown, suggestions,
    };
  }
  const view: DiagramView = { label: name, visible: ids, at: Date.now() };
  const k = key(projectId);
  viewStore.setState((s) => ({ views: { ...s.views, [k]: view }, saved: { ...s.saved, [k]: { ...(s.saved[k] ?? {}), [name]: view } } }));
  return { ok: true, view, resolution, catalogue: cat };
}

export const currentView = (projectId: string | null): DiagramView | null => viewStore.getState().views[key(projectId)] ?? null;
export const savedViews = (projectId: string | null): DiagramView[] => Object.values(viewStore.getState().saved[key(projectId)] ?? {});

export function recordExport(e: ExportedView) {
  viewStore.setState({ lastExport: e });
}

/** For tests: forget every view. */
export function resetViews() {
  viewStore.setState({ views: {}, saved: {}, lastExport: null });
}

export interface ComposedView {
  view: DiagramView;
  resolution: Resolution;
  findings: SheetFinding[];
}

/** Resolve a stored view against the model as it is now, with its scoped preflight findings. */
export function composeView(model: PlanModel, view: DiagramView, products: LibraryProduct[] = []): ComposedView {
  const resolution = resolveVisible(model, view.visible);
  return { view, resolution, findings: viewFindings(model, resolution, products) };
}
