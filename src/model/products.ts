/**
 * Product spec briefs (#30). The page decides what must be found for each kind of fixture;
 * the user's agent searches and fills it in; a human accepts the result. Templates are data,
 * so a new category is a new entry here, not new code.
 *
 * Lengths are metres, like every other value the tools exchange. A value always carries a
 * status and at least one source. A value nobody found stays null and says where the agent
 * looked; nothing is guessed from photos or similar models.
 */

import { validateIdentity, type ExactProduct } from "./productIdentity";
import type { ValueStatus } from "./types";
import { formatMm, quantize } from "./geometry";
import { outlineExtents, type Outline } from "./outline";
import { BATHROOM_PRODUCT_CATEGORIES } from "./bathroomProductCategories";
import type { MeasurementRecord } from "./productMeasurements";

/** Datums a field can be measured from. A spec sheet that uses another one must say so. */
export const REFERENCES = {
  "finished-wall": "the finished wall face behind the fixture (tile face)",
  "finished-floor": "the finished floor level (tile top)",
  "fixture-centreline": "the fixture's own centreline, facing it; left is negative",
  "fixture-end": "the fixture's nearer end (bath: the tap end unless the sheet says otherwise)",
  "fixture-side": "the fixture's back or wall-side edge",
  "fixture-bottom": "the product's own bottom edge; not a project mounting height",
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
  service: "waste" | "water" | "power";
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
  /** Existing generic geometry has no elevation, recess or opening/swing. */
  placement?: { supportedWhen: { field: string; in: string[] }[]; limitation: string };
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
      { type: "choice", key: "panType", label: "Pan type", group: "installation", required: true, options: ["back-to-wall", "wall-faced", "wall-hung", "other"], definition: "How the pan meets the wall." },
      { type: "choice", key: "cistern", label: "Cistern", group: "installation", required: true, options: ["close-coupled", "in-wall", "exposed-wall-mounted", "other"], definition: "Where the cistern sits: on the pan, inside the wall, or on the wall face." },
      { type: "choice", key: "inletEntry", label: "Water inlet entry", group: "rough-in", required: true, options: ["bottom", "back", "side"], definition: "Where the supply enters the cistern: underneath, through the back, or from the side." },
      { type: "choice", key: "trap", label: "Trap", group: "rough-in", required: true, options: ["S", "P", "universal"], definition: "S = floor waste, P = wall waste, universal = either." },
      len({ key: "sTrapSetoutMin", label: "S-trap set-out, minimum", group: "rough-in", required: true, reference: "finished-wall", min: 0.05, max: 0.5, when: { field: "trap", in: ["S", "universal"] }, definition: "From the finished wall face to the centre of the floor waste; smallest set-out the pan accepts." }),
      len({ key: "sTrapSetoutMax", label: "S-trap set-out, maximum", group: "rough-in", required: true, reference: "finished-wall", min: 0.05, max: 0.5, when: { field: "trap", in: ["S", "universal"] }, definition: "As above; largest set-out the pan accepts. Same as the minimum when it is fixed." }),
      len({ key: "pTrapWasteHeight", label: "P-trap waste height", group: "rough-in", required: true, reference: "finished-floor", min: 0.1, max: 0.3, when: { field: "trap", in: ["P", "universal"] }, definition: "To the centre of the wall waste." }),
      len({ key: "inletHeight", label: "Water inlet height", group: "rough-in", required: true, reference: "finished-floor", min: 0.05, max: 1.2, definition: "To the centre of the water inlet (stop valve)." }),
      len({ key: "inletOffset", label: "Water inlet offset", group: "rough-in", required: false, reference: "fixture-centreline", min: -0.5, max: 0.5, definition: "Sideways from the pan centreline, facing the pan; left is negative." }),
      len({ key: "frameDepth", label: "In-wall cistern frame depth", group: "installation", required: true, reference: "frame", min: 0.05, max: 0.3, when: { field: "cistern", in: ["in-wall"] }, definition: "Depth the in-wall cistern frame needs behind the finished wall." }),
      { type: "choice", key: "power", label: "Power for an electric seat", group: "rough-in", required: true, options: ["not-required", "required"], definition: "Whether the suite as supplied (e.g. with a bidet seat) needs a power outlet." },
      len({ key: "powerOutletHeight", label: "Power outlet height", group: "rough-in", required: true, reference: "finished-floor", min: 0.1, max: 1.5, when: { field: "power", in: ["required"] }, definition: "To the centre of the power outlet the sheet recommends." }),
      len({ key: "powerOutletOffset", label: "Power outlet offset", group: "rough-in", required: false, reference: "fixture-centreline", min: -1, max: 1, when: { field: "power", in: ["required"] }, definition: "Sideways from the pan centreline, facing the pan; left is negative." }),
    ],
    roughIn: [
      { id: "waste-s", label: "Floor waste (S-trap)", service: "waste", when: { field: "trap", in: ["S", "universal"] },
        across: { zeroAt: "fixture-centreline" }, out: { range: ["sTrapSetoutMin", "sTrapSetoutMax"] }, up: { zeroAt: "finished-floor" } },
      { id: "waste-p", label: "Wall waste (P-trap)", service: "waste", when: { field: "trap", in: ["P", "universal"] },
        across: { zeroAt: "fixture-centreline" }, out: { zeroAt: "finished-wall" }, up: { field: "pTrapWasteHeight" } },
      { id: "inlet", label: "Water inlet", service: "water", across: { field: "inletOffset" }, out: { zeroAt: "finished-wall" }, up: { field: "inletHeight" } },
      { id: "power", label: "Power outlet", service: "power", when: { field: "power", in: ["required"] }, across: { field: "powerOutletOffset" }, out: { zeroAt: "finished-wall" }, up: { field: "powerOutletHeight" } },
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
      { type: "choice", key: "shape", label: "Plan shape", group: "envelope", required: true, options: ["rectangular", "corner-round", "other"], definition: "Rectangular, or a corner bath with two straight wall sides and a rounded front. For a corner bath, length and width are its extents along each wall." },
      len({ key: "frontWidth", label: "Width across the curved front", group: "envelope", required: true, min: 0.5, max: 2.5, when: { field: "shape", in: ["corner-round"] }, definition: "Straight-line distance between the two ends of the curved front, where it meets the straight wall sides." }),
      len({ key: "frontProjection", label: "Projection from the corner", group: "envelope", required: true, reference: "other", min: 0.5, max: 2.2, when: { field: "shape", in: ["corner-round"] }, definition: "From the corner where the walls meet to the front of the curve, along the line bisecting the corner." }),
      len({ key: "wasteFromEnd", label: "Waste from end", group: "rough-in", required: true, reference: "fixture-end", min: 0, max: 2.2, definition: "From the outside of the end named in wasteEnd to the centre of the waste. For a corner bath, the end is the back edge on the other wall." }),
      { type: "choice", key: "wasteEnd", label: "Waste measured from end", group: "rough-in", required: false, options: ["left", "right"], definition: "Which end wasteFromEnd is measured from, facing the bath. Needed to place the waste in the plan." },
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
  ...BATHROOM_PRODUCT_CATEGORIES,
];

export const categoryById = (id: string): ProductCategory | undefined => PRODUCT_CATEGORIES.find((c) => c.id === id);

/** Explicitly bound the existing floor-based envelope path; no guessed mounting geometry. */
export function productPlacementProblem(category: ProductCategory, fields: Record<string, FieldValue>): string | null {
  const p = category.placement;
  if (!p) return null; // keep the existing categories compatible
  return p.supportedWhen.length && p.supportedWhen.every((c) => c.in.includes(String(fields[c.field]?.value)))
    ? null : `Unsupported product placement: ${p.limitation} Installation geometry is pending issue #51.`;
}

/** How the agent should research a brief. Returned with every brief. */
export const RESEARCH_PROTOCOL: string[] = [
  "0. If the request has attachments, they are the spec sheet the person already holds for this exact product: complete the brief from them first and cite them as `attachment:<id>` with the page as locator (\"p. 2\", \"p. 2, fig. 1\"). An image attachment has no text you can read; if you need its contents, ask the person to paste it into the conversation. A PDF page with no text (a scan) is not read for you either: nothing is OCR'd.",
  "1. Identify the exact product from what the human gave you (brand, model, code, link). If several products match, do not pick one: submit nothing and say which candidates you found with leave_note.",
  "2. Use the manufacturer's current specification sheet or installation guide first; a retailer listing only when the manufacturer publishes nothing. Cite each value's source: the URL and, always, where on it (page, figure, table or section). Alternatives need the same.",
  "3. Report exactly what the source prints, converted to metres, with status `published`. This path takes researched figures only; a site measurement is recorded by a person, not submitted here.",
  "4. Check each field's reference. If the source measures from a different point than the brief asks (e.g. set-out to the wall surface or frame instead of the finished wall face), submit the source's value with `reference` set to what it measures from and explain in `note`. Never convert it yourself.",
  "5. If a required field is not published, submit value null with a note saying where you looked. Never estimate from photos, drawings without dimensions, or similar models.",
  "6. If two sources disagree, submit the one you trust with the other under `alternatives`.",
  "7. Product mounting/fixing dimensions belong in this brief; proposed project mounting heights do not. Report published product-local dimensions from their named datum. Do not infer the installation elevation, recess, swing, accessories or connections. Required accessories use the exact component identity fields, not a guessed substitute.",
];

export interface SourceRef {
  /** an http(s) link, or `attachment:<id>` for a file attached to the request */
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
  /** Human evidence is written only through the explicit measurement flow. */
  measurement?: MeasurementRecord;
  /** Complete alternative records retain status, datum, date and evidence. */
  observations?: FieldObservation[];
}
export type FieldObservation = Omit<FieldValue, "observations" | "alternatives">;

export interface SpecSubmission extends ExactProduct {
  manufacturer: string;
  model: string;
  code?: string;
  fields: Record<string, FieldValue>;
}

/** What validation needs to know about a file attached to the request (#34). */
export interface AttachmentRef {
  id: string;
  name: string;
  kind: "pdf" | "image";
  /** PDF only: the text of each page, page 1 first; empty for a page with no text layer */
  pages?: { page: number; text: string }[];
}

/** Context a submission is checked against: the request's own attachments. */
export interface SubmissionContext {
  attachments?: AttachmentRef[];
}

export const ATTACHMENT_PREFIX = "attachment:";

/** The attachment id a source cites, or null when it is not an attachment citation. */
export function attachmentIdOf(url: unknown): string | null {
  return typeof url === "string" && url.trim().startsWith(ATTACHMENT_PREFIX) ? url.trim().slice(ATTACHMENT_PREFIX.length).trim() : null;
}

/** The page a locator names ("p. 2", "page 3, table 1", "pp. 4"), or null. */
export function pageOfLocator(locator: unknown): number | null {
  if (typeof locator !== "string") return null;
  const m = /^\s*(?:pp?|pg|page)\.?\s*(\d+)\b/i.exec(locator);
  return m ? Number(m[1]) : null;
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

/**
 * Every source needs an http(s) link, or an attachment on this request, and where on it the
 * figure is. A PDF attachment's locator must name a page it has (#34).
 */
export function checkSources(sources: unknown[], ctx: SubmissionContext, onNote?: (message: string) => void): string | null {
  if (!sources.length) return "has no source. Give the URL and where on it (page, figure, table), or cite an attachment as attachment:<id> with its page.";
  for (const x of sources) {
    const src = x as Partial<SourceRef> | null;
    const attId = src ? attachmentIdOf(src.url) : null;
    if (attId !== null) {
      const att = (ctx.attachments ?? []).find((a) => a.id === attId);
      if (!att) {
        const have = (ctx.attachments ?? []).map((a) => `${ATTACHMENT_PREFIX}${a.id} (${a.name})`);
        return `${src!.url} is not attached to this request. ${have.length ? `Attached: ${have.join(", ")}.` : "It has no attachments."}`;
      }
      if (typeof src!.locator !== "string" || !src!.locator.trim()) {
        return `source ${src!.url} needs a locator: the page the figure is on, e.g. "p. 2".`;
      }
      if (att.kind === "pdf") {
        const page = pageOfLocator(src!.locator);
        const count = att.pages?.length ?? 0;
        if (page === null) return `source ${src!.url} (${att.name}) needs its locator to start with the page, e.g. "p. 2" or "p. 2, fig. 1"; got "${src!.locator}".`;
        if (page < 1 || page > count) return `source ${src!.url} (${att.name}) has ${count} page(s); page ${page} does not exist.`;
        if (!att.pages![page - 1].text.trim()) onNote?.(`${att.name} p. ${page} has no text layer (a scan?), so nothing was extracted from it; check the figure against the page itself.`);
      }
      continue;
    }
    if (!src || !safeUrl(src.url)) return "every source must be an http(s) link or an attachment:<id> on this request.";
    if (typeof src.locator !== "string" || !src.locator.trim()) return `source ${src.url} needs a locator: the page, figure, table or section the figure is on.`;
  }
  return null;
}

/** Type and range for one value; the same rules apply to alternatives. */
export function checkValue(f: FieldSpec, value: unknown): { code: string; message: string } | null {
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
export function validateSubmission(category: ProductCategory, s: SpecSubmission, ctx: SubmissionContext = {}): SpecProblem[] {
  const out: SpecProblem[] = [];
  const err = (field: string | null, code: string, message: string) => out.push({ field, severity: "error", code, message });
  const warn = (field: string | null, code: string, message: string) => out.push({ field, severity: "warning", code, message });
  if (!s || typeof s !== "object") return [{ field: null, severity: "error", code: "submission_invalid", message: "Submission must be an object." }];
  if (typeof s.manufacturer !== "string" || !s.manufacturer.trim()) err(null, "manufacturer_missing", "Name the manufacturer.");
  if (typeof s.model !== "string" || !s.model.trim()) err(null, "model_missing", "Name the model.");
  if (s.code !== undefined && typeof s.code !== "string") err(null, "code_invalid", "Product code must be text.");
  if (typeof s.code === "string" && s.code.trim() && s.identity?.code?.state !== "known") err("identity.code", "identity_source_invalid", "A submitted product code needs matching sourced identity.code evidence; legacy codes remain unknown.");
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
    if (v.measurement || v.observations) err(f.key, "human_evidence_only", `${f.label}: human measurement evidence belongs in the explicit human flow, not researched submission.`);
    if (v.value === null || v.value === undefined) {
      if (f.required && applicable && !v.note?.trim()) err(f.key, "unknown_without_note", `${f.label} is unknown: say where you looked in note.`);
      else if (f.required && applicable) warn(f.key, "required_unknown", `${f.label} is unknown. ${v.note}`);
      continue;
    }
    if (v.status !== "published") err(f.key, "status_not_published", `${f.label}: a submitted value must be \`published\` (a manufacturer or retailer figure). Site measurements are recorded by a person, not through this path.`);
    const sourceProblem = checkSources(Array.isArray(v.sources) ? v.sources : [], ctx, (m) => warn(f.key, "attachment_page_no_text", `${f.label}: ${m}`));
    if (sourceProblem) err(f.key, "source_invalid", `${f.label}: ${sourceProblem}`);
    const valueProblem = checkValue(f, v.value);
    if (valueProblem) err(f.key, valueProblem.code, `${f.label} ${valueProblem.message}`);
    if (f.type === "length" && v.reference && v.reference !== f.reference) {
      warn(f.key, "reference_mismatch", `${f.label} is measured from ${REFERENCES[v.reference] ?? v.reference}, but the brief asks for ${f.reference ? REFERENCES[f.reference] : "no particular datum"}.`);
    }
    for (const [i, alt] of (Array.isArray(v.alternatives) ? v.alternatives : []).entries()) {
      const altProblem = !alt ? "is empty" : checkSources([alt.source], ctx) ?? (checkValue(f, alt.value)?.message ?? null);
      if (altProblem) { err(f.key, "alternative_invalid", `${f.label}, alternative ${i + 1}: ${altProblem}`); continue; }
      if (!valueProblem && differs(alt.value, v.value as number | string)) {
        warn(f.key, "sources_disagree", `${f.label}: ${alt.source.url} (${alt.source.locator}) gives ${show(f, alt.value)}, not ${show(f, v.value as number | string)}.`);
      }
    }
  }
  if (category.placement) {
    for (const f of category.fields.filter((f) => f.key.endsWith("Min"))) {
      const maxKey = `${f.key.slice(0, -3)}Max`;
      const lo = fields[f.key]?.value, hi = fields[maxKey]?.value;
      const maxSpec = category.fields.find((spec) => spec.key === maxKey);
      const minDatum = fields[f.key]?.reference ?? (f.type === "length" ? f.reference : undefined);
      const maxDatum = fields[maxKey]?.reference ?? (maxSpec?.type === "length" ? maxSpec.reference : undefined);
      if (applies(f, fields) && typeof lo === "number" && typeof hi === "number") {
        if (!minDatum || minDatum === "other" || minDatum !== maxDatum) {
          warn(f.key, "range_datum_mismatch", `${f.key} and ${maxKey} cannot be ordered without a common named datum. Their sourced values are retained for human review; no conversion is inferred.`);
        } else if (lo > hi) {
          err(f.key, "range_reversed", `${f.label} exceeds ${maxKey}; check the published range.`);
        }
      }
    }
    if (category.id === "towel-rail") {
      const mode = fields.heating?.value, power = fields.power?.value;
      if ((mode === "electric" || mode === "dual") && power === "not-required") {
        err("power", "power_mode_conflict", "Electric or dual heating requires power for this exact variant.");
      }
      if ((mode === "unheated" || mode === "hydronic") && power === "required") {
        err("power", "power_mode_conflict", "Unheated or hydronic-only rails do not have electric heating; check the exact variant and heating mode.");
      }
    }
  }
  // a corner bath's outline must agree with the printed lengths along each wall
  if (category.id === "bath" && fields.shape?.value === "corner-round") {
    const L = fields.length?.value, W = fields.width?.value;
    const fw = fields.frontWidth?.value, fp = fields.frontProjection?.value;
    if (typeof fw === "number" && typeof fp === "number") {
      if (fp <= fw / 2 + 0.001) {
        err("frontProjection", "front_curves_inward", `The projection (${formatMm(fp)} mm) must reach past the middle of the front (${formatMm(fw / 2)} mm from the corner), or the front would curve inward. Check which dimension is which.`);
      } else {
        const e = outlineExtents(cornerBathOutline(fields, 10, 10, "left", true)!);
        if (e.minX < -5 - 0.0005 || e.minY < -5 - 0.0005) {
          err("frontProjection", "front_behind_corner", `A circular front through the ${formatMm(fw)} mm width and ${formatMm(fp)} mm projection swings behind the corner. Check the two dimensions.`);
        }
      }
    }
    if (typeof L === "number" && typeof W === "number" && Math.abs(L - W) > 0.005) {
      warn("shape", "corner_asymmetric", `Length and width differ (${formatMm(L)} × ${formatMm(W)} mm): an offset corner bath. Its outline needs each straight side, which the brief does not ask for yet, so it is placed as its box.`);
    }
    const o = typeof L === "number" && typeof W === "number" ? cornerBathOutline(fields, L, W, "left") : null;
    if (o && typeof L === "number" && typeof W === "number" && !out.some((p) => p.severity === "error" && p.field === "frontProjection")) {
      const e = outlineExtents(o);
      const along1 = e.maxX - e.minX, along2 = e.maxY - e.minY;
      if (Math.abs(along1 - L) > 0.005 || Math.abs(along2 - W) > 0.005) {
        warn("frontWidth", "outline_disagrees", `A circular front through the front width and projection reaches ${formatMm(along1)} × ${formatMm(along2)} mm along the walls, but the printed length and width are ${formatMm(L)} × ${formatMm(W)} mm. The front may not be a circular arc, or the printed sizes may include a rim. The plan uses the outline for shape and the larger of the two for clearance.`);
      }
    }
  }
  out.push(...validateIdentity(s, (sources) => checkSources(sources, ctx)));
  return out;
}

/**
 * The plan outline of a corner bath with two equal straight wall sides and a curved front,
 * in its own frame, square corner at the back-left (or back-right). The sides are the front
 * width over √2 (a right-angled corner); the front is the circular arc through both side ends
 * and the front-most point on the corner's bisector. Null when either measure is unknown.
 */
export function cornerBathOutline(fields: Record<string, FieldValue>, w: number, d: number, corner: "left" | "right", ignoreSizes = false): Outline | null {
  const fw = fields.frontWidth?.value, fp = fields.frontProjection?.value;
  if (typeof fw !== "number" || typeof fp !== "number" || fp <= fw / 2) return null;
  // equal straight sides only: an offset corner bath (length ≠ width) is left as its box
  const L = fields.length?.value, W = fields.width?.value;
  if (!ignoreSizes && typeof L === "number" && typeof W === "number" && Math.abs(L - W) > 0.005) return null;
  const side = fw / Math.SQRT2;
  const k = fp / Math.SQRT2;
  const sx = corner === "left" ? 1 : -1;
  const c = { x: (-w / 2) * sx, y: -d / 2 };
  const at = (along: number, out: number) => ({ x: quantize(c.x + sx * along), y: quantize(c.y + out) });
  return {
    start: at(0, 0),
    segments: [
      { to: at(side, 0) },
      { to: at(0, side), via: at(k, k) },
      { to: at(0, 0) },
    ],
  };
}

/** The envelope for a 3D block, only when all three are known. */
export function envelopeOf(category: ProductCategory, fields: Record<string, FieldValue>): { w: number; d: number; h: number } | null {
  const pick = (k: string) => {
    const fv = fields[k], spec = category.fields.find((f) => f.key === k);
    const ownDatum = k === category.envelope.w ? "fixture-end" : k === category.envelope.d ? "fixture-side" : "fixture-bottom";
    // A dimension from a different datum is not an envelope this path can express.
    if (spec?.type === "length" && fv?.reference && fv.reference !== spec.reference && !(fv.measurement && fv.reference === ownDatum)) return null;
    return typeof fv?.value === "number" && Number.isFinite(fv.value) && fv.value > 0 ? fv.value : null;
  };
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
  evidence?: FieldValue;
  maxEvidence?: FieldValue;
}

export interface RoughInPoint {
  id: string;
  label: string;
  service: "waste" | "water" | "power";
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
export function roughInPoints(category: ProductCategory, fields: Record<string, FieldValue>, human = false): RoughInPoint[] {
  const spec = (key: string) => category.fields.find((f) => f.key === key) as LengthField | undefined;
  const num = (key: string) => (typeof fields[key]?.value === "number" ? (fields[key].value as number) : undefined);
  const points: RoughInPoint[] = [];
  for (const r of category.roughIn) {
    if (r.when && !r.when.in.includes(String(fields[r.when.field]?.value))) continue;
    const missing: string[] = [];
    const axis = (a: AxisSpec | undefined, axisName: string): AxisValue | undefined => {
      if (!a) return undefined;
      if ("zeroAt" in a) {
        if (!human) return { from: a.zeroAt, value: 0 };
        const key = `service.${r.id}.${axisName}`, value = num(key);
        if (value === undefined) missing.push(key);
        return { from: fields[key]?.reference ?? a.zeroAt, field: key, ...(value !== undefined ? { value } : {}), ...(fields[key] ? { evidence: structuredClone(fields[key]) } : {}) };
      }
      if ("range" in a) {
        const [lo, hi] = a.range;
        const from = fields[lo]?.reference ?? spec(lo)?.reference ?? "other";
        const maxFrom = fields[hi]?.reference ?? spec(hi)?.reference ?? "other";
        if (from !== maxFrom) {
          missing.push(`${lo}..${hi}: different datums`);
          return { from, field: `${lo}..${hi}`, ...(fields[lo] ? { evidence: structuredClone(fields[lo]) } : {}), ...(fields[hi] ? { maxEvidence: structuredClone(fields[hi]) } : {}) };
        }
        const min = num(lo);
        const max = num(hi);
        if (min === undefined) missing.push(lo);
        if (max === undefined) missing.push(hi);
        return { from, field: `${lo}..${hi}`, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(fields[lo] ? { evidence: structuredClone(fields[lo]) } : {}), ...(fields[hi] ? { maxEvidence: structuredClone(fields[hi]) } : {}) };
      }
      const value = num(a.field);
      if (value === undefined) missing.push(a.field);
      return { from: fields[a.field]?.reference ?? spec(a.field)?.reference ?? "other", field: a.field, ...(value !== undefined ? { value } : {}), ...(fields[a.field] ? { evidence: structuredClone(fields[a.field]) } : {}) };
    };
    const across = axis(r.across, "across");
    const out = axis(r.out, "out");
    const up = axis(r.up, "up");
    points.push({ id: r.id, label: r.label, service: r.service, ...(across ? { across } : {}), ...(out ? { out } : {}), ...(up ? { up } : {}), resolved: missing.length === 0, missing });
  }
  return points;
}
