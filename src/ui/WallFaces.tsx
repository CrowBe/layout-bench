/**
 * Wall reference faces (#4) in the Inspector: one side at a time, its existing surface, frame
 * face and proposed build-up, a small section, and every face's offset from a chosen
 * reference face. Edits go through actions.setWallSide, the same action set_wall_side calls.
 * A blank value is unknown and stays unknown; faces beyond it read "unresolved".
 */

import { useEffect, useState } from "react";
import { actions, logActivity, type LayerInput, type QuantityInput, type WallSidePatch } from "../model/store";
import { formatMm } from "../model/geometry";
import { LAYER_KINDS, LAYER_LABELS, VALUE_STATUSES, layerLabel, sideFaces, type FaceResult } from "../model/faces";
import type { LayerKind, Quantity, ValueStatus, Wall, WallSide, WallSideName } from "../model/types";

const run = (wall: Wall, side: WallSideName, patch: WallSidePatch) => {
  const r = actions.setWallSide(wall.id, side, patch);
  logActivity("human", "set_wall_side", r.summary, r.ok);
  return r;
};

export const toInput = (q: Quantity | undefined): QuantityInput | null =>
  q ? { value: q.value ?? null, ...(q.status ? { status: q.status } : {}), ...(q.source ? { source: q.source } : {}) } : null;

const layerInputs = (s: WallSide | undefined): LayerInput[] =>
  (s?.layers ?? []).map((l) => ({ id: l.id, kind: l.kind, name: l.name, thickness: toInput(l.thickness) }));

/** Millimetre value plus status. Blank means unknown. */
export function QuantityField({ label, q, onCommit, scale = 1000 }: {
  label: string;
  scale?: number;
  q: Quantity | undefined;
  onCommit: (next: QuantityInput | null) => { ok: boolean; summary: string };
}) {
  const shown = q?.value !== undefined ? (scale === 1000 ? formatMm(q.value) : String(q.value * scale)) : "";
  const [draft, setDraft] = useState(shown);
  const [status, setStatus] = useState<ValueStatus | "">(q?.status ?? "");
  const [error, setError] = useState("");
  useEffect(() => { setDraft(shown); setStatus(q?.status ?? ""); }, [shown, q?.status]);

  const commit = (nextStatus = status) => {
    const text = draft.trim();
    if (text === shown && nextStatus === (q?.status ?? "")) return;
    if (text === "") {
      const r = onCommit(q?.source ? { value: null, source: q.source } : null);
      setError(r.ok ? "" : r.summary);
      return;
    }
    const n = Number(text);
    if (!Number.isFinite(n)) { setError(`"${text}" is not a number.`); return; }
    if (!nextStatus) { setError("Choose how this value is known before it is stored."); return; }
    const r = onCommit({ value: n / scale, status: nextStatus, ...(q?.source ? { source: q.source } : {}) });
    setError(r.ok ? "" : r.summary);
  };

  return (
    <div className="face-field">
      <label className="field inspector-field">
        {label}
        <input
          inputMode="decimal"
          placeholder="unknown"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setDraft(shown); }}
        />
      </label>
      <select aria-label={`${label} status`} value={status} onChange={(e) => { const s = e.target.value as ValueStatus | ""; setStatus(s); commit(s); }}>
        <option value="">— status —</option>
        {VALUE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      {error && <span className="inspector-error" role="alert">{error}</span>}
    </div>
  );
}

/** A horizontal section through the side: frame at left, layers stacked toward the room. */
function Section({ spec, faces }: { spec: WallSide | undefined; faces: FaceResult[] }) {
  const layers = spec?.layers ?? [];
  const PX = 4; // px per mm
  const UNKNOWN_W = 24;
  const x0 = 34;
  let x = x0;
  const rects = layers.map((l) => {
    const t = l.thickness.value;
    const w = t !== undefined ? Math.max(2, t * 1000 * PX) : UNKNOWN_W;
    const r = { l, x, w, unknown: t === undefined };
    x += w;
    return r;
  });
  const frame = faces.find((f) => f.face === "frame");
  const existing = faces.find((f) => f.face === "existing");
  const existingX = frame?.resolved && existing?.resolved ? x0 + (existing.offset! - frame.offset!) * 1000 * PX : null;
  const width = Math.max(x + 70, (existingX ?? 0) + 40, 200);
  const fill: Record<LayerKind, string> = { board: "#d9d2c3", waterproofing: "#8fb3cf", adhesive: "#c9c2b0", tile: "#f2efe8" };
  return (
    <svg className="face-section" role="img" aria-label="Wall side section" width="100%" viewBox={`0 0 ${width} 74`}>
      <rect x={0} y={10} width={x0} height={44} fill="#b88c5a" opacity={frame?.resolved ? 1 : 0.35} />
      <text x={x0 / 2} y={66} fontSize={9} textAnchor="middle" fill="#6b6255">frame{frame?.resolved ? "" : " ?"}</text>
      {rects.map((r) => (
        <g key={r.l.id}>
          <rect x={r.x} y={10} width={r.w} height={44} fill={r.unknown ? "none" : fill[r.l.kind]} stroke={r.unknown ? "#c0392b" : "#6b6255"} strokeDasharray={r.unknown ? "3 2" : undefined} strokeWidth={0.8} />
          {r.unknown && <text x={r.x + r.w / 2} y={36} fontSize={11} textAnchor="middle" fill="#c0392b">?</text>}
        </g>
      ))}
      <text x={x + 6} y={36} fontSize={9} fill="#6b6255">room →</text>
      {existingX !== null && (
        <g>
          <line x1={existingX} y1={2} x2={existingX} y2={62} stroke="#4f86b0" strokeDasharray="4 3" />
          <text x={existingX + 3} y={8} fontSize={8} fill="#4f86b0">existing</text>
        </g>
      )}
    </svg>
  );
}

export function WallFaces({ wall, roomFor }: { wall: Wall; roomFor: (side: WallSideName) => string | null }) {
  const [side, setSide] = useState<WallSideName>("left");
  const [reference, setReference] = useState("frame");
  const [newKind, setNewKind] = useState<LayerKind>("board");
  const spec = wall.sides?.[side];
  const faces = sideFaces(spec);
  const ref = faces.find((f) => f.face === reference) ?? faces[1];
  const layers = layerInputs(spec);
  const setLayers = (next: LayerInput[]) => run(wall, side, { layers: next });

  return (
    <section className="wall-faces" aria-label="Wall faces">
      <strong>Reference faces</strong>
      <div className="face-sides" role="tablist">
        {(["left", "right"] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={side === s} className={side === s ? "active" : ""} onClick={() => setSide(s)}>
            {s === "left" ? "Left" : "Right"} side{roomFor(s) ? ` · ${roomFor(s)}` : ""}
          </button>
        ))}
      </div>
      <span className="hint">Positions are mm from the drawn wall line toward this side (A→B, {side}). Blank = unknown.</span>
      <QuantityField label="Existing surface (mm)" q={spec?.existing} onCommit={(q) => run(wall, side, { existing: q })} />
      <QuantityField label="Frame face (mm)" q={spec?.frame} onCommit={(q) => run(wall, side, { frame: q })} />
      <div className="face-layers">
        <span className="hint">Build-up, from the frame out</span>
        {spec?.layers.map((l, i) => (
          <div key={l.id} className="face-layer">
            <input aria-label={`Layer ${i + 1} name`} defaultValue={l.name} placeholder={LAYER_LABELS[l.kind]}
              onBlur={(e) => { if (e.target.value.trim() !== l.name) setLayers(layers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))); }} />
            <button type="button" aria-label={`Remove ${layerLabel(l)}`} onClick={() => setLayers(layers.filter((_, j) => j !== i))}>Remove</button>
            <QuantityField label={`${layerLabel(l)} thickness (mm)`} q={l.thickness}
              onCommit={(q) => setLayers(layers.map((x, j) => (j === i ? { ...x, thickness: q } : x)))} />
          </div>
        ))}
        <div className="face-add">
          <select aria-label="New layer kind" value={newKind} onChange={(e) => setNewKind(e.target.value as LayerKind)}>
            {LAYER_KINDS.map((k) => <option key={k} value={k}>{LAYER_LABELS[k]}</option>)}
          </select>
          <button type="button" onClick={() => setLayers([...layers, { kind: newKind }])}>Add layer</button>
        </div>
      </div>
      <Section spec={spec} faces={faces} />
      <label className="field inspector-field">
        Measure from
        <select aria-label="Reference face" value={ref.face} onChange={(e) => setReference(e.target.value)}>
          {faces.map((f) => <option key={f.face} value={f.face}>{f.label}</option>)}
        </select>
      </label>
      <table className="face-table" aria-label="Face offsets">
        <thead><tr><th>Face</th><th>From line</th><th>From {ref.label.toLowerCase()}</th><th>Basis</th></tr></thead>
        <tbody>
          {faces.map((f) => (
            <tr key={f.face} data-face={f.face}>
              <td>{f.label}</td>
              <td>{f.resolved ? `${formatMm(f.offset!)} mm` : "unresolved"}</td>
              <td>{f.resolved && ref.resolved ? `${formatMm(f.offset! - ref.offset!)} mm` : "unresolved"}</td>
              <td title={f.missing.length ? `Missing: ${f.missing.join(", ")}` : f.inputs.map((x) => `${x.field}: ${x.status}`).join("; ")}>
                {f.resolved ? f.basis : `missing ${f.missing.join(", ")}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
