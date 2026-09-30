/**
 * Product spec briefs (#30). The page decides what must be found for each kind of fixture;
 * the user's agent searches and fills it in; a human accepts the result. Templates are data,
 * so a new category is a new entry here, not new code.
 *
 * Lengths are metres, like every other value the tools exchange. A value always carries a
 * status and at least one source. A value nobody found stays null and says where the agent
 * looked; nothing is guessed from photos or similar models.
 */

import type { ValueStatus } from "./types";
import { formatMm } from "./geometry";

/** Datums a field can be measured from. A spec sheet that uses another one must say so. */
export const REFERENCES = {
  "finished-wall": "the finished wall face behind the fixture (tile face)",
  "finished-floor": "the finished floor level (tile top)",
  "fixture-centreline": "the fixture's own centreline, facing it; left is negative",
  "fixture-end": "the fixture's nearer end (bath: the tap end unless the sheet says otherwise)",
  "fixture-side": "the fixture's back or wall-side edge",
  "frame": "the wall frame face",
  "other": "some other point; say which in the note",
} as const;
export type ReferenceId = keyof typeof REFERENCES;

export type FieldGroup = "envelope" | "rough-in" | "installation";

interface BaseField {
  key: string;
  label: string;
  group: FieldGroup;
  /** needed for a trade view; must be found or explicitly reported unknown */
  required: boolean;
  definition: string;
  /** only applies when another field has one of these values */
  when?: { field: string; in: string[] };
}
export interface LengthField extends BaseField { type: "length"; reference?: ReferenceId; min: number; max: number }
export interface ChoiceField extends BaseField { type: "choice"; options: string[] }
export interface CountField extends BaseField { type: "count"; min: number; max: number }
export interface TextField extends BaseField { type: "text" }
export type FieldSpec = LengthField | ChoiceField | CountField | TextField;

/**
 * One axis of a rough-in point: taken from a field, a range between two fields, or fixed at
 * zero on a named datum (e.g. a P-trap waste sits at the finished wall face).
 */
export type AxisSpec = { field: string } | { range: [string, string] } | { zeroAt: ReferenceId };

/**
 * A service connection on the fixture. Axes: across (sideways), out (away from the wall or
 * the fixture's back edge) and up (above the floor). An axis left out is not part of the point.
 */
export interface RoughInSpec {
  id: string;
  label: string;
  service: "waste" | "water";
  when?: { field: string; in: string[] };
  across?: AxisSpec;
  out?: AxisSpec;
  up?: AxisSpec;
}

export interface ProductCategory {
  id: string;
  label: string;
  /** what the footprint w × d × h fields are, for a 3D envelope */
  envelope: { w: string; d: string; h: string };
  fields: FieldSpec[];
  roughIn: RoughInSpec[];
}

const len = (f: Omit<LengthField, "type">): LengthField => ({ type: "length", ...f });

export const PRODUCT_CATEGORIES: ProductCategory[] = [
  {
    id: "toilet",
    label: "Toilet suite",
    envelope: { w: "width", d: "depth", h: "height" },
    fields: [
      len({ key: "width", label: "Overall width", group: "envelope", required: true, min: 0.25, max: 0.8, definition: "Widest point of pan and cistern together." }),
      len({ key: "depth", label: "Overall projection", group: "envelope", required: true, reference: "finished-wall", min: 0.4, max: 1.0, definition: "From the finished wall face to the front of the pan." }),
      len({ key: "height", label: "Overall height", group: "envelope", required: true, reference: "finished-floor", min: 0.3, max: 1.2, definition: "To the top of the cistern (or the pan, for an in-wall cistern)." }),
      len({ key: "seatHeight", label: "Seat height", group: "installation", required: false, reference: "finished-floor", min: 0.3, max: 0.55, definition: "Top of the seat." }),
      { type: "choice", key: "panType", label: "Pan type", group: "installation", required: true, options: ["wall-faced", "back-to-wall", "close-coupled", "wall-hung", "other"], definition: "How the pan meets the wall." },
      { type: "choice", key: "trap", label: "Trap", group: "rough-in", required: true, options: ["S", "P", "universal"], definition: "S = floor waste, P = wall waste, universal = either." },
      len({ key: "sTrapSetoutMin", label: "S-trap set-out, minimum", group: "rough-in", required: true, reference: "finished-wall", min: 0.05, max: 0.5, when: { field: "trap", in: ["S", "universal"] }, definition: "From the finished wall face to the centre of the floor waste; smallest set-out the pan accepts." }),
      len({ key: "sTrapSetoutMax", label: "S-trap set-out, maximum", group: "rough-in", required: true, reference: "finished-wall", min: 0.05, max: 0.5, when: { field: "trap", in: ["S", "universal"] }, definition: "As above; largest set-out the pan accepts. Same as the minimum when it is fixed." }),
      len({ key: "pTrapWasteHeight", label: "P-trap waste height", group: "rough-in", required: true, reference: "finished-floor", min: 0.1, max: 0.3, when: { field: "trap", in: ["P", "universal"] }, definition: "To the centre of the wall waste." }),
      len({ key: "inletHeight", label: "Water inlet height", group: "rough-in", required: true, reference: "finished-floor", min: 0.05, max: 1.2, definition: "To the centre of the water inlet (stop valve)." }),
      len({ key: "inletOffset", label: "Water inlet offset", group: "rough-in", required: false, reference: "fixture-centreline", min: -0.5, max: 0.5, definition: "Sideways from the pan centreline, facing the pan; left is negative." }),
      len({ key: "frameDepth", label: "In-wall cistern frame depth", group: "installation", required: true, reference: "frame", min: 0.05, max: 0.3, when: { field: "panType", in: ["wall-hung"] }, definition: "Depth the in-wall cistern frame needs behind the finished wall." }),
    ],
    roughIn: [
      { id: "waste-s", label: "Floor waste (S-trap)", service: "waste", when: { field: "trap", in: ["S", "universal"] },
        across: { zeroAt: "fixture-centreline" }, out: { range: ["sTrapSetoutMin", "sTrapSetoutMax"] }, up: { zeroAt: "finished-floor" } },
      { id: "waste-p", label: "Wall waste (P-trap)", service: "waste", when: { field: "trap", in: ["P", "universal"] },
        across: { zeroAt: "fixture-centreline" }, out: { zeroAt: "finished-wall" }, up: { field: "pTrapWasteHeight" } },
      { id: "inlet", label: "Water inlet", service: "water", across: { field: "inletOffset" }, out: { zeroAt: "finished-wall" }, up: { field: "inletHeight" } },
    ],
  },
  {
    id: "vanity",
    label: "Vanity / basin",
    envelope: { w: "width", d: "depth", h: "height" },
    fields: [
      len({ key: "width", label: "Overall width", group: "envelope", required: true, min: 0.3, max: 2.4, definition: "Widest point of cabinet and top." }),
      len({ key: "depth", label: "Overall depth", group: "envelope", required: true, reference: "finished-wall", min: 0.2, max: 0.7, definition: "From the finished wall face to the front of the top." }),
      len({ key: "height", label: "Unit height", group: "envelope", required: true, min: 0.1, max: 1.0, definition: "Cabinet plus top, not including tapware." }),
      { type: "choice", key: "mounting", label: "Mounting", group: "installation", required: true, options: ["wall-hung", "floor-standing"], definition: "How the unit is supported." },
      len({ key: "benchHeight", label: "Bench height", group: "installation", required: true, reference: "finished-floor", min: 0.6, max: 1.0, definition: "Top of the bench or basin rim when installed as the sheet recommends." }),
      len({ key: "wasteHeight", label: "Waste height", group: "rough-in", required: true, reference: "finished-floor", min: 0.3, max: 0.8, definition: "To the centre of the waste outlet at the wall." }),
      len({ key: "wasteOffset", label: "Waste offset", group: "rough-in", required: false, reference: "fixture-centreline", min: -1, max: 1, definition: "Sideways from the unit centreline, facing it; left is negative." }),
      { type: "count", key: "tapHoles", label: "Tap holes", group: "rough-in", required: true, min: 0, max: 3, definition: "Holes in the top or basin; 0 for wall-mounted tapware." },
      { type: "text", key: "tapHoleLayout", label: "Tap hole layout", group: "rough-in", required: false, definition: "Positions of the tap holes as the sheet gives them." },
    ],
    roughIn: [
      { id: "waste", label: "Wall waste", service: "waste", across: { field: "wasteOffset" }, out: { zeroAt: "finished-wall" }, up: { field: "wasteHeight" } },
    ],
  },
  {
    id: "bath",
    label: "Bath",
    envelope: { w: "length", d: "width", h: "height" },
    fields: [
      len({ key: "length", label: "Overall length", group: "envelope", required: true, min: 1.0, max: 2.2, definition: "Outside length." }),
      len({ key: "width", label: "Overall width", group: "envelope", required: true, min: 0.5, max: 1.2, definition: "Outside width." }),
      len({ key: "height", label: "Overall height", group: "envelope", required: true, reference: "finished-floor", min: 0.3, max: 0.8, definition: "To the rim." }),
      { type: "choice", key: "installation", label: "Installation", group: "installation", required: true, options: ["freestanding", "inset", "back-to-wall", "corner"], definition: "How the bath is installed." },
      len({ key: "wasteFromEnd", label: "Waste from end", group: "rough-in", required: true, reference: "fixture-end", min: 0, max: 2.2, definition: "From the outside of the nearer end to the centre of the waste." }),
      len({ key: "wasteFromSide", label: "Waste from side", group: "rough-in", required: true, reference: "fixture-side", min: 0, max: 1.2, definition: "From the outside of the back or wall-side edge to the centre of the waste." }),
      { type: "choice", key: "overflow", label: "Overflow", group: "rough-in", required: false, options: ["yes", "no"], definition: "Whether the bath has an overflow." },
      { type: "choice", key: "surround", label: "Hob or surround", group: "installation", required: true, options: ["hob", "apron", "tiled-frame", "none-required"], when: { field: "installation", in: ["inset", "back-to-wall", "corner"] }, definition: "What the bath needs built around or under its rim: a hob, a fitted apron or skirt, a tiled frame, or nothing." },
      { type: "text", key: "surroundDetail", label: "Hob or surround detail", group: "installation", required: false, when: { field: "installation", in: ["inset", "back-to-wall", "corner"] }, definition: "Hob height and width, apron or recess dimensions, exactly as the sheet gives them." },
    ],
    // plan position only: the brief does not ask for the waste's height
    roughIn: [
      { id: "waste", label: "Bath waste", service: "waste", across: { field: "wasteFromEnd" }, out: { field: "wasteFromSide" } },
    ],
  },
];

export const categoryById = (id: string): ProductCategory | undefined => PRODUCT_CATEGORIES.find((c) => c.id === id);

/** How the agent should research a brief. Returned with every brief. */
export const RESEARCH_PROTOCOL: string[] = [
  "1. Identify the exact product from what the human gave you (brand, model, code, link). If several products match, do not pick one: submit nothing and say which candidates you found with leave_note.",
  "2. Use the manufacturer's current specification sheet or installation guide first; a retailer listing only when the manufacturer publishes nothing. Cite each value's source: the URL and, always, where on it (page, figure, table or section). Alternatives need the same.",
  "3. Report exactly what the source prints, converted to metres, with status `published`. This path takes researched figures only; a site measurement is recorded by a person, not submitted here.",
  "4. Check each field's reference. If the source measures from a different point than the brief asks (e.g. set-out to the wall surface or frame instead of the finished wall face), submit the source's value with `reference` set to what it measures from and explain in `note`. Never convert it yourself.",
  "5. If a required field is not published, submit value null with a note saying where you looked. Never estimate from photos, drawings without dimensions, or similar models.",
  "6. If two sources disagree, submit the one you trust with the other under `alternatives`.",
];

export interface SourceRef {
  url: string;
  /** page, figure or table */
  locator?: string;
}

export interface FieldValue {
  value: number | string | null;
  status?: ValueStatus;
  sources?: SourceRef[];
  reference?: ReferenceId;
  note?: string;
  alternatives?: { value: number | string; source: SourceRef }[];
}

export interface SpecSubmission {
  manufacturer: string;
  model: string;
  code?: string;
  fields: Record<string, FieldValue>;
}

export interface SpecProblem {
  field: string | null;
  severity: "error" | "warning";
  code: string;
  message: string;
}


/** Whether a field applies, given the choices submitted so far. */
export function applies(field: FieldSpec, fields: Record<string, FieldValue>): boolean {
  if (!field.when) return true;
  const v = fields[field.when.field]?.value;
  return typeof v === "string" && field.when.in.includes(v);
}

/** Only web links are sources; anything else (javascript:, data:, a bare word) is refused. */
export function safeUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

const show = (f: FieldSpec, x: number | string) => (f.type === "length" && typeof x === "number" ? `${formatMm(x)} mm` : String(x));

/** Every source needs an http(s) link and where on it the figure is. */
function checkSources(sources: unknown[]): string | null {
  if (!sources.length) return "has no source. Give the URL and where on it (page, figure, table).";
  for (const x of sources) {
    const src = x as Partial<SourceRef> | null;
    if (!src || !safeUrl(src.url)) return "every source must be an http(s) link.";
    if (typeof src.locator !== "string" || !src.locator.trim()) return `source ${src.url} needs a locator: the page, figure, table or section the figure is on.`;
  }
  return null;
}

/** Type and range for one value; the same rules apply to alternatives. */
function checkValue(f: FieldSpec, value: unknown): { code: string; message: string } | null {
  switch (f.type) {
    case "length":
      if (typeof value !== "number" || !Number.isFinite(value)) return { code: "not_a_length", message: "must be a number of metres." };
      if (value < f.min || value > f.max) return { code: "out_of_range", message: `${value} m is outside ${f.min}–${f.max} m. Check the unit: lengths are metres.` };
      return null;
    case "choice":
      return typeof value === "string" && f.options.includes(value) ? null : { code: "not_an_option", message: `must be one of ${f.options.join(", ")}.` };
    case "count":
      return typeof value === "number" && Number.isInteger(value) && value >= f.min && value <= f.max ? null : { code: "not_a_count", message: `must be a whole number from ${f.min} to ${f.max}.` };
    case "text":
      return typeof value === "string" && value.trim() ? null : { code: "not_text", message: "must be text." };
  }
}

const differs = (a: number | string, b: number | string): boolean =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) > 0.0005 : a !== b;

/**
 * Check a submission against its category. Errors block the submission (nothing is stored);
 * warnings travel with it to the human reviewer.
 */
export function validateSubmission(category: ProductCategory, s: SpecSubmission): SpecProblem[] {
  const out: SpecProblem[] = [];
  const err = (field: string | null, code: string, message: string) => out.push({ field, severity: "error", code, message });
  const warn = (field: string | null, code: string, message: string) => out.push({ field, severity: "warning", code, message });
  if (!s || typeof s !== "object") return [{ field: null, severity: "error", code: "submission_invalid", message: "Submission must be an object." }];
  if (!s.manufacturer?.trim()) err(null, "manufacturer_missing", "Name the manufacturer.");
  if (!s.model?.trim()) err(null, "model_missing", "Name the model.");
  const fields = s.fields && typeof s.fields === "object" ? s.fields : {};
  for (const key of Object.keys(fields)) {
    if (!category.fields.some((f) => f.key === key)) err(key, "field_unknown", `"${key}" is not a field of the ${category.label} brief.`);
  }
  for (const f of category.fields) {
    const v = fields[f.key];
    const applicable = applies(f, fields);
    if (!v) {
      if (f.required && applicable) err(f.key, "field_missing", `${f.label} is required: submit its value, or null with a note saying where you looked.`);
      continue;
    }
    if (!applicable && v.value !== null) warn(f.key, "field_not_applicable", `${f.label} does not apply to this ${f.when!.field}; the reviewer will see it anyway.`);
    if (v.value === null || v.value === undefined) {
      if (f.required && applicable && !v.note?.trim()) err(f.key, "unknown_without_note", `${f.label} is unknown: say where you looked in note.`);
      else if (f.required && applicable) warn(f.key, "required_unknown", `${f.label} is unknown. ${v.note}`);
      continue;
    }
    if (v.status !== "published") err(f.key, "status_not_published", `${f.label}: a submitted value must be \`published\` (a manufacturer or retailer figure). Site measurements are recorded by a person, not through this path.`);
    const sourceProblem = checkSources(Array.isArray(v.sources) ? v.sources : []);
    if (sourceProblem) err(f.key, "source_invalid", `${f.label}: ${sourceProblem}`);
    const valueProblem = checkValue(f, v.value);
    if (valueProblem) err(f.key, valueProblem.code, `${f.label} ${valueProblem.message}`);
    if (f.type === "length" && v.reference && v.reference !== f.reference) {
      warn(f.key, "reference_mismatch", `${f.label} is measured from ${REFERENCES[v.reference] ?? v.reference}, but the brief asks for ${f.reference ? REFERENCES[f.reference] : "no particular datum"}.`);
    }
    for (const [i, alt] of (Array.isArray(v.alternatives) ? v.alternatives : []).entries()) {
      const altProblem = !alt ? "is empty" : checkSources([alt.source]) ?? (checkValue(f, alt.value)?.message ?? null);
      if (altProblem) { err(f.key, "alternative_invalid", `${f.label}, alternative ${i + 1}: ${altProblem}`); continue; }
      if (!valueProblem && differs(alt.value, v.value as number | string)) {
        warn(f.key, "sources_disagree", `${f.label}: ${alt.source.url} (${alt.source.locator}) gives ${show(f, alt.value)}, not ${show(f, v.value as number | string)}.`);
      }
    }
  }
  return out;
}

/** The envelope for a 3D block, only when all three are known. */
export function envelopeOf(category: ProductCategory, fields: Record<string, FieldValue>): { w: number; d: number; h: number } | null {
  const pick = (k: string) => (typeof fields[k]?.value === "number" ? (fields[k].value as number) : null);
  const w = pick(category.envelope.w);
  const d = pick(category.envelope.d);
  const h = pick(category.envelope.h);
  return w !== null && d !== null && h !== null ? { w, d, h } : null;
}

export interface AxisValue {
  from: ReferenceId;
  /** the field it came from, when not a fixed zero */
  field?: string;
  value?: number;
  min?: number;
  max?: number;
}

export interface RoughInPoint {
  id: string;
  label: string;
  service: "waste" | "water";
  across?: AxisValue;
  out?: AxisValue;
  up?: AxisValue;
  resolved: boolean;
  /** fields whose values are unknown or not submitted */
  missing: string[];
}

/**
 * The fixture's service points, each axis naming its datum. An axis whose field is unknown
 * stays without a value and the point is unresolved; nothing is filled in.
 */
export function roughInPoints(category: ProductCategory, fields: Record<string, FieldValue>): RoughInPoint[] {
  const spec = (key: string) => category.fields.find((f) => f.key === key) as LengthField | undefined;
  const num = (key: string) => (typeof fields[key]?.value === "number" ? (fields[key].value as number) : undefined);
  const points: RoughInPoint[] = [];
  for (const r of category.roughIn) {
    if (r.when && !r.when.in.includes(String(fields[r.when.field]?.value))) continue;
    const missing: string[] = [];
    const axis = (a: AxisSpec | undefined): AxisValue | undefined => {
      if (!a) return undefined;
      if ("zeroAt" in a) return { from: a.zeroAt, value: 0 };
      if ("range" in a) {
        const [lo, hi] = a.range;
        const min = num(lo);
        const max = num(hi);
        if (min === undefined) missing.push(lo);
        if (max === undefined) missing.push(hi);
        return { from: spec(lo)?.reference ?? "other", field: `${lo}..${hi}`, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
      }
      const value = num(a.field);
      if (value === undefined) missing.push(a.field);
      return { from: spec(a.field)?.reference ?? "other", field: a.field, ...(value !== undefined ? { value } : {}) };
    };
    const across = axis(r.across);
    const out = axis(r.out);
    const up = axis(r.up);
    points.push({ id: r.id, label: r.label, service: r.service, ...(across ? { across } : {}), ...(out ? { out } : {}), ...(up ? { up } : {}), resolved: missing.length === 0, missing });
  }
  return points;
}
