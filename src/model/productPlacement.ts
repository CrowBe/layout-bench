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
import { hostWasteFields, productCornerSide, resolveHostFrameWaste } from "./fittedWaste";
import { quantize } from "./geometry";
import {
  validInstallation,
  mirroringProblem,
  geometryForPlacement,
  type FixtureInstallation,
} from "./installation";
import { revisionOf } from "./productRevision";

export { productCornerSide };

export function productPlacement(
  product: LibraryProduct,
  anchor: FixtureAnchor,
  wall: Wall,
  installation?: FixtureInstallation,
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
  const wallMounted =
    (product.category === "mirror" &&
      product.fields.mounting?.value === "surface") ||
    (product.category === "towel-rail" &&
      product.fields.mounting?.value === "wall");
  if (unsupported && !wallMounted)
    return { ok: false as const, summary: unsupported };
  if (installation !== undefined && !validInstallation(installation))
    return {
      ok: false as const,
      summary:
        "Invalid installation placement: name the mounting, floor datum, room, orientation and optional height with status/source.",
    };
  if (wallMounted && installation?.mounting !== "wall")
    return {
      ok: false as const,
      summary:
        "Unsupported product placement: this wall-mounted fitting requires explicit installation.mounting wall and an entered room/floor datum; omitted height remains unknown.",
    };
  if (product.installationGeometry && !installation)
    return {
      ok: false as const,
      summary:
        "Sourced installation geometry requires explicit placement above a named room/floor datum; no ground height is assumed.",
    };
  if (installation?.mounting === "wall" && !wallMounted)
    return {
      ok: false as const,
      summary:
        "Unsupported wall mounting for this category/mode; detailed installation geometry is not represented.",
    };
  if (installation?.mirror) {
    const problem = mirroringProblem(product, product.installationGeometry);
    if (problem) return { ok: false as const, summary: problem };
  }
  const installationGeometry = installation
    ? geometryForPlacement(product)
    : product.installationGeometry;
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
      ...(product.installationGeometry?.outline?.shape
        ? { outline: product.installationGeometry.outline.shape }
        : shape
          ? { outline: shape }
          : {}),
      ...(wallMounted ? { installationMounting: "wall" as const } : {}),
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
  const hostWaste = resolveHostFrameWaste({
    fields: hostWasteFields(product),
    boxW: entry.w,
    outlineStart: entry.outline?.start ?? outline?.start,
    storedCorner: corner ?? undefined,
    anchor,
    wall,
  });
  const servicePoints: ServicePoint[] = (product.roughIn ?? [])
    .filter((p) => !installationGeometry?.services?.some((s) => s.id === p.id))
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
      const isWaste = point.service === "waste";
      const wasteFromHost =
        isWaste &&
        hostWaste.resolved &&
        hostWaste.across !== undefined &&
        hostWaste.out !== undefined;
      const end = corner ?? product.fields.wasteEnd?.value;
      // Waste host-frame axes come only from resolveHostFrameWaste. Unresolved waste
      // never falls through fixture-end/fixture-side conversion (that invented a
      // published across). Already-in-frame axes (centreline, finished-wall) stay.
      const across = wasteFromHost
        ? hostWaste.across
        : isWaste
          ? point.across?.from === "fixture-centreline"
            ? point.across.value
            : undefined
          : point.across?.from === "fixture-centreline"
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
      if (wasteFromHost) {
        face = anchor.face;
        out = quantize(hostWaste.out! + anchor.gap);
      } else if (point.out?.from === "finished-wall") {
        out = point.out.value ?? point.out.min;
        outMax =
          point.out.max !== undefined && point.out.min !== undefined
            ? point.out.max
            : undefined;
      } else if (!isWaste && point.out?.from === "fixture-side") {
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
      const unresolvedWaste =
        isWaste && !wasteFromHost && across === undefined && out === undefined;
      if (unresolvedWaste) return null;
      const derivedHostFrame = wasteFromHost || point.across?.basis === "derived" || point.out?.basis === "derived";
      const status = derivedHostFrame ? "derived" : (evidenceStatus(Object.values(axisEvidence)) ?? "published");
      const sourced = [
        source,
        ...Object.values(axisEvidence).map(evidenceText),
        derivedHostFrame
          ? hostWaste.fromCorner !== undefined
            ? "host-frame across/out derived from wasteFromCorner (not published)"
            : "host-frame across/out derived (not published)"
          : "",
      ]
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
        ...(derivedHostFrame ? { basis: "derived" as const } : {}),
        ...(Object.keys(axisEvidence).length
          ? { axisEvidence: structuredClone(axisEvidence) }
          : {}),
        source: unconverted.length
          ? `${sourced}; not converted: ${unconverted.join(", ")}`
          : sourced,
      };
    })
    .filter((p): p is ServicePoint => p !== null);
  return {
    ok: true as const,
    entry,
    additionalEntries,
    servicePoints,
    installationGeometry,
    ...(corner
      ? {
          corner: {
            left: outline ? kindFor(fixedHand ? corner : "left") : entry.kind,
            right: outline ? kindFor(fixedHand ? corner : "right") : entry.kind,
            side: corner,
          },
        }
      : {}),
  };
}
