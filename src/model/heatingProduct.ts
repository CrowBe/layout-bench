/**
 * One accessor for heating-cable and thermostat briefs (#68). Length, output, coverage,
 * current and voltage are read here; checks, Inspector, print and WebMCP do not copy them.
 * A live library product wins over a travelling snapshot so a product edit updates every check.
 */
import type { Heating, Quantity, ValueStatus } from "./types";
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
export const SPACING_FROM_COVERAGE_RATIONALE =
  "Implied loop spacing if the published coverage range is spread along the published heated length. Derived, not a manufacturer spacing instruction and not a code requirement.";

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

export function heatingCableFigures(heating: Heating | undefined, library?: LibraryProduct[]): HeatingCableFigures {
  const fields = heatingCableFields(heating, library);
  const live = heatingCableProduct(heating, library);
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
    if (typeof coverage.value !== "number" || typeof length.value !== "number" || !(length.value > 0)) {
      return {
        kind: "unknown",
        unit: "m",
        quantity: label,
        origin: "coverage-area / cable-length",
        formula: SPACING_FROM_COVERAGE_FORMULA,
        note: "Spacing range stays unknown until coverage and heated length are both numeric.",
      };
    }
    return {
      value: quantize(coverage.value / length.value),
      kind: "derived",
      unit: "m",
      quantity: label,
      origin: "coverage-area / cable-length",
      formula: SPACING_FROM_COVERAGE_FORMULA,
      source: `${SPACING_FROM_COVERAGE_RATIONALE} Inputs: ${coverage.quantity} ${coverage.value} ${coverage.unit} (${coverage.kind}${coverage.source ? `, ${coverage.source}` : ""}) and ${length.quantity} ${length.value} ${length.unit} (${length.kind}${length.source ? `, ${length.source}` : ""}).`,
    };
  };
  return {
    ...(live?.manufacturer || heating?.manufacturer ? { manufacturer: live?.manufacturer || heating?.manufacturer } : {}),
    ...(live?.model || heating?.model ? { model: live?.model || heating?.model } : {}),
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
  const ip = fields[THERMO_IP_KEY];
  const ipText = typeof ip?.value === "string" && ip.value.trim() ? ip.value.trim() : undefined;
  return {
    ...(live?.manufacturer ? { manufacturer: live.manufacturer } : {}),
    ...(live?.model ? { model: live.model } : {}),
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
  const hasBrief = !!(cable || heating?.cableSpecification?.category === "heating-cable");
  const lengthLocked = typeof fields[CABLE_LENGTH_KEY]?.value === "number";
  const outputLocked = typeof fields[CABLE_OUTPUT_KEY]?.value === "number";
  return {
    length: lengthLocked,
    ratedOutput: outputLocked,
    manufacturer: hasBrief && !!(cable?.manufacturer || heating?.manufacturer),
    model: hasBrief && !!(cable?.model || heating?.model),
  };
}

export type HeatingWriteKey = "length" | "ratedOutput" | "manufacturer" | "model";

/**
 * Same refusal for set, clear-of-locked-field, tools and any later catalogue/re-anchor writer.
 * Only real numbers (or non-empty names) lock; unknown brief fields stay writable on the record.
 */
export function heatingProductWriteGuard(
  current: Heating | undefined,
  patch: Partial<Record<HeatingWriteKey | "cableProductId" | "cableSpecification", unknown>> & Record<string, unknown>,
  library?: LibraryProduct[],
): string | null {
  const next: Heating = {
    zoneIds: current?.zoneIds ?? [],
    path: current?.path ?? [],
    keepouts: current?.keepouts ?? [],
    ...current,
  };
  if (patch.cableProductId !== undefined) {
    if (patch.cableProductId === null) delete next.cableProductId;
    else next.cableProductId = patch.cableProductId as string;
  }
  if (patch.cableSpecification !== undefined) {
    if (patch.cableSpecification === null) delete next.cableSpecification;
    else next.cableSpecification = patch.cableSpecification as ProductSpecification;
  }
  const locks = heatingProductLocks(next, library);
  const reasons: string[] = [];
  if (locks.length && patch.length !== undefined) {
    reasons.push("length is locked to the heating-cable brief cableLength (a number is present); clear the product reference to enter a heating-record length");
  }
  if (locks.ratedOutput && patch.ratedOutput !== undefined) {
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
  if (!loc || typeof loc.description !== "string" || typeof loc.source !== "string") return false;
  if (!loc.description.trim() || !loc.source.trim()) return false;
  return loc.kind === undefined || loc.kind === "wet-room" || loc.kind === "outside-wet-room";
}

export function validHeatingProductRef(v: unknown, category: "heating-cable" | "thermostat"): boolean {
  if (v === undefined) return true;
  if (typeof v === "string") return v.length > 0 && v.length <= 200;
  return isProductSpecification(v) && v.category === category;
}
