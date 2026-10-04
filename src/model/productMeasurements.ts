/** Explicit human evidence for reused fittings (#48). No measurements come from photos or
 * the research tool. Published observations keep their separately located source. */
import { REFERENCES, applies, categoryById, validateProductGeometry, checkSources, checkValue, type FieldObservation, type FieldSpec, type FieldValue, type ProductCategory, type SpecProblem, type SubmissionContext } from "./products";
import { VALUE_STATUSES } from "./faces";
import type { ValueStatus } from "./types";

export interface PhysicalItem { label: string; notes?: string }
export interface MeasurementRecord {
  /** metres, count, choice, text, or the unit of a quantity field (W, V, A, Ω…) */
  unit: string;
  date: string | null;
  dateNote?: string;
  evidence: string;
  recordedBy: "human";
}
export interface ProductSpecification {
  category: string;
  fields: Record<string, FieldValue>;
  recordingMode?: "human-measurement";
  acceptedAt: number;
}
export const measurementUnit = (field: FieldSpec): MeasurementRecord["unit"] => field.type === "length" ? "metres" : field.type === "quantity" ? field.unit : field.type;
const dateValid = (date: unknown) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
export const isPhysicalItem = (p: unknown): p is PhysicalItem => !!p && typeof p === "object" && typeof (p as PhysicalItem).label === "string" && !!(p as PhysicalItem).label.trim() && ((p as PhysicalItem).notes === undefined || typeof (p as PhysicalItem).notes === "string");

/** A published template's zero is a convention, not a measured fact about a reused fitting.
 * Ask the human for it explicitly, using the same canonical fields as every other axis. */
export function measurementFields(category: ProductCategory): FieldSpec[] {
  const extras: FieldSpec[] = [];
  for (const point of category.roughIn) for (const axis of ["across", "out", "up"] as const) {
    const spec = point[axis];
    if (spec && "zeroAt" in spec) extras.push({ type: "length", key: `service.${point.id}.${axis}`, label: `${point.label}: ${axis} position`, group: "rough-in", required: false, reference: spec.zeroAt, min: -3, max: 3,
      ...(point.when ? { when: point.when } : {}), definition: `Explicit human value in metres from ${REFERENCES[spec.zeroAt]}. The published template's zero is not assumed for this physical item.` });
  }
  return [...category.fields, ...extras];
}
export const unknownMeasurementFields = (category: ProductCategory): Record<string, FieldValue> => Object.fromEntries(measurementFields(category).map(field => [field.key, { value: null, note: "Not supplied for this physical item." }]));

export function validateMeasurementFields(category: ProductCategory, fields: Record<string, FieldValue>, ctx: SubmissionContext = {}): SpecProblem[] {
  const problems: SpecProblem[] = [], specs = measurementFields(category);
  const add = (field: string, severity: "error" | "warning", code: string, message: string) => problems.push({ field, severity, code, message });
  const record = (field: FieldSpec, value: FieldObservation | FieldValue, prefix: string) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) { add(field.key, "error", "measurement_invalid", `${prefix} must be an evidence record.`); return; }
    if (value.note !== undefined && typeof value.note !== "string") add(field.key, "error", "measurement_invalid", `${prefix}: the note must be text.`);
    if (value.sources !== undefined && (!Array.isArray(value.sources) || value.sources.length && checkSources(value.sources, ctx))) add(field.key, "error", "source_invalid", `${prefix}: sources must be a list of valid located references.`);
    if (value.value === null) {
      if (!(typeof value.note === "string" && value.note.trim())) add(field.key, "error", "unknown_without_note", `${prefix}: explain what is unknown.`);
      return;
    }
    const invalidValue = checkValue(field, value.value);
    if (invalidValue) add(field.key, "error", invalidValue.code, `${prefix} ${invalidValue.message}`);
    if (!VALUE_STATUSES.includes(value.status as ValueStatus)) add(field.key, "error", "measurement_status", `${prefix}: explicitly choose measured, estimated, proposed, site-confirmed or published.`);
    if (field.type === "length" && (!value.reference || !Object.hasOwn(REFERENCES, value.reference))) add(field.key, "error", "measurement_datum", `${prefix}: name the physical datum.`);
    if ((value.reference === "other" || value.reference === "unresolved") && !(typeof value.note === "string" && value.note.trim())) add(field.key, "error", "measurement_datum", `${prefix}: ${value.reference === "other" ? "explain the other physical datum" : "say what the source shows and why its datum is unclear"} in the note.`);
    if (value.status === "published") {
      const bad = Array.isArray(value.sources) ? checkSources(value.sources, ctx) : "sources must be a list.";
      if (bad) add(field.key, "error", "source_invalid", `${prefix}: ${bad}`);
      if (value.measurement) add(field.key, "error", "measurement_provenance", `${prefix}: a published figure uses its source, not a human measurement record.`);
    } else {
      const m = value.measurement;
      if (!m || m.recordedBy !== "human" || m.unit !== measurementUnit(field) || typeof m.evidence !== "string" || !m.evidence.trim() || !(dateValid(m.date) || m.date === null && typeof m.dateNote === "string" && m.dateNote.trim())) {
        add(field.key, "error", "measurement_provenance", `${prefix}: record the unit, human evidence/reference and a valid date, or explicitly unknown date with an explanation.`);
      }
    }
    if (field.type === "length" && field.reference && value.reference && field.reference !== value.reference) add(field.key, "warning", "reference_mismatch", `${prefix} uses ${value.reference}; the template asks for ${field.reference}. No datum conversion is inferred.`);
  };
  for (const key of Object.keys(fields)) if (!specs.some(spec => spec.key === key)) add(key, "error", "field_unknown", `${key} is not a field of this measured fitting.`);
  for (const field of specs) {
    const value = fields[field.key];
    if (!value) {
      if (field.required && applies(field, fields)) add(field.key, "error", "field_missing", `${field.label}: record a value or explicit unknown.`);
      continue;
    }
    record(field, value, field.label);
    if (value.value === null && field.required && applies(field, fields)) add(field.key, "warning", "required_unknown", `${field.label} remains unknown: ${value.note ?? ""}`);
    if (value.observations !== undefined && !Array.isArray(value.observations)) add(field.key, "error", "measurement_invalid", `${field.label}: observations must be a list.`);
    for (const [index, observation] of (Array.isArray(value.observations) ? value.observations : []).entries()) {
      record(field, observation, `${field.label}, observation ${index + 1}`);
      if (observation?.value !== null && value.value !== null && (observation?.value !== value.value || observation?.reference !== value.reference)) add(field.key, "warning", "evidence_disagreement", `${field.label}: observation ${index + 1} differs in value or datum; every observation is retained for review.`);
    }
    if (value.alternatives !== undefined && !Array.isArray(value.alternatives)) add(field.key, "error", "measurement_invalid", `${field.label}: alternatives must be a list.`);
    for (const alternative of Array.isArray(value.alternatives) ? value.alternatives : []) {
      if (!alternative || typeof alternative !== "object") { add(field.key, "error", "measurement_invalid", `${field.label}: an alternative must be an evidence record.`); continue; }
      record(field, { ...alternative, status: "published", sources: [alternative.source], reference: value.reference }, `${field.label}, published alternative`);
      if (alternative.value !== value.value) add(field.key, "warning", "evidence_disagreement", `${field.label}: a published alternative differs; its source is retained.`);
    }
  }
  problems.push(...validateProductGeometry(category, fields));
  return problems;
}

/** Changing the working record retains previous evidence, including explicit unknowns. */
export function withObservation(current: FieldValue | undefined, observation: FieldObservation): FieldValue {
  const previous = current ? (({ observations: _observations, alternatives: _alternatives, ...record }) => record)(current) : undefined;
  const observations = [...(current?.observations ?? []), ...(previous && !current?.observations?.some(v => JSON.stringify(v) === JSON.stringify(previous)) ? [previous] : []), structuredClone(observation)];
  return { ...structuredClone(observation), ...(current?.alternatives ? { alternatives: structuredClone(current.alternatives) } : {}), observations };
}
export const workingObservation = (current: FieldValue, index: number): FieldValue => ({ ...structuredClone(current.observations![index]), observations: structuredClone(current.observations), ...(current.alternatives ? { alternatives: structuredClone(current.alternatives) } : {}) });
export const evidenceText = (value: FieldValue | undefined): string => [value?.measurement ? `${value.measurement.evidence}; measurement date ${value.measurement.date ?? `unknown (${value.measurement.dateNote})`}; human; ${value.measurement.unit}` : "", ...(value?.sources ?? []).map(source => `${source.url} (${source.locator ?? ""})`)].filter(Boolean).join("; ");
const statusRank: ValueStatus[] = ["estimated", "proposed", "published", "measured", "site-confirmed"];
export const evidenceStatus = (values: (FieldValue | undefined)[]): ValueStatus | undefined => values.filter(v => v?.value !== null && v?.value !== undefined && v?.status).map(v => v!.status!).sort((a, b) => statusRank.indexOf(a) - statusRank.indexOf(b))[0];

/** Structural project readback validation; source attachment bytes are deliberately not transferred here. */
export function isProductSpecification(value: unknown): value is ProductSpecification {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const spec = value as ProductSpecification;
  if (typeof spec.category !== "string" || !spec.fields || typeof spec.fields !== "object" || Array.isArray(spec.fields) || !Number.isFinite(spec.acceptedAt) || (spec.recordingMode !== undefined && spec.recordingMode !== "human-measurement")) return false;
  // the fixed units, plus the units this category's quantity fields are recorded in
  const units = new Set<string>(["metres", "count", "choice", "text", ...(categoryById(spec.category)?.fields ?? []).flatMap((f) => f.type === "quantity" ? [f.unit] : [])]);
  const valid = (v: FieldObservation | FieldValue): boolean => !!v && typeof v === "object" && !Array.isArray(v) && (v.value === null || typeof v.value === "string" || typeof v.value === "number" && Number.isFinite(v.value)) && (v.status === undefined || VALUE_STATUSES.includes(v.status)) && (v.note === undefined || typeof v.note === "string") && (v.reference === undefined || typeof v.reference === "string" && Object.hasOwn(REFERENCES, v.reference)) && (v.sources === undefined || Array.isArray(v.sources) && v.sources.every(s => !!s && typeof s.url === "string" && (s.locator === undefined || typeof s.locator === "string"))) && (v.measurement === undefined || !!v.measurement && typeof v.measurement === "object" && v.measurement.recordedBy === "human" && typeof v.measurement.evidence === "string" && !!v.measurement.evidence.trim() && (dateValid(v.measurement.date) || v.measurement.date === null && typeof v.measurement.dateNote === "string" && !!v.measurement.dateNote.trim()) && typeof v.measurement.unit === "string" && units.has(v.measurement.unit));
  return Object.values(spec.fields).every(v => valid(v) && (v.observations === undefined || Array.isArray(v.observations) && v.observations.every(valid)) && (v.alternatives === undefined || Array.isArray(v.alternatives) && v.alternatives.every(a => !!a && typeof a === "object" && valid({ ...a, status: "published", sources: [a.source] }))));
}
