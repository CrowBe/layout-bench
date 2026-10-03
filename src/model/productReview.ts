/** Human review of the current evidence, never automatic product acceptance. */
import {
  identityOf,
  identityReviewKeys,
  type IdentityKey,
} from "./productIdentity";
import { applies, categoryById, type FieldGroup } from "./products";
import {
  productReviewWarnings,
  type FieldReview,
  type ProductRequest,
} from "./productLibrary";

export const REVIEW_GROUPS: FieldGroup[] = [
  "envelope",
  "rough-in",
  "installation",
];

/** Stable evidence text survives JSON reload; source order remains significant. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function requiredReviewKeys(request: ProductRequest): string[] {
  const s = request.submission;
  if (!s) return [];
  const flagged = productReviewWarnings(request).flatMap((w) =>
    w.field === "components" || w.field?.startsWith("identity.")
      ? [w.field]
      : [],
  );
  return [
    ...new Set([
      ...Object.keys(s.fields),
      ...(s.installationGeometry ? ["installationGeometry"] : []),
      ...identityReviewKeys(s),
      ...flagged,
    ]),
  ];
}

export function reviewEvidence(request: ProductRequest, key: string): string {
  const s = request.submission;
  if (!s) return "";
  const spec = categoryById(request.category)?.fields.find(
    (f) => f.key === key,
  );
  const evidence =
    key === "installationGeometry"
      ? s.installationGeometry
      : key === "components"
      ? { status: s.componentsStatus, components: s.components }
      : key.startsWith("identity.")
        ? identityOf(s)[key.slice(9) as IdentityKey]
        : s.fields[key];
  return stable({
    category: request.category,
    manufacturer: s.manufacturer,
    model: s.model,
    code: s.code,
    identity: identityOf(s),
    key,
    evidence,
    // The outline and point datums are interpreted against this envelope.
    ...(key === "installationGeometry" ? { envelope: { width: s.fields.width, depth: s.fields.depth, height: s.fields.height } } : {}),
    requestedEvidence:
      key === "components"
        ? {
            status: request.known.componentsStatus,
            components: request.known.components,
          }
        : key.startsWith("identity.")
          ? request.known.identity?.[key.slice(9) as IdentityKey]
          : undefined,
    applicable: spec ? applies(spec, s.fields) : true,
    condition: spec?.when ? s.fields[spec.when.field] : undefined,
    definition: spec,
    flags: productReviewWarnings(request).filter(
      (w) => w.field === key || w.field === null,
    ),
  });
}

/** Shared by research and human measurement revisions; no decision is automatically reused. */
export function prepareReviewRevision(
  previous: ProductRequest,
  next: ProductRequest,
) {
  const reviews: Record<string, FieldReview> = {};
  const reuseCandidates: Record<string, FieldReview> = {};
  const individualOnly = [
    ...new Set([
      ...(previous.individualOnly ?? []),
      ...Object.keys(previous.reviews).filter(
        (k) => previous.reviews[k].decision === "rejected",
      ),
    ]),
  ];
  const previousRejections = { ...previous.previousRejections };
  for (const [key, review] of Object.entries(previous.reviews))
    if (review.decision === "rejected" && review.reason)
      previousRejections[key] = review.reason;
  if (previous.submission)
    for (const key of requiredReviewKeys(next)) {
      const prior =
        currentReview(previous, key) ?? previous.reuseCandidates?.[key];
      if (!prior) continue;
      const oldEvidence =
        prior.evidence ??
        reviewEvidence({ ...previous, status: "submitted" }, key);
      if (oldEvidence !== reviewEvidence(next, key)) continue;
      const bound = { ...prior, evidence: oldEvidence };
      if (prior.decision === "rejected") reviews[key] = bound;
      else reuseCandidates[key] = bound;
    }
  return { reviews, reuseCandidates, individualOnly, previousRejections };
}

/** Legacy decisions remain readable until a revision changes their evidence. */
export function currentReview(
  request: ProductRequest,
  key: string,
): FieldReview | undefined {
  const review = request.reviews[key];
  if (request.status === "accepted") return review;
  return review &&
    (!review.evidence || review.evidence === reviewEvidence(request, key))
    ? review
    : undefined;
}

export function productReviewSummary(request: ProductRequest) {
  const s = request.submission;
  const flags = productReviewWarnings(request);
  const cat = categoryById(request.category);
  const fields = (cat?.fields ?? []).map((f) => {
    const v = s?.fields[f.key];
    const applicable = applies(f, s?.fields ?? {});
    const known =
      v?.value !== undefined &&
      v.value !== null &&
      !!v.status &&
      !["unknown", "not-applicable"].includes(v.status);
    const review = currentReview(request, f.key);
    const warnings = flags.filter((w) => w.field === f.key || w.field === null);
    return {
      key: f.key,
      label: f.label,
      group: f.group,
      required: f.required,
      applicable,
      submitted: !!v,
      known,
      review: review?.decision ?? "pending",
      reason: review?.reason,
      previousRejection: request.previousRejections?.[f.key],
      warnings,
      eligible:
        request.status === "submitted" &&
        !!v &&
        applicable &&
        known &&
        !warnings.length &&
        !review &&
        !request.individualOnly?.includes(f.key),
      reuseEligible:
        request.status === "submitted" &&
        !review &&
        request.reuseCandidates?.[f.key]?.decision === "accepted" &&
        request.reuseCandidates[f.key].evidence ===
          reviewEvidence(request, f.key),
    };
  });
  const keys = requiredReviewKeys(request);
  const pending = keys.filter((k) => !currentReview(request, k));
  const rejected = keys.filter(
    (k) => currentReview(request, k)?.decision === "rejected",
  );
  const reuse = keys.filter(
    (k) =>
      !currentReview(request, k) &&
      request.reuseCandidates?.[k]?.decision === "accepted" &&
      request.reuseCandidates[k].evidence === reviewEvidence(request, k),
  );
  return {
    fields,
    flags,
    pending,
    rejected,
    reuse,
    applicableRequired: fields
      .filter((f) => f.applicable && f.required)
      .map((f) => f.key),
    unknownRequired: fields
      .filter((f) => f.applicable && f.required && !f.known)
      .map((f) => f.key),
    conflicts: flags.filter((w) =>
      [
        "sources_disagree",
        "identity_conflict",
        "evidence_disagreement",
      ].includes(w.code),
    ),
    datumMismatches: flags.filter((w) =>
      ["reference_mismatch", "range_datum_mismatch"].includes(w.code),
    ),
    groups: REVIEW_GROUPS.map((group) => ({
      group,
      eligible: fields
        .filter((f) => f.group === group && f.eligible)
        .map((f) => f.key),
    })),
  };
}
