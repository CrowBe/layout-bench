/** Standalone printable review, derived from canonical data. All inputs and unknowns survive printing. */
import type { Room } from "../model/types";
import { CABLE_DEPTH_DATUM, heatingEvidence, heatingZones } from "../model/heating";
import { heatingNameSource } from "../model/heatingProduct";
import type { HeatingFigure } from "../model/heatingProduct";
const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const mm = (v: number | undefined) =>
  v === undefined ? "unknown" : `${Math.round(v * 10000) / 10} mm`;
export function heatingPlanSvg(room: Room): string {
  const h = room.heating;
  const pts = [
    { x: room.x, y: room.y },
    { x: room.x + room.w, y: room.y + room.h },
    ...(h?.path ?? []),
    ...[...heatingZones(room), ...(h?.keepouts ?? [])].flatMap((r) => [
      { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h },
    ]),
  ];
  const x = Math.min(...pts.map((p) => p.x)) - 0.1,
    y = Math.min(...pts.map((p) => p.y)) - 0.1;
  const w = Math.max(...pts.map((p) => p.x)) - x + 0.1,
    height = Math.max(...pts.map((p) => p.y)) - y + 0.1;
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Proposed heating plan" viewBox="${x} ${y} ${w} ${height}"><rect x="${room.x}" y="${room.y}" width="${room.w}" height="${room.h}" fill="#f2efe8" stroke="#777" stroke-width=".005"/>${heatingZones(
    room,
  )
    .map(
      (r) =>
        `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="#aa7700" stroke-width=".01" stroke-dasharray=".03 .02"/>`,
    )
    .join(
      "",
    )}${(h?.keepouts ?? []).map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#eecccc" stroke="#b00020" stroke-width=".006"/>`).join("")}<polyline points="${h?.path.map((p) => `${p.x},${p.y}`).join(" ") ?? ""}" fill="none" stroke="#c64c19" stroke-width=".012"/>${h?.path.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r=".02" fill="#c64c19"/><text x="${p.x + 0.025}" y="${p.y - 0.025}" font-size=".06">${i + 1}</text>`).join("") ?? ""}</svg>`;
}
export function heatingSectionSvg(room: Room): string {
  const pts = heatingEvidence(room).section,
    resolved = pts.filter((p) => p.level !== undefined);
  if (!resolved.length)
    return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Heating section unresolved" viewBox="0 0 500 60"><text x="10" y="30" font-size="14">Cable section unresolved — missing levels / cable height</text></svg>`;
  const lo = Math.min(...resolved.flatMap((p) => [p.bottom!, p.level!])),
    hi = Math.max(...resolved.flatMap((p) => [p.top!, p.level!])),
    span = Math.max(0.001, hi - lo);
  const X = (s: number) => 35 + (430 * s) / Math.max(0.001, pts.at(-1)!.s),
    Y = (z: number) => 130 - (100 * (z - lo)) / span;
  const line = (key: "level" | "bottom" | "top", color: string) =>
    pts
      .slice(1)
      .map((p, i) => {
        const a = pts[i];
        return p[key] !== undefined && a[key] !== undefined
          ? `<line x1="${X(a.s)}" y1="${Y(a[key]!)}" x2="${X(p.s)}" y2="${Y(p[key]!)}" stroke="${color}" stroke-width="2"/>`
          : "";
      })
      .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cable section through screed" viewBox="0 0 500 170">${line("top", "#777")}${line("bottom", "#777")}${line("level", "#c64c19")}<text x="10" y="16" font-size="11">Profile ${esc(mm(lo))} to ${esc(mm(hi))} above ${esc(room.floorBuildUp?.datum ?? "datum")}</text><text x="10" y="155" font-size="11">Grey = screed faces; orange = proposed centre from ${esc(CABLE_DEPTH_DATUM)}; horizontal distance is plan projection; vertically exaggerated</text></svg>`;
}
const fig = (f: HeatingFigure | undefined) =>
  !f || f.value === undefined
    ? `unknown (${esc(f?.kind ?? "unknown")}${f?.note ? `; ${esc(f.note)}` : ""})`
    : `${esc(f.value)} ${esc(f.unit)} · ${esc(f.kind)}${f.formula ? ` · ${esc(f.formula)}` : ""}${f.source ? ` · ${esc(f.source)}` : ""}`;
const figRow = (label: string, f: HeatingFigure | undefined) =>
  `<tr><td>${esc(label)}</td><td>${fig(f)}</td><td>${esc(f?.kind ?? "unknown")}${f?.formula ? ` · ${esc(f.formula)}` : ""}${f?.origin ? ` · ${esc(f.origin)}` : ""}${f?.source ? ` · ${esc(f.source)}` : ""}${f?.note ? ` · ${esc(f.note)}` : ""}</td></tr>`;
export function renderHeatingReview(room: Room): string {
  const h = room.heating,
    e = heatingEvidence(room);
  const fields = [
    "productSource",
    "requirements",
    "screedLayerId",
  ] as const;
  const entered = [
    ["minSpacing", "Entered minimum spacing", "mm", 1000],
    ["edgeClearance", "Entered clearance", "mm", 1000],
    ["depthFromBottom", "Cable centre above screed bottom", "mm", 1000],
  ] as const;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Proposed heating review</title><style>@page{size:A4;margin:15mm}body{font:12px system-ui;color:#29261f;max-width:900px;margin:auto}h1{font-size:22px}svg{max-width:100%;height:320px}table{border-collapse:collapse;width:100%;margin:14px 0}td,th{border:1px solid #ccc;padding:5px;text-align:left;overflow-wrap:anywhere}th{background:#f2efe8}p,li{overflow-wrap:anywhere}tr{break-inside:avoid}.section svg{height:180px}.warn{color:#a33812}</style></head><body><h1>${esc(room.label)} · proposed in-screed heating</h1><p class="warn">Planning and communication only. Manufacturer / electrician approval pending; not an electrical installation or compliance approval.</p>${heatingPlanSvg(room)}<p>Plan route length: ${e.planRouteLength} m · Spatial route length (sampled profile): ${e.routeLength === undefined ? "unknown" : e.routeLength + " m"} · selected zone footprint: ${e.selectedArea} m² · zone area excluding entered keep-outs: ${e.availableArea} m². ${esc(e.coverageNote)} ${esc(e.lengthNote)}</p><p>Minimum non-adjacent spacing: ${mm(e.minimumNonAdjacentSpacing)} · boundary clearance: ${mm(e.edgeDistance)} · keep-out clearance: ${mm(e.keepoutDistance)} · remaining confirmed cable length: ${e.remainingProductLength === undefined ? "unknown" : e.remainingProductLength + " m"}.</p><p>Cable depth datum: ${esc(e.datums.cableDepth)}. Wall setback datum: ${esc(e.datums.wallSetback)}. ${esc(e.spacingNote)}</p><table><tr><th>Product / constraint</th><th>Value</th><th>Kind / source</th></tr><tr><td>manufacturer</td><td>${esc(e.cable.manufacturer || "unknown")}</td><td>${esc(heatingNameSource(e.cable.manufacturerOrigin) ?? "unknown")}</td></tr><tr><td>model</td><td>${esc(e.cable.model || "unknown")}</td><td>${esc(heatingNameSource(e.cable.modelOrigin) ?? "unknown")}</td></tr>${fields.map((k) => `<tr><td>${k}</td><td>${esc(h?.[k] || "unknown")}</td><td>User-entered text</td></tr>`).join("")}${figRow("Cable product length", e.cable.length)}${figRow("Rated output", e.cable.ratedOutput)}${figRow("Coverage area, minimum", e.cable.coverageMin)}${figRow("Coverage area, maximum", e.cable.coverageMax)}${figRow("Derived spacing, minimum", e.cable.spacingMin)}${figRow("Derived spacing, maximum", e.cable.spacingMax)}${figRow("Cable rated current", e.cable.ratedCurrent)}${figRow("Cable rated voltage", e.cable.ratedVoltage)}${figRow("Thermostat rated switching current", e.thermostat.ratedCurrent)}${figRow("Thermostat rated voltage, minimum", e.thermostat.voltageMin)}${figRow("Thermostat rated voltage, maximum", e.thermostat.voltageMax)}${figRow("Plan route length", e.figures.planRouteLength)}${figRow("Spatial route length", e.figures.spatialRouteLength)}${figRow("Remaining confirmed product length", e.figures.remainingProductLength)}<tr><td>Thermostat printed IP</td><td>${esc(e.thermostat.ingressProtection?.value ?? "unknown")} · ${esc(e.thermostat.ingressProtection?.kind ?? "unknown")}</td><td>${esc(e.thermostat.ingressProtection?.source ?? e.thermostat.ingressProtection?.note ?? "unknown")}</td></tr>${entered.map(([k, label, unit, scale]) => `<tr><td>${label}</td><td>${h?.[k]?.value === undefined ? "unknown" : esc(h[k]!.value! * scale) + " " + unit}</td><td>${esc(h?.[k]?.status ?? "unknown")} · ${esc(h?.[k]?.source ?? "source not supplied")}</td></tr>`).join("")}</table><p>Selected zones: ${esc(h?.zoneIds.join(", ") || "unknown")}</p><p>${esc(e.sectionNote)}</p><div class="section">${heatingSectionSvg(room)}</div><table><tr><th>Plan route distance (m)</th><th>Plan x / y (mm)</th><th>Screed bottom / cable / top above datum</th><th>Basis or missing</th></tr>${e.section.map((p) => `<tr><td>${p.s}</td><td>${mm(p.x)} / ${mm(p.y)}</td><td>${mm(p.bottom)} / ${mm(p.level)} / ${mm(p.top)}</td><td>${esc(p.level === undefined ? p.missing.join(", ") : p.basis)}</td></tr>`).join("")}</table><table><tr><th>Keep-out</th><th>x / y / width / height (mm)</th><th>Source</th></tr>${(h?.keepouts ?? []).map((r) => `<tr><td>${esc(r.label)}</td><td>${[r.x, r.y, r.w, r.h].map(mm).join(" / ")}</td><td>${esc(r.source || "unknown")}</td></tr>`).join("")}</table><ul>${e.problems.map((p) => `<li>${esc(p.severity + " · " + p.code + ": " + p.message)}</li>`).join("")}</ul></body></html>`;
}
