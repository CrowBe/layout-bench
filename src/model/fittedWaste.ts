/**
 * Fitted waste vs its host (#75). Positions are compared in the host's own frame (across the
 * centreline, left negative facing the host; out from the host's back edge). A corner-bath
 * sheet that gives the waste from the right-angle corner along the bisector is converted
 * (along each wall = distance / √2) and the host-frame result is derived, never published.
 * Outlet sizes are compared only when both are known and like-for-like: a waste hole is not a
 * pipe outlet or connection. Unknown point or size means no comparison and no invented figure.
 * This is a modelling/set-out check; it does not certify drainage or plumbing.
 */

import type { FixtureAnchor, Issue, Item, PlanModel, ServicePoint, ValueStatus, Wall } from "./types";
import { catalogByKind, catalogForItem, type CatalogLookup } from "./catalog";
import { formatMm, quantize, segLen } from "./geometry";
import { sideNormal } from "./faces";
import { cornerBisectorToHostFrame, type FieldValue } from "./products";
import { identityOf } from "./productIdentity";
import { evidenceFingerprint } from "./productRevision";

export { cornerBisectorToHostFrame };

/**
 * Modelling/set-out check: a fitted waste whose centre is farther than this from the host's
 * recorded waste centre, in the host's own frame, is flagged for review. 50 mm is this named
 * modelling tolerance, not a manufacturer figure and not a plumbing-code requirement.
 */
export const FITTED_WASTE_OFFSET_TOLERANCE_M = 0.05;

/** Float comparison for like-for-like diameters (0.5 mm). Not a product or plumbing tolerance. */
export const FITTED_WASTE_SIZE_EPSILON_M = 0.0005;

export const DIAMETER_KINDS = ["hole", "outlet", "connection", "thread"] as const;
export type DiameterKind = (typeof DIAMETER_KINDS)[number];
/** `thread` stays so an accessory can name it; no brief records wasteThreadDiameter yet, so hostWasteDiameter("thread") stays unknown and the size check stays silent. */

/** Pipe sizes that may be compared with each other. A hole or thread is not the same kind. */
const PIPE_SIZE_KINDS: ReadonlySet<DiameterKind> = new Set(["outlet", "connection"]);

export function diametersAreLikeForLike(a: DiameterKind, b: DiameterKind): boolean {
  return a === b || (PIPE_SIZE_KINDS.has(a) && PIPE_SIZE_KINDS.has(b));
}

export const isDiameterKind = (v: unknown): v is DiameterKind =>
  typeof v === "string" && (DIAMETER_KINDS as readonly string[]).includes(v);

export const cornerFromOutlineStart = (start: { x: number } | undefined): "left" | "right" | undefined => {
  if (!start) return undefined;
  return start.x < 0 ? "left" : "right";
};

/** Same rotation as fixtures.facingRotation, kept here so this module does not import fixtures. */
const facingRotationDeg = (n: { x: number; y: number }): number => {
  const deg = (Math.atan2(n.x, n.y) * 180) / Math.PI;
  return quantize(((deg % 360) + 360) % 360);
};

/** Which back corner of a placed corner bath is square: the end of the wall it sits nearer. */
export function productCornerSide(anchor: FixtureAnchor, wall: Wall): "left" | "right" {
  const length = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  const along = anchor.from === "b" ? length - anchor.distance : anchor.distance;
  const normal = sideNormal(wall, anchor.side);
  const rotation = (-facingRotationDeg(normal) * Math.PI) / 180;
  const towardB =
    Math.cos(rotation) * (wall.bx - wall.ax) + Math.sin(rotation) * (wall.by - wall.ay) > 0;
  return along <= length - along === towardB ? "left" : "right";
}

export interface HostWasteInput {
  fields: Record<string, FieldValue>;
  boxW: number;
  outlineStart?: { x: number };
  storedCorner?: "left" | "right";
  anchor?: FixtureAnchor;
  wall?: Wall;
}

/** Outline start, else the live wall set-out, else the item's stored corner. */
export function resolveWasteCorner(input: HostWasteInput): "left" | "right" | undefined {
  return cornerFromOutlineStart(input.outlineStart)
    ?? (input.anchor && input.wall ? productCornerSide(input.anchor, input.wall) : undefined)
    ?? input.storedCorner;
}

/** Stored right-angle disagrees with the live nearer end; do not invent a bisector conversion. */
export function cornerHandDisagrees(input: HostWasteInput): boolean {
  if (!input.storedCorner || !input.anchor || !input.wall) return false;
  return productCornerSide(input.anchor, input.wall) !== input.storedCorner;
}

export type CornerHandChange = { ok: true; item: Item } | { ok: false; summary: string };
export type CornerHandBlock = { blocked: false } | { blocked: true; summary: string; remediation: string };

const isDerivedPoint = (p: ServicePoint) => p.status === "derived" || p.basis === "derived";
const confirmedStatus = (status?: string) => status === "measured" || status === "site-confirmed";

/** Same preconditions as applyCornerHandChange / anchorFixture; used for the review warning too. */
export function cornerHandChangeBlock(
  item: Item,
  ctx: { sourcePlacement?: { ok: true; servicePoints: ServicePoint[] } | { ok: false } } = {},
): CornerHandBlock {
  const hand = item.productIdentity ? identityOf(item.productIdentity).handedness : undefined;
  if (hand?.state === "known" && ["left", "right"].includes(hand.value ?? "")) {
    return {
      blocked: true,
      summary: `This exact product is ${hand.value}-handed; choose a separate documented variant for the other corner.`,
      remediation: `check the product's ${hand.value} hand; choose a separate documented variant for the other corner rather than re-anchoring this fixture`,
    };
  }
  const copiedOf = (id: string) => (ctx.sourcePlacement?.ok ? ctx.sourcePlacement.servicePoints.find((p) => p.id === id) : undefined);
  const conflict = (item.servicePoints ?? []).find((point) => {
    if (point.across === undefined || point.across === 0) return false;
    const copied = copiedOf(point.id);
    return (!point.axisEvidence && confirmedStatus(point.status) && evidenceFingerprint(point) !== evidenceFingerprint(copied)) ||
      (confirmedStatus(point.axisEvidence?.across?.status) && (point.across !== copied?.across || evidenceFingerprint(point.axisEvidence?.across) !== evidenceFingerprint(copied?.axisEvidence?.across)));
  });
  if (conflict) {
    return {
      blocked: true,
      summary: `Changing corner hand would reflect the measured/site-confirmed project axis on ${conflict.id}. Reconcile that instance connection individually; its coordinate, evidence and anchor remain unchanged.`,
      remediation: `re-measure the site datum on ${conflict.id}; a sourced measured or site-confirmed across is not mirrored by re-anchoring`,
    };
  }
  if (item.installationGeometry) {
    return {
      blocked: true,
      summary: "Changing corner hand with sourced installation geometry needs an explicit reflection review; its source coordinates and pinned shape remain unchanged.",
      remediation: "review the sourced installation geometry; its source coordinates and pinned shape stay unchanged",
    };
  }
  return { blocked: false };
}

/**
 * Guarded corner-hand update used by re-anchoring. Same preconditions as anchorFixture:
 * known left/right handedness, a sourced measured/site-confirmed across, and sourced
 * installationGeometry all refuse. Derived host-frame axes are recomputed through the
 * shared resolver, never by negation.
 */
export function applyCornerHandChange(
  item: Item,
  side: "left" | "right",
  ctx: {
    wall: Wall;
    sourcePlacement?: { ok: true; servicePoints: ServicePoint[] } | { ok: false };
  },
): CornerHandChange {
  if (!item.corner) return { ok: true, item };
  const block = cornerHandChangeBlock(item, ctx);
  if (block.blocked) return { ok: false, summary: block.summary };
  const mirrorPoint = (point: { x: number; y: number }) => ({ x: -point.x, y: point.y });
  const pinned = item.productGeometry;
  const geometry = pinned
    ? {
        ...structuredClone(pinned),
        kind: item.corner[side],
        ...(pinned.outline
          ? {
              outline: {
                ...structuredClone(pinned.outline),
                start: mirrorPoint(pinned.outline.start),
                segments: pinned.outline.segments.map((segment) => ({
                  ...segment,
                  to: mirrorPoint(segment.to),
                  ...(segment.via ? { via: mirrorPoint(segment.via) } : {}),
                })),
              },
            }
          : {}),
      }
    : undefined;
  const proposed: Item = {
    ...item,
    kind: item.corner[side],
    corner: { ...item.corner, side },
    ...(geometry ? { productGeometry: geometry } : {}),
  };
  const cat = catalogForItem(proposed);
  const hostPt = cat
    ? resolveHostFrameWaste({
        fields: proposed.productSpecification?.fields ?? proposed.productSnapshot?.fields ?? {},
        boxW: cat.w,
        outlineStart: (geometry?.outline ?? cat.outline)?.start,
        storedCorner: side,
        anchor: proposed.anchor,
        wall: ctx.wall,
      })
    : { resolved: false as const, missing: ["footprint"] as string[], datum: "" };
  const hasDerived = (item.servicePoints ?? []).some(isDerivedPoint);
  if (hasDerived && !hostPt.resolved) {
    const why = hostPt.missing.length ? hostPt.missing.join(", ") : "the host waste point is unresolved";
    return {
      ok: false,
      summary:
        `The derived waste point cannot be recomputed (${why}). ` +
        `The corner hand, outline, kind and service points are unchanged.`,
    };
  }
  const gap = proposed.anchor?.gap ?? 0;
  const next: Item = { ...proposed };
  if (item.servicePoints) {
    next.servicePoints = item.servicePoints.map((p) => {
      if (isDerivedPoint(p)) {
        return { ...p, across: hostPt.across, out: quantize(hostPt.out! + gap) };
      }
      return p.across === undefined ? p : { ...p, across: quantize(-p.across) };
    });
  }
  return { ok: true, item: next };
}

/** Wall set-out no longer matches the stored corner hand; review, do not invent a conversion. */
export function cornerHandProblems(model: PlanModel): Issue[] {
  const out: Issue[] = [];
  for (const it of model.items) {
    if (!it.corner || !it.anchor) continue;
    const wall = model.walls.find((w) => w.id === it.anchor!.wallId);
    if (!wall) continue;
    const live = productCornerSide(it.anchor, wall);
    if (live === it.corner.side) continue;
    const block = cornerHandChangeBlock(it);
    const nextStep = block.blocked
      ? block.remediation
      : "Re-anchor the fixture to update the corner hand";
    out.push({
      severity: "warning",
      code: "fixture_corner_hand_review",
      message:
        `${it.id}: a wall edit changed which end is nearer, so the stored ${it.corner.side}-hand no longer matches the live wall set-out (${live}-hand). ` +
        `${nextStep}. This is a modelling/set-out review, not a manufacturer figure, plumbing check or compliance verdict.`,
      refs: [it.id, wall.id],
    });
  }
  return out;
}

const num = (field: FieldValue | undefined): number | undefined =>
  typeof field?.value === "number" && Number.isFinite(field.value) ? field.value : undefined;

const sourceText = (field: FieldValue | undefined): string => {
  if (!field) return "unknown";
  const src = field.sources?.[0];
  const cited = src ? `${src.url}${src.locator ? ` (${src.locator})` : ""}` : field.note ? "" : "no source cited";
  const status = field.value === null || field.value === undefined ? "unknown" : (field.status ?? "unspecified status");
  return [status, cited, field.note].filter((s) => s && String(s).trim()).join("; ");
};

export interface HostWastePoint {
  resolved: boolean;
  across?: number;
  out?: number;
  /** Host-frame across/out obtained by converting another datum are never status `published`. */
  basis?: "derived" | ValueStatus;
  /** Reference point and frame of the compared position. */
  datum: string;
  source?: string;
  conversion?: string;
  missing: string[];
  fromCorner?: number;
  alongEachWall?: number;
  corner?: "left" | "right";
}

export interface DiameterReading {
  known: boolean;
  value?: number;
  kind?: DiameterKind;
  status?: ValueStatus;
  source?: string;
  label: string;
  note?: string;
}

/**
 * One host-frame waste resolver: corner-round uses wasteFromCorner (derived via
 * cornerBisectorToHostFrame) when the right-angle corner is known; otherwise end/side.
 * An orphaned wasteFromCorner on a non-corner-round bath is ignored.
 */
export function resolveHostFrameWaste(input: HostWasteInput): HostWastePoint {
  const fields = input.fields;
  const missing: string[] = [];
  const fromCorner = fields.shape?.value === "corner-round" ? num(fields.wasteFromCorner) : undefined;
  if (fromCorner !== undefined) {
    if (cornerHandDisagrees(input)) {
      return {
        resolved: false,
        datum: "host frame (across centreline, out from back edge)",
        source: sourceText(fields.wasteFromCorner),
        missing: [
          "corner hand review: the wall's nearer end no longer matches the stored right-angle; re-anchor the fixture to update it. No host-frame waste point is invented from a disputed hand",
        ],
      };
    }
    const corner = resolveWasteCorner(input);
    if (corner) {
      const { across, out, alongEachWall } = cornerBisectorToHostFrame(fromCorner, input.boxW, corner);
      const conversion =
        `${formatMm(fromCorner)} mm from the ${corner}-hand right-angle corner along the bisector ` +
        `→ ${formatMm(alongEachWall)} mm along each wall (${formatMm(fromCorner)}/√2); ` +
        `host frame (derived, not published): ${formatMm(across)} mm across the centreline (left negative), ` +
        `${formatMm(out)} mm out from the back edge`;
      return {
        resolved: true,
        across: quantize(across),
        out: quantize(out),
        basis: "derived",
        datum:
          `host frame: across the centreline (left negative, facing the host), out from the back edge; ` +
          `taken from the ${corner}-hand right-angle corner along the bisector (not wasteFromEnd/wasteFromSide)`,
        source: sourceText(fields.wasteFromCorner),
        conversion,
        missing: [],
        fromCorner,
        alongEachWall,
        corner,
      };
    }
    missing.push("which corner the right-angle sits in (plan outline, stored corner, or wall set-out)");
  }

  const fromEnd = num(fields.wasteFromEnd);
  const fromSide = num(fields.wasteFromSide);
  if (fromEnd === undefined && fromSide === undefined) {
    return {
      resolved: false,
      datum: "host frame (across centreline, out from back edge)",
      source: fromCorner !== undefined ? sourceText(fields.wasteFromCorner) : undefined,
      missing: missing.length
        ? [...missing, "wasteFromEnd and wasteFromSide"]
        : ["host waste point (wasteFromCorner along the bisector, or wasteFromEnd and wasteFromSide)"],
    };
  }
  if (fromSide === undefined) missing.push("wasteFromSide (out from the host's back edge / fixture-side)");
  if (fromEnd === undefined) missing.push("wasteFromEnd (from the named end)");

  let across: number | undefined;
  let conversion: string | undefined;
  const wasteEnd = fields.wasteEnd?.value;
  const corner = resolveWasteCorner(input);
  if (fromEnd !== undefined) {
    if (wasteEnd === "right") {
      across = input.boxW / 2 - fromEnd;
      conversion = `wasteFromEnd ${formatMm(fromEnd)} mm from the right end → host-frame across ${formatMm(across)} mm (derived, not published)`;
    } else if (wasteEnd === "left") {
      across = -(input.boxW / 2 - fromEnd);
      conversion = `wasteFromEnd ${formatMm(fromEnd)} mm from the left end → host-frame across ${formatMm(across)} mm (derived, not published)`;
    } else if (corner && input.outlineStart) {
      const sx = corner === "right" ? 1 : -1;
      across = input.outlineStart.x - sx * fromEnd;
      conversion =
        `wasteFromEnd ${formatMm(fromEnd)} mm from the ${corner}-hand right-angle along the back ` +
        `→ host-frame across ${formatMm(across)} mm (derived, not published; the sheet datum for a corner bath is the bisector when wasteFromCorner is known)`;
    } else {
      missing.push("wasteEnd (which end wasteFromEnd is measured from, facing the host)");
    }
  }

  if (missing.length || across === undefined || fromSide === undefined) {
    return {
      resolved: false,
      datum: "host frame (across centreline, out from the back edge / fixture-side)",
      source: [fromEnd !== undefined ? `wasteFromEnd: ${sourceText(fields.wasteFromEnd)}` : "", fromSide !== undefined ? `wasteFromSide: ${sourceText(fields.wasteFromSide)}` : ""].filter(Boolean).join("; ") || undefined,
      conversion,
      missing,
    };
  }
  return {
    resolved: true,
    across: quantize(across),
    out: quantize(fromSide),
    basis: "derived",
    datum:
      "host frame: across converted from wasteFromEnd (from the named end, not the centreline); out = wasteFromSide from the back / fixture-side edge",
    source: `wasteFromEnd: ${sourceText(fields.wasteFromEnd)}; wasteFromSide: ${sourceText(fields.wasteFromSide)}`,
    conversion,
    missing: [],
  };
}

export function hostWasteInHostFrame(host: Item, lookup: CatalogLookup = catalogByKind, model?: PlanModel): HostWastePoint {
  const cat = catalogForItem(host, lookup);
  if (!cat) return { resolved: false, datum: "host frame (across centreline, out from back edge)", missing: [`footprint of ${host.id}`] };
  const wall = host.anchor && model ? model.walls.find((w) => w.id === host.anchor!.wallId) : undefined;
  return resolveHostFrameWaste({
    fields: host.productSpecification?.fields ?? {},
    boxW: cat.w,
    outlineStart: cat.outline?.start,
    storedCorner: host.corner?.side,
    anchor: host.anchor,
    wall,
  });
}

export function accessoryOutletDiameter(item: Item): DiameterReading {
  const fields = item.productSpecification?.fields ?? {};
  const value = num(fields.outletDiameter);
  const kindRaw = fields.outletSizeKind?.value;
  const kind = isDiameterKind(kindRaw) ? kindRaw : undefined;
  const source = sourceText(fields.outletDiameter);
  if (value === undefined) {
    return {
      known: false,
      kind,
      label: "accessory outlet diameter",
      source,
      note: fields.outletDiameter?.note ?? "outlet diameter unknown",
    };
  }
  if (!kind) {
    return {
      known: false,
      value,
      label: "accessory outlet diameter",
      source,
      note: "outletSizeKind unknown, so this figure is not compared (hole, outlet, connection and thread are different kinds)",
    };
  }
  return {
    known: true,
    value,
    kind,
    status: fields.outletDiameter?.status,
    source,
    label: `accessory ${kind}`,
    note: fields.outletDiameter?.note,
  };
}

export function hostWasteDiameter(host: Item, want: DiameterKind): DiameterReading {
  const fields = host.productSpecification?.fields ?? {};
  // thread: no bath brief field yet; stays unknown until one is recorded.
  const fieldKey = want === "hole" ? "wasteHoleDiameter" : want === "thread" ? "wasteThreadDiameter" : "wasteConnectionDiameter";
  const field = fields[fieldKey];
  const value = num(field);
  const kind: DiameterKind = want === "hole" || want === "thread" ? want : "connection";
  const label = `host ${kind}`;
  if (value === undefined) {
    return { known: false, kind, label, source: sourceText(field), note: field?.note ?? `${fieldKey} unknown` };
  }
  return { known: true, value, kind, status: field?.status, source: sourceText(field), label, note: field?.note };
}

/** Pick the host figure that is like-for-like with the accessory, or none. */
export function likeForLikeHostDiameter(host: Item, accessory: DiameterReading): DiameterReading | null {
  if (!accessory.known || !accessory.kind) return null;
  if (accessory.kind === "hole") return hostWasteDiameter(host, "hole");
  if (accessory.kind === "thread") return hostWasteDiameter(host, "thread");
  // outlet and connection are pipe sizes: compare with the host's recorded connection/outlet
  return hostWasteDiameter(host, "connection");
}

const offsetWarn = (item: Item, host: Item, fitted: { across: number; out: number }, hostPt: HostWastePoint, offset: number): Issue => ({
  severity: "warning",
  code: "fitted_waste_offset",
  message:
    `${item.id} is ${formatMm(offset)} mm from ${host.id}'s waste centre in the host frame ` +
    `(tolerance FITTED_WASTE_OFFSET_TOLERANCE_M = ${formatMm(FITTED_WASTE_OFFSET_TOLERANCE_M)} mm, a modelling/set-out check, not a manufacturer figure). ` +
    `Fitted position: ${formatMm(fitted.across)} mm across the host centreline (left negative, facing the host) and ` +
    `${formatMm(fitted.out)} mm out from the host's back edge, as entered in that host frame. ` +
    `Host waste: ${hostPt.datum}. ${hostPt.conversion ?? ""} ` +
    `Source of the host figure: ${hostPt.source ?? "unknown"}; host-frame across/out basis: ${hostPt.basis ?? "unknown"}.`,
  refs: [item.id, host.id],
});

const sizeWarn = (item: Item, host: Item, acc: DiameterReading, hostDia: DiameterReading): Issue => ({
  severity: "warning",
  code: "fitted_waste_size",
  message:
    `${item.id} ${acc.kind} ${formatMm(acc.value!)} mm (${acc.status ?? "unspecified status"}; ${acc.source ?? "no source"}) ` +
    `does not match ${host.id} ${hostDia.kind} ${formatMm(hostDia.value!)} mm (${hostDia.status ?? "unspecified status"}; ${hostDia.source ?? "no source"}). ` +
    `Each figure's kind is named (hole, outlet, connection, thread); this is a modelling comparison of like-for-like sizes, not a plumbing verdict.`,
  refs: [item.id, host.id],
});

/** Problems when a waste-category accessory is fitted inside a host. */
export function fittedWasteProblems(model: PlanModel, lookup: CatalogLookup = catalogByKind): Issue[] {
  const out: Issue[] = [];
  for (const it of model.items) {
    if (!it.fittedTo) continue;
    if (it.productSpecification?.category !== "waste") continue;
    const host = model.items.find((x) => x.id === it.fittedTo!.hostId);
    if (!host || host.fittedTo) continue;

    const hostPt = hostWasteInHostFrame(host, lookup, model);
    if (hostPt.resolved && hostPt.across !== undefined && hostPt.out !== undefined) {
      const dx = it.fittedTo.across - hostPt.across;
      const dy = it.fittedTo.out - hostPt.out;
      const offset = Math.hypot(dx, dy);
      if (offset > FITTED_WASTE_OFFSET_TOLERANCE_M + 1e-9) {
        out.push(offsetWarn(it, host, it.fittedTo, hostPt, offset));
      }
    }

    const acc = accessoryOutletDiameter(it);
    if (!acc.known || !acc.kind) continue;
    const hostDia = likeForLikeHostDiameter(host, acc);
    if (!hostDia || !hostDia.known || !hostDia.kind) continue;
    if (!diametersAreLikeForLike(acc.kind, hostDia.kind)) continue;
    if (Math.abs(acc.value! - hostDia.value!) > FITTED_WASTE_SIZE_EPSILON_M) {
      out.push(sizeWarn(it, host, acc, hostDia));
    }
  }
  return out;
}
