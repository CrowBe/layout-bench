/**
 * A room's heating record can pin an accepted library product for its cable and for its
 * controller, so the figures a route is checked against are reviewed evidence with their sources,
 * not retyped numbers. The product is a snapshot kept with the project, like a placed fixture's.
 * Checks compare what was recorded; they never approve an installation.
 */
import type { LibraryProduct } from "./productLibrary";
import type { ProductSpecification } from "./productMeasurements";
import { evidenceText } from "./productMeasurements";
import type { FieldValue } from "./products";
import type { Heating, Quantity, ValueStatus } from "./types";
import { VALUE_STATUSES } from "./faces";
import { quantize } from "./geometry";

export interface HeatingProduct {
  productId: string;
  manufacturer: string;
  model: string;
  specification: ProductSpecification;
}

export const CABLE_CATEGORY = "heating-cable";
export const CONTROLLER_CATEGORY = "thermostat";

const num = (fields: Record<string, FieldValue>, key: string): number | undefined => {
  const v = fields[key]?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
};
const quantity = (product: LibraryProduct, key: string): Quantity | undefined => {
  const fv = product.fields[key], value = num(product.fields, key);
  if (value === undefined || !fv) return undefined;
  const status: ValueStatus = fv.status && VALUE_STATUSES.includes(fv.status) ? fv.status : "published";
  return { value, status, source: evidenceText(fv) || `${product.manufacturer} ${product.model}, product library ${product.id}` };
};

export const snapshotOf = (product: LibraryProduct): HeatingProduct => ({
  productId: product.id, manufacturer: product.manufacturer, model: product.model,
  specification: structuredClone({ category: product.category, fields: product.fields, recordingMode: product.recordingMode, acceptedAt: product.acceptedAt }),
});

/** The record's own cable fields, filled from a heating-cable product. Unknown figures are left out, never zero. */
export function cableFieldsFrom(product: LibraryProduct): Partial<Heating> {
  const length = quantity(product, "cableLength"), ratedOutput = quantity(product, "totalPower");
  const text = product.fields.installationRequirements?.value;
  return {
    manufacturer: product.manufacturer || undefined, model: product.model || undefined,
    productSource: `Product library ${product.id}`,
    ...(typeof text === "string" && text.trim() ? { requirements: text } : {}),
    ...(length ? { length } : {}), ...(ratedOutput ? { ratedOutput } : {}),
    cableProduct: snapshotOf(product),
  };
}

/** Cable pitch the label's coverage implies: area ÷ heated length, smallest to largest, in metres. */
export function impliedSpacing(spec: ProductSpecification | undefined): { min: number; max: number } | null {
  if (!spec) return null;
  const length = num(spec.fields, "cableLength"), lo = num(spec.fields, "coverageAreaMin"), hi = num(spec.fields, "coverageAreaMax");
  if (!length || lo === undefined || hi === undefined || lo > hi) return null;
  return { min: quantize(lo / length), max: quantize(hi / length) };
}

export interface HeatingCheck { severity: "error" | "warning"; code: string; message: string }

const mm = (m: number) => `${(m * 1000).toFixed(0)} mm`;

/**
 * Checks that need the pinned products. `availableArea` is the zone area less keep-outs and
 * `planRouteLength` the plan length of the drawn route, both from the heating evidence.
 */
export function productChecks(h: Heating, availableArea: number, planRouteLength: number): HeatingCheck[] {
  const out: HeatingCheck[] = [];
  const add = (severity: HeatingCheck["severity"], code: string, message: string) => out.push({ severity, code, message });
  const cable = h.cableProduct?.specification, controller = h.controller?.specification;
  if (cable) {
    const lo = num(cable.fields, "coverageAreaMin"), hi = num(cable.fields, "coverageAreaMax");
    if (lo !== undefined && hi !== undefined && availableArea > 0 && (availableArea < lo - 1e-6 || availableArea > hi + 1e-6)) {
      add("warning", "heating_coverage_outside_product_range", `Heated area ${availableArea.toFixed(2)} m² (zones less keep-outs) is outside the ${lo}–${hi} m² the cable's label gives.`);
    }
    const pitch = impliedSpacing(cable);
    if (pitch && planRouteLength > 0 && availableArea > 0) {
      const drawn = availableArea / planRouteLength;
      if (drawn < pitch.min - 0.002 || drawn > pitch.max + 0.002) {
        add("warning", "heating_spacing_outside_product_range", `The drawn route implies about ${mm(drawn)} between runs; the cable's coverage range implies ${mm(pitch.min)}–${mm(pitch.max)}.`);
      }
    }
  }
  if (controller) {
    const ip = controller.fields.ingressProtection?.value;
    add("warning", "heating_controller_ingress", `Controller housing is ${typeof ip === "string" && ip.trim() ? ip : "of unknown ingress protection"}. Where it may be fitted relative to the bathroom zones is for the electrician to decide; nothing here checks it.`);
    if (cable) {
      const volts = num(cable.fields, "ratedVoltage"), vLo = num(controller.fields, "ratedVoltageMin"), vHi = num(controller.fields, "ratedVoltageMax");
      if (volts !== undefined && vLo !== undefined && vHi !== undefined && (volts < vLo || volts > vHi)) {
        add("error", "heating_controller_voltage", `Cable is rated ${volts} V; the controller's range is ${vLo}–${vHi} V.`);
      }
      const amps = num(cable.fields, "ratedCurrent"), rating = num(controller.fields, "ratedCurrent");
      if (amps !== undefined && rating !== undefined && amps > rating) {
        add("error", "heating_controller_current", `Cable draws ${amps} A; the controller is rated ${rating} A.`);
      }
    }
  }
  return out;
}

/** Structural check for a persisted snapshot. */
export const validHeatingProduct = (v: unknown, category: string): v is HeatingProduct => {
  const p = v as HeatingProduct;
  return !!p && typeof p === "object" && typeof p.productId === "string" && typeof p.manufacturer === "string" && typeof p.model === "string" &&
    !!p.specification && typeof p.specification === "object" && p.specification.category === category && !!p.specification.fields && typeof p.specification.fields === "object";
};
