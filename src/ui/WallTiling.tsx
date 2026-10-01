/**
 * Wall tile set-out (#9) in the wall Inspector: the proposed inputs for one side, an editable
 * elevation (drag the red origin tile, or nudge it 10 mm), the cut table, what is unresolved,
 * and the printable A3 sheet. Edits go through actions.setWallTiling, the same action
 * set_wall_tiling calls. A blank value is unknown and stays unknown; nothing is defaulted.
 */

import { useRef, useState } from "react";
import { actions, logActivity, useAppStore, type TilingPatch } from "../model/store";
import { formatMm, quantize, segLen } from "../model/geometry";
import { FLOOR_LABELS, REFERENCE_LABELS, TILE_FLOOR_REFERENCES, TILE_ORIENTATIONS, TILE_REFERENCES, tilingLayout, type TilingLayout } from "../model/tiling";
import { cutRows, renderTilingSheet } from "../sheets/tiling";
import type { Wall, WallSideName } from "../model/types";
import { QuantityField, toInput } from "./WallFaces";
import { download } from "./download";

const run = (wall: Wall, side: WallSideName, patch: TilingPatch) => {
  const r = actions.setWallTiling(wall.id, side, patch);
  logActivity("human", "set_wall_tiling", r.summary, r.ok);
  return r;
};

/** Print the sheet alone, sized to A3 landscape (the same route as the Sheets tab). */
function printSheet(svg: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><title>Wall tile set-out</title><style>@page{size:A3 landscape;margin:0}html,body{margin:0}svg{display:block;width:420mm;height:297mm}</style>${svg}`);
  w.document.close();
  w.focus();
  w.print();
}

/**
 * The elevation, looking at the face: end A on the left. The origin tile can be dragged; the
 * drop is stored as the new origin, rounded to 1 mm, with the status the origin already had
 * (proposed when it had none).
 */
function Elevation({ wall, side, layout, onMoveOrigin }: {
  wall: Wall;
  side: WallSideName;
  layout: TilingLayout;
  onMoveOrigin: (ds: number, dz: number) => void;
}) {
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  const top = Math.max(wall.height, layout.band?.z1 ?? 0);
  const W = 300;
  const pad = 14;
  const k = (W - 2 * pad) / len;
  const H = top * k + 2 * pad;
  const X = (s: number) => pad + s * k;
  const Y = (z: number) => H - pad - z * k;
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const toLocal = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const o = layout.origin, t = layout.tile;
  return (
    <svg ref={svgRef} className="tile-elevation" role="img" aria-label={`Wall ${wall.id} ${side} side tile elevation`} viewBox={`0 0 ${W} ${H}`} width="100%"
      onPointerMove={(e) => { if (drag) { const p = toLocal(e); setDrag({ ...drag, dx: p.x - drag.x, dy: p.y - drag.y }); } }}
      onPointerUp={() => {
        if (!drag) return;
        const ds = quantize(Math.round((drag.dx / k) * 1000) / 1000);
        const dz = quantize(Math.round((-drag.dy / k) * 1000) / 1000);
        setDrag(null);
        if (ds || dz) onMoveOrigin(ds, dz);
      }}
      onPointerLeave={() => setDrag(null)}>
      <rect x={X(0)} y={Y(wall.height)} width={len * k} height={wall.height * k} fill="#f4f1ea" stroke="#b8b0a0" strokeWidth={0.6} />
      <line x1={X(0) - 6} x2={X(len) + 6} y1={Y(0)} y2={Y(0)} stroke="#333" strokeWidth={0.8} />
      <text x={X(0)} y={pad - 4} fontSize={8} textAnchor="middle">A</text>
      <text x={X(len)} y={pad - 4} fontSize={8} textAnchor="middle">B</text>
      {layout.pieces.map((p, i) => (
        <rect key={i} data-piece={p.cut ? "cut" : "full"} x={X(p.s0)} y={Y(p.z1)} width={(p.s1 - p.s0) * k} height={(p.z1 - p.z0) * k}
          fill={p.cut ? "#f3d2b3" : "#fff"} stroke="#6b6255" strokeWidth={0.3} />
      ))}
      {layout.openings.map((op) => (
        <rect key={op.openingId} x={X(op.s0)} y={Y(op.z1)} width={(op.s1 - op.s0) * k} height={(op.z1 - op.z0) * k} fill="#dfe9f2" stroke="#2f78b7" strokeWidth={0.6} />
      ))}
      {[layout.limits.a, layout.limits.b].map((l) => l.s !== undefined && (
        <line key={l.end} x1={X(l.s)} x2={X(l.s)} y1={Y(top) - 4} y2={Y(0) + 4} stroke="#8a5a1c" strokeDasharray="3 2" strokeWidth={0.7} />
      ))}
      {layout.band && <line x1={X(0)} x2={X(len)} y1={Y(layout.band.z0)} y2={Y(layout.band.z0)} stroke="#1a7f37" strokeWidth={0.8} />}
      {o && t && (
        <rect data-role="origin-tile" x={X(o.s) + (drag?.dx ?? 0)} y={Y(o.z + t.up) + (drag?.dy ?? 0)} width={t.along * k} height={t.up * k}
          fill="rgba(176,0,32,0.08)" stroke="#b00020" strokeWidth={1.2} style={{ cursor: "move", touchAction: "none" }}
          onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); const p = toLocal(e); setDrag({ x: p.x, y: p.y, dx: 0, dy: 0 }); }} />
      )}
      {!layout.cuts && <text x={W / 2} y={H / 2} fontSize={9} textAnchor="middle" fill="#b00020">unresolved: no pattern until every input is known</text>}
      <text x={pad} y={H - 2} fontSize={7} fill="#b00020">PROPOSED · not as-built</text>
    </svg>
  );
}

export function WallTiling({ wall, roomFor }: { wall: Wall; roomFor: (side: WallSideName) => string | null }) {
  const model = useAppStore((s) => s.model);
  const [side, setSide] = useState<WallSideName>(() => (wall.tiling?.left && !wall.tiling?.right ? "left" : "right"));
  const t = wall.tiling?.[side];
  const layout = tilingLayout(model, wall, side);
  const set = (patch: TilingPatch) => run(wall, side, patch);
  const moveOrigin = (ds: number, dz: number) => {
    // dragging right moves the tile toward B: along from A grows, along from B shrinks
    const sign = t?.originFrom === "b" ? -1 : 1;
    const patch: TilingPatch = {};
    if (ds && t?.originAlong?.value !== undefined) patch.originAlong = { ...toInput(t.originAlong)!, value: quantize(t.originAlong.value + sign * ds), status: t.originAlong.status ?? "proposed" };
    if (dz && t?.originUp?.value !== undefined) patch.originUp = { ...toInput(t.originUp)!, value: quantize(t.originUp.value + dz), status: t.originUp.status ?? "proposed" };
    if (Object.keys(patch).length) set(patch);
  };
  const select = <K extends "orientation" | "reference" | "floor" | "originFrom">(key: K, label: string, options: readonly string[], names?: Record<string, string>) => (
    <label className="field inspector-field">
      {label}
      <select aria-label={label} value={(t?.[key] as string | undefined) ?? ""} onChange={(e) => set({ [key]: e.target.value || null } as TilingPatch)}>
        <option value="">— not chosen —</option>
        {options.map((o) => <option key={o} value={o}>{names?.[o] ?? o}</option>)}
      </select>
    </label>
  );
  const rows = cutRows(layout);
  const sheet = () => renderTilingSheet(model, wall.id, side);
  const fileName = `${model.name.replace(/[^\w-]+/g, "-")}-${wall.id}-${side}-tiling.svg`;

  return (
    <section className="wall-tiling" aria-label="Wall tiling">
      <strong>Tile set-out (proposed)</strong>
      <div className="face-sides" role="tablist">
        {(["left", "right"] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={side === s} className={side === s ? "active" : ""} onClick={() => setSide(s)}>
            {s === "left" ? "Left" : "Right"} side{roomFor(s) ? ` · ${roomFor(s)}` : ""}
          </button>
        ))}
      </div>
      <span className="hint">Your proposal for the tiler. Sizes are mm; blank = unknown. Never recorded as built.</span>
      <QuantityField label="Tile length, long edge (mm)" q={t?.tileLength} onCommit={(q) => set({ tileLength: q })} />
      <QuantityField label="Tile width, short edge (mm)" q={t?.tileWidth} onCommit={(q) => set({ tileWidth: q })} />
      {select("orientation", "Orientation", TILE_ORIENTATIONS, { landscape: "landscape (long edge along)", portrait: "portrait (long edge up)" })}
      <QuantityField label="Grout joint (mm)" q={t?.joint} onCommit={(q) => set({ joint: q })} />
      {select("reference", "Cut ends to", TILE_REFERENCES, REFERENCE_LABELS)}
      {select("floor", "Courses from", TILE_FLOOR_REFERENCES, FLOOR_LABELS)}
      {select("originFrom", "Origin measured from", ["a", "b", "centre"], { a: "end A limit face", b: "end B limit face", centre: "run centre" })}
      <QuantityField label="Origin along (mm)" q={t?.originAlong} onCommit={(q) => set({ originAlong: q })} />
      <QuantityField label="Origin up from floor reference (mm)" q={t?.originUp} onCommit={(q) => set({ originUp: q })} />
      <QuantityField label="Tiled height above floor reference (mm)" q={t?.tiledHeight} onCommit={(q) => set({ tiledHeight: q })} />
      <Elevation wall={wall} side={side} layout={layout} onMoveOrigin={moveOrigin} />
      <div className="tile-nudge">
        <span className="hint">Move origin</span>
        <button type="button" aria-label="Move origin 10 mm toward A" disabled={!layout.origin} onClick={() => moveOrigin(-0.01, 0)}>← 10</button>
        <button type="button" aria-label="Move origin 10 mm toward B" disabled={!layout.origin} onClick={() => moveOrigin(0.01, 0)}>10 →</button>
        <button type="button" aria-label="Move origin 10 mm down" disabled={!layout.origin} onClick={() => moveOrigin(0, -0.01)}>↓ 10</button>
        <button type="button" aria-label="Move origin 10 mm up" disabled={!layout.origin} onClick={() => moveOrigin(0, 0.01)}>↑ 10</button>
      </div>
      <span className="hint">
        Ends cut to: {layout.limits.a.label} · {layout.limits.b.label}. Courses from {layout.floor.label}
        {layout.floor.level !== undefined ? ` (+${formatMm(layout.floor.level)} mm above ${layout.floor.datum})` : ""}.
      </span>
      <table className="face-table" aria-label="Tile cuts">
        <thead><tr><th>Cut</th><th>mm</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.key} data-cut={r.key}><td>{r.label}</td><td>{r.value}</td></tr>)}
        </tbody>
      </table>
      {layout.missing.length > 0 && (
        <ul className="tile-missing" aria-label="Unresolved tiling inputs">
          {layout.missing.map((m) => <li key={m} className="inspector-warn">Unknown: {m}</li>)}
        </ul>
      )}
      {layout.problems.filter((p) => p.code !== "tiling_unresolved").map((p) => <span key={p.message} className={p.severity === "error" ? "inspector-error" : "inspector-warn"}>{p.message}</span>)}
      <div className="sheets-actions">
        <button type="button" onClick={() => download(fileName, sheet(), "image/svg+xml")}>Download set-out (SVG)</button>
        <button type="button" onClick={() => printSheet(sheet())}>Print / save as PDF</button>
        {t && <button type="button" onClick={() => set({ clear: true })}>Clear set-out</button>}
      </div>
    </section>
  );
}
