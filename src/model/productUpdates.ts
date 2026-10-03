/** Read-only revision projection. Applying this projection is a separate human action. */
import { catalogByKind, catalogForItem, type CatalogEntry } from "./catalog";
import { applyAnchors, anchorPose, roughIn } from "./fixtures";
import { checkModel } from "./issues";
import { exactSnapshot } from "./productIdentity";
import type { LibraryProduct } from "./productLibrary";
import { productPlacement } from "./productPlacement";
import { evidenceFingerprint, revisionOf } from "./productRevision";
import type { FieldValue } from "./products";
import type { InstallationGeometry, LocalService } from "./installation";
import type { Item, PlanModel, ServicePoint } from "./types";

type Axis = "across" | "out" | "outMax" | "up";
type EvidencedPoint = ServicePoint & {
  axisEvidence?: Partial<Record<Axis, FieldValue>>;
};
const confirmed = (status?: string) =>
  status === "measured" || status === "site-confirmed";

function preserveServices(
  before: ServicePoint[],
  proposed: ServicePoint[],
  source: ServicePoint[],
) {
  const preserved: string[] = [],
    unresolved: string[] = [];
  const points = proposed.map((p) => structuredClone(p) as EvidencedPoint);
  for (const prior of before as EvidencedPoint[]) {
    const copied = source.find((p) => p.id === prior.id) as
      | EvidencedPoint
      | undefined;
    const index = points.findIndex((p) => p.id === prior.id);
    const next = index < 0 ? undefined : points[index];
    // Legacy confirmations cover the whole point; retain even explicitly unknown axes.
    if (!prior.axisEvidence && confirmed(prior.status)) {
      preserved.push(`${prior.id}: entire ${prior.status} project connection`);
      if (evidenceFingerprint(prior) !== evidenceFingerprint(next))
        unresolved.push(
          `${prior.id}: catalogue connection differs; retained the project confirmation for individual reconciliation.`,
        );
      if (index < 0) points.push(structuredClone(prior));
      else points[index] = structuredClone(prior);
      continue;
    }
    const axes = (["across", "out", "outMax", "up"] as Axis[]).filter(
      (axis) =>
        confirmed(prior.axisEvidence?.[axis]?.status) &&
        (evidenceFingerprint(prior.axisEvidence?.[axis]) !==
          evidenceFingerprint(copied?.axisEvidence?.[axis]) ||
          prior[axis] !== copied?.[axis] ||
          (axis.startsWith("out") && prior.face !== copied?.face)),
    );
    if (!axes.length) continue;
    const retained = next ?? { ...structuredClone(prior), axisEvidence: {} };
    retained.axisEvidence = { ...retained.axisEvidence };
    for (const axis of axes) {
      preserved.push(
        `${prior.id}.${axis}: site-edited ${prior.axisEvidence![axis]!.status} axis, differs from pinned catalogue evidence`,
      );
      if (
        prior[axis] !== next?.[axis] ||
        (axis.startsWith("out") && prior.face !== next?.face)
      )
        unresolved.push(
          `${prior.id}.${axis}: new catalogue evidence differs; retained original project coordinate and datum.`,
        );
      if (prior[axis] === undefined) delete retained[axis];
      else retained[axis] = prior[axis];
      retained.axisEvidence[axis] = structuredClone(prior.axisEvidence![axis]);
      if (axis.startsWith("out")) {
        retained.face = prior.face;
        // A range shares its wall datum: never mix endpoints from two faces.
        if (next && next.face !== prior.face) {
          retained.out = prior.out;
          retained.outMax = prior.outMax;
          if (prior.axisEvidence?.out)
            retained.axisEvidence.out = structuredClone(prior.axisEvidence.out);
          if (prior.axisEvidence?.outMax)
            retained.axisEvidence.outMax = structuredClone(
              prior.axisEvidence.outMax,
            );
        }
      }
    }
    retained.source = [
      next?.source,
      `Preserved project evidence: ${prior.source ?? prior.id}`,
    ]
      .filter(Boolean)
      .join("; ");
    // Keep the weakest participating status, without turning a proposed axis into confirmed.
    const order = [
      "estimated",
      "proposed",
      "published",
      "measured",
      "site-confirmed",
    ];
    retained.status =
      Object.values(retained.axisEvidence)
        .filter((v) => v?.value !== null)
        .map((v) => v!.status!)
        .filter(Boolean)
        .sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] ?? prior.status;
    if (index < 0) points.push(retained);
    else points[index] = retained;
  }
  return { points, preserved, unresolved };
}

function preserveLocalServices(
  before: InstallationGeometry | undefined,
  proposed: InstallationGeometry | undefined,
  source: InstallationGeometry | undefined,
) {
  if (!before)
    return {
      geometry: proposed,
      preserved: [] as string[],
      unresolved: [] as string[],
    };
  const convert = (p: LocalService): ServicePoint => ({
    id: p.id,
    label: p.label,
    service: p.service,
    face: "fixture-back",
    across: p.x ?? undefined,
    out: p.y ?? undefined,
    up: p.z ?? undefined,
    status: p.status,
    source: p.sources.map((s) => `${s.url} (${s.locator})`).join("; "),
    axisEvidence: p.axisEvidence,
  });
  // An unchanged copied measured point is product evidence, not a later site override.
  const edited = (before.services ?? []).filter(
    (p) =>
      evidenceFingerprint(p) !==
      evidenceFingerprint(source?.services?.find((s) => s.id === p.id)),
  );
  const result = preserveServices(
    edited.map(convert),
    (proposed?.services ?? []).map(convert),
    (source?.services ?? []).map(convert),
  );
  const services = result.points.map((p) => {
    const original = before.services?.find((s) => s.id === p.id),
      next = proposed?.services?.find((s) => s.id === p.id);
    return {
      ...(next ?? original!),
      id: p.id,
      label: p.label,
      service: p.service,
      x: p.across ?? null,
      y: p.out ?? null,
      z: p.up ?? null,
      status: p.status,
      axisEvidence: p.axisEvidence,
      sources: [...(next?.sources ?? []), ...(original?.sources ?? [])],
    };
  });
  const geometry = proposed
    ? { ...structuredClone(proposed), services }
    : services.length
      ? { ...structuredClone(before), services }
      : undefined;
  return {
    geometry,
    preserved: result.preserved.map((s) => `Local service ${s}`),
    unresolved: result.unresolved.map((s) => `Local service ${s}`),
  };
}

export interface InstanceUpdate {
  id: string;
  before: Item;
  after?: Item;
  geometryBefore?: CatalogEntry;
  geometryAfter?: CatalogEntry;
  preserved: string[];
  unresolved: string[];
  blocked?: string;
}

export function previewProductUpdate(
  model: PlanModel,
  target: LibraryProduct,
  selected: string[],
  library: LibraryProduct[],
) {
  const entries: CatalogEntry[] = [],
    rows: InstanceUpdate[] = [];
  const ids = [...new Set(selected)];
  for (const id of ids) {
    const item = model.items.find((i) => i.id === id);
    if (!item) continue;
    const current =
      item.productSnapshot ?? library.find((p) => p.id === item.productId);
    const row: InstanceUpdate = {
      id,
      before: structuredClone(item),
      geometryBefore: structuredClone(catalogForItem(item)),
      preserved: [],
      unresolved: [],
    };
    rows.push(row);
    if (
      !current ||
      revisionOf(current).seriesId !== revisionOf(target).seriesId ||
      revisionOf(current).number >= revisionOf(target).number
    ) {
      row.blocked =
        "This instance is not pinned to an earlier revision of this exact product.";
      continue;
    }
    const wall =
      item.anchor && model.walls.find((w) => w.id === item.anchor!.wallId);
    if (!item.anchor || !wall) {
      row.blocked =
        "Original wall anchor is unresolved; establish it explicitly before updating.";
      continue;
    }
    const placement = productPlacement(
      target,
      item.anchor,
      wall,
      item.installation,
    );
    if (!placement.ok) {
      row.blocked = placement.summary;
      continue;
    }
    entries.push(placement.entry, ...placement.additionalEntries);
    const original = productPlacement(
      current,
      item.anchor,
      wall,
      item.installation,
    );
    if (
      original.ok &&
      row.geometryBefore &&
      ["w", "d", "h", "outline"].some(
        (key) =>
          evidenceFingerprint(
            row.geometryBefore![key as keyof CatalogEntry],
          ) !== evidenceFingerprint(original.entry[key as keyof CatalogEntry]),
      )
    ) {
      row.blocked =
        "The placed geometry differs from its pinned product evidence. Reconcile that instance override individually before applying a catalogue revision.";
      continue;
    }
    const services = preserveServices(
      item.servicePoints ?? [],
      placement.servicePoints,
      original.ok ? original.servicePoints : [],
    );
    const local = preserveLocalServices(
      item.installationGeometry,
      placement.installationGeometry,
      original.ok ? original.installationGeometry : undefined,
    );
    row.preserved = [...services.preserved, ...local.preserved];
    row.unresolved = [...services.unresolved, ...local.unresolved];
    row.geometryAfter = structuredClone(placement.entry);
    row.after = {
      ...structuredClone(item),
      kind: placement.entry.kind,
      productId: target.id,
      productIdentity: exactSnapshot(target),
      productSnapshot: structuredClone(target),
      productGeometry: structuredClone(placement.entry),
      productSpecification: structuredClone({
        category: target.category,
        fields: target.fields,
        recordingMode: target.recordingMode,
        acceptedAt: target.acceptedAt,
      }),
      servicePoints: services.points,
      installationGeometry: local.geometry
        ? structuredClone(local.geometry)
        : undefined,
      corner: placement.corner,
    };
  }
  const lookup = (kind: string) =>
    entries.find((e) => e.kind === kind) ?? catalogByKind(kind);
  const projected = applyAnchors(
    {
      ...structuredClone(model),
      items: model.items.map(
        (item) =>
          rows.find((row) => row.id === item.id)?.after ??
          structuredClone(item),
      ),
    },
    lookup,
  );
  for (const row of rows)
    if (row.after) {
      row.after = projected.items.find((item) => item.id === row.id)!;
      const pose = anchorPose(projected, row.after, lookup);
      if (!pose.resolved)
        row.unresolved.push(
          `Original anchor remains unresolved: ${pose.missing.join(", ")}`,
        );
      for (const point of roughIn(projected, row.after, lookup))
        if (!point.resolved)
          row.unresolved.push(`${point.label}: ${point.missing.join(", ")}`);
    }
  const issues = checkModel(projected, lookup).filter((issue) =>
    issue.refs.some((ref) => ids.includes(ref)),
  );
  return {
    targetId: target.id,
    selected: ids,
    rows,
    entries,
    model: projected,
    issues,
    fingerprint: evidenceFingerprint({ model, target, selected: ids }),
    applicable:
      ids.length > 0 &&
      rows.length === ids.length &&
      rows.every((row) => row.after && !row.blocked),
  };
}
export type ProductUpdatePreview = ReturnType<typeof previewProductUpdate>;
