/**
 * One accessor for heating-cable and thermostat briefs (#68). Length, output, coverage,
 * current and voltage are read here; checks, Inspector, print and WebMCP do not copy them.
 * A live library product wins over a travelling snapshot so a product edit updates every check.
 */
import type { Heating, PlanModel, Quantity, ValueStatus } from "./types";
import { known } from "./faces";
import { quantize } from "./geometry";
import { evidenceText, isProductSpecification, type ProductSpecification } from "./productMeasurements";
import { productStore, type LibraryProduct } from "./productLibrary";
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

function heatingRefersToProduct(heating: Heating, fromIds: ReadonlySet<string>, which: "cable" | "thermostat"): boolean {
  const id = which === "cable" ? heating.cableProductId : heating.thermostatProductId;
  const spec = which === "cable" ? heating.cableSpecification : heating.thermostatSpecification;
  if (id && fromIds.has(id)) return true;
  const snapId = snapshotExtra(spec).productId;
  return !!(snapId && fromIds.has(snapId));
}

export function applyHeatingProductRetarget(
  heating: Heating,
  fromIds: ReadonlySet<string>,
  product: LibraryProduct,
): { heating: Heating; changed: Array<"cable" | "thermostat"> } {
  const next: Heating = structuredClone(heating);
  const changed: Array<"cable" | "thermostat"> = [];
  if (product.category === "heating-cable" && heatingRefersToProduct(heating, fromIds, "cable")) {
    next.cableProductId = product.id;
    next.cableSpecification = specificationFromProduct(product);
    changed.push("cable");
  }
  if (product.category === "thermostat" && heatingRefersToProduct(heating, fromIds, "thermostat")) {
    next.thermostatProductId = product.id;
    next.thermostatSpecification = specificationFromProduct(product);
    changed.push("thermostat");
  }
  return { heating: next, changed };
}

export function retargetHeatingInModel(
  model: PlanModel,
  fromIds: Iterable<string | undefined>,
  product: LibraryProduct,
): { model: PlanModel; rooms: string[]; changed: Array<"cable" | "thermostat"> } {
  const ids = new Set([...fromIds].filter((id): id is string => typeof id === "string" && id.length > 0));
  if (!ids.size) return { model, rooms: [], changed: [] };
  const rooms: string[] = [];
  const changed = new Set<"cable" | "thermostat">();
  const nextRooms = model.rooms.map((room) => {
    if (!room.heating) return room;
    const result = applyHeatingProductRetarget(room.heating, ids, product);
    if (!result.changed.length) return room;
    rooms.push(room.id);
    for (const item of result.changed) changed.add(item);
    return { ...room, heating: result.heating };
  });
  return {
    model: rooms.length ? { ...model, rooms: nextRooms } : model,
    rooms,
    changed: [...changed],
  };
}

export function heatingRevisionSummary(product: LibraryProduct, rooms: string[], changed: Array<"cable" | "thermostat">): string {
  if (!rooms.length) return "";
  const who = [product.manufacturer, product.model].filter((s) => s.trim()).join(" ") || product.id;
  return `Heating on ${rooms.length} room(s) retargeted to ${who} (${product.id}); ${changed.join(" and ")} snapshot rewritten from the accepted product.`;
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

export function heatingLibrary(library?: LibraryProduct[]): LibraryProduct[] {
  return library ?? productStore.getState().products;
}

function productById(id: string | undefined, category: string, library: LibraryProduct[]): LibraryProduct | undefined {
  if (!id) return undefined;
  return library.find((p) => p.id === id && p.category === category);
}

/** Shared input bag: live library product fields, else the travelling snapshot. */
export function heatingCableFields(heating: Heating | undefined, library?: LibraryProduct[]): Record<string, FieldValue> {
  const live = productById(heating?.cableProductId, "heating-cable", heatingLibrary(library));
  if (live) return live.fields;
  const spec = heating?.cableSpecification;
  return spec?.category === "heating-cable" ? spec.fields : {};
}

export function thermostatFields(heating: Heating | undefined, library?: LibraryProduct[]): Record<string, FieldValue> {
  const live = productById(heating?.thermostatProductId, "thermostat", heatingLibrary(library));
  if (live) return live.fields;
  const spec = heating?.thermostatSpecification;
  return spec?.category === "thermostat" ? spec.fields : {};
}

export function heatingCableProduct(heating: Heating | undefined, library?: LibraryProduct[]): LibraryProduct | undefined {
  return productById(heating?.cableProductId, "heating-cable", heatingLibrary(library));
}

export function thermostatProduct(heating: Heating | undefined, library?: LibraryProduct[]): LibraryProduct | undefined {
  return productById(heating?.thermostatProductId, "thermostat", heatingLibrary(library));
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
  model?: string;
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

function productName(
  live: LibraryProduct | undefined,
  spec: ProductSpecification | undefined,
  key: "manufacturer" | "model",
): string | undefined {
  const fromLive = live?.[key]?.trim();
  if (fromLive) return fromLive;
  return snapshotExtra(spec)[key];
}

export function heatingCableFigures(heating: Heating | undefined, library?: LibraryProduct[]): HeatingCableFigures {
  const fields = heatingCableFields(heating, library);
  const live = heatingCableProduct(heating, library);
  const manufacturer = productName(live, heating?.cableSpecification, "manufacturer");
  const model = productName(live, heating?.cableSpecification, "model");
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
    ...(manufacturer ? { manufacturer } : {}),
    ...(model ? { model } : {}),
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
  model?: string;
  ratedCurrent: HeatingFigure;
  voltageMin: HeatingFigure;
  voltageMax: HeatingFigure;
  ingressProtection?: { value?: string; kind: FigureKind; source?: string; note?: string; quantity: string };
}

export function thermostatFigures(heating: Heating | undefined, library?: LibraryProduct[]): ThermostatFigures {
  const fields = thermostatFields(heating, library);
  const live = thermostatProduct(heating, library);
  const manufacturer = productName(live, heating?.thermostatSpecification, "manufacturer");
  const model = productName(live, heating?.thermostatSpecification, "model");
  const ip = fields[THERMO_IP_KEY];
  const ipText = typeof ip?.value === "string" && ip.value.trim() ? ip.value.trim() : undefined;
  return {
    ...(manufacturer ? { manufacturer } : {}),
    ...(model ? { model } : {}),
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

/** Keys on the heating record that a writer must not set while the brief holds a real number (or a non-empty name). */
export function heatingProductLocks(heating: Heating | undefined, library?: LibraryProduct[]): {
  length: boolean;
  ratedOutput: boolean;
  manufacturer: boolean;
  model: boolean;
} {
  const cable = heatingCableProduct(heating, library);
  const fields = heatingCableFields(heating, library);
  const lengthLocked = typeof fields[CABLE_LENGTH_KEY]?.value === "number";
  const outputLocked = typeof fields[CABLE_OUTPUT_KEY]?.value === "number";
  const manufacturer = productName(cable, heating?.cableSpecification, "manufacturer");
  const model = productName(cable, heating?.cableSpecification, "model");
  return {
    length: lengthLocked,
    ratedOutput: outputLocked,
    manufacturer: !!manufacturer,
    model: !!model,
  };
}

export type HeatingWriteKey = "length" | "ratedOutput" | "manufacturer" | "model";

/**
 * Same refusal for set, clear-of-locked-field, tools and any later catalogue/re-anchor writer.
 * Only real numbers (or non-empty names) lock; unknown brief fields stay writable on the record.
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
  if (attachingCable && locks.length && shadowedLength && patch.length !== null) {
    reasons.push("cannot attach a heating-cable brief while the record holds a numeric length; pass length:null to clear the shadowed record value");
  }
  if (attachingCable && locks.ratedOutput && shadowedOutput && patch.ratedOutput !== null) {
    reasons.push("cannot attach a heating-cable brief while the record holds a numeric ratedOutput; pass ratedOutput:null to clear the shadowed record value");
  }
  if (locks.length && patch.length !== undefined && patch.length !== null) {
    reasons.push("length is locked to the heating-cable brief cableLength (a number is present); clear the product reference to enter a heating-record length");
  }
  if (locks.ratedOutput && patch.ratedOutput !== undefined && patch.ratedOutput !== null) {
    reasons.push("ratedOutput is locked to the heating-cable brief totalPower (a number is present); clear the product reference to enter a heating-record output");
  }
  if (locks.manufacturer && patch.manufacturer !== undefined) {
    reasons.push("manufacturer is locked to the referenced heating-cable product");
  }
  if (locks.model && patch.model !== undefined) {
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
  return isProductSpecification(v) && v.category === category;
}
