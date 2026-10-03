/** Pure placement derivation, shared by placing and previewing a catalogue revision. */
import type { LibraryProduct } from "./productLibrary";
import type { CatalogEntry } from "./catalog";
import type { FixtureAnchor, ServicePoint, Wall } from "./types";
import { exactProductLabel, identityOf } from "./productIdentity";
import {
  categoryById,
  cornerBathOutline,
  envelopeOf,
  productPlacementProblem,
  validateProductGeometry,
} from "./products";
import { evidenceStatus, evidenceText } from "./productMeasurements";
import { outlineExtents, outlineProblems } from "./outline";
import { facingRotation } from "./fixtures";
import { sideNormal } from "./faces";
import { quantize, segLen } from "./geometry";
import { revisionOf } from "./productRevision";

export function productCornerSide(
  anchor: FixtureAnchor,
  wall: Wall,
): "left" | "right" {
  const length = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  const along =
    anchor.from === "b" ? length - anchor.distance : anchor.distance;
  const normal = sideNormal(wall, anchor.side);
  const rotation = (-facingRotation(normal) * Math.PI) / 180;
  const towardB =
    Math.cos(rotation) * (wall.bx - wall.ax) +
      Math.sin(rotation) * (wall.by - wall.ay) >
    0;
  return along <= length - along === towardB ? "left" : "right";
}

export function productPlacement(
  product: LibraryProduct,
  anchor: FixtureAnchor,
  wall: Wall,
) {
  const category = categoryById(product.category);
  const invalid = category
    ? validateProductGeometry(category, product.fields).filter(
        (p) => p.severity === "error",
      )
    : [];
  if (invalid.length)
    return {
      ok: false as const,
      summary: invalid.map((p) => p.message).join(" "),
    };
  const unsupported = category
    ? productPlacementProblem(category, product.fields)
    : null;
  if (unsupported) return { ok: false as const, summary: unsupported };
  const envelope = category ? envelopeOf(category, product.fields) : null;
  if (!envelope)
    return {
      ok: false as const,
      summary:
        "Overall size or its datum is unresolved; no geometry was invented.",
    };
  const label = `${exactProductLabel(product)} · catalogue revision ${revisionOf(product).number}`;
  const corner =
    product.category === "bath" &&
    product.fields.shape?.value === "corner-round"
      ? productCornerSide(anchor, wall)
      : null;
  const hand = identityOf(product).handedness;
  const fixedHand =
    hand.state === "known" && ["left", "right"].includes(hand.value ?? "");
  if (corner && fixedHand && hand.value !== corner)
    return {
      ok: false as const,
      summary: `This exact product is ${hand.value}-handed; it cannot be mirrored into the ${corner} corner.`,
    };
  const outline = corner
    ? cornerBathOutline(product.fields, envelope.w, envelope.d, corner)
    : null;
  let box = { ...envelope };
  if (outline) {
    const extents = outlineExtents(outline);
    box = {
      w: Math.max(envelope.w, extents.maxX - extents.minX),
      d: Math.max(envelope.d, extents.maxY - extents.minY),
      h: envelope.h,
    };
  }
  const kindFor = (side: "left" | "right" | null) =>
    `product_${product.id}${side ? `_${side}` : ""}`;
  const entryFor = (side: "left" | "right" | null): CatalogEntry => {
    const shape =
      side && outline
        ? cornerBathOutline(product.fields, box.w, box.d, side)
        : null;
    return {
      kind: kindFor(side),
      label,
      ...box,
      category: "bath",
      color: "#9a9186",
      ...(shape ? { outline: shape } : {}),
    };
  };
  const entry = entryFor(corner && outline ? corner : null);
  if (entry.outline && outlineProblems(entry.outline, entry.w, entry.d).length)
    return {
      ok: false as const,
      summary: "The sourced outline does not resolve within its envelope.",
    };
  const additionalEntries =
    corner && outline && !fixedHand
      ? [entryFor(corner === "left" ? "right" : "left")]
      : [];
  const source = `${label}, product library ${product.id}`;
  const servicePoints: ServicePoint[] = (product.roughIn ?? [])
    .filter(
      (point) =>
        product.recordingMode !== "human-measurement" ||
        evidenceStatus([
          point.across?.evidence,
          point.out?.evidence,
          point.out?.maxEvidence,
          point.up?.evidence,
        ]),
    )
    .map((point) => {
      const end = corner ?? product.fields.wasteEnd?.value;
      const across =
        point.across?.from === "fixture-centreline"
          ? point.across.value
          : point.across?.from === "fixture-end" &&
              point.across.value !== undefined &&
              (end === "left" || end === "right")
            ? quantize(
                end === "left"
                  ? -box.w / 2 + point.across.value
                  : box.w / 2 - point.across.value,
              )
            : undefined;
      let face = "finished",
        out: number | undefined,
        outMax: number | undefined;
      if (point.out?.from === "finished-wall") {
        out = point.out.value ?? point.out.min;
        outMax =
          point.out.max !== undefined && point.out.min !== undefined
            ? point.out.max
            : undefined;
      } else if (point.out?.from === "fixture-side") {
        face = anchor.face;
        out =
          point.out.value !== undefined
            ? quantize(point.out.value + anchor.gap)
            : undefined;
      }
      const up =
        point.up?.from === "finished-floor" ? point.up.value : undefined;
      const unconverted = [
        point.across && across === undefined
          ? `across from ${point.across.from}`
          : "",
        point.out && out === undefined ? `out from ${point.out.from}` : "",
        point.up && up === undefined ? `up from ${point.up.from}` : "",
      ].filter(Boolean);
      const axisEvidence = {
        ...(point.across?.evidence ? { across: point.across.evidence } : {}),
        ...(point.out?.evidence ? { out: point.out.evidence } : {}),
        ...(point.out?.maxEvidence ? { outMax: point.out.maxEvidence } : {}),
        ...(point.up?.evidence ? { up: point.up.evidence } : {}),
      };
      const status = evidenceStatus(Object.values(axisEvidence)) ?? "published";
      const sourced = [source, ...Object.values(axisEvidence).map(evidenceText)]
        .filter(Boolean)
        .join("; ");
      return {
        id: point.id,
        label: point.label,
        service: point.service,
        face,
        ...(out !== undefined ? { out } : {}),
        ...(outMax !== undefined ? { outMax } : {}),
        ...(across !== undefined ? { across } : {}),
        ...(up !== undefined ? { up } : {}),
        status,
        ...(Object.keys(axisEvidence).length
          ? { axisEvidence: structuredClone(axisEvidence) }
          : {}),
        source: unconverted.length
          ? `${sourced}; not converted: ${unconverted.join(", ")}`
          : sourced,
      };
    });
  return {
    ok: true as const,
    entry,
    additionalEntries,
    servicePoints,
    ...(corner && outline
      ? {
          corner: {
            left: kindFor(fixedHand ? corner : "left"),
            right: kindFor(fixedHand ? corner : "right"),
            side: corner,
          },
        }
      : {}),
  };
}
