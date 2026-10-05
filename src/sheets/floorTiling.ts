/** Shared canonical floor pattern drawing used in the Inspector and printable SVG. */
import type { PlanModel, Room } from "../model/types";
import { floorTileLayout, type FloorTileLayout } from "../model/floorTiling";
import { esc, f1, mm, tag } from "./floorPlan";
export function floorCutRows(l: FloorTileLayout) {
  return (["west", "east", "north", "south"] as const).map((edge) => ({
    edge,
    value: l.cuts
      ? `${mm(l.cuts[edge].size)}${l.cuts[edge].full ? " (full)" : ""}${l.cuts[edge].gap ? ` + ${mm(l.cuts[edge].gap!)} gap` : ""}`
      : "?",
  }));
}
export function floorTileDrawing(l: FloorTileLayout, room: Room): string {
  const b = l.bounds ?? {
    x0: room.x,
    x1: room.x + room.w,
    y0: room.y,
    y1: room.y + room.h,
  };
  const k = 250 / Math.max(b.x1 - b.x0, b.y1 - b.y0),
    X = (x: number) => 25 + (x - b.x0) * k,
    Y = (y: number) => 25 + (y - b.y0) * k;
  const line = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    extra: string,
  ) =>
    `<line x1="${f1(X(a.x))}" y1="${f1(Y(a.y))}" x2="${f1(X(b.x))}" y2="${f1(Y(b.y))}" ${extra}/>`;
  const rect = (x: number, y: number, w: number, h: number, extra: string) =>
    `<rect x="${f1(X(x))}" y="${f1(Y(y))}" width="${f1(w * k)}" height="${f1(h * k)}" ${extra}/>`;
  const parts = [
    rect(
      b.x0,
      b.y0,
      b.x1 - b.x0,
      b.y1 - b.y0,
      'fill="#f4f1ea" stroke="#222" stroke-width="1"',
    ),
  ];
  parts.push(
    ...l.pieces.map((p) =>
      rect(
        p.x0,
        p.y0,
        p.x1 - p.x0,
        p.y1 - p.y0,
        `data-piece="${p.cut ? "cut" : "full"}" fill="${p.cut ? "#f3d2b3" : "#fff"}" stroke="#6b6255" stroke-width="0.4"`,
      ),
    ),
  );
  // Clip drainage and transitions to chosen zone: sourced geometry remains canonical.
  parts.push(
    `<defs><clipPath id="floor-tile-clip">${rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, "")}</clipPath></defs><g clip-path="url(#floor-tile-clip)">`,
  );
  for (const p of l.planes)
    parts.push(
      rect(
        p.x,
        p.y,
        p.w,
        p.h,
        `data-plane="${esc(p.id)}" fill="none" stroke="#1a7f37" stroke-width="1" stroke-dasharray="4 2"`,
      ),
      `<text x="${f1(X(p.x) + 3)}" y="${f1(Y(p.y) + 25)}" font-size="7" fill="#1a7f37">${esc(p.label)}${p.resolved ? "" : " ?"}</text>`,
    );
  for (const [index, w] of l.wastes.entries())
    parts.push(
      line(
        w.a,
        w.b,
        `data-waste="${esc(w.id)}" stroke="#7a5230" stroke-width="3"`,
      ),
      `<circle cx="${f1(X(w.a.x))}" cy="${f1(Y(w.a.y))}" r="3" fill="#7a5230"/>`,
      `<text x="${f1(X((w.a.x + w.b.x) / 2) + 5)}" y="${f1(Y((w.a.y + w.b.y) / 2) + 14)}" font-size="7" fill="#7a5230">W${index + 1} c/l</text>`,
    );
  parts.push("</g>");
  for (const d of l.doors)
    parts.push(
      line(
        d.a,
        d.b,
        `data-door="${esc(d.id)}" stroke="#2f78b7" stroke-width="3" stroke-dasharray="3 2"`,
      ),
    );
  if (l.origin) {
    const o = l.origin;
    parts.push(
      line(
        { x: o.x - 0.1, y: o.y },
        { x: o.x + 0.1, y: o.y },
        'stroke="#b00020" stroke-width="1"',
      ),
      line(
        { x: o.x, y: o.y - 0.1 },
        { x: o.x, y: o.y + 0.1 },
        'stroke="#b00020" stroke-width="1"',
      ),
    );
  }
  const text = (x: number, y: number, t: string) =>
    `<text x="${x}" y="${y}" font-size="8" text-anchor="middle">${esc(t)}</text>`;
  parts.push(
    text(
      25 + ((b.x1 - b.x0) * k) / 2,
      15,
      `${mm(b.x1 - b.x0)} mm ${l.bounds ? tag(l.basis) : "?"}`,
    ),
    text(
      25 + ((b.x1 - b.x0) * k) / 2,
      290,
      `${mm(b.y1 - b.y0)} mm ${l.bounds ? tag(l.basis) : "?"} depth`,
    ),
  );
  if (!l.cuts) parts.push(text(150, 140, "UNRESOLVED: no tile pattern"));
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Proposed floor tile plan" viewBox="0 0 310 310" data-status="proposed">${parts.join("\n")}</svg>`;
}
export function renderFloorTilingSheet(model: PlanModel, room: Room): string {
  const l = floorTileLayout(model, room),
    t = room.floorTiling;
  const rows = [
    `PROPOSED FLOOR TILE SET-OUT · ${model.name} · ${room.label}`,
    "FOR TILER REVIEW · NOT AS-BUILT · NOT FOR ORDERING",
    `Zone: ${t?.zone ?? "?"} · long edge axis: ${t?.axis ?? "?"}`,
    `Origin: a tile's ${t?.originXFrom === "east" ? "east" : "west"} edge from the finished ${t?.originXFrom ?? "west"} face, its ${t?.originYFrom === "south" ? "south" : "north"} edge from the finished ${t?.originYFrom ?? "north"} face.`,
    `X ${t?.originX?.value === undefined ? "?" : mm(t.originX.value) + " " + tag(t.originX.status)} mm · Y ${t?.originY?.value === undefined ? "?" : mm(t.originY.value) + " " + tag(t.originY.status)} mm`,
    ...l.inputs
      .filter((i) => !i.field.includes("finished face"))
      .map(
        (i) =>
          `${i.field}: ${i.value === null ? "?" : mm(i.value)} mm ${tag(i.status)}`,
      ),
    ...l.faces.map(
      (f) =>
        `${f.label}: ${f.value === undefined ? "?" : mm(f.value)} mm ${tag(f.basis)}`,
    ),
    ...floorCutRows(l).map((c) => `${c.edge} cut: ${c.value} mm`),
    "Legend: orange cut · white full · red origin axes",
    "Green dashed fall planes · brown waste c/l · blue doorway",
    "SC site-confirmed · M measured · PUB published · P proposed · E estimated · ? unknown",
    "Confirm perimeter / doorway joints, drain apertures and slope-break cuts.",
    ...(t?.note ? [`Field note: ${t.note}`] : []),
    ...l.wastes.map(
      (w, i) =>
        `W${i + 1} ${w.label}: ${w.relation ?? "grid relationship unresolved"}`,
    ),
    ...l.missing.map((m) => `UNRESOLVED: ${m}`),
    ...l.problems
      .filter((p) => p.code !== "floor_tiling_unresolved")
      .map((p) => `REVIEW: ${p.message}`),
  ];
  // Wrap every field; grow a notes page instead of silently truncating unresolved fields.
  const wrapped = rows.flatMap((s) => {
    const lines = [];
    let cur = "";
    for (const word of s.split(" ")) {
      if ((cur + " " + word).length > 82 && cur) {
        lines.push(cur);
        cur = word;
      } else cur = (cur + " " + word).trim();
    }
    if (cur) lines.push(cur);
    return lines;
  });
  const pages = Math.max(1, Math.ceil(wrapped.length / 64));
  let text = "";
  wrapped.forEach((s, i) => {
    const page = Math.floor(i / 64);
    text += `<text x="${page ? 12 : 227}" y="${14 + (i % 64) * 4.1 + page * 297}" font-size="2.2">${esc(s)}</text>`;
  });
  const diagram = floorTileDrawing(l, room).replace(
    'viewBox="0 0 310 310"',
    'x="12" y="24" width="205" height="230" viewBox="0 0 310 310"',
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="${297 * pages}mm" viewBox="0 0 420 ${297 * pages}" font-family="Helvetica,Arial,sans-serif" data-sheet="floor-tiling" data-status="proposed"><rect width="420" height="${297 * pages}" fill="white"/>${diagram}${text}<text x="12" y="275" font-size="2.4">Diagram scaled to fit; use written dimensions in mm. Plan X right, Y down.</text></svg>`;
}

/** Split the exported notes strip into true A3 pages for browser printing. */
export function floorTilingPrintHtml(svg: string): string {
  const height = Number(svg.match(/height="(\d+)mm"/)?.[1] ?? 297);
  const pageCount = Math.max(1, Math.ceil(height / 297));
  const pages = Array.from({ length: pageCount }, (_, i) =>
    svg
      .replace(/height="\d+mm"/, 'height="297mm"')
      .replace(/viewBox="0 0 420 \d+"/, `viewBox="0 ${i * 297} 420 297"`),
  );
  return `<!doctype html><title>Floor tile set-out</title><style>@page{size:A3 landscape;margin:0}html,body{margin:0}.sheet{break-after:page}.sheet:last-child{break-after:auto}svg{display:block;width:420mm;height:297mm}</style>${pages.map((page) => `<div class="sheet">${page}</div>`).join("")}`;
}
