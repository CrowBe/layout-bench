/**
 * Floor assembly (#6) in the Inspector: datum, substrate top, the layers above it, a small
 * section and the resolved level of each. Edits go through actions.setRoomFloor, the same
 * action set_room_floor calls. A blank value is unknown; levels above it read "unresolved".
 */

import { CABLE_DEPTH_DATUM, heatingSection } from "../model/heating";
import { useState } from "react";
import { actions, logActivity, type FloorLayerInput, type FloorPatch } from "../model/store";
import { formatMm } from "../model/geometry";
import { DEFAULT_DATUM, FLOOR_LAYER_KINDS, FLOOR_LAYER_LABELS, floorLayerLabel, floorLevels, floorFill } from "../model/floor";
import type { FloorLayerKind, Room } from "../model/types";
import { QuantityField, toInput } from "./WallFaces";

const run = (room: Room, patch: FloorPatch) => {
  const r = actions.setRoomFloor(room.id, patch);
  logActivity("human", "set_room_floor", r.summary, r.ok);
  return r;
};

const FILL: Record<FloorLayerKind, string> = { waterproofing: "#8fb3cf", screed: "#bdb6a6", adhesive: "#c9c2b0", tile: "#f2efe8" };

/** A vertical section: substrate at the bottom, layers stacked upward, datum as a dashed line. */
function Section({ room }: { room: Room }) {
  const spec = room.floorBuildUp;
  const PX = 4;
  const UNKNOWN_H = 14;
  const base = 70;
  let y = base;
  const rects = (spec?.layers ?? []).map((l) => {
    const t = l.thickness.value;
    const h = t !== undefined ? Math.max(2, t * 1000 * PX) : UNKNOWN_H;
    y -= h;
    return { l, y, h, unknown: t === undefined };
  });
  const sub = spec?.substrateTop;
  const datumY = sub?.value !== undefined ? base - -sub.value * 1000 * PX : null;
  const minY = Math.min(0, y, datumY !== null ? datumY - 14 : 0) - 8;
  // This stack is referenced to the substrate. Sloped cable levels use their own local
  // screed faces in the route profile, rather than an unrelated flat section.
  const cable = room.drainage?.planes.length ? undefined : heatingSection(room)[0];
  const cableY = cable?.level !== undefined && sub?.value !== undefined ? base - (cable.level - sub.value) * 1000 * PX : undefined;
  const maxY = Math.max(base + 20, (datumY ?? 0) + 14);
  return (
    <svg className="face-section" role="img" aria-label="Floor section" width="100%" viewBox={`0 ${minY} 200 ${maxY - minY}`}>
      <rect x={20} y={base} width={120} height={16} fill="#b88c5a" opacity={sub?.value !== undefined ? 1 : 0.35} />
      <text x={80} y={base + 12} fontSize={9} textAnchor="middle" fill="#6b6255">substrate{sub?.value !== undefined ? "" : " ?"}</text>
      {rects.map((r) => (
        <g key={r.l.id}>
          <rect x={20} y={r.y} width={120} height={r.h} fill={r.unknown ? "none" : FILL[r.l.kind]} stroke={r.unknown ? "#c0392b" : "#6b6255"} strokeDasharray={r.unknown ? "3 2" : undefined} strokeWidth={0.8} />
          {r.unknown && <text x={80} y={r.y + r.h - 3} fontSize={10} textAnchor="middle" fill="#c0392b">?</text>}
        </g>
      ))}
      {cableY !== undefined && <g data-role="heating-in-floor-section"><circle cx={80} cy={cableY} r={3} fill="#c64c19"/><text x={144} y={cableY} fontSize={8} fill="#c64c19">cable (from screed bottom)</text></g>}
      {datumY !== null && (
        <g>
          <line x1={0} y1={datumY} x2={200} y2={datumY} stroke="#4f86b0" strokeDasharray="4 3" />
          <text x={144} y={datumY - 3} fontSize={8} fill="#4f86b0">datum</text>
        </g>
      )}
    </svg>
  );
}

export function FloorBuildUp({ room }: { room: Room }) {
  const [newKind, setNewKind] = useState<FloorLayerKind>("screed");
  const spec = room.floorBuildUp;
  const levels = floorLevels(spec);
  const fill = floorFill(spec);
  const layers: FloorLayerInput[] = (spec?.layers ?? []).map((l) => ({ id: l.id, kind: l.kind, name: l.name, thickness: toInput(l.thickness) }));
  const setLayers = (next: FloorLayerInput[]) => run(room, { layers: next });

  return (
    <section className="wall-faces floor-build-up" aria-label="Floor build-up">
      <strong>Floor build-up</strong>
      <span className="hint">Levels are mm above the datum, up positive. Blank = unknown.</span>
      <label className="field inspector-field">
        Datum
        <input aria-label="Floor datum" defaultValue={spec?.datum ?? DEFAULT_DATUM} key={spec?.datum ?? DEFAULT_DATUM}
          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== (spec?.datum ?? DEFAULT_DATUM)) run(room, { datum: v }); }} />
      </label>
      <label className="field inspector-field">
        Substrate (as found)
        <input aria-label="Substrate" placeholder="unknown" defaultValue={spec?.substrate ?? ""} key={spec?.substrate ?? ""}
          onBlur={(e) => { if (e.target.value.trim() !== (spec?.substrate ?? "")) run(room, { substrate: e.target.value }); }} />
      </label>
      <QuantityField label="Substrate top (mm)" q={spec?.substrateTop} onCommit={(q) => run(room, { substrateTop: q })} />
      <QuantityField label="Finished level target (mm)" q={spec?.finishedTarget} onCommit={(q) => run(room, { finishedTarget: q })} />
      {fill && <span className="hint" data-role="floor-fill">To reach the target, {fill.layers.join(" + ")} fill {formatMm(fill.thickness)} mm together ({fill.basis}).</span>}
      <div className="face-layers">
        <span className="hint">Layers, from the substrate up</span>
        {spec?.layers.map((l, i) => (
          <div key={l.id} className="face-layer">
            <input aria-label={`Floor layer ${i + 1} name`} defaultValue={l.name} placeholder={FLOOR_LAYER_LABELS[l.kind]}
              onBlur={(e) => { if (e.target.value.trim() !== l.name) setLayers(layers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))); }} />
            <button type="button" aria-label={`Remove ${floorLayerLabel(l)}`} onClick={() => setLayers(layers.filter((_, j) => j !== i))}>Remove</button>
            <QuantityField label={`${floorLayerLabel(l)} thickness (mm)`} q={l.thickness}
              onCommit={(q) => setLayers(layers.map((x, j) => (j === i ? { ...x, thickness: q } : x)))} />
          </div>
        ))}
        <div className="face-add">
          <select aria-label="New floor layer kind" value={newKind} onChange={(e) => setNewKind(e.target.value as FloorLayerKind)}>
            {FLOOR_LAYER_KINDS.map((k) => <option key={k} value={k}>{FLOOR_LAYER_LABELS[k]}</option>)}
          </select>
          <button type="button" onClick={() => setLayers([...layers, { kind: newKind }])}>Add layer</button>
        </div>
      </div>
      <Section room={room} />
      {room.heating && <span className="hint">Cable centre in the stack is from the {CABLE_DEPTH_DATUM}. Sloped routes use the sampled profile, not this flat section.</span>}
      <table className="face-table" aria-label="Floor levels">
        <thead><tr><th>Level</th><th>Above datum</th><th>Basis</th></tr></thead>
        <tbody>
          {levels.map((l) => (
            <tr key={l.level} data-level={l.level}>
              <td>{l.label}</td>
              <td>{l.resolved ? `${formatMm(l.top!)} mm${l.fromTarget ? " (from target)" : ""}` : "unresolved"}</td>
              <td title={l.inputs.map((x) => `${x.field}: ${x.status}`).join("; ")}>{l.resolved ? l.basis : `missing ${l.missing.join(", ")}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
