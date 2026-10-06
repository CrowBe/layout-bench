/**
 * A floor waste's drain product (#82). A waste links to an accepted "drain" brief; the link pins
 * that brief as a travelling snapshot, so grate size, outlet and body depth reach the plan, the
 * falls, the tiling and 3D with their sources. A later accepted revision in the same series is
 * offered as an update and applied only on an explicit action (as for placed fixtures, #53).
 *
 * Nothing is defaulted: a field the brief leaves unknown stays unresolved and is named.
 */
import { formatMm, quantize, type Pt } from "./geometry";
import { heatingSnapshotsDisagree, latestInSeries, specificationFromProduct } from "./heatingProduct";
import { evidenceText, isProductSpecification } from "./productMeasurements";
import { productStore, type LibraryProduct } from "./productLibrary";
import { revisionOf } from "./productRevision";
import type { FieldValue } from "./products";
import type { Waste, WasteProductLink } from "./types";

export const DRAIN_CATEGORY = "drain";

/** Pin an accepted library product to a waste. */
export function wasteLinkFromProduct(product: LibraryProduct): WasteProductLink {
  return { productId: product.id, specification: { ...specificationFromProduct(product), revision: revisionOf(product).number } };
}

export function validWasteProductLink(v: unknown): boolean {
  if (v === undefined) return true;
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const link = v as WasteProductLink;
  return typeof link.productId === "string" && !!link.productId && link.productId.length <= 200 &&
    isProductSpecification(link.specification) && link.specification.category === DRAIN_CATEGORY;
}

/** One brief figure as read for a waste: metres, with its status and where it came from. */
export interface WasteFigure {
  value: number;
  status?: string;
  source?: string;
}

export interface WasteProductInfo {
  productId: string;
  name: string;
  revision?: number;
  grateType?: string;
  grateLength?: WasteFigure;
  grateWidth?: WasteFigure;
  outletDiameter?: WasteFigure;
  outletOffset?: WasteFigure;
  outletDepth?: WasteFigure;
  outletBelowGrate?: WasteFigure;
  installationDepth?: WasteFigure;
  bodyDepth?: WasteFigure;
  /** brief fields this waste needs that the product leaves unknown */
  unresolved: string[];
  /** a newer accepted revision in the series whose evidence differs; applied only on request */
  update?: { productId: string; revision: number };
}

const figure = (fv: FieldValue | undefined): WasteFigure | undefined =>
  fv && typeof fv.value === "number" && Number.isFinite(fv.value)
    ? { value: fv.value, ...(fv.status ? { status: fv.status } : {}), ...((evidenceText(fv) || fv.note) ? { source: [evidenceText(fv), fv.note].filter(Boolean).join(" — ") } : {}) }
    : undefined;

const FIELD_LABELS: Record<string, string> = {
  grateLength: "grate length",
  grateWidth: "grate width",
  outletDiameter: "outlet diameter",
  installationDepth: "installation depth below the grate",
};

/** What the linked brief says about this waste, or undefined when no product is linked. */
export function wasteProduct(w: Waste, library?: LibraryProduct[]): WasteProductInfo | undefined {
  const link = w.product;
  if (!link) return undefined;
  const spec = link.specification;
  const f = spec.fields;
  const lib = library ?? productStore.getState().products;
  const name = [spec.manufacturer, spec.model].filter(Boolean).join(" ") || link.productId;
  const info: WasteProductInfo = { productId: link.productId, name, unresolved: [] };
  if (spec.revision !== undefined) info.revision = spec.revision;
  if (typeof f.grateType?.value === "string") info.grateType = f.grateType.value;
  for (const key of ["grateLength", "grateWidth", "outletDiameter", "outletOffset", "outletDepth", "outletBelowGrate", "installationDepth"] as const) {
    const v = figure(f[key]);
    if (v) info[key] = v;
    else if (FIELD_LABELS[key]) info.unresolved.push(FIELD_LABELS[key]);
  }
  const depth = figure(f.depth);
  if (depth) info.bodyDepth = depth;
  const live = latestInSeries(link.productId, DRAIN_CATEGORY, lib);
  if (live && heatingSnapshotsDisagree(live, spec)) {
    info.update = { productId: live.id, revision: revisionOf(live).number };
  }
  return info;
}

const wasteAxis = (w: Waste): { c: Pt; u: Pt; n: Pt; len: number } => {
  const len = Math.hypot(w.bx - w.ax, w.by - w.ay);
  const u = len > 1e-9 ? { x: (w.bx - w.ax) / len, y: (w.by - w.ay) / len } : { x: 1, y: 0 };
  return { c: { x: (w.ax + w.bx) / 2, y: (w.ay + w.by) / 2 }, u, n: { x: -u.y, y: u.x }, len };
};

/**
 * The grate outline in plan at its real size, centred on the waste. A linear grate runs along
 * the drawn centreline; a point grate's length runs along plan X. Undefined unless the brief
 * gives both grate length and width.
 */
export function grateOutline(w: Waste, info: WasteProductInfo | undefined): Pt[] | undefined {
  if (!info?.grateLength || !info.grateWidth) return undefined;
  const { c, u, n } = w.kind === "linear" ? wasteAxis(w) : { c: { x: w.ax, y: w.ay }, u: { x: 1, y: 0 }, n: { x: 0, y: 1 } };
  const a = info.grateLength.value / 2, b = info.grateWidth.value / 2;
  return [[-a, -b], [a, -b], [a, b], [-a, b]].map(([s, t]) => ({ x: quantize(c.x + u.x * s + n.x * t), y: quantize(c.y + u.y * s + n.y * t) }));
}

export interface OutletPosition {
  x?: number;
  y?: number;
  diameter?: number;
  /** how the position was derived, or why it is unresolved */
  basis: string;
}

/**
 * Where the outlet is in plan. Linear: the entered position along the channel from end A, plus
 * the brief's sideways offset (positive to the right walking from A to B). Point: the brief's
 * sideways offset (plan X) and distance from the body's back edge (plan Y), with the body
 * centred on the grate centre, as stated in the basis.
 */
export function outletPosition(w: Waste, info: WasteProductInfo | undefined): OutletPosition {
  const diameter = info?.outletDiameter?.value;
  const withD = (o: OutletPosition): OutletPosition => (diameter !== undefined ? { ...o, diameter } : o);
  if (!info) return { basis: "no drain product linked" };
  if (w.kind === "linear") {
    const missing = [...(w.outletAt?.value === undefined ? ["outlet position along the channel (entered on the waste)"] : []), ...(!info.outletOffset ? ["outlet sideways offset (brief)"] : [])];
    if (missing.length) return withD({ basis: `unresolved: ${missing.join(", ")}` });
    const { u, n } = wasteAxis(w);
    const s = w.outletAt!.value!, t = info.outletOffset!.value;
    return withD({ x: quantize(w.ax + u.x * s + n.x * t), y: quantize(w.ay + u.y * s + n.y * t), basis: `${formatMm(s)} mm from end A (${w.outletAt!.status ?? "unknown status"}), ${formatMm(t)} mm sideways (brief)` });
  }
  const missing = [...(!info.outletOffset ? ["outlet sideways offset"] : []), ...(!info.outletDepth ? ["outlet from body back edge"] : []), ...(!info.bodyDepth ? ["body depth (envelope)"] : [])];
  if (missing.length) return withD({ basis: `unresolved: ${missing.join(", ")} (brief)` });
  return withD({
    x: quantize(w.ax + info.outletOffset!.value),
    y: quantize(w.ay - info.bodyDepth!.value / 2 + info.outletDepth!.value),
    basis: "brief offsets from the body's back edge; body taken as centred on the grate centre",
  });
}

export interface WasteProductProblem {
  severity: "warning";
  code: string;
  message: string;
}

/** Checks between a waste as drawn and its product. */
export function wasteProductProblems(w: Waste, library?: LibraryProduct[]): WasteProductProblem[] {
  const info = wasteProduct(w, library);
  if (!info) return [];
  const out: WasteProductProblem[] = [];
  if (w.kind === "linear" && info.grateLength) {
    const drawn = Math.hypot(w.bx - w.ax, w.by - w.ay);
    if (Math.abs(drawn - info.grateLength.value) > 0.001) {
      out.push({ severity: "warning", code: "waste_grate_length_mismatch", message: `Waste "${w.label}" is drawn ${formatMm(drawn)} mm long but its product grate (${info.name}) is ${formatMm(info.grateLength.value)} mm.` });
    }
  }
  if (w.kind === "linear" && w.outletAt?.value !== undefined) {
    const drawn = Math.hypot(w.bx - w.ax, w.by - w.ay);
    if (w.outletAt.value < 0 || w.outletAt.value > drawn) out.push({ severity: "warning", code: "waste_outlet_off_channel", message: `Waste "${w.label}" outlet is ${formatMm(w.outletAt.value)} mm from end A, outside the ${formatMm(drawn)} mm channel.` });
  }
  if (info.update) {
    out.push({ severity: "warning", code: "waste_product_update_available", message: `Waste "${w.label}" uses ${info.name}${info.revision ? ` revision ${info.revision}` : ""}; accepted revision ${info.update.revision} differs. Review it, then update the waste (update_waste_product) to use it.` });
  }
  return out;
}
