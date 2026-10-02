/** Proposed cable geometry and evidence. Checks compare entered constraints; they never approve installation. */
import type { Heating, Quantity, Room } from "./types";
import { floorLevels } from "./floor";
import { heightAt } from "./drainage";
import { VALUE_STATUSES, known, weakest, input } from "./faces";
import { pointSegDist, quantize, segmentsCross, type Pt } from "./geometry";

type Rect = { x: number; y: number; w: number; h: number };
const EPS = 1e-8;
const inside = (p: Pt, r: Rect) =>
  p.x >= r.x - EPS &&
  p.x <= r.x + r.w + EPS &&
  p.y >= r.y - EPS &&
  p.y <= r.y + r.h + EPS;
const edges = (r: Rect): [Pt, Pt][] => {
  const a = { x: r.x, y: r.y },
    b = { x: r.x + r.w, y: r.y },
    c = { x: r.x + r.w, y: r.y + r.h },
    d = { x: r.x, y: r.y + r.h };
  return [
    [a, b],
    [b, c],
    [c, d],
    [d, a],
  ];
};
const segDist = (a: Pt, b: Pt, c: Pt, d: Pt) =>
  segmentsCross(a, b, c, d)
    ? 0
    : Math.min(
        pointSegDist(a, c, d),
        pointSegDist(b, c, d),
        pointSegDist(c, a, b),
        pointSegDist(d, a, b),
      );
const rectDist = (a: Pt, b: Pt, r: Rect) =>
  inside(a, r) || inside(b, r)
    ? 0
    : Math.min(...edges(r).map(([c, d]) => segDist(a, b, c, d)));
const segments = (path: Pt[]) =>
  path.slice(1).map((b, i) => ({
    a: path[i],
    b,
    length: Math.hypot(b.x - path[i].x, b.y - path[i].y),
  }));
export const heatingZones = (room: Room): Rect[] =>
  (room.heating?.zoneIds ?? []).flatMap<Rect>((id) =>
    id === room.id
      ? [room]
      : (room.drainage?.planes.filter((p) => p.id === id) ?? []),
  );

/** Coordinate compression gives exact union area and its exterior edges, including gaps. */
function union(rects: Rect[], exclusions: Rect[] = []) {
  const all = [...rects, ...exclusions];
  const xs = [...new Set(all.flatMap((r) => [r.x, r.x + r.w]))].sort(
    (a, b) => a - b,
  );
  const ys = [...new Set(all.flatMap((r) => [r.y, r.y + r.h]))].sort(
    (a, b) => a - b,
  );
  const cells = new Set<string>();
  let area = 0;
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < ys.length - 1; j++) {
      const p = { x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 };
      if (
        rects.some((r) => inside(p, r)) &&
        !exclusions.some((r) => inside(p, r))
      ) {
        cells.add(`${i}:${j}`);
        area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
      }
    }
  const boundary: [Pt, Pt][] = [];
  for (const cell of cells) {
    const [i, j] = cell.split(":").map(Number);
    const e = edges({
      x: xs[i],
      y: ys[j],
      w: xs[i + 1] - xs[i],
      h: ys[j + 1] - ys[j],
    });
    [
      [i, j - 1],
      [i + 1, j],
      [i, j + 1],
      [i - 1, j],
    ].forEach(([x, y], k) => {
      if (!cells.has(`${x}:${y}`)) boundary.push(e[k]);
    });
  }
  return { area: quantize(area), boundary };
}
/** Split a segment at every rectangular boundary: endpoints inside alone cannot prove containment. */
function contained(a: Pt, b: Pt, rects: Rect[]) {
  const ts = [0, 1];
  for (const r of rects) {
    if (Math.abs(b.x - a.x) > EPS)
      for (const x of [r.x, r.x + r.w]) {
        const t = (x - a.x) / (b.x - a.x);
        if (t > 0 && t < 1) ts.push(t);
      }
    if (Math.abs(b.y - a.y) > EPS)
      for (const y of [r.y, r.y + r.h]) {
        const t = (y - a.y) / (b.y - a.y);
        if (t > 0 && t < 1) ts.push(t);
      }
  }
  ts.sort((x, y) => x - y);
  return (
    ts.every((t) =>
      rects.some((r) =>
        inside({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, r),
      ),
    ) &&
    ts.slice(1).every((t, i) => {
      const m = (ts[i] + t) / 2;
      return rects.some((r) =>
        inside({ x: a.x + (b.x - a.x) * m, y: a.y + (b.y - a.y) * m }, r),
      );
    })
  );
}
export interface CableLevel {
  x: number;
  y: number;
  /** Cumulative plan-projection distance, not spatial cable distance. */
  s: number;
  level?: number;
  bottom?: number;
  top?: number;
  basis: string;
  missing: string[];
}
/** Levels at vertices, every drainage-plane boundary and interval midpoints. Sloped screed follows the entered finished surface; no flat fallback if drainage exists. */
export function heatingSection(room: Room): CableLevel[] {
  const h = room.heating;
  if (!h) return [];
  const layers = room.floorBuildUp?.layers ?? [];
  const screeds = layers.filter((l) => l.kind === "screed");
  const layer = h.screedLayerId
    ? screeds.find((l) => l.id === h.screedLayerId)
    : screeds.length === 1
      ? screeds[0]
      : undefined;
  const index = layer ? layers.indexOf(layer) : -1;
  const levels = floorLevels(room.floorBuildUp);
  let distance = 0;
  const points = h.path.flatMap((p, i) => {
    if (!i) return [{ ...p, s: 0 }];
    const a = h.path[i - 1];
    const length = Math.hypot(p.x - a.x, p.y - a.y);
    const previous = distance;
    distance += length;
    const breaks = [0, 1];
    for (const plane of room.drainage?.planes ?? []) {
      if (Math.abs(p.x - a.x) > EPS)
        for (const x of [plane.x, plane.x + plane.w]) {
          const t = (x - a.x) / (p.x - a.x);
          if (t > 0 && t < 1) breaks.push(t);
        }
      if (Math.abs(p.y - a.y) > EPS)
        for (const y of [plane.y, plane.y + plane.h]) {
          const t = (y - a.y) / (p.y - a.y);
          if (t > 0 && t < 1) breaks.push(t);
        }
    }
    const sorted = [...new Set(breaks)].sort((a, b) => a - b);
    const samples = sorted
      .slice(1)
      .flatMap((t, index) => [(sorted[index] + t) / 2, t]);
    return samples.map((t) => ({
      x: a.x + (p.x - a.x) * t,
      y: a.y + (p.y - a.y) * t,
      s: previous + length * t,
    }));
  });
  return points.map((p) => {
    const missing: string[] = [];
    let top: number | undefined, bottom: number | undefined;
    const inputs = [
      input("cable height above screed bottom", h.depthFromBottom),
    ];
    if (!layer) missing.push("select one screed layer");
    else if (room.drainage?.planes.length) {
      const floor = heightAt(room.drainage, p.x, p.y);
      const above = layers.slice(index + 1);
      inputs.push(
        ...[layer, ...above].map((l) =>
          input(`${l.name} thickness`, l.thickness),
        ),
      );
      if (floor.level === undefined)
        missing.push(floor.reason ?? "local floor level");
      if (
        floor.level !== undefined &&
        known(layer.thickness) &&
        above.every((l) => known(l.thickness))
      ) {
        top = quantize(
          floor.level - above.reduce((n, l) => n + l.thickness.value!, 0),
        );
        bottom = quantize(top - layer.thickness.value);
        // include the drainage basis in derived provenance
        if (floor.basis !== "unknown")
          inputs.push({
            field: "local floor level",
            value: floor.level,
            status: floor.basis,
          });
      }
    } else {
      const lv = levels[index + 1];
      if (lv?.resolved && known(layer.thickness)) {
        top = lv.top;
        bottom = quantize(top! - layer.thickness.value);
      }
      if (lv) inputs.push(...lv.inputs);
      else missing.push("floor assembly");
    }
    missing.push(
      ...inputs.filter((i) => i.status === "unknown").map((i) => i.field),
    );
    if (bottom === undefined && !missing.length) missing.push("screed level");
    const resolved =
      bottom !== undefined && known(h.depthFromBottom) && !missing.length;
    return {
      ...p,
      s: quantize(p.s),
      ...(top !== undefined ? { top, bottom } : {}),
      ...(resolved
        ? { level: quantize(bottom! + h.depthFromBottom!.value!) }
        : {}),
      basis: resolved ? weakest(inputs) : "unknown",
      missing: [...new Set(missing)],
    };
  });
}
export interface HeatingProblem {
  severity: "error" | "warning";
  code: string;
  message: string;
}
/** Length follows every resolved profile interval, including plane boundaries and midpoints. */
function routeLengths(room: Room, section: CableLevel[]) {
  const planRouteLength = quantize(segments(room.heating?.path ?? []).reduce((n, s) => n + s.length, 0));
  const resolved = section.length >= 2 && section.every(p => p.level !== undefined);
  const routeLength = resolved ? section.slice(1).reduce((n, p, i) => {
    const a = section[i];
    return n + Math.hypot(p.x - a.x, p.y - a.y, p.level! - a.level!);
  }, 0) : undefined;
  return { planRouteLength, routeLength };
}
export function heatingEvidence(room: Room) {
  const h = room.heating;
  const segs = segments(h?.path ?? []),
    zones = heatingZones(room);
  const section = heatingSection(room);
  const { planRouteLength, routeLength } = routeLengths(room, section);
  let separation: number | undefined;
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 2; j < segs.length; j++) {
      const d = segDist(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
      separation = separation === undefined ? d : Math.min(separation, d);
    }
  const boundary = union(zones).boundary;
  let edgeDistance: number | undefined;
  let keepoutDistance: number | undefined;
  for (const segment of segs) {
    for (const [a, b] of boundary) {
      const distance = segDist(segment.a, segment.b, a, b);
      edgeDistance =
        edgeDistance === undefined
          ? distance
          : Math.min(edgeDistance, distance);
    }
    for (const keepout of h?.keepouts ?? []) {
      const distance = rectDist(segment.a, segment.b, keepout);
      keepoutDistance =
        keepoutDistance === undefined
          ? distance
          : Math.min(keepoutDistance, distance);
    }
  }
  const confirmedLength =
    known(h?.length) &&
    ["published", "measured", "site-confirmed"].includes(h!.length!.status!);
  return {
    planRouteLength,
    ...(routeLength !== undefined ? { routeLength: quantize(routeLength) } : {}),
    selectedArea: union(zones).area,
    availableArea: union(zones, h?.keepouts).area,
    ...(separation !== undefined
      ? { minimumNonAdjacentSpacing: quantize(separation) }
      : {}),
    ...(edgeDistance !== undefined
      ? { edgeDistance: quantize(edgeDistance) }
      : {}),
    ...(keepoutDistance !== undefined
      ? { keepoutDistance: quantize(keepoutDistance) }
      : {}),
    ...(confirmedLength && routeLength !== undefined
      ? { remainingProductLength: quantize(h!.length!.value! - routeLength) }
      : {}),
    coverageNote:
      "Areas are zone footprints excluding entered keep-outs, not verified heat coverage.",
    lengthNote: "Plan route length is the XY projection. Spatial route length follows the sampled cable profile and drives confirmed product balance only when the whole profile resolves. Unsupplied cold tails and connections are excluded.",
    sectionNote: "Sampled profile at vertices, plane boundaries and interval midpoints. Entered screed thickness applies throughout the route; local screed top follows entered finished planes minus layers above. Trade must verify variable thickness, substrate and slope.",
    section,
    problems: heatingProblems(room, section),
  };
}
export function heatingProblems(room: Room, section = heatingSection(room)): HeatingProblem[] {
  const h = room.heating;
  if (!h) return [];
  const out: HeatingProblem[] = [];
  const add = (
    code: string,
    message: string,
    severity: HeatingProblem["severity"] = "warning",
  ) => out.push({ code, message, severity });
  add(
    "heating_signoff",
    "Proposed route only: manufacturer and licensed electrician must review cable identity, length, output, bend radius, spacing, exclusions, cover, sensor, cold tails, waterproofing and electrical installation. No compliance approval.",
  );
  const unknown = [
    "manufacturer",
    "model",
    "requirements",
    "productSource",
  ].filter((k) => !h[k as keyof Heating]);
  for (const k of [
    "length",
    "ratedOutput",
    "minSpacing",
    "edgeClearance",
    "depthFromBottom",
  ] as const)
    if (!known(h[k])) unknown.push(k);
  if (unknown.length)
    add(
      "heating_metadata_unknown",
      `Unknown cable/product information: ${unknown.join(", ")}.`,
    );
  if (
    known(h.length) &&
    !["published", "measured", "site-confirmed"].includes(h.length.status!)
  )
    add(
      "heating_length_unconfirmed",
      "Cable length is proposed/estimated; excess-product-length check remains pending confirmation.",
    );
  const zones = heatingZones(room),
    segs = segments(h.path);
  const missing = h.zoneIds.filter(
    (id) => id !== room.id && !room.drainage?.planes.some((p) => p.id === id),
  );
  if (!h.zoneIds.length || missing.length)
    add(
      "heating_zone_unknown",
      `Select screed zone(s); unavailable zone ids: ${missing.join(", ") || "none selected"}.`,
    );
  if (
    zones.some(
      (z) =>
        z.x < room.x - EPS ||
        z.y < room.y - EPS ||
        z.x + z.w > room.x + room.w + EPS ||
        z.y + z.h > room.y + room.h + EPS,
    )
  )
    add(
      "heating_zone_outside_room",
      "A selected zone extends beyond the room.",
      "error",
    );
  if (h.path.length < 2)
    add("heating_path_missing", "Enter at least two cable route points.");
  if (
    h.path.some((p) => !zones.some((zone) => inside(p, zone))) ||
    segs.some((s) => !contained(s.a, s.b, zones))
  )
    add(
      "heating_outside_zone",
      "Cable leaves the union of selected screed zones.",
      "error",
    );
  if (segs.some((s) => s.length < EPS))
    add(
      "heating_zero_segment",
      "Cable route contains coincident consecutive points.",
      "error",
    );
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i],
        b = segs[j];
      const backtracks =
        j === i + 1 &&
        Math.abs(
          (a.b.x - a.a.x) * (b.b.y - b.a.y) - (a.b.y - a.a.y) * (b.b.x - b.a.x),
        ) < EPS &&
        (a.b.x - a.a.x) * (b.b.x - b.a.x) + (a.b.y - a.a.y) * (b.b.y - b.a.y) <
          0;
      const d = j > i + 1 ? segDist(a.a, a.b, b.a, b.b) : undefined;
      if (backtracks || (d !== undefined && d < EPS))
        add(
          "heating_overlap",
          `Cable segments ${i + 1} and ${j + 1} cross, touch or overlap.`,
          "error",
        );
      else if (
        d !== undefined &&
        known(h.minSpacing) &&
        d < h.minSpacing.value - EPS
      )
        add(
          "heating_spacing",
          `Cable segments ${i + 1} and ${j + 1} are ${(d * 1000).toFixed(1)} mm apart, below entered minimum ${(h.minSpacing.value * 1000).toFixed(1)} mm.`,
          "error",
        );
    }
  if (segs.some((s) => h.keepouts.some((r) => rectDist(s.a, s.b, r) < EPS)))
    add(
      "heating_keepout",
      "Cable intersects or touches an entered keep-out.",
      "error",
    );
  const boundary = union(zones).boundary;
  if (
    known(h.edgeClearance) &&
    segs.some(
      (s) =>
        boundary.some(
          ([a, b]) => segDist(s.a, s.b, a, b) < h.edgeClearance!.value! - EPS,
        ) ||
        h.keepouts.some(
          (r) => rectDist(s.a, s.b, r) < h.edgeClearance!.value! - EPS,
        ),
    )
  )
    add(
      "heating_clearance",
      "Cable is below entered clearance from zone boundary or keep-out.",
      "error",
    );
  const { routeLength } = routeLengths(room, section);
  if (routeLength === undefined) add("heating_route_length_unknown", "Spatial cable length and confirmed product-length balance remain unknown until the whole route has resolved screed levels and cable height; the plan projection is not cable length.");
  if (
    known(h.length) &&
    ["published", "measured", "site-confirmed"].includes(h.length.status!) &&
    routeLength !== undefined && routeLength > h.length.value + EPS
  )
    add(
      "heating_length_exceeded",
      `Proposed spatial route (sampled profile) ${routeLength.toFixed(4)} m exceeds confirmed cable length ${h.length.value} m. Do not cut or shorten a cable without manufacturer instructions.`,
      "error",
    );
  if (section.some((p) => p.level === undefined) || !section.length)
    add(
      "heating_depth_unknown",
      "Cable section remains unresolved until screed layer, floor levels and cable height are entered.",
    );
  if (
    section.some(
      (p) =>
        p.level !== undefined &&
        (p.level <= p.bottom! + EPS || p.level >= p.top! - EPS),
    )
  )
    add(
      "heating_outside_screed",
      "Cable centre lies at or beyond a screed face. Review thickness, height and manufacturer cover requirements.",
      "error",
    );
  return out;
}
/** Shape/provenance validation shared by saved-project import and action edits. */
export function validHeating(v: unknown): v is Heating {
  if (v === undefined) return true;
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const h = v as Heating;
  const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  const q = (value: Quantity | undefined) => {
    if (value === undefined) return true;
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    if (value.source !== undefined && typeof value.source !== "string")
      return false;
    if (value.status !== undefined && !VALUE_STATUSES.includes(value.status))
      return false;
    if (value.value === undefined) return true;
    return finite(value.value) && value.value >= 0 && !!value.status;
  };
  return (
    [
      "manufacturer",
      "model",
      "productSource",
      "requirements",
      "screedLayerId",
    ].every(
      (k) =>
        h[k as keyof Heating] === undefined ||
        typeof h[k as keyof Heating] === "string",
    ) &&
    [
      "length",
      "ratedOutput",
      "minSpacing",
      "edgeClearance",
      "depthFromBottom",
    ].every((k) => q(h[k as keyof Heating] as Quantity | undefined)) &&
    Array.isArray(h.zoneIds) &&
    h.zoneIds.length <= 100 &&
    h.zoneIds.every((id) => typeof id === "string") &&
    Array.isArray(h.path) &&
    h.path.length <= 1000 &&
    h.path.every((p) => p && finite(p.x) && finite(p.y)) &&
    Array.isArray(h.keepouts) &&
    h.keepouts.length <= 100 &&
    h.keepouts.every(
      (r) =>
        r &&
        typeof r.id === "string" &&
        typeof r.label === "string" &&
        [r.x, r.y, r.w, r.h].every(finite) &&
        r.w > 0 &&
        r.h > 0 &&
        (r.source === undefined || typeof r.source === "string"),
    ) &&
    new Set(h.keepouts.map((r) => r.id)).size === h.keepouts.length
  );
}
