/**
 * One accessor for heating-cable and thermostat briefs (#68). Length, output, coverage,
 * current and voltage are read here; checks, Inspector, print and WebMCP do not copy them.
 * The latest accepted revision in the referenced series wins over a travelling snapshot so a
 * product revision updates every check, including in projects that were not open at accept time.
 */
import type { Heating, PlanModel, Quantity, ValueStatus } from "./types";
import { known } from "./faces";
import { quantize } from "./geometry";
import { evidenceText, isProductSpecification, type ProductSpecification } from "./productMeasurements";
import { productStore, type LibraryProduct } from "./productLibrary";
import { revisionOf } from "./productRevision";
import type { FieldValue } from "./products";

export const CABLE_LENGTH_KEY = "cableLength";
export const CABLE_OUTPUT_KEY = "totalPower";
export const CABLE_COVERAGE_MIN_KEY = "coverageAreaMin";
export const CABLE_COVERAGE_MAX_KEY = "coverageAreaMax";
export const CABLE_CURRENT_KEY = "ratedCurrent";
export const CABLE_VOLTAGE_KEY = "ratedVoltage";
export const CABLE_OUTPUT_PER_M_KEY = "outputPerMetre";
export const CABLE_RESISTANCE_KEY = "resistance";
export const THERMO_CURRENT_KEY = "ratedCurrent";
export const THERMO_VOLTAGE_MIN_KEY = "ratedVoltageMin";
export const THERMO_VOLTAGE_MAX_KEY = "ratedVoltageMax";
export const THERMO_IP_KEY = "ingressProtection";

/** Coverage area / cable length. Named so a derived millimetre range is never stored as published. */
export const SPACING_FROM_COVERAGE_FORMULA = "coverage area / cable length";
/** Wording uses each input's recorded kind; derivation itself requires confirmed coverage and length. */
export function spacingFromCoverageRationale(coverageKind: string, lengthKind: string): string {
  return `Implied loop spacing if the ${coverageKind} coverage range is spread along the ${lengthKind} heated length. Derived, not a manufacturer spacing instruction and not a code requirement.`;
}
export const SPACING_FROM_COVERAGE_RATIONALE =
  "Implied loop spacing if the coverage range is spread along the heated length, using each input's recorded kind. Derived only from confirmed coverage and length. Not a manufacturer spacing instruction and not a code requirement.";

/** Travelling snapshot written from an accepted library product (fields plus identity names). */
export type HeatingProductSnapshot = ProductSpecification & {
  manufacturer?: string;
  model?: string;
  productId?: string;
};

export type HeatingNameOrigin = "product-brief" | "heating-record";

export function specificationFromProduct(product: LibraryProduct): HeatingProductSnapshot {
  return {
    category: product.category,
    fields: structuredClone(product.fields),
    ...(product.recordingMode ? { recordingMode: product.recordingMode } : {}),
    acceptedAt: product.acceptedAt,
    ...(product.manufacturer.trim() ? { manufacturer: product.manufacturer.trim() } : {}),
    ...(product.model.trim() ? { model: product.model.trim() } : {}),
    productId: product.id,
  };
}

function snapshotExtra(spec: ProductSpecification | undefined): { manufacturer?: string; model?: string; productId?: string } {
  if (!spec) return {};
  const extra = spec as HeatingProductSnapshot;
  return {
    ...(typeof extra.manufacturer === "string" && extra.manufacturer.trim() ? { manufacturer: extra.manufacturer.trim() } : {}),
    ...(typeof extra.model === "string" && extra.model.trim() ? { model: extra.model.trim() } : {}),
    ...(typeof extra.productId === "string" && extra.productId ? { productId: extra.productId } : {}),
  };
}

export function heatingSnapshotProductId(spec: ProductSpecification | undefined): string | undefined {
  return snapshotExtra(spec).productId;
}

/** A snapshot is only published evidence when it names the accepted product it was written from. */
export function validHeatingProductSnapshot(v: unknown, category: "heating-cable" | "thermostat"): boolean {
  if (v === undefined) return true;
  if (!isProductSpecification(v) || v.category !== category) return false;
  const id = snapshotExtra(v).productId;
  return typeof id === "string" && id.length > 0 && id.length <= 200;
}

function specFingerprint(spec: ProductSpecification): string {
  const extra = snapshotExtra(spec);
  return JSON.stringify({
    category: spec.category,
    fields: spec.fields,
    manufacturer: extra.manufacturer ?? "",
    model: extra.model ?? "",
  });
}

export function heatingSnapshotsDisagree(live: LibraryProduct, spec: ProductSpecification | undefined): boolean {
  if (!spec) return true;
  return specFingerprint(specificationFromProduct(live)) !== specFingerprint(spec);
}

export function heatingLibrary(library?: LibraryProduct[]): LibraryProduct[] {
  return library ?? productStore.getState().products;
}

/** Latest accepted revision in the same series as `id` (seriesId of revision 1 is that product's id). */
export function latestInSeries(id: string | undefined, category: string, library: LibraryProduct[]): LibraryProduct | undefined {
  if (!id) return undefined;
  const exact = library.find((p) => p.id === id);
  const seriesId = exact ? revisionOf(exact).seriesId : id;
  const members = library.filter((p) => p.category === category && revisionOf(p).seriesId === seriesId);
  if (!members.length) return exact?.category === category ? exact : undefined;
  return members.reduce((best, p) => (revisionOf(p).number > revisionOf(best).number ? p : best));
}

export interface HeatingProductRef {
  referencedId?: string;
  live?: LibraryProduct;
  /** Set only when the snapshot names the accepted product it was written from. */
  snapshot?: HeatingProductSnapshot;
  unresolved: boolean;
  superseded: boolean;
  unresolvedReason?: string;
}

/**
 * Shared resolver: stored id or snapshot productId → latest accepted revision in that series.
 * A snapshot without productId is not published evidence.
 */
export function resolveHeatingProduct(
  heating: Heating | undefined,
  category: "heating-cable" | "thermostat",
  library?: LibraryProduct[],
): HeatingProductRef {
  const lib = heatingLibrary(library);
  const spec = category === "heating-cable" ? heating?.cableSpecification : heating?.thermostatSpecification;
  const storedId = category === "heating-cable" ? heating?.cableProductId : heating?.thermostatProductId;
  const extra = snapshotExtra(spec);
  const snapshotHasId = !!extra.productId;
  const categoryMatch = !!spec && spec.category === category;
  const snapshot = categoryMatch && snapshotHasId ? (spec as HeatingProductSnapshot) : undefined;
  const referencedId = (storedId && storedId.trim()) || extra.productId;
  const live = latestInSeries(referencedId, category, lib);
  const missingStored = !!storedId && !live;
  const missingSnapshotId = categoryMatch && !snapshotHasId;
  const unresolved = missingStored || missingSnapshotId;
  const unresolvedReason = missingSnapshotId
    ? `${category} snapshot has no productId of the accepted product it was written from. Those fields are not shown as published.`
    : missingStored
      ? `${storedId} is not an accepted ${category} in this library. Checks use the travelling snapshot if it carries a productId; they do not invent a product.`
      : undefined;
  return {
    ...(referencedId ? { referencedId } : {}),
    ...(live ? { live } : {}),
    ...(snapshot ? { snapshot } : {}),
    unresolved,
    superseded: !!live && !!referencedId && live.id !== referencedId,
    ...(unresolvedReason ? { unresolvedReason } : {}),
  };
}

function heatingRefersToSeries(
  heating: Heating,
  product: LibraryProduct,
  which: "cable" | "thermostat",
  library: LibraryProduct[],
): boolean {
  const category = which === "cable" ? "heating-cable" : "thermostat";
  if (product.category !== category) return false;
  const referencedId = resolveHeatingProduct(heating, category, library).referencedId;
  if (!referencedId) return false;
  const seriesId = revisionOf(product).seriesId;
  if (referencedId === product.id || referencedId === seriesId) return true;
  const found = library.find((p) => p.id === referencedId);
  return found ? revisionOf(found).seriesId === seriesId : false;
}

function shadowedWriteKeys(current: Heating, product: LibraryProduct): HeatingWriteKey[] {
  const keys: HeatingWriteKey[] = [];
  if (product.category !== "heating-cable") return keys;
  if (typeof product.fields[CABLE_LENGTH_KEY]?.value === "number" && typeof current.length?.value === "number") keys.push("length");
  if (typeof product.fields[CABLE_OUTPUT_KEY]?.value === "number" && typeof current.ratedOutput?.value === "number") keys.push("ratedOutput");
  if (product.manufacturer.trim() && current.manufacturer?.trim()) keys.push("manufacturer");
  if (product.model.trim() && current.model?.trim()) keys.push("model");
  return keys;
}

export function applyHeatingProductRetarget(
  heating: Heating,
  product: LibraryProduct,
  library?: LibraryProduct[],
): { heating: Heating; changed: Array<"cable" | "thermostat">; cleared: HeatingWriteKey[] } {
  const lib = heatingLibrary(library);
  const next: Heating = structuredClone(heating);
  const changed: Array<"cable" | "thermostat"> = [];
  const cleared: HeatingWriteKey[] = [];
  const applySide = (which: "cable" | "thermostat") => {
    if (!heatingRefersToSeries(heating, product, which, lib)) return;
    const idKey = which === "cable" ? "cableProductId" : "thermostatProductId";
    const specKey = which === "cable" ? "cableSpecification" : "thermostatSpecification";
    const patch: Record<string, unknown> = { [idKey]: product.id };
    const shadowed = which === "cable" ? shadowedWriteKeys(heating, product) : [];
    for (const key of shadowed) patch[key] = null;
    const refused = heatingProductWriteGuard(heating, patch, lib);
    if (refused) return;
    next[idKey] = product.id;
    next[specKey] = specificationFromProduct(product);
    for (const key of shadowed) delete next[key];
    changed.push(which);
    cleared.push(...shadowed);
  };
  applySide("cable");
  applySide("thermostat");
  return { heating: next, changed, cleared };
}

export function retargetHeatingInModel(
  model: PlanModel,
  product: LibraryProduct,
  library?: LibraryProduct[],
): { model: PlanModel; rooms: string[]; changed: Array<"cable" | "thermostat">; cleared: HeatingWriteKey[] } {
  const lib = heatingLibrary(library);
  const rooms: string[] = [];
  const changed = new Set<"cable" | "thermostat">();
  const cleared = new Set<HeatingWriteKey>();
  const nextRooms = model.rooms.map((room) => {
    if (!room.heating) return room;
    const result = applyHeatingProductRetarget(room.heating, product, lib);
    if (!result.changed.length) return room;
    rooms.push(room.id);
    for (const item of result.changed) changed.add(item);
    for (const key of result.cleared) cleared.add(key);
    return { ...room, heating: result.heating };
  });
  return {
    model: rooms.length ? { ...model, rooms: nextRooms } : model,
    rooms,
    changed: [...changed],
    cleared: [...cleared],
  };
}

export function heatingRevisionSummary(
  product: LibraryProduct,
  rooms: string[],
  changed: Array<"cable" | "thermostat">,
  cleared: HeatingWriteKey[] = [],
): string {
  if (!rooms.length) return "";
  const who = [product.manufacturer, product.model].filter((s) => s.trim()).join(" ") || product.id;
  const extra = cleared.length ? ` Cleared shadowed heating-record ${cleared.join(", ")}.` : "";
  return `Heating on ${rooms.length} room(s) retargeted to ${who} (${product.id}); ${changed.join(" and ")} snapshot rewritten from the accepted product.${extra}`;
}

export type FigureKind =
  | ValueStatus
  | "derived"
  | "modelled"
  | "unknown";

export interface HeatingFigure {
  value?: number;
  /** Absent numeric value stays unknown; never a guessed number. */
  kind: FigureKind;
  unit: string;
  source?: string;
  note?: string;
  formula?: string;
  origin: "product-brief" | "heating-record" | "drawn-path" | "coverage-area / cable-length" | "product-minus-route";
  /** What the number is (rated current, switching current, …), for like-for-like warnings. */
  quantity: string;
  datum?: string;
}

export const CONFIRMED: ReadonlySet<string> = new Set(["published", "measured", "site-confirmed"]);

function productName(
  live: LibraryProduct | undefined,
  spec: ProductSpecification | undefined,
  key: "manufacturer" | "model",
): string | undefined {
  const fromLive = live?.[key]?.trim();
  if (fromLive) return fromLive;
  if (!heatingSnapshotProductId(spec)) return undefined;
  return snapshotExtra(spec)[key];
}

function recordName(heating: Heating | undefined, key: "manufacturer" | "model"): string | undefined {
  const value = heating?.[key]?.trim();
  return value || undefined;
}

function resolvedName(
  live: LibraryProduct | undefined,
  spec: ProductSpecification | undefined,
  heating: Heating | undefined,
  key: "manufacturer" | "model",
): { value: string; origin: HeatingNameOrigin } | undefined {
  const fromProduct = productName(live, spec, key);
  if (fromProduct) return { value: fromProduct, origin: "product-brief" };
  const fromRecord = recordName(heating, key);
  if (fromRecord) return { value: fromRecord, origin: "heating-record" };
  return undefined;
}

/** Shared input bag: latest series revision, else a snapshot that names its productId. */
export function heatingCableFields(heating: Heating | undefined, library?: LibraryProduct[]): Record<string, FieldValue> {
  const resolved = resolveHeatingProduct(heating, "heating-cable", library);
  if (resolved.live) return resolved.live.fields;
  if (resolved.snapshot) return resolved.snapshot.fields;
  return {};
}

export function thermostatFields(heating: Heating | undefined, library?: LibraryProduct[]): Record<string, FieldValue> {
  const resolved = resolveHeatingProduct(heating, "thermostat", library);
  if (resolved.live) return resolved.live.fields;
  if (resolved.snapshot) return resolved.snapshot.fields;
  return {};
}

export function heatingCableProduct(heating: Heating | undefined, library?: LibraryProduct[]): LibraryProduct | undefined {
  return resolveHeatingProduct(heating, "heating-cable", library).live;
}

export function thermostatProduct(heating: Heating | undefined, library?: LibraryProduct[]): LibraryProduct | undefined {
  return resolveHeatingProduct(heating, "thermostat", library).live;
}

function fieldNumber(fields: Record<string, FieldValue>, key: string): FieldValue | undefined {
  return fields[key];
}

function figureFromField(
  fields: Record<string, FieldValue>,
  key: string,
  quantity: string,
  unit: string,
  origin: HeatingFigure["origin"] = "product-brief",
): HeatingFigure {
  const fv = fieldNumber(fields, key);
  const source = [evidenceText(fv), fv?.note].filter(Boolean).join(" — ") || undefined;
  if (typeof fv?.value !== "number" || !Number.isFinite(fv.value)) {
    return {
      kind: "unknown",
      unit,
      quantity,
      origin,
      ...(source ? { source } : {}),
      ...(fv?.note ? { note: fv.note } : { note: `${quantity} is not on the referenced brief.` }),
    };
  }
  return {
    value: fv.value,
    kind: fv.status ?? "unknown",
    unit,
    quantity,
    origin,
    ...(source ? { source } : {}),
    ...(fv.note ? { note: fv.note } : {}),
    ...(fv.reference ? { datum: fv.reference } : {}),
  };
}

function figureFromQuantity(
  q: Quantity | undefined,
  quantity: string,
  unit: string,
): HeatingFigure {
  if (!known(q)) {
    return {
      kind: "unknown",
      unit,
      quantity,
      origin: "heating-record",
      ...(q?.source ? { source: q.source } : {}),
      note: `${quantity} is not entered on the heating record.`,
    };
  }
  return {
    value: q.value,
    kind: q.status,
    unit,
    quantity,
    origin: "heating-record",
    ...(q.source ? { source: q.source } : {}),
  };
}

/** Prefer the product brief; heating-record length/output only when the brief has no number. */
function preferBrief(brief: HeatingFigure, fallback: HeatingFigure): HeatingFigure {
  return typeof brief.value === "number" ? brief : fallback;
}

export interface HeatingCableFigures {
  manufacturer?: string;
  manufacturerOrigin?: HeatingNameOrigin;
  model?: string;
  modelOrigin?: HeatingNameOrigin;
  length: HeatingFigure;
  ratedOutput: HeatingFigure;
  coverageMin: HeatingFigure;
  coverageMax: HeatingFigure;
  ratedCurrent: HeatingFigure;
  ratedVoltage: HeatingFigure;
  outputPerMetre: HeatingFigure;
  resistance: HeatingFigure;
  /** coverageMin / length; absent unless both numbers exist. */
  spacingMin: HeatingFigure;
  spacingMax: HeatingFigure;
}

export function heatingNameSource(origin: HeatingNameOrigin | undefined): string | undefined {
  if (origin === "heating-record") return "user-entered on the heating record";
  if (origin === "product-brief") return "product identity (submission text, not a published figure)";
  return undefined;
}

export function heatingCableFigures(heating: Heating | undefined, library?: LibraryProduct[]): HeatingCableFigures {
  const resolved = resolveHeatingProduct(heating, "heating-cable", library);
  const fields = heatingCableFields(heating, library);
  const manufacturer = resolvedName(resolved.live, resolved.snapshot, heating, "manufacturer");
  const model = resolvedName(resolved.live, resolved.snapshot, heating, "model");
  const length = preferBrief(
    figureFromField(fields, CABLE_LENGTH_KEY, "heated cable length", "m"),
    figureFromQuantity(heating?.length, "heated cable length", "m"),
  );
  const ratedOutput = preferBrief(
    figureFromField(fields, CABLE_OUTPUT_KEY, "rated total power", "W"),
    figureFromQuantity(heating?.ratedOutput, "rated total power", "W"),
  );
  const coverageMin = figureFromField(fields, CABLE_COVERAGE_MIN_KEY, "coverage area, minimum", "m²");
  const coverageMax = figureFromField(fields, CABLE_COVERAGE_MAX_KEY, "coverage area, maximum", "m²");
  const spacing = (coverage: HeatingFigure, label: string): HeatingFigure => {
    if (!confirmedNumber(coverage) || !confirmedNumber(length) || !(length.value > 0)) {
      return {
        kind: "unknown",
        unit: "m",
        quantity: label,
        origin: "coverage-area / cable-length",
        formula: SPACING_FROM_COVERAGE_FORMULA,
        note: "Spacing range stays unknown until coverage and heated length are both confirmed numeric figures (published, measured or site-confirmed).",
      };
    }
    const rationale = spacingFromCoverageRationale(coverage.kind, length.kind);
    return {
      value: quantize(coverage.value / length.value),
      kind: "derived",
      unit: "m",
      quantity: label,
      origin: "coverage-area / cable-length",
      formula: SPACING_FROM_COVERAGE_FORMULA,
      source: `${rationale} Inputs: ${coverage.quantity} ${coverage.value} ${coverage.unit} (${coverage.kind}${coverage.source ? `, ${coverage.source}` : ""}) and ${length.quantity} ${length.value} ${length.unit} (${length.kind}${length.source ? `, ${length.source}` : ""}).`,
    };
  };
  return {
    ...(manufacturer ? { manufacturer: manufacturer.value, manufacturerOrigin: manufacturer.origin } : {}),
    ...(model ? { model: model.value, modelOrigin: model.origin } : {}),
    length,
    ratedOutput,
    coverageMin,
    coverageMax,
    ratedCurrent: figureFromField(fields, CABLE_CURRENT_KEY, "cable rated current", "A"),
    ratedVoltage: figureFromField(fields, CABLE_VOLTAGE_KEY, "cable rated voltage", "V"),
    outputPerMetre: figureFromField(fields, CABLE_OUTPUT_PER_M_KEY, "output per metre", "W/m"),
    resistance: figureFromField(fields, CABLE_RESISTANCE_KEY, "cable resistance", "Ω"),
    spacingMin: spacing(coverageMin, "derived minimum spacing"),
    spacingMax: spacing(coverageMax, "derived maximum spacing"),
  };
}

export interface ThermostatFigures {
  manufacturer?: string;
  manufacturerOrigin?: HeatingNameOrigin;
  model?: string;
  modelOrigin?: HeatingNameOrigin;
  ratedCurrent: HeatingFigure;
  voltageMin: HeatingFigure;
  voltageMax: HeatingFigure;
  ingressProtection?: { value?: string; kind: FigureKind; source?: string; note?: string; quantity: string };
}

export function thermostatFigures(heating: Heating | undefined, library?: LibraryProduct[]): ThermostatFigures {
  const resolved = resolveHeatingProduct(heating, "thermostat", library);
  const fields = thermostatFields(heating, library);
  const manufacturer = resolvedName(resolved.live, resolved.snapshot, undefined, "manufacturer");
  const model = resolvedName(resolved.live, resolved.snapshot, undefined, "model");
  const ip = fields[THERMO_IP_KEY];
  const ipText = typeof ip?.value === "string" && ip.value.trim() ? ip.value.trim() : undefined;
  return {
    ...(manufacturer ? { manufacturer: manufacturer.value, manufacturerOrigin: manufacturer.origin } : {}),
    ...(model ? { model: model.value, modelOrigin: model.origin } : {}),
    ratedCurrent: figureFromField(fields, THERMO_CURRENT_KEY, "thermostat rated switching current", "A"),
    voltageMin: figureFromField(fields, THERMO_VOLTAGE_MIN_KEY, "thermostat rated voltage, minimum", "V"),
    voltageMax: figureFromField(fields, THERMO_VOLTAGE_MAX_KEY, "thermostat rated voltage, maximum", "V"),
    ingressProtection: ip
      ? {
          quantity: "printed ingress protection",
          kind: ipText ? (ip.status ?? "unknown") : "unknown",
          ...(ipText ? { value: ipText } : {}),
          ...(evidenceText(ip) || ip.note ? { source: [evidenceText(ip), ip.note].filter(Boolean).join(" — ") } : {}),
          ...(ipText ? {} : { note: ip.note || "IP code is not on the referenced thermostat brief." }),
        }
      : { quantity: "printed ingress protection", kind: "unknown", note: "No thermostat brief is referenced." },
  };
}

export function confirmedNumber(figure: HeatingFigure): figure is HeatingFigure & { value: number } {
  return typeof figure.value === "number" && Number.isFinite(figure.value) && CONFIRMED.has(figure.kind);
}

/** Keys on the heating record that a writer must not set while the brief holds a real number (or a product-brief name). */
export function heatingProductLocks(heating: Heating | undefined, library?: LibraryProduct[]): {
  length: boolean;
  ratedOutput: boolean;
  manufacturer: boolean;
  model: boolean;
} {
  const resolved = resolveHeatingProduct(heating, "heating-cable", library);
  const fields = heatingCableFields(heating, library);
  const lengthLocked = typeof fields[CABLE_LENGTH_KEY]?.value === "number";
  const outputLocked = typeof fields[CABLE_OUTPUT_KEY]?.value === "number";
  return {
    length: lengthLocked,
    ratedOutput: outputLocked,
    manufacturer: !!productName(resolved.live, resolved.snapshot, "manufacturer"),
    model: !!productName(resolved.live, resolved.snapshot, "model"),
  };
}

export type HeatingWriteKey = "length" | "ratedOutput" | "manufacturer" | "model";

/**
 * Same refusal for set, clear-of-locked-field, tools, retarget and any later catalogue writer.
 * Only real numbers (or product-brief names) lock; unknown brief fields stay writable on the record.
 * manufacturer:null and model:null are always allowed so a shadowed record name can be cleared.
 */
export function heatingProductWriteGuard(
  current: Heating | undefined,
  patch: Partial<Record<HeatingWriteKey | "cableProductId" | "thermostatProductId", unknown>> & Record<string, unknown>,
  library?: LibraryProduct[],
): string | null {
  const lib = heatingLibrary(library);
  const next: Heating = {
    zoneIds: current?.zoneIds ?? [],
    path: current?.path ?? [],
    keepouts: current?.keepouts ?? [],
    ...current,
  };
  if (patch.cableProductId !== undefined) {
    if (patch.cableProductId === null) {
      delete next.cableProductId;
      delete next.cableSpecification;
    } else {
      const product = lib.find((p) => p.id === patch.cableProductId);
      next.cableProductId = patch.cableProductId as string;
      if (product?.category === "heating-cable") next.cableSpecification = specificationFromProduct(product);
    }
  }
  if (patch.thermostatProductId !== undefined) {
    if (patch.thermostatProductId === null) {
      delete next.thermostatProductId;
      delete next.thermostatSpecification;
    } else {
      const product = lib.find((p) => p.id === patch.thermostatProductId);
      next.thermostatProductId = patch.thermostatProductId as string;
      if (product?.category === "thermostat") next.thermostatSpecification = specificationFromProduct(product);
    }
  }
  const locks = heatingProductLocks(next, lib);
  const reasons: string[] = [];
  const attachingCable = patch.cableProductId !== undefined && patch.cableProductId !== null;
  const shadowedLength = typeof current?.length?.value === "number";
  const shadowedOutput = typeof current?.ratedOutput?.value === "number";
  const shadowedManufacturer = !!current?.manufacturer?.trim();
  const shadowedModel = !!current?.model?.trim();
  if (attachingCable && locks.length && shadowedLength && patch.length !== null) {
    reasons.push("cannot attach a heating-cable brief while the record holds a numeric length; pass length:null to clear the shadowed record value");
  }
  if (attachingCable && locks.ratedOutput && shadowedOutput && patch.ratedOutput !== null) {
    reasons.push("cannot attach a heating-cable brief while the record holds a numeric ratedOutput; pass ratedOutput:null to clear the shadowed record value");
  }
  if (attachingCable && locks.manufacturer && shadowedManufacturer && patch.manufacturer !== null) {
    reasons.push("cannot attach a heating-cable brief while the record holds manufacturer; pass manufacturer:null to clear the shadowed record value");
  }
  if (attachingCable && locks.model && shadowedModel && patch.model !== null) {
    reasons.push("cannot attach a heating-cable brief while the record holds model; pass model:null to clear the shadowed record value");
  }
  if (locks.length && patch.length !== undefined && patch.length !== null) {
    reasons.push("length is locked to the heating-cable brief cableLength (a number is present); clear the product reference to enter a heating-record length");
  }
  if (locks.ratedOutput && patch.ratedOutput !== undefined && patch.ratedOutput !== null) {
    reasons.push("ratedOutput is locked to the heating-cable brief totalPower (a number is present); clear the product reference to enter a heating-record output");
  }
  if (locks.manufacturer && patch.manufacturer !== undefined && patch.manufacturer !== null) {
    reasons.push("manufacturer is locked to the referenced heating-cable product");
  }
  if (locks.model && patch.model !== undefined && patch.model !== null) {
    reasons.push("model is locked to the referenced heating-cable product");
  }
  return reasons.length ? `Heating rejected: ${reasons.join("; ")}.` : null;
}

export function validThermostatLocation(v: unknown): boolean {
  if (v === undefined) return true;
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const loc = v as Heating["thermostatLocation"];
  if (!loc || typeof loc.description !== "string" || !loc.description.trim()) return false;
  if (loc.source !== undefined && typeof loc.source !== "string") return false;
  return loc.kind === undefined || loc.kind === "wet-room" || loc.kind === "outside-wet-room";
}

export function validHeatingProductRef(v: unknown, category: "heating-cable" | "thermostat"): boolean {
  if (v === undefined) return true;
  if (typeof v === "string") return v.length > 0 && v.length <= 200;
  return validHeatingProductSnapshot(v, category);
}
