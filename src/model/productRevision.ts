/** Catalogue revisions are application history, never manufacturer revision claims. */
import { identityOf, type ExactProduct } from "./productIdentity";
import type { LibraryProduct } from "./productLibrary";
import type { SpecSubmission } from "./products";
import type { PlanModel } from "./types";

export interface ProductRevision {
  seriesId: string;
  number: number;
  parentProductId?: string;
}

export function revisionOf(product: LibraryProduct): ProductRevision {
  return product.revision ?? { seriesId: product.id, number: 1 };
}

export function validProductRevision(value: unknown): value is ProductRevision {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as ProductRevision;
  return (
    typeof v.seriesId === "string" &&
    !!v.seriesId &&
    Number.isInteger(v.number) &&
    v.number > 0 &&
    (v.parentProductId === undefined || typeof v.parentProductId === "string")
  );
}

/** Corrections to evidence are allowed; a different exact variant needs its own product. */
export function revisionVariantProblems(
  before: LibraryProduct,
  after: SpecSubmission,
): string[] {
  const out: string[] = [];
  if (before.manufacturer.trim() !== after.manufacturer.trim())
    out.push("manufacturer");
  if (before.model.trim() !== after.model.trim()) out.push("model");
  const a = identityOf(before),
    b = identityOf(after);
  const codeA = a.code.state === "known" ? a.code.value : before.code;
  const codeB = b.code.state === "known" ? b.code.value : after.code;
  if (codeA !== codeB) out.push("code");
  for (const key of Object.keys(a) as (keyof typeof a)[]) {
    if (a[key].state !== b[key].state || a[key].value !== b[key].value)
      out.push(`identity.${key}`);
  }
  return out;
}

function evidence(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(evidence).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${evidence(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export interface RevisionDifference {
  key: string;
  before: unknown;
  after: unknown;
}
/** Full field records include provenance, datums, alternatives and future measurement evidence. */
export function revisionDifferences(
  before: LibraryProduct,
  after: SpecSubmission,
): RevisionDifference[] {
  const rows: RevisionDifference[] = [];
  const add = (key: string, a: unknown, b: unknown) => {
    if (evidence(a) !== evidence(b)) rows.push({ key, before: a, after: b });
  };
  for (const key of ["manufacturer", "model", "code"] as const)
    add(key, before[key], after[key]);
  for (const key of new Set([
    ...Object.keys(before.fields),
    ...Object.keys(after.fields),
  ]))
    add(`fields.${key}`, before.fields[key], after.fields[key]);
  const a = identityOf(before),
    b = identityOf(after);
  for (const key of Object.keys(a) as (keyof typeof a)[])
    add(`identity.${key}`, a[key], b[key]);
  add("components", before.components ?? [], after.components ?? []);
  add(
    "componentsStatus",
    before.componentsStatus ?? "unknown",
    after.componentsStatus ?? "unknown",
  );
  for (const key of ["installationGeometry", "physicalItem", "recordingMode"])
    add(
      key,
      (before as unknown as Record<string, unknown>)[key],
      (after as unknown as Record<string, unknown>)[key],
    );
  return rows;
}

/** A fingerprint for preview freshness; includes geometry, anchors and per-axis evidence. */
export function evidenceFingerprint(value: unknown): string {
  return evidence(value);
}

/** Historical issuance records do not make current planning evidence different by themselves. */
export function planningEvidence(model: PlanModel): string {
  return evidenceFingerprint({
    ...model,
    sheetSet: model.sheetSet
      ? { titleBlock: model.sheetSet.titleBlock }
      : undefined,
  });
}
