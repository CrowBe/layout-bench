/** Exact variant evidence (#47). Absent legacy values stay explicitly unknown. */
import type { SourceRef, SpecProblem } from "./products";
import { isPhysicalItem, type PhysicalItem } from "./productMeasurements";

export const IDENTITY_FIELDS = { code: "Product code", finish: "Finish", configuration: "Size / configuration", handedness: "Handedness" } as const;
export type IdentityKey = keyof typeof IDENTITY_FIELDS;
export interface IdentityValue {
  state: "known" | "unknown" | "not-applicable";
  value: string | null;
  sources?: SourceRef[];
  note?: string;
  alternatives?: { value: string; source: SourceRef }[];
}
export type ProductIdentity = Record<IdentityKey, IdentityValue>;
export interface ProductComponent {
  name: string;
  code: IdentityValue;
  quantity: number | null;
  provision: "included" | "separately-required" | "unresolved";
  sources?: SourceRef[];
  note?: string;
}
export interface ExactProduct {
  manufacturer: string;
  model: string;
  code?: string;
  identity?: ProductIdentity;
  components?: ProductComponent[];
  componentsStatus?: "documented" | "unknown" | "not-applicable";
  physicalItem?: PhysicalItem;
}
export type SelectionStatus = "unknown" | "proposed" | "purchased" | "reused";
export const SELECTION_STATUSES: SelectionStatus[] = ["unknown", "proposed", "purchased", "reused"];
export const unknownIdentity = (): ProductIdentity => Object.fromEntries(Object.keys(IDENTITY_FIELDS).map(k => [k, { state: "unknown", value: null }])) as ProductIdentity;
export const identityOf = (p: Pick<ExactProduct, "identity">): ProductIdentity => ({ ...unknownIdentity(), ...p.identity });
/**
 * Identity with the entered top-level `code` standing in for an unknown identity code, so a sheet
 * prints the code written on the record (a carton or label code) instead of "unknown". `entered`
 * names the keys taken that way: they are entered, not sourced.
 */
export const identityWithCode = (p: Pick<ExactProduct, "identity" | "code">): { identity: ProductIdentity; entered: IdentityKey[] } => {
  const identity = identityOf(p);
  const code = p.code?.trim();
  if (identity.code.state !== "unknown" || !code) return { identity, entered: [] };
  return { identity: { ...identity, code: { state: "known", value: code } }, entered: ["code"] };
};
export const identityText = (v: IdentityValue): string => v.state === "known" ? v.value ?? "unknown" : v.state;
export const exactProductLabel = (p: ExactProduct): string => {
  const identity = identityOf(p);
  return [p.physicalItem?.label ?? [p.manufacturer, p.model].filter(Boolean).join(" "), ...Object.values(identity).filter(v => v.state === "known").map(identityText)].filter(Boolean).join(" · ");
};
export const exactSnapshot = (p: ExactProduct): ExactProduct => structuredClone({ manufacturer: p.manufacturer, model: p.model, ...(p.code ? { code: p.code } : {}), ...(p.physicalItem ? { physicalItem: p.physicalItem } : {}), identity: identityOf(p), components: p.components ?? [], componentsStatus: p.componentsStatus ?? "unknown" });
export function identityReviewKeys(p: ExactProduct): string[] {
  return [...(p.identity ? Object.keys(IDENTITY_FIELDS).map(k => `identity.${k}`) : []), ...(p.componentsStatus !== undefined || p.components !== undefined ? ["components"] : [])];
}

/** Sources use the same URL/attachment/page rules as dimensional evidence. */
export function validateIdentity(p: ExactProduct, checkSources: (s: unknown[]) => string | null): SpecProblem[] {
  const problems: SpecProblem[] = [];
  const add = (field: string, severity: "warning" | "error", code: string, message: string) => problems.push({ field, severity, code, message });
  const value = (field: string, raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { add(field, "error", "identity_invalid", `${field}: use a known, unknown or not-applicable evidence object.`); return; }
    const v = raw as IdentityValue;
    if (!["known", "unknown", "not-applicable"].includes(v.state) || (v.state === "known" ? typeof v.value !== "string" || !v.value.trim() : v.value !== null)) {
      add(field, "error", "identity_invalid", `${field}: known needs exact text; unknown/not-applicable needs value null.`); return;
    }
    if (v.note !== undefined && typeof v.note !== "string") add(field, "error", "identity_invalid", `${field}: note must be text.`);
    if (v.sources !== undefined && !Array.isArray(v.sources)) add(field, "error", "identity_source_invalid", `${field}: sources must be a list.`);
    if (v.state !== "unknown" || Array.isArray(v.sources) && v.sources.length) {
      const bad = checkSources(Array.isArray(v.sources) ? v.sources : []);
      if (bad) add(field, "error", "identity_source_invalid", `${field}: ${bad}`);
    }
    if (v.alternatives !== undefined && !Array.isArray(v.alternatives)) add(field, "error", "identity_invalid", `${field}: alternatives must be a list.`);
    for (const alt of Array.isArray(v.alternatives) ? v.alternatives : []) {
      const bad = !alt || typeof alt.value !== "string" || !alt.value.trim() ? "alternative needs exact text" : checkSources([alt.source]);
      if (bad) add(field, "error", "identity_alternative_invalid", `${field}: ${bad}`);
      else if (alt.value !== v.value) add(field, "warning", "identity_conflict", `${field}: ${alt.source.url} (${alt.source.locator}) gives ${alt.value}, conflicting with ${identityText(v)}.`);
    }
  };
  if (p.identity !== undefined) {
    if (!p.identity || typeof p.identity !== "object" || Array.isArray(p.identity)) add("identity", "error", "identity_invalid", "identity must be an object.");
    else {
      for (const k of Object.keys(p.identity)) if (!(k in IDENTITY_FIELDS)) add(`identity.${k}`, "error", "identity_invalid", `Unknown identity field ${k}.`);
      for (const k of Object.keys(IDENTITY_FIELDS) as IdentityKey[]) if (p.identity[k] !== undefined) value(`identity.${k}`, p.identity[k]);
      if (p.identity.handedness?.state === "known" && !["left", "right", "reversible", "non-handed"].includes(p.identity.handedness.value ?? "")) add("identity.handedness", "error", "identity_invalid", "Handedness must be left, right, reversible or non-handed when documented. Leave it unknown if the source does not establish one.");
      if (typeof p.code === "string" && p.code && p.identity.code?.state === "known" && p.code.trim() !== p.identity.code.value?.trim()) add("identity.code", "warning", "identity_conflict", `Product code ${p.code} conflicts with identity code ${p.identity.code.value}.`);
    }
  }
  if (p.componentsStatus !== undefined && !["documented", "unknown", "not-applicable"].includes(p.componentsStatus)) add("components", "error", "components_invalid", "Use documented, unknown or not-applicable component status.");
  if (p.components !== undefined && !Array.isArray(p.components)) add("components", "error", "components_invalid", "components must be a list.");
  const components = Array.isArray(p.components) ? p.components : [];
  if (components.length && p.componentsStatus !== "documented") add("components", "error", "components_invalid", "A component list needs componentsStatus documented.");
  if (p.componentsStatus === "documented" && !components.length) add("components", "error", "components_invalid", "Documented components needs a non-empty list; use not-applicable when none are required.");
  components.forEach((c, i) => {
    if (!c || typeof c !== "object") { add("components", "error", "components_invalid", `Component ${i + 1} must be an object.`); return; }
    const prefix = `Component ${i + 1}`;
    if (c.note !== undefined && typeof c.note !== "string") add("components", "error", "components_invalid", `${prefix}: note must be text.`);
    if (c.sources !== undefined && !Array.isArray(c.sources)) add("components", "error", "components_invalid", `${prefix}: sources must be a list.`);
    if (typeof c.name !== "string" || !c.name.trim() || !["included", "separately-required", "unresolved"].includes(c.provision) || !(c.quantity === null || Number.isInteger(c.quantity) && c.quantity > 0)) add("components", "error", "components_invalid", `${prefix}: name, positive whole quantity (or null) and included/separately-required/unresolved provision are required.`);
    value("components", c.code);
    if (c.quantity !== null || c.provision !== "unresolved" || Array.isArray(c.sources) && c.sources.length) {
      const bad = checkSources(Array.isArray(c.sources) ? c.sources : []);
      if (bad) add("components", "error", "component_source_invalid", `${prefix}: ${bad}`);
    }
  });
  return problems;
}

/** Structural check for persisted identity snapshots; attachment bytes live separately. */
export function isExactProduct(value: unknown): value is ExactProduct {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as ExactProduct;
  if (typeof p.manufacturer !== "string" || typeof p.model !== "string" || (p.code !== undefined && typeof p.code !== "string")) return false;
  if (p.physicalItem !== undefined && !isPhysicalItem(p.physicalItem)) return false;
  return !validateIdentity(p, sources => {
    if (!sources.length) return "Missing source.";
    return sources.every(s => {
      if (!s || typeof s !== "object") return false;
      const ref = s as SourceRef;
      if (typeof ref.url !== "string" || typeof ref.locator !== "string" || !ref.locator.trim()) return false;
      if (/^attachment:\S+$/.test(ref.url)) return true;
      try { return ["http:", "https:"].includes(new URL(ref.url).protocol); } catch { return false; }
    }) ? null : "Invalid source.";
  }).some(p => p.severity === "error");
}
