/** Proposed floor set-out. Never substitutes room bounds for unresolved finished faces.
 * Rectangular zones are a room or an existing drainage plane; skew walls stay unresolved.
 * Waste centre lines are shown; a waste linked to a sized drain brief also shows its grate
 * outline (#82). Drain aperture dimensions are never invented.
 */
import type { FloorTiling, PlanModel, Room, WallSideName } from "./types";
import {
  input,
  known,
  resolveFace,
  sideNormal,
  weakest,
  type FaceInput,
} from "./faces";
import { edgeCut, MAX_PIECES, type EdgeCut } from "./tiling";
import { drainageProblems, planeSurface } from "./drainage";
import { grateOutline, wasteProduct } from "./wasteProduct";
import { quantize, type Pt } from "./geometry";

export interface FloorTilePiece {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  cut: boolean;
}
export interface FloorTileLayout {
  roomId: string;
  status: "proposed";
  resolved: boolean;
  basis: string;
  inputs: FaceInput[];
  missing: string[];
  faces: {
    edge: "west" | "east" | "north" | "south";
    label: string;
    value?: number;
    basis: string;
  }[];
  bounds?: { x0: number; x1: number; y0: number; y1: number };
  origin?: Pt;
  tile?: { x: number; y: number };
  joint?: number;
  cuts?: Record<"west" | "east" | "north" | "south", EdgeCut>;
  pieces: FloorTilePiece[];
  /** grate: the linked brief's outline in plan (#82); absent when the brief has no grate size */
  wastes: { id: string; label: string; a: Pt; b: Pt; grate?: Pt[]; tileInsert?: boolean; product?: string; relation?: string }[];
  planes: {
    id: string;
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
    resolved: boolean;
  }[];
  doors: { id: string; a: Pt; b: Pt; unresolved: boolean }[];
  problems: { severity: "error" | "warning"; code: string; message: string }[];
}
const EPS = 1e-4;
/** The first/last tile inside the zone, clipped at both opposing boundaries.
 * The infinite grid may put a full tile beyond the other edge of a narrow zone;
 * retain only its intersection with the zone, including bounded joint gaps.
 */
function boundedEdgeCut(
  origin: number,
  tile: number,
  joint: number,
  low: number,
  high: number,
  keep: "before" | "after",
): EdgeCut {
  const edge = keep === "after" ? low : high;
  const cut = edgeCut(origin, tile, joint, edge, keep);
  const gap = cut.gap ?? 0;
  const start = keep === "after" ? edge + gap : edge - gap - cut.size;
  const end = start + cut.size;
  const size = quantize(
    Math.max(0, Math.min(high, end) - Math.max(low, start)),
  );
  return {
    size: size > EPS ? size : 0,
    of: tile,
    full: size >= tile - EPS && size > EPS,
    ...(cut.gap !== undefined
      ? { gap: quantize(Math.min(gap, high - low)) }
      : {}),
  };
}

export function floorTileLayout(model: PlanModel, room: Room): FloorTileLayout {
  const t: FloorTiling = room.floorTiling ?? {};
  const inputs = [
    input("tile length", t.tileLength),
    input("tile width", t.tileWidth),
    input("grout joint", t.joint),
    input("origin X", t.originX),
    input("origin Y", t.originY),
  ];
  const l: FloorTileLayout = {
    roomId: room.id,
    status: "proposed",
    resolved: false,
    basis: "unknown",
    inputs,
    missing: inputs.filter((i) => i.status === "unknown").map((i) => i.field),
    faces: [],
    pieces: [],
    wastes: [],
    planes: [],
    doors: [],
    problems: [],
  };
  const warn = (code: string, message: string) =>
    l.problems.push({ severity: "warning", code, message });
  const error = (message: string) =>
    l.problems.push({
      severity: "error",
      code: "floor_tiling_invalid",
      message,
    });
  if (!t.axis) l.missing.push("set-out axis (x or y)");
  if (!t.zone) l.missing.push("floor zone (room or a drainage plane)");
  const cx = room.x + room.w / 2,
    cy = room.y + room.h / 2;
  const edges = ["west", "east", "north", "south"] as const;
  for (const edge of edges) {
    const vertical = edge === "west" || edge === "east";
    const limit =
      edge === "west"
        ? room.x
        : edge === "east"
          ? room.x + room.w
          : edge === "north"
            ? room.y
            : room.y + room.h;
    const candidates = model.walls.filter((w) => {
      const coord = vertical ? (w.ax + w.bx) / 2 : (w.ay + w.by) / 2;
      const a = vertical ? w.ay : w.ax,
        b = vertical ? w.by : w.bx;
      const start = vertical ? room.y : room.x,
        end = start + (vertical ? room.h : room.w);
      return (
        Math.abs(coord - limit) <= w.thickness / 2 + 0.09 &&
        Math.min(a, b) <= start + 0.09 &&
        Math.max(a, b) >= end - 0.09
      );
    });
    if (candidates.length !== 1) {
      l.faces.push({
        edge,
        label: `${edge}: ${candidates.length ? "ambiguous walls" : "no boundary wall"}`,
        basis: "unknown",
      });
      l.missing.push(
        `${edge} finished boundary: ${candidates.length ? "more than one wall" : "no wall"}`,
      );
      continue;
    }
    const w = candidates[0];
    const nl = sideNormal(w, "left");
    const side: WallSideName =
      (cx - (w.ax + w.bx) / 2) * nl.x + (cy - (w.ay + w.by) / 2) * nl.y > 0
        ? "left"
        : "right";
    const f = resolveFace(w.sides?.[side], "finished");
    const n = sideNormal(w, side);
    const label = `${edge}: finished face of ${w.id} (${side})`;
    if (vertical ? Math.abs(w.ax - w.bx) > EPS : Math.abs(w.ay - w.by) > EPS) {
      l.faces.push({ edge, label, basis: "unknown" });
      l.missing.push(`${label}: skew wall needs a surveyed polygon set-out`);
      continue;
    }
    const value = f.resolved
      ? quantize(vertical ? w.ax + n.x * f.offset! : w.ay + n.y * f.offset!)
      : undefined;
    l.faces.push({ edge, label, value, basis: f.basis });
    if (!f.resolved) l.missing.push(...f.missing.map((m) => `${label}: ${m}`));
    if (f.resolved)
      inputs.push({ field: label, value: value!, status: f.basis });
    for (const o of model.openings.filter(
      (o) => o.wallId === w.id && o.kind === "door",
    )) {
      const len = Math.hypot(w.bx - w.ax, w.by - w.ay),
        dx = (w.bx - w.ax) / len,
        dy = (w.by - w.ay) / len;
      const mid = {
        x: w.ax + (w.bx - w.ax) * o.t + n.x * (f.offset ?? 0),
        y: w.ay + (w.by - w.ay) * o.t + n.y * (f.offset ?? 0),
      };
      l.doors.push({
        id: o.id,
        a: { x: mid.x - (dx * o.width) / 2, y: mid.y - (dy * o.width) / 2 },
        b: { x: mid.x + (dx * o.width) / 2, y: mid.y + (dy * o.width) / 2 },
        unresolved: !f.resolved || o.widthDefaulted !== false,
      });
      if (!f.resolved || o.widthDefaulted !== false)
        l.missing.push(
          `door ${o.id} transition: finished face or real clear width unresolved`,
        );
      else
        warn(
          "floor_tiling_door_transition",
          `Door ${o.id}: transition is at the finished face; continuation and threshold joint need tiler confirmation.`,
        );
    }
  }
  if (room.drainage) {
    l.wastes = room.drainage.wastes.map((w) => {
      const info = wasteProduct(w);
      const grate = grateOutline(w, info);
      return {
        id: w.id,
        label: w.label,
        a: { x: w.ax, y: w.ay },
        b: { x: w.bx, y: w.by },
        ...(grate ? { grate } : {}),
        ...(info?.grateType === "tile-insert" ? { tileInsert: true } : {}),
        ...(info ? { product: info.name } : {}),
      };
    });
    l.planes = room.drainage.planes.map((p) => ({
      ...p,
      resolved: planeSurface(room.drainage!, p).resolved,
    }));
    l.problems.push(...drainageProblems(room));
    for (const p of l.planes)
      if (!p.resolved)
        l.missing.push(`fall plane ${p.label}: slope/levels unresolved`);
  }
  if (!l.wastes.length)
    l.missing.push("drain position not recorded; waste cuts unresolved");
  else {
    for (const w of l.wastes)
      if (!w.grate)
        l.missing.push(
          `${w.label}: drain aperture size not recorded${w.product ? ` in the ${w.product} brief` : " (no drain product linked)"}; waste cut unresolved`,
        );
    warn(
      "floor_tiling_waste_cut",
      l.wastes.every((w) => w.grate)
        ? "Grate outlines come from the linked drain briefs. Confirm clearance, edge joints and cut shape on site."
        : "Wastes without a sized drain product show centre lines only. Confirm aperture size, clearance and cut shape on site.",
    );
  }
  for (const q of [t.tileLength, t.tileWidth])
    if (known(q) && q.value <= 0) error("Tile edges must be positive.");
  if (known(t.joint) && t.joint.value < 0)
    error("Grout joint cannot be negative.");
  if (
    known(t.tileLength) &&
    known(t.tileWidth) &&
    known(t.joint) &&
    t.joint.value >= Math.min(t.tileLength.value, t.tileWidth.value)
  )
    warn(
      "floor_tiling_joint",
      "Joint is not smaller than the tile edge; check units.",
    );
  const fv = (e: string) => l.faces.find((f) => f.edge === e)?.value;
  if (l.faces.every((f) => f.value !== undefined)) {
    let x0 = fv("west")!,
      x1 = fv("east")!,
      y0 = fv("north")!,
      y1 = fv("south")!;
    if (t.zone && t.zone !== "room") {
      const zone = room.drainage?.planes.find((p) => p.id === t.zone);
      if (!zone) {
        l.missing.push(`floor zone ${t.zone} no longer exists`);
        return l;
      }
      x0 = Math.max(x0, zone.x);
      x1 = Math.min(x1, zone.x + zone.w);
      y0 = Math.max(y0, zone.y);
      y1 = Math.min(y1, zone.y + zone.h);
    }
    if (x1 <= x0 || y1 <= y0)
      error("Finished faces and chosen zone leave no floor area.");
    else l.bounds = { x0, x1, y0, y1 };
  }
  if (known(t.tileLength) && known(t.tileWidth) && t.axis)
    l.tile =
      t.axis === "x"
        ? { x: t.tileLength.value, y: t.tileWidth.value }
        : { x: t.tileWidth.value, y: t.tileLength.value };
  if (known(t.joint)) l.joint = t.joint.value;
  if (l.bounds && known(t.originX) && known(t.originY) && (l.tile || (t.originXFrom !== "east" && t.originYFrom !== "south")))
    l.origin = {
      // from the east or south face, originX/Y run back into the room to the tile's far edge
      x: quantize(t.originXFrom === "east" ? fv("east")! - t.originX.value - l.tile!.x : fv("west")! + t.originX.value),
      y: quantize(t.originYFrom === "south" ? fv("south")! - t.originY.value - l.tile!.y : fv("north")! + t.originY.value),
    };
  if (
    !l.bounds ||
    !l.tile ||
    !l.origin ||
    l.joint === undefined ||
    !t.zone ||
    l.problems.some((p) => p.severity === "error")
  ) {
    warn(
      "floor_tiling_unresolved",
      "Pattern unresolved: enter the tile, joint, axis, origin, zone and every finished boundary face.",
    );
    return l;
  }
  const { x0, x1, y0, y1 } = l.bounds,
    { x: tx, y: ty } = l.tile,
    { x: ox, y: oy } = l.origin,
    j = l.joint;
  const positionCount =
    (Math.ceil((x1 - x0) / (tx + j)) + 2) *
    (Math.ceil((y1 - y0) / (ty + j)) + 2);
  const canEnumerate =
    Number.isFinite(positionCount) && positionCount <= MAX_PIECES;
  l.cuts = {
    west: boundedEdgeCut(ox, tx, j, x0, x1, "after"),
    east: boundedEdgeCut(ox, tx, j, x0, x1, "before"),
    north: boundedEdgeCut(oy, ty, j, y0, y1, "after"),
    south: boundedEdgeCut(oy, ty, j, y0, y1, "before"),
  };
  const px = tx + j,
    py = ty + j,
    k0 = Math.floor((x0 - ox) / px),
    k1 = Math.ceil((x1 - ox) / px),
    r0 = Math.floor((y0 - oy) / py),
    r1 = Math.ceil((y1 - oy) / py);
  if (!canEnumerate || ![k0, k1, r0, r1].every(Number.isSafeInteger))
    warn(
      "floor_tiling_density",
      "More than 20,000 tile positions; pieces omitted. Increase tile size for a readable drawing.",
    );
  else
    for (let k = k0; k <= k1; k++)
      for (let r = r0; r <= r1; r++) {
        const a = Math.max(x0, ox + k * px),
          b = Math.min(x1, ox + k * px + tx),
          c = Math.max(y0, oy + r * py),
          d = Math.min(y1, oy + r * py + ty);
        if (b - a > EPS && d - c > EPS)
          l.pieces.push({
            x0: quantize(a),
            x1: quantize(b),
            y0: quantize(c),
            y1: quantize(d),
            cut: b - a < tx - EPS || d - c < ty - EPS,
          });
      }
  for (const [edge, c] of Object.entries(l.cuts)) {
    if (!c.full && c.size < Math.min(0.05, c.of / 4))
      warn(
        "floor_tiling_sliver",
        `${edge} cut is ${Math.round(c.size * 10000) / 10} mm: narrow piece for tiler review.`,
      );
    if (c.gap && c.gap > EPS)
      warn(
        "floor_tiling_edge_joint",
        `${edge} boundary falls in a grout joint; confirm the perimeter movement joint.`,
      );
  }
  const crossesPlaneBoundary = (
    piece: FloorTilePiece,
    plane: FloorTileLayout["planes"][number],
  ) => {
    const overlapsY = plane.y < piece.y1 && plane.y + plane.h > piece.y0;
    const overlapsX = plane.x < piece.x1 && plane.x + plane.w > piece.x0;
    const interiorX = (x: number) => x > piece.x0 + EPS && x < piece.x1 - EPS;
    const interiorY = (y: number) => y > piece.y0 + EPS && y < piece.y1 - EPS;
    return (
      (overlapsY && (interiorX(plane.x) || interiorX(plane.x + plane.w))) ||
      (overlapsX && (interiorY(plane.y) || interiorY(plane.y + plane.h)))
    );
  };
  const crossesBreak = l.planes.some((plane) =>
    l.pieces.some((piece) => crossesPlaneBoundary(piece, plane)),
  );
  if (crossesBreak)
    warn(
      "floor_tiling_slope_break",
      "Tiles cross floor-plane boundaries. Confirm slope-break cuts and movement joints with the tiler.",
    );
  const axisRelation = (
    value: number,
    origin: number,
    tile: number,
    pitch: number,
  ) => {
    const offset = quantize((((value - origin) % pitch) + pitch) % pitch);
    return `${Math.round(offset * 10000) / 10} mm after a tile start${offset > tile ? " (in grout joint)" : " (over tile)"}`;
  };
  for (const w of l.wastes) {
    const describe = (p: Pt) =>
      `X ${axisRelation(p.x, ox, tx, px)}, Y ${axisRelation(p.y, oy, ty, py)}`;
    const linear = w.a.x !== w.b.x || w.a.y !== w.b.y;
    const centre = `centre ${linear ? "line start" : "point"}: ${describe(w.a)}${linear ? `; end: ${describe(w.b)}` : ""}`;
    if (!w.grate) {
      w.relation = `${centre}; aperture cut unresolved`;
      continue;
    }
    const xs = w.grate.map((p) => p.x), ys = w.grate.map((p) => p.y);
    const [gx0, gx1, gy0, gy1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const square = w.grate.every((p) => (p.x === gx0 || p.x === gx1) && (p.y === gy0 || p.y === gy1));
    const edges = square
      ? `grate ${Math.round((gx1 - gx0) * 1000)} × ${Math.round((gy1 - gy0) * 1000)} mm; west edge ${axisRelation(gx0, ox, tx, px)}, east edge ${axisRelation(gx1, ox, tx, px)}, north edge ${axisRelation(gy0, oy, ty, py)}, south edge ${axisRelation(gy1, oy, ty, py)}`
      : "grate set at an angle to the tiles; edge relationships not worked out";
    w.relation = `${centre}; ${edges}${w.tileInsert ? "; tile insert: cut a tile piece to fill the insert as well as the opening around it" : ""}`;
  }
  l.basis = weakest(inputs);
  l.resolved = l.missing.length === 0;
  if (l.missing.length)
    warn("floor_tiling_unresolved", `Review fields: ${l.missing.join("; ")}.`);
  return l;
}
/** The layout's own problems. Its drainage problems are left out: the checker reports them once per room. */
export function floorTilingProblems(model: PlanModel) {
  return model.rooms
    .filter((r) => r.floorTiling)
    .flatMap((r) => {
      const drainage = new Set(drainageProblems(r).map((p) => `${p.code}\n${p.message}`));
      return floorTileLayout(model, r)
        .problems.filter((p) => !drainage.has(`${p.code}\n${p.message}`))
        .map((p) => ({
          ...p,
          message: `${r.label} floor tiling: ${p.message}`,
          refs: [r.id],
        }));
    });
}
