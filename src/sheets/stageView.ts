/**
 * Construction-stage diagram views (#41). One canonical project; a stage is only a choice of
 * which of its layers and objects are visible. Nothing here writes to the model: the catalogue
 * is derived from it, a view is a list of ids kept outside it (see viewState.ts), and the
 * diagram and the specification sheet are both rendered from the same resolved element set.
 *
 * Only recorded content is offered. Heating without a room record is explicitly absent;
 * pipe and cable runs between service points remain unmodelled.
 * Unknown values print as "?" with what is missing, exactly as on sheet A-01.
 */

import type { Acknowledgement, PlanModel, Quantity, Room, Wall, WallSideName } from "../model/types";
import type { LibraryProduct } from "../model/productLibrary";
import { catalogByKind, isBuiltInKind } from "../model/catalog";
import { rectCorners, segLen, type Pt } from "../model/geometry";
import { openingSpan } from "../model/issues";
import { input, known, layerLabel, resolveFace, sideFaces, sideNormal, wallBody, weakest } from "../model/faces";
import { DEFAULT_DATUM, floorLayerLabel, floorLevels } from "../model/floor";
import { heatingEvidence } from "../model/heating";
import { planeSurface } from "../model/drainage";
import { anchorPose, roughIn } from "../model/fixtures";
import { itemPolygon } from "../model/outline";
import { IDENTITY_FIELDS, identityOf, identityText, type IdentityKey } from "../model/productIdentity";
import { categoryById } from "../model/products";
import { checkSheet, type SheetFinding } from "./check";
import { PAPER, TAGS, esc, f1, joinedRect, mm, tag } from "./floorPlan";

// ---------------------------------------------------------------------------------- catalogue

export const LAYERS = [
  { id: "walls", label: "Walls as drawn (line, length, body)" },
  { id: "wall-existing", label: "Existing wall surfaces (surveyed)" },
  { id: "wall-frame", label: "Wall frame faces (after strip-out)" },
  { id: "wall-board", label: "Wall board (e.g. Villaboard)" },
  { id: "wall-waterproofing", label: "Wall waterproofing" },
  { id: "wall-adhesive", label: "Wall tile adhesive" },
  { id: "wall-tile", label: "Wall tile" },
  { id: "windows", label: "Windows" },
  { id: "doors", label: "Doors" },
  { id: "rooms", label: "Rooms (outline label)" },
  { id: "floor-substrate", label: "Floor substrate and datum" },
  { id: "floor-waterproofing", label: "Floor waterproofing" },
  { id: "floor-heating-cable", label: "Proposed in-screed heating cable" },
  { id: "floor-screed", label: "Floor screed" },
  { id: "floor-adhesive", label: "Floor tile adhesive" },
  { id: "floor-tile", label: "Floor tile" },
  { id: "drainage-wastes", label: "Floor wastes" },
  { id: "drainage-planes", label: "Floor planes and falls" },
  { id: "fixtures", label: "Fixtures (bath, vanity, toilet, screen…)" },
  { id: "services-waste", label: "Waste service points" },
  { id: "services-water", label: "Water service points" },
  { id: "services-power", label: "Power service points" },
] as const;
export type LayerId = (typeof LAYERS)[number]["id"];

/** Construction content the model has no representation for. It is never drawn or listed as present. */
export const NOT_MODELLED = [
  "in-screed heating cable (no cable record supplied)",
  "pipe and cable runs between service points (only the points are modelled)",
];

export type ElementType = "wall" | "face" | "wall-layer" | "opening" | "room" | "floor-substrate" | "floor-layer" | "waste" | "floor-plane" | "heating" | "fixture" | "service-point";

export interface ViewElement {
  id: string;
  layer: LayerId;
  type: ElementType;
  label: string;
  /** the canonical model entity it is drawn from */
  ref: string;
  /** the wall side, for faces and wall layers */
  side?: WallSideName;
  /**
   * the sub-entity within ref (face name, layer, waste, plane or service point id). Kept here
   * rather than parsed back out of `id`, because some model ids may contain ":".
   */
  sub?: string;
}

export interface Catalogue {
  layers: { id: LayerId; label: string; elements: string[] }[];
  /** known layer kinds with nothing recorded in this model yet */
  emptyLayers: LayerId[];
  elements: ViewElement[];
  notModelled: string[];
}

const wallName = (w: Wall) => w.id.replace(/^wall_/, "");

/** Every layer and object the model really has, with stable ids derived from model ids. */
export function catalogue(model: PlanModel): Catalogue {
  const els: ViewElement[] = [];
  const add = (e: ViewElement) => els.push(e);
  for (const w of model.walls) {
    add({ id: `wall:${w.id}`, layer: "walls", type: "wall", label: `Wall ${wallName(w)}`, ref: w.id });
  }
  for (const w of model.walls) {
    for (const side of ["left", "right"] as WallSideName[]) {
      const spec = w.sides?.[side];
      if (!spec) continue;
      if (spec.existing) add({ id: `wall:${w.id}:${side}:existing`, layer: "wall-existing", type: "face", label: `Wall ${wallName(w)} ${side}: existing surface`, ref: w.id, side, sub: "existing" });
      if (spec.frame) add({ id: `wall:${w.id}:${side}:frame`, layer: "wall-frame", type: "face", label: `Wall ${wallName(w)} ${side}: frame face`, ref: w.id, side, sub: "frame" });
      for (const l of spec.layers) add({ id: `wall:${w.id}:${side}:${l.id}`, layer: `wall-${l.kind}` as LayerId, type: "wall-layer", label: `Wall ${wallName(w)} ${side}: ${layerLabel(l)}`, ref: w.id, side, sub: l.id });
    }
  }
  for (const o of model.openings) {
    add({ id: `opening:${o.id}`, layer: o.kind === "door" ? "doors" : "windows", type: "opening", label: `${o.kind === "door" ? "Door" : "Window"} ${o.id} on ${o.wallId}`, ref: o.id });
  }
  for (const r of model.rooms) {
    add({ id: `room:${r.id}`, layer: "rooms", type: "room", label: `Room ${r.label}`, ref: r.id });
    const fb = r.floorBuildUp;
    if (fb) {
      add({ id: `room:${r.id}:substrate`, layer: "floor-substrate", type: "floor-substrate", label: `${r.label} floor: substrate`, ref: r.id });
      for (const l of fb.layers) add({ id: `room:${r.id}:floor:${l.id}`, layer: `floor-${l.kind}` as LayerId, type: "floor-layer", label: `${r.label} floor: ${floorLayerLabel(l)}`, ref: r.id, sub: l.id });
    }
    if (r.heating) add({ id: `room:${r.id}:heating`, layer: "floor-heating-cable", type: "heating", label: `${r.label}: proposed heating cable`, ref: r.id });
    for (const wst of r.drainage?.wastes ?? []) add({ id: `room:${r.id}:waste:${wst.id}`, layer: "drainage-wastes", type: "waste", label: `${r.label}: ${wst.label}`, ref: r.id, sub: wst.id });
    for (const p of r.drainage?.planes ?? []) add({ id: `room:${r.id}:plane:${p.id}`, layer: "drainage-planes", type: "floor-plane", label: `${r.label}: ${p.label}`, ref: r.id, sub: p.id });
  }
  for (const it of model.items) {
    const label = catalogByKind(it.kind)?.label ?? it.kind;
    add({ id: `item:${it.id}`, layer: "fixtures", type: "fixture", label: `${label} (${it.id})`, ref: it.id });
    for (const sp of it.servicePoints ?? []) add({ id: `item:${it.id}:sp:${sp.id}`, layer: `services-${sp.service}` as LayerId, type: "service-point", label: `${label}: ${sp.label}`, ref: it.id, sub: sp.id });
  }
  const layers = LAYERS.map((l) => ({ id: l.id, label: l.label, elements: els.filter((e) => e.layer === l.id).map((e) => e.id) })).filter((l) => l.elements.length);
  return { layers, emptyLayers: LAYERS.filter((l) => !layers.some((x) => x.id === l.id)).map((l) => l.id), elements: els, notModelled: NOT_MODELLED.filter((_, i) => i !== 0 || !model.rooms.some((r) => r.heating)) };
}

export interface Resolution {
  /** visible element ids in catalogue order */
  elements: ViewElement[];
  /** requested ids that name nothing in the current model */
  unknown: string[];
}

/** Resolve a list of layer and object ids against the model. Order and duplicates do not matter. */
export function resolveVisible(model: PlanModel, ids: string[], cat = catalogue(model)): Resolution {
  const want = new Set<string>();
  const unknown: string[] = [];
  for (const id of ids) {
    const layer = cat.layers.find((l) => l.id === id);
    if (layer) { layer.elements.forEach((e) => want.add(e)); continue; }
    if (cat.elements.some((e) => e.id === id)) { want.add(id); continue; }
    unknown.push(id);
  }
  return { elements: cat.elements.filter((e) => want.has(e.id)), unknown };
}

/** A short "did you mean" list for an unknown id: catalogue ids sharing its longest part. */
export function suggest(cat: Catalogue, id: string): string[] {
  const parts = id.split(/[:_-]/).filter((p) => p.length > 1).sort((a, b) => b.length - a.length);
  const all = [...cat.layers.map((l) => l.id), ...cat.elements.map((e) => e.id)];
  for (const p of parts) {
    const hits = all.filter((x) => x.includes(p));
    if (hits.length) return hits.slice(0, 5);
  }
  return [];
}

// ---------------------------------------------------------------------------------- spec rows

export type RowStatus = keyof typeof TAGS;

export interface SpecRow {
  element: string;
  layer: LayerId;
  label: string;
  property: string;
  /** printed value: mm for lengths, text otherwise; "?" when unknown */
  value: string;
  status: RowStatus;
  /** what the value is measured from, when it is a position or level */
  datum?: string;
  source?: string;
  missing?: string[];
}

const dimStatus = (defaulted: boolean | undefined): RowStatus => (defaulted === undefined ? "unknown" : defaulted ? "defaulted" : "entered");
const qRow = (q: Quantity | undefined) => (known(q) ? { value: mm(q.value), status: q.status as RowStatus, ...(q.source ? { source: q.source } : {}) } : { value: "?", status: "unknown" as RowStatus, ...(q?.source ? { source: q.source } : {}) });

/** The specification rows for one element: every property with its status and source. */
export function specRows(model: PlanModel, el: ViewElement, products: LibraryProduct[] = []): SpecRow[] {
  const rows: SpecRow[] = [];
  const row = (property: string, r: Omit<SpecRow, "element" | "layer" | "label" | "property">) =>
    rows.push({ element: el.id, layer: el.layer, label: el.label, property, ...r, ...(r.value === "?" && !r.missing ? { missing: [property] } : {}) });

  if (el.type === "wall" || el.type === "face" || el.type === "wall-layer") {
    const w = model.walls.find((x) => x.id === el.ref)!;
    if (el.type === "wall") {
      row("length A→B along drawn line (mm)", { value: mm(segLen(w.ax, w.ay, w.bx, w.by)), status: "entered" });
      row("thickness (mm)", { value: mm(w.thickness), status: dimStatus(w.thicknessDefaulted) });
      row("height (mm)", { value: mm(w.height), status: dimStatus(w.heightDefaulted) });
      return rows;
    }
    const side = el.side!;
    const spec = w.sides?.[side];
    const datum = `drawn line of ${w.id}, toward ${side} side`;
    if (el.type === "face") {
      const name = el.sub as "existing" | "frame";
      const r = qRow(spec?.[name]);
      row(`${name === "existing" ? "existing surface" : "frame face"} position (mm)`, { ...r, datum });
      return rows;
    }
    const layer = spec!.layers.find((l) => l.id === el.sub)!;
    row("kind", { value: layer.kind, status: "entered" });
    row("thickness (mm)", qRow(layer.thickness));
    const face = sideFaces(spec).find((f) => f.face === layer.id)!;
    row("outer face position (mm)", face.resolved ? { value: mm(face.offset!), status: face.basis as RowStatus, datum } : { value: "?", status: "unknown", datum, missing: face.missing });
    return rows;
  }

  if (el.type === "opening") {
    const o = model.openings.find((x) => x.id === el.ref)!;
    const w = model.walls.find((x) => x.id === o.wallId);
    row("width (mm)", { value: mm(o.width), status: dimStatus(o.widthDefaulted) });
    if (o.kind === "window") row("sill above floor (mm)", { value: mm(o.sill), status: dimStatus(o.sillDefaulted) });
    row("height (mm)", { value: mm(o.height), status: dimStatus(o.heightDefaulted) });
    if (w) row("centre from end A (mm)", { value: mm(o.t * segLen(w.ax, w.ay, w.bx, w.by)), status: "entered", datum: `${w.id} end A, along the drawn line` });
    return rows;
  }

  const room = (): Room => model.rooms.find((x) => x.id === el.ref)!;
  if (el.type === "room") {
    const r = room();
    row("size w × h (mm)", { value: `${mm(r.w)} × ${mm(r.h)}`, status: "entered" });
    return rows;
  }
  if (el.type === "floor-substrate" || el.type === "floor-layer") {
    const fb = room().floorBuildUp!;
    const datum = fb.datum || DEFAULT_DATUM;
    const levels = floorLevels(fb);
    if (el.type === "floor-substrate") {
      row("substrate", fb.substrate ? { value: fb.substrate, status: "entered" } : { value: "?", status: "unknown", missing: ["substrate type (never assumed)"] });
      const lv = levels[0];
      row("substrate top level (mm)", lv.resolved ? { value: mm(lv.top!), status: lv.basis as RowStatus, datum, ...(fb.substrateTop?.source ? { source: fb.substrateTop.source } : {}) } : { value: "?", status: "unknown", datum, missing: lv.missing });
      return rows;
    }
    const layer = fb.layers.find((l) => l.id === el.sub)!;
    row("kind", { value: layer.kind, status: "entered" });
    row("thickness (mm)", qRow(layer.thickness));
    const lv = levels.find((l) => l.level === layer.id)!;
    row("top level (mm)", lv.resolved ? { value: mm(lv.top!), status: lv.basis as RowStatus, datum } : { value: "?", status: "unknown", datum, missing: lv.missing });
    return rows;
  }
  if (el.type === "waste") {
    const r = room();
    const wst = r.drainage!.wastes.find((x) => x.id === el.sub)!;
    row("kind", { value: wst.kind, status: "entered" });
    row("finished level at waste (mm)", { ...qRow(wst.level), datum: r.floorBuildUp?.datum || DEFAULT_DATUM });
    return rows;
  }
  if (el.type === "heating") {
    const r = room(), h = r.heating!, e = heatingEvidence(r);
    for (const property of ["manufacturer", "model", "productSource", "requirements"] as const) row(property, { value: h[property] || "?", status: h[property] ? "entered" : "unknown" });
    for (const property of ["length", "minSpacing", "edgeClearance", "depthFromBottom"] as const) row(`${property} (mm)`, qRow(h[property]));
    row("rated output (W)", h.ratedOutput?.value !== undefined ? { value: String(h.ratedOutput.value), status: h.ratedOutput.status ?? "unknown", source: h.ratedOutput.source } : { value: "?", status: "unknown" });
    row("plan route length (m)", { value: String(e.planRouteLength), status: "proposed" });
    row("spatial route length, sampled profile (m)", { value: e.routeLength === undefined ? "?" : String(e.routeLength), status: e.routeLength === undefined ? "unknown" : "proposed" });
    row("remaining confirmed product length (m)", { value: e.remainingProductLength === undefined ? "?" : String(e.remainingProductLength), status: e.remainingProductLength === undefined ? "unknown" : "proposed" });
    row("length basis", { value: e.lengthNote, status: "proposed" });
    row("zone ids", { value: h.zoneIds.join(", ") || "?", status: h.zoneIds.length ? "proposed" : "unknown" });
    row("available zone area (m²), not heat coverage", { value: String(e.availableArea), status: "proposed" });
    row("minimum non-adjacent spacing (mm)", { value: e.minimumNonAdjacentSpacing === undefined ? "?" : mm(e.minimumNonAdjacentSpacing), status: e.minimumNonAdjacentSpacing === undefined ? "unknown" : "proposed" });
    row("installation approval", { value: "Pending manufacturer / electrician review", status: "proposed" });
    for (const [i, p] of h.path.entries()) row(`point ${i + 1} x / y (mm)`, { value: `${mm(p.x)} / ${mm(p.y)}`, status: "proposed", datum: "plan origin" });
    for (const p of e.section) row(`cable level at ${p.s} m along plan route (mm)`, p.level === undefined ? { value: "?", status: "unknown", missing: p.missing } : { value: mm(p.level), status: p.basis as RowStatus, datum: r.floorBuildUp?.datum || DEFAULT_DATUM });
    for (const k of h.keepouts) row(`keep-out ${k.label} x / y / w / h (mm)`, { value: [k.x, k.y, k.w, k.h].map(mm).join(" / "), status: "entered", source: k.source });
    for (const p of e.problems) row(p.code, { value: p.message, status: "proposed" });
    return rows;
  }
  if (el.type === "floor-plane") {
    const r = room();
    const d = r.drainage!;
    const p = d.planes.find((x) => x.id === el.sub)!;
    const s = planeSurface(d, p);
    row("fall (mm per m)", s.resolved && s.fall !== undefined
      ? { value: f1(s.fall * 1000), status: s.basis as RowStatus, ...(p.fall?.source ? { source: p.fall.source } : {}) }
      : { value: "?", status: "unknown", missing: s.missing.length ? s.missing : [s.unsupported ?? "fall"] });
    return rows;
  }

  // fixtures and service points
  const it = model.items.find((x) => x.id === el.ref)!;
  if (el.type === "fixture") {
    const cat = catalogByKind(it.kind);
    row("footprint w × d (mm)", cat ? { value: `${mm(cat.w)} × ${mm(cat.d)}`, status: it.productId ? "published" : isBuiltInKind(it.kind) ? "defaulted" : "entered" } : { value: "?", status: "unknown", missing: [`kind ${it.kind}`] });
    if (it.anchor) {
      const pose = anchorPose(model, it);
      row("set-out", {
        value: `${mm(it.anchor.distance)} from ${it.anchor.from.toUpperCase()} · ${mm(it.anchor.gap)} off ${it.anchor.face}`,
        status: it.anchor.status, datum: `${it.anchor.wallId} ${it.anchor.side} side, ${it.anchor.face} face`,
        ...(it.anchor.source ? { source: it.anchor.source } : {}),
        ...(pose.resolved ? {} : { missing: pose.missing }),
      });
    } else {
      row("set-out", { value: "?", status: "unknown", missing: ["not set out from a wall face"] });
    }
    row("project selection", { value: it.selectionStatus ?? "unknown", status: it.selectionStatus && it.selectionStatus !== "unknown" ? "entered" : "unknown" });
    const product = it.productId ? products.find((p) => p.id === it.productId) : undefined;
    const exact = it.productIdentity ?? product;
    if (exact) {
      row("exact product", { value: `${exact.manufacturer} ${exact.model}`, status: "published" });
      const identity = identityOf(exact);
      for (const key of Object.keys(IDENTITY_FIELDS) as IdentityKey[]) {
        const v = identity[key];
        row(IDENTITY_FIELDS[key], { value: identityText(v), status: v.state === "unknown" ? "unknown" : "published", ...(v.sources?.length ? { source: v.sources.map(s => `${s.url}${s.locator ? ` (${s.locator})` : ""}`).join("; ") } : {}) });
      }
      row("components", { value: exact.componentsStatus ?? "unknown", status: exact.componentsStatus && exact.componentsStatus !== "unknown" ? "published" : "unknown" });
      for (const [i, c] of (exact.components ?? []).entries()) {
        row(`component ${i + 1}`, { value: `${c.name} · code ${identityText(c.code)} · quantity ${c.quantity ?? "unknown"} · ${c.provision}`, status: c.code.state === "unknown" || c.quantity === null || c.provision === "unresolved" ? "unknown" : "published", source: [...(c.code.sources ?? []), ...(c.sources ?? [])].map(s => `${s.url}${s.locator ? ` (${s.locator})` : ""}`).join("; ") });
      }
    }
    if (it.productId && !product) row("product", { value: it.productId, status: "unknown", missing: ["product not in this browser's library"] });
    if (product) {
      const fieldSpecs = categoryById(product.category)?.fields ?? [];
      const lengthKeys = new Set(fieldSpecs.filter((f) => f.type === "length").map((f) => f.key));
      row("product", { value: [product.manufacturer, product.model].filter(Boolean).join(" "), status: "published" });
      for (const [key, fv] of Object.entries(product.fields)) {
        const field = fieldSpecs.find((f) => f.key === key);
        const datum = fv.reference ?? (field?.type === "length" ? field.reference : undefined);
        if (fv.value === null || fv.value === undefined) { row(key, { value: "?", status: "unknown", ...(datum ? { datum } : {}), missing: [fv.note ?? key] }); continue; }
        row(key, {
          // only length fields are metres; a count (tap holes) or text prints as given
          value: typeof fv.value === "number" && lengthKeys.has(key) ? mm(fv.value) : String(fv.value),
          status: (fv.status ?? "unknown") as RowStatus,
          ...(datum ? { datum } : {}),
          ...(fv.sources?.length ? { source: fv.sources.map((s) => `${s.url}${s.locator ? ` (${s.locator})` : ""}`).join("; ") } : {}),
        });
      }
    }
    return rows;
  }
  const sp = it.servicePoints!.find((x) => x.id === el.sub)!;
  const reading = roughIn(model, it).find((r) => r.pointId === sp.id)!;
  const src = sp.source ? { source: sp.source } : {};
  row("service", { value: sp.service, status: "entered" });
  row(`out from ${sp.face} face (mm)`, sp.out !== undefined ? { value: `${mm(sp.out)}${sp.outMax !== undefined ? `–${mm(sp.outMax)}` : ""}`, status: sp.status, datum: `${sp.face} face`, ...src } : { value: "?", status: "unknown", missing: ["out distance"] });
  row("across from fixture centreline (mm)", sp.across !== undefined ? { value: mm(sp.across), status: sp.status, ...src } : { value: "?", status: "unknown", missing: ["across offset"] });
  row("up from finished floor (mm)", sp.up !== undefined ? { value: mm(sp.up), status: sp.status, datum: "finished floor", ...src } : { value: "?", status: "unknown", missing: ["up height"] });
  // along depends on the fixture's set-out as well as the point's own offset: the weaker status
  const alongStatus = it.anchor ? weakest([input("point", { value: 0, status: sp.status }), input("set-out", { value: 0, status: it.anchor.status })]) : sp.status;
  row("along from end A (mm)", reading.alongFromA !== undefined ? { value: mm(reading.alongFromA), status: alongStatus as RowStatus, datum: it.anchor ? `${it.anchor.wallId} end A` : undefined } : { value: "?", status: "unknown", missing: reading.missing.length ? reading.missing : ["position along the wall"] });
  return rows;
}

// ---------------------------------------------------------------------------------- findings

/**
 * Sheet preflight scoped to a view: the A-01 rules (title block, geometry, printed defaults),
 * kept for the entities this view shows, plus the view's own checks. Nothing is relaxed: a
 * defaulted width on a visible door blocks here as it does on A-01.
 */
export function viewFindings(model: PlanModel, res: Resolution, products: LibraryProduct[] = []): SheetFinding[] {
  const out: SheetFinding[] = [];
  if (res.unknown.length) {
    out.push({ code: "view_stale_ids", severity: "blocking", ref: res.unknown.join(","), message: `This view names ${res.unknown.length} id(s) the model no longer has: ${res.unknown.join(", ")}. Compose it again.`, fix: { tool: "set_diagram_view", args: { label: "<stage>", visible: "<ids from list_diagram_content>" }, hint: "Re-apply the view with current ids." } });
  }
  if (!res.elements.length) out.push({ code: "view_empty", severity: "blocking", ref: "view", message: "Nothing is visible in this view." });
  const refs = new Set(res.elements.map((e) => e.ref));
  const openingsShown = res.elements.some((e) => e.type === "opening");
  // Blocking rules are A-01's, unrelaxed, for every entity this view draws. Advisory items are
  // this view's own: each visible value that would print as unknown or as a default.
  for (const f of checkSheet(model, "floor-plan")) {
    if (f.severity !== "blocking" || f.code === "nothing_to_draw") continue;
    if (f.ref === "titleBlock" || f.ref === "model") { out.push(f); continue; }
    const ids = f.ref.split(",");
    if (!ids.some((id) => refs.has(id))) continue;
    if (f.code.includes("opening") && !openingsShown) continue; // the opening is not on this drawing
    out.push(f);
  }
  for (const el of res.elements) {
    for (const r of specRows(model, el, products)) {
      if (r.value === "?" || r.missing?.length) {
        out.push({ code: "unresolved_in_view", severity: "advisory", ref: el.id, message: `${el.label}: ${r.property} ${r.value === "?" ? "unknown; printed as \"?\"" : "unresolved"}${r.missing?.length ? ` (missing ${r.missing.join(", ")})` : ""}.` });
      } else if (r.status === "defaulted") {
        out.push({ code: "default_in_view", severity: "advisory", ref: el.id, message: `${el.label}: ${r.property} is a default placeholder (DEF), not a measurement.` });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------- diagram

const DRAW = { x: 12, y: 12, w: 248, h: 268 };
const PANEL = { x: 266, w: 146 };
const SCALES = [10, 20, 25, 50, 100, 200];

export interface StageRenderOptions {
  label: string;
  findings: SheetFinding[];
  /** acknowledgements an export went past; printed with their reasons */
  acknowledged?: Acknowledgement[];
  /** YYYY-MM-DD when exported; absent renders a preview */
  date?: string;
  note?: string;
  products?: LibraryProduct[];
}

/** The body extent (frame or existing face, else the drawn thickness), without any build-up. */
const bodyExtent = (w: Wall) => { const b = wallBody(w); return { zMin: b.z - b.depth / 2, zMax: b.z + b.depth / 2 }; };

/**
 * The dimensioned diagram for one view, A3 landscape in paper mm. Scale and placement come
 * from the whole canonical plan, so every stage of one project lines up sheet to sheet.
 */
export function renderStageDiagram(model: PlanModel, elements: ViewElement[], opts: StageRenderOptions): string {
  const vis = new Set(elements.map((e) => e.id));
  const parts: string[] = [];
  const text = (x: number, y: number, s: string, size = 2.4, extra = "") =>
    parts.push(`<text x="${f1(x)}" y="${f1(y)}" font-size="${size}" ${extra}>${esc(s)}</text>`);
  const line = (a: Pt, b: Pt, extra = "") => parts.push(`<line x1="${f1(a.x)}" y1="${f1(a.y)}" x2="${f1(b.x)}" y2="${f1(b.y)}" ${extra}/>`);
  const poly = (pts: Pt[], extra = "") => parts.push(`<polygon points="${pts.map((p) => `${f1(p.x)},${f1(p.y)}`).join(" ")}" ${extra}/>`);
  const de = (id: string) => `data-element="${esc(id)}"`;

  // ---- scale: the whole plan as built, the same for every stage ----
  const xs: number[] = [];
  const ys: number[] = [];
  for (const w of model.walls) for (const c of rectCorners(joinedRect(model, w))) { xs.push(c.x); ys.push(c.y); }
  for (const r of model.rooms) { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); }
  if (!xs.length) { xs.push(0, 1); ys.push(0, 1); }
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const margin = 24;
  const N = SCALES.find((n) => ((maxX - minX) * 1000) / n <= DRAW.w - 2 * margin && ((maxY - minY) * 1000) / n <= DRAW.h - 2 * margin) ?? SCALES[SCALES.length - 1];
  const k = 1000 / N;
  const ox = DRAW.x + (DRAW.w - (maxX - minX) * k) / 2;
  const oy = DRAW.y + (DRAW.h - (maxY - minY) * k) / 2;
  const P = (p: Pt): Pt => ({ x: ox + (p.x - minX) * k, y: oy + (p.y - minY) * k });
  const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

  parts.push(`<rect x="5" y="5" width="410" height="287" fill="none" stroke="#000" stroke-width="0.5"/>`);
  parts.push(`<rect x="${DRAW.x}" y="${DRAW.y}" width="${DRAW.w}" height="${DRAW.h}" fill="none" stroke="#999" stroke-width="0.2"/>`);

  // ---- rooms ----
  for (const r of model.rooms) {
    if (!vis.has(`room:${r.id}`)) continue;
    const c = P({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    text(c.x, c.y, r.label.toUpperCase(), 3, `text-anchor="middle" fill="#888" ${de(`room:${r.id}`)}`);
  }

  // ---- floor planes and wastes ----
  for (const r of model.rooms) {
    const d = r.drainage;
    if (!d) continue;
    for (const p of d.planes) {
      const id = `room:${r.id}:plane:${p.id}`;
      if (!vis.has(id)) continue;
      const a = P({ x: p.x, y: p.y });
      parts.push(`<rect x="${f1(a.x)}" y="${f1(a.y)}" width="${f1(p.w * k)}" height="${f1(p.h * k)}" fill="none" stroke="#2f78b7" stroke-width="0.2" stroke-dasharray="2 1" ${de(id)}/>`);
      const s = planeSurface(d, p);
      text(a.x + 1.5, a.y + p.h * k - 1.5, `${p.label}: fall ${s.resolved && s.fall !== undefined ? `${f1(s.fall * 1000)} mm/m ${tag(s.basis)}` : "?"}`, 1.9, `fill="#2f78b7"`);
    }
    for (const wst of d.wastes) {
      const id = `room:${r.id}:waste:${wst.id}`;
      if (!vis.has(id)) continue;
      const a = P({ x: wst.ax, y: wst.ay });
      const b = P({ x: wst.bx, y: wst.by });
      if (wst.kind === "linear") line(a, b, `stroke="#7a5230" stroke-width="1.2" ${de(id)}`);
      else parts.push(`<circle cx="${f1(a.x)}" cy="${f1(a.y)}" r="1.4" fill="none" stroke="#7a5230" stroke-width="0.4" ${de(id)}/>`);
      text((a.x + b.x) / 2, (a.y + b.y) / 2 + 3.2, `${wst.label} FL ${known(wst.level) ? `${mm(wst.level.value)} ${tag(wst.level.status)}` : "?"}`, 1.9, `text-anchor="middle" fill="#7a5230"`);
    }
  }

  // ---- walls: the body only, then each visible layer as its own strip ----
  for (const w of model.walls) {
    if (!vis.has(`wall:${w.id}`)) continue;
    poly(rectCorners(joinedRect(model, w, bodyExtent)).map(P), `fill="#d9d9d9" stroke="#222" stroke-width="0.35" ${de(`wall:${w.id}`)}`);
  }
  const layerFill: Record<string, string> = { board: "#f3e3c3", waterproofing: "#9ec9e8", adhesive: "#cfcfcf", tile: "#ffffff" };
  for (const w of model.walls) {
    const len = segLen(w.ax, w.ay, w.bx, w.by) || 1;
    const d = { x: (w.bx - w.ax) / len, y: (w.by - w.ay) / len };
    for (const side of ["left", "right"] as const) {
      const spec = w.sides?.[side];
      if (!spec) continue;
      const n = sideNormal(w, side);
      const at = (along: number, off: number) => P({ x: w.ax + d.x * along + n.x * off, y: w.ay + d.y * along + n.y * off });
      const faces = sideFaces(spec);
      spec.layers.forEach((l, i) => {
        const id = `wall:${w.id}:${side}:${l.id}`;
        if (!vis.has(id)) return;
        const inner = faces[1 + i], outer = faces[2 + i];
        if (!inner.resolved || !outer.resolved) {
          // position unknown: say so where the layer would be, never draw a guessed strip
          const m = at(len / 2, 0.02);
          text(m.x, m.y, `${layerLabel(l)} ? (position unresolved)`, 1.8, `text-anchor="middle" fill="#b00020" ${de(id)}`);
          return;
        }
        poly([at(0, inner.offset!), at(len, inner.offset!), at(len, outer.offset!), at(0, outer.offset!)], `fill="${layerFill[l.kind]}" stroke="#555" stroke-width="0.15" ${de(id)}`);
      });
      for (const name of ["existing", "frame"] as const) {
        const id = `wall:${w.id}:${side}:${name}`;
        if (!vis.has(id)) continue;
        const f = resolveFace(spec, name);
        if (!f.resolved) { const m = at(len / 2, 0); text(m.x, m.y - 1, `${name} ?`, 1.8, `text-anchor="middle" fill="#b00020" ${de(id)}`); continue; }
        line(at(0, f.offset!), at(len, f.offset!), `${name === "existing" ? `stroke="#2f78b7" stroke-width="0.25" stroke-dasharray="1.2 0.8"` : `stroke="#8a5a1c" stroke-width="0.25" stroke-dasharray="0.6 0.6"`} ${de(id)}`);
      }
    }
  }

  // Heating is drawn only if its canonical element is selected for this stage.
  for (const r of model.rooms) {
    const id = `room:${r.id}:heating`;
    if (!vis.has(id) || !r.heating) continue;
    for (const exclusion of r.heating.keepouts) {
      const a = P(exclusion), b = P({ x: exclusion.x + exclusion.w, y: exclusion.y + exclusion.h });
      parts.push(`<rect x="${f1(a.x)}" y="${f1(a.y)}" width="${f1(b.x-a.x)}" height="${f1(b.y-a.y)}" fill="#fee" stroke="#b00020" stroke-width="0.2" ${de(id)}/>`);
    }
    const points = r.heating.path.map(P);
    parts.push(`<polyline points="${points.map((p) => `${f1(p.x)},${f1(p.y)}`).join(" ")}" fill="none" stroke="#c64c19" stroke-width="0.5" ${de(id)}/>`);
    points.forEach((p, i) => text(p.x+1, p.y-1, String(i+1), 1.8, `fill="#c64c19"`));
    const evidence = heatingEvidence(r);
    if (points.length) text(points[0].x, points[0].y-4, `PROPOSED CABLE plan ${evidence.planRouteLength} m; spatial ${evidence.routeLength === undefined ? "unknown" : `${evidence.routeLength} m`} (sampled); trade review pending`, 1.8, `fill="#c64c19"`);
  }

  // ---- openings ----
  for (const o of model.openings) {
    const id = `opening:${o.id}`;
    const w = model.walls.find((x) => x.id === o.wallId);
    if (!vis.has(id) || !w) continue;
    const [t0, t1] = openingSpan(w, o);
    const ext = bodyExtent(w);
    const d = { x: (w.bx - w.ax), y: (w.by - w.ay) };
    const n = sideNormal(w, "right");
    const at = (t: number, s: number) => ({ x: w.ax + d.x * t + n.x * s, y: w.ay + d.y * t + n.y * s });
    poly([at(t0, ext.zMin), at(t1, ext.zMin), at(t1, ext.zMax), at(t0, ext.zMax)].map(P), `fill="#fff" stroke="#222" stroke-width="0.25" ${de(id)}`);
    const c = P(at((t0 + t1) / 2, (ext.zMin + ext.zMax) / 2));
    const len = segLen(w.ax, w.ay, w.bx, w.by);
    text(c.x, c.y - 3.2, `${o.kind === "door" ? "D" : "W"} ${mm(o.width)} ${tag(dimStatus(o.widthDefaulted))}`, 2.2, `text-anchor="middle"`);
    text(c.x, c.y + 4.6, `c/l ${mm(o.t * len)} from A`, 1.9, `text-anchor="middle" fill="#444"`);
  }

  // ---- wall length dimensions ----
  for (const w of model.walls) {
    if (!vis.has(`wall:${w.id}`)) continue;
    const len = segLen(w.ax, w.ay, w.bx, w.by);
    const mid = { x: (w.ax + w.bx) / 2, y: (w.ay + w.by) / 2 };
    const nr = sideNormal(w, "right");
    const outward = (centre.x - mid.x) * nr.x + (centre.y - mid.y) * nr.y > 0 ? { x: -nr.x, y: -nr.y } : nr;
    const off = 14 / k;
    const a = P({ x: w.ax + outward.x * off, y: w.ay + outward.y * off });
    const b = P({ x: w.bx + outward.x * off, y: w.by + outward.y * off });
    line(a, b, `stroke="#000" stroke-width="0.18"`);
    for (const e of [a, b]) line({ x: e.x - 1, y: e.y - 1 }, { x: e.x + 1, y: e.y + 1 }, `stroke="#000" stroke-width="0.3"`);
    const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    const upright = angle > 90 || angle < -90 ? angle + 180 : angle;
    const m = { x: (a.x + b.x) / 2 + outward.x * 1.8, y: (a.y + b.y) / 2 + outward.y * 1.8 };
    const onLine = (["left", "right"] as const).some((side) => { const f = resolveFace(w.sides?.[side], "existing"); return f.resolved && Math.abs(f.offset!) < 1e-4; });
    parts.push(`<text x="${f1(m.x)}" y="${f1(m.y)}" font-size="2.4" text-anchor="middle" dominant-baseline="middle" transform="rotate(${f1(upright)} ${f1(m.x)} ${f1(m.y)})" data-dim="${esc(w.id)}">${esc(`${mm(len)} ENT · ${wallName(w)} A→B ${onLine ? "(existing surface)" : "(drawn line)"}`)}</text>`);
  }

  // ---- fixtures and service points ----
  const fixtureNo = new Map(model.items.map((it, i) => [it.id, `F${i + 1}`]));
  for (const it of model.items) {
    if (!vis.has(`item:${it.id}`)) continue;
    const pg = itemPolygon(it);
    if (!pg) continue;
    poly(pg.map(P), `fill="#fff" stroke="#444" stroke-width="0.3" ${de(`item:${it.id}`)}`);
    const c = P({ x: it.x, y: it.y });
    text(c.x, c.y, fixtureNo.get(it.id)!, 2.6, `text-anchor="middle" dominant-baseline="middle" font-weight="bold"`);
    if (it.anchor && anchorPose(model, it).resolved) text(c.x, c.y + 3.4, `${mm(it.anchor.distance)} from ${it.anchor.from.toUpperCase()} · ${mm(it.anchor.gap)} off ${it.anchor.face} ${tag(it.anchor.status)}`, 1.8, `text-anchor="middle" fill="#444"`);
  }
  for (const it of model.items) {
    roughIn(model, it).forEach((r, i) => {
      const id = `item:${it.id}:sp:${r.pointId}`;
      if (!vis.has(id)) return;
      const fill = r.service === "waste" ? "#7a5230" : r.service === "water" ? "#2f78b7" : "#c0392b";
      if (r.x === undefined || r.y === undefined) return; // listed under Rough-in with "?"; never placed where it is not known
      const p = P({ x: r.x, y: r.y });
      parts.push(`<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="1.1" fill="${fill}" ${de(id)}/>`);
      text(p.x + 1.5, p.y - 1.2, `${fixtureNo.get(it.id)}.${i + 1}`, 1.8, `fill="${fill}"`);
    });
  }

  // ---- scale bar ----
  const sbY = DRAW.y + DRAW.h - 6;
  for (let i = 0; i < 2; i++) parts.push(`<rect x="${f1(DRAW.x + 6 + i * 0.5 * k)}" y="${f1(sbY)}" width="${f1(0.5 * k)}" height="1.5" fill="${i % 2 ? "#fff" : "#000"}" stroke="#000" stroke-width="0.2"/>`);
  text(DRAW.x + 6, sbY - 1, "0", 2);
  text(DRAW.x + 6 + k, sbY - 1, "1 m", 2);
  text(DRAW.x + 6, sbY + 4.5, `Scale 1:${N} at A3. Orientation not recorded. Dimensions in mm.`, 2);

  // ---- panel ----
  let y = 14;
  let overflowed = false;
  const PANEL_BOTTOM = 228;
  const x0 = PANEL.x;
  const heading = (s: string) => { if (y > PANEL_BOTTOM) return; text(x0, y, s, 2.8, `font-weight="bold"`); y += 4; };
  const row = (s: string, size = 2.1, extra = "") => {
    const max = Math.floor((PANEL.w - 4) / (size * 0.52));
    const lines: string[] = [];
    let cur = "";
    for (const word of s.split(" ")) {
      if ((cur + " " + word).trim().length > max && cur) { lines.push(cur); cur = word; } else cur = (cur + " " + word).trim();
    }
    if (cur) lines.push(cur);
    for (const [i, l] of lines.entries()) {
      if (y > PANEL_BOTTOM) { if (!overflowed) { text(x0, y, "… more: see the specification sheet / get_diagram_view", 2, `fill="#666"`); overflowed = true; } return; }
      text(x0 + (i ? 3 : 0), y, l, size, extra);
      y += size + 1;
    }
  };
  const limitRows = (rows: { s: string; extra?: string }[], max: number) => {
    rows.slice(0, max).forEach((r) => row(r.s, 2.1, r.extra ?? ""));
    if (rows.length > max) row(`… ${rows.length - max} more: see the specification sheet`, 2, `fill="#666"`);
  };

  heading(`Stage: ${opts.label}`);
  row(`Shows ${elements.length} element(s) of the one project model; everything else is hidden, not removed.`);
  row("Status: SC site-confirmed · M measured · PUB published · P proposed · E estimated · ENT entered · DEF default · ? unknown");
  row(`Not modelled, never drawn: ${catalogue(model).notModelled.map((s) => s.split(" (")[0]).join("; ")}.`, 1.9, `fill="#666"`);
  y += 2;

  const byType = (...types: ElementType[]) => elements.filter((e) => types.includes(e.type));
  const rowsFor = (els: ViewElement[]) => els.map((el) => {
    const rs = specRows(model, el, opts.products).filter((r) => !["kind", "service"].includes(r.property));
    return { s: `${el.label}: ${rs.map((r) => `${r.property.replace(/ \(mm\)$/, "")} ${r.value === "?" ? "?" : `${r.value} ${tag(r.status)}`}`).join(" · ")}`, extra: de(el.id) };
  });
  const fixtureElements = byType("fixture");
  if (fixtureElements.length) {
    heading("Fixtures — exact selection");
    limitRows(fixtureElements.map(el => {
      const it = model.items.find(i => i.id === el.ref)!;
      const exact = it.productIdentity ?? opts.products?.find(p => p.id === it.productId);
      const identity = identityOf(exact ?? {});
      const details = exact ? `${exact.manufacturer} ${exact.model} · ${Object.entries(IDENTITY_FIELDS).map(([key, label]) => `${label} ${identityText(identity[key as IdentityKey])}`).join(" · ")}` : el.label;
      return { s: `${fixtureNo.get(it.id)}: ${details} · selection ${it.selectionStatus ?? "unknown"}`, extra: de(el.id) };
    }), 6);
    y += 2;
  }
  const sections: [string, ViewElement[], number][] = [
    ["Wall faces and layers (mm from drawn line)", byType("face", "wall-layer"), 10],
    ["Floor (mm above datum)", byType("floor-substrate", "floor-layer"), 6],
    [byType("heating").length ? "Drainage / heating" : "Drainage", byType("waste", "floor-plane", "heating"), 4],
    ["Rough-in (as entered, from the named face)", byType("service-point"), 10],
  ];
  for (const [title, els, max] of sections) {
    if (!els.length) continue;
    heading(title);
    limitRows(rowsFor(els), max);
    y += 2;
  }

  const unresolved = opts.findings.filter((f) => f.severity === "advisory");
  heading(`Unresolved in this view (${unresolved.length})`);
  limitRows(unresolved.map((f) => ({ s: `• ${f.message}`, extra: `fill="#7a3b00"` })), 8);
  y += 2;
  const acks = opts.acknowledged ?? [];
  if (acks.length) {
    heading(`Exported past ${acks.length} blocking finding(s)`);
    limitRows(acks.map((a) => ({ s: `• ${a.code} (${a.ref}), ${a.by}: ${a.reason}`, extra: `fill="#b00020"` })), 6);
  } else if (!opts.date) {
    const blocking = opts.findings.filter((f) => f.severity === "blocking");
    if (blocking.length) { heading(`Blocking (${blocking.length}): not exportable yet`); limitRows(blocking.map((f) => ({ s: `• ${f.message}`, extra: `fill="#b00020"` })), 6); }
  }

  const tb = model.sheetSet?.titleBlock ?? {};
  const tbY = 236;
  parts.push(`<rect x="${x0 - 2}" y="${tbY}" width="${PANEL.w}" height="${292 - tbY - 3}" fill="none" stroke="#000" stroke-width="0.35"/>`);
  const tby = (i: number) => tbY + 5 + i * 5.2;
  text(x0, tby(0), `Project: ${tb.project?.trim() || "?"}`, 2.6, `font-weight="bold"`);
  text(x0, tby(1), `Site / room: ${tb.site?.trim() || "?"}`, 2.4);
  text(x0, tby(2), `Stage diagram: ${opts.label}`, 2.4);
  text(x0, tby(3), `Scale 1:${N} @ A3 · ${opts.date ? `Exported ${opts.date} · not a revision of A-01` : "PREVIEW, not exported"}`, 2.4);
  text(x0, tby(4), `Prepared by: ${tb.preparedBy?.trim() || "?"} · Plan: ${model.name}`, 2.2);
  text(x0, tby(5), opts.note ? `Note: ${opts.note}` : "", 2.1);
  parts.push(`<rect x="${x0 - 2}" y="${tby(6) - 3.4}" width="${PANEL.w}" height="7" fill="#b00020"/>`);
  text(x0 + PANEL.w / 2 - 2, tby(6) + 1.2, "PROPOSED · FOR TRADE REVIEW · NOT AS-BUILT · NOT A COMPLIANCE CERTIFICATE", 2.1, `text-anchor="middle" fill="#fff" font-weight="bold"`);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAPER.w}mm" height="${PAPER.h}mm" viewBox="0 0 ${PAPER.w} ${PAPER.h}" font-family="Helvetica, Arial, sans-serif" data-sheet="stage-view" data-scale="${N}">`,
    `<metadata id="stage-view">${esc(JSON.stringify({ label: opts.label, elements: elements.map((e) => e.id) }))}</metadata>`,
    `<rect width="${PAPER.w}" height="${PAPER.h}" fill="#fff"/>`,
    ...parts,
    `</svg>`,
  ].join("\n");
}

// ---------------------------------------------------------------------------------- spec sheet

/** The specification sheet for the same view: one table row per property, grouped by layer. */
export function renderStageSpec(model: PlanModel, elements: ViewElement[], opts: StageRenderOptions): { html: string; rows: SpecRow[] } {
  const rows = elements.flatMap((el) => specRows(model, el, opts.products));
  const tb = model.sheetSet?.titleBlock ?? {};
  const td = (s: string | undefined) => `<td>${esc(s ?? "")}</td>`;
  const groups = LAYERS.filter((l) => elements.some((e) => e.layer === l.id));
  const body = groups.map((g) => {
    const tr = elements.filter((e) => e.layer === g.id).map((el) => rows.filter((r) => r.element === el.id).map((r, i) =>
      `<tr data-element="${esc(el.id)}"${r.value === "?" ? ' class="unknown"' : ""}>${i === 0 ? `<td rowspan="${rows.filter((x) => x.element === el.id).length}">${esc(el.label)}</td>` : ""}${td(r.property)}${td(r.value)}${td(`${TAGS[r.status] ?? "?"} ${r.status}`)}${td(r.datum)}${td(r.source)}${td(r.missing?.join(", "))}</tr>`).join("")).join("");
    return `<tbody><tr class="group"><th colspan="7">${esc(g.label)}</th></tr>${tr}</tbody>`;
  }).join("");
  const unresolved = opts.findings.filter((f) => f.severity === "advisory");
  const acks = opts.acknowledged ?? [];
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(`${model.name}: ${opts.label} specification`)}</title>
<style>body{font:12px Helvetica,Arial,sans-serif;margin:16px;color:#111}h1{font-size:16px;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin-top:8px}td,th{border:1px solid #bbb;padding:3px 5px;text-align:left;vertical-align:top}tr.group th{background:#eee}tr.unknown td{background:#fff3e0}.banner{background:#b00020;color:#fff;font-weight:bold;padding:4px 6px;margin:6px 0}.muted{color:#555}</style>
</head><body data-sheet="stage-spec">
<script type="application/json" id="stage-view">${JSON.stringify({ label: opts.label, elements: elements.map((e) => e.id) }).replace(/</g, "\\u003c")}</script>
<h1>Specification: ${esc(opts.label)}</h1>
<div>Project: ${esc(tb.project?.trim() || "?")} · Site / room: ${esc(tb.site?.trim() || "?")} · Prepared by: ${esc(tb.preparedBy?.trim() || "?")} · Plan: ${esc(model.name)}</div>
<div>${opts.date ? `Exported ${esc(opts.date)} · not a revision of A-01` : "PREVIEW, not exported"}${opts.note ? ` · Note: ${esc(opts.note)}` : ""}</div>
<div class="banner">PROPOSED · FOR TRADE REVIEW · NOT AS-BUILT · NOT A COMPLIANCE CERTIFICATE</div>
<p class="muted">Lists exactly the ${elements.length} element(s) visible in this stage view of the one project model. Lengths in mm. Status: SC site-confirmed · M measured · PUB published · P proposed · E estimated · ENT entered (not site-confirmed) · DEF default placeholder · ? unknown. A "?" value is not known and must not be read as a measurement. Not modelled, so never listed: ${esc(catalogue(model).notModelled.join("; "))}.</p>
<table><thead><tr><th>Element</th><th>Property</th><th>Value</th><th>Status</th><th>Measured from</th><th>Source</th><th>Missing</th></tr></thead>${body}</table>
<h2>Unresolved in this view (${unresolved.length})</h2><ul>${unresolved.map((f) => `<li>${esc(f.message)}</li>`).join("")}</ul>
${acks.length ? `<h2>Exported past ${acks.length} blocking finding(s)</h2><ul>${acks.map((a) => `<li>${esc(`${a.code} (${a.ref}), ${a.by}: ${a.reason}`)}</li>`).join("")}</ul>` : ""}
</body></html>`;
  return { html, rows };
}
