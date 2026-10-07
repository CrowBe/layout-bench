/**
 * Drainage (#7) in the Inspector: wastes, sloped floor planes, the derived heights, checks, a
 * section through the first waste, and the build-up and door-threshold references. Edits go
 * through actions.setRoomDrainage, the same action set_room_drainage calls. A blank level or
 * fall is unknown and the plane that needs it reads "unresolved".
 */

import { useEffect, useState } from "react";
import { actions, logActivity, type ControlInput, type DrainagePatch, type PlaneInput, type WasteInput } from "../model/store";
import { drainageProblems, planeSurface, sectionAlong, thresholds } from "../model/drainage";
import { finishedLevel } from "../model/floor";
import { formatMm } from "../model/geometry";
import { useAppStore } from "../model/store";
import type { Room } from "../model/types";
import { QuantityField, toInput } from "./WallFaces";
import { useProductStore } from "../model/productLibrary";
import { DRAIN_CATEGORY, outletPosition, wasteProduct } from "../model/wasteProduct";

const run = (room: Room, patch: DrainagePatch) => {
  const r = actions.setRoomDrainage(room.id, patch);
  logActivity("human", "set_room_drainage", r.summary, r.ok);
  return r;
};

/** A plan position or size typed in mm, committed on blur or Enter. */
function Mm({ label, value, onCommit }: { label: string; value: number; onCommit: (m: number) => { ok: boolean; summary: string } }) {
  const shown = formatMm(value);
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState("");
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    if (draft.trim() === shown) return;
    const n = Number(draft.trim());
    if (draft.trim() === "" || !Number.isFinite(n)) { setError(`"${draft}" is not a number.`); setDraft(shown); return; }
    const r = onCommit(n / 1000);
    setError(r.ok ? "" : r.summary);
    if (!r.ok) setDraft(shown);
  };
  return (
    <label className="field inspector-field">
      {label}
      <input inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setDraft(shown); }} />
      {error && <span className="inspector-error" role="alert">{error}</span>}
    </label>
  );
}

const wasteInputs = (room: Room): WasteInput[] =>
  (room.drainage?.wastes ?? []).map((w) => ({ id: w.id, label: w.label, kind: w.kind, x: w.ax, y: w.ay, ...(w.kind === "linear" ? { x2: w.bx, y2: w.by, outletAt: toInput(w.outletAt) } : {}), level: toInput(w.level) }));
const planeInputs = (room: Room): PlaneInput[] =>
  (room.drainage?.planes ?? []).map((p) => ({
    id: p.id, label: p.label, x: p.x, y: p.y, w: p.w, h: p.h, waste: p.wasteId ?? null, fall: toInput(p.fall),
    controls: p.controls.map((c): ControlInput => ({ id: c.id, label: c.label, x: c.x, y: c.y, level: toInput(c.level) })),
  }));

/** Floor profile along a line through the first waste, with the finished level as a reference. */
function Section({ room }: { room: Room }) {
  const d = room.drainage!;
  const w0 = d.wastes[0];
  const x = w0 ? (w0.ax + w0.bx) / 2 : room.x + room.w / 2;
  const pts = sectionAlong(d, { x, y: room.y }, { x, y: room.y + room.h }, 25);
  const known = pts.filter((p) => p.level !== undefined);
  const fin = finishedLevel(room.floorBuildUp);
  const all = [...known.map((p) => p.level!), ...(fin.resolved ? [fin.top!] : [])];
  if (!known.length) return <span className="hint">Section: no resolved heights along x = {formatMm(x)} mm.</span>;
  const lo = Math.min(...all, 0), hi = Math.max(...all, 0.001), W = 200, H = 70, pad = 8;
  const sy = (v: number) => H - pad - ((v - lo) / Math.max(hi - lo, 0.002)) * (H - 2 * pad);
  const sx = (s: number) => pad + (s / room.h) * (W - 2 * pad);
  const path = pts.map((p, i) => (p.level === undefined ? "" : `${i && pts[i - 1].level !== undefined ? "L" : "M"}${sx(p.s).toFixed(1)},${sy(p.level).toFixed(1)}`)).join(" ");
  return (
    <svg className="face-section" role="img" aria-label="Floor section through the waste" width="100%" viewBox={`0 0 ${W} ${H}`}>
      <line x1={0} x2={W} y1={sy(0)} y2={sy(0)} stroke="#4f86b0" strokeDasharray="4 3" />
      <text x={W - 4} y={sy(0) - 2} fontSize={7} textAnchor="end" fill="#4f86b0">datum</text>
      {fin.resolved && <>
        <line x1={0} x2={W} y1={sy(fin.top!)} y2={sy(fin.top!)} stroke="#8a8070" strokeDasharray="2 2" />
        <text x={4} y={sy(fin.top!) - 2} fontSize={7} fill="#8a8070">build-up finished {formatMm(fin.top!)} mm</text>
      </>}
      <path d={path} fill="none" stroke="#2f6a96" strokeWidth={1.6} />
      <text x={pad} y={H - 1} fontSize={7} fill="#6b6255">section x = {formatMm(x)} mm, y {formatMm(room.y)} → {formatMm(room.y + room.h)}</text>
    </svg>
  );
}

/** The waste's drain brief: pick one, see what it gives, or move to a newer accepted revision. */
function WasteProductRow({ room, index, drains, onLink }: { room: Room; index: number; drains: { id: string; manufacturer: string; model: string }[]; onLink: (product: string | null) => void }) {
  const w = room.drainage!.wastes[index];
  const info = wasteProduct(w);
  const linkedInLibrary = !!info && drains.some((p) => p.id === info.productId);
  const outlet = outletPosition(w, info);
  const size = (f?: { value: number }) => (f ? `${formatMm(f.value)}` : "?");
  return (
    <div className="hint" data-role="waste-product">
      <label className="field inspector-field">
        Drain product
        <select aria-label={`${w.label} drain product`} value={info?.productId ?? ""} onChange={(e) => onLink(e.target.value || null)}>
          <option value="">— none —</option>
          {info && !linkedInLibrary && <option value={info.productId} disabled>{info.name} (carried with the project)</option>}
          {drains.map((p) => <option key={p.id} value={p.id}>{[p.manufacturer, p.model].filter(Boolean).join(" ") || p.id}</option>)}
        </select>
      </label>
      {info ? (
        <span data-role="waste-product-figures">
          Grate {size(info.grateLength)} × {size(info.grateWidth)} mm{info.grateType ? ` (${info.grateType})` : ""} · outlet Ø {size(info.outletDiameter)} mm · body {size(info.installationDepth)} mm below the grate · outlet position {outlet.x !== undefined ? `${formatMm(outlet.x)}, ${formatMm(outlet.y!)} mm` : outlet.basis}
        </span>
      ) : <span>No drain product: grate, outlet and body depth unresolved.</span>}
      {info?.update && (
        <button type="button" onClick={() => { const r = actions.updateWasteProduct(room.id, w.id); logActivity("human", "update_waste_product", r.summary, r.ok); }}>
          Use revision {info.update.revision}
        </button>
      )}
    </div>
  );
}

export function Drainage({ room }: { room: Room }) {
  const model = useAppStore((s) => s.model);
  const drains = useProductStore((s) => s.products).filter((p) => p.category === DRAIN_CATEGORY);
  const d = room.drainage;
  const wastes = wasteInputs(room);
  const planes = planeInputs(room);
  const setWastes = (next: WasteInput[]) => run(room, { wastes: next });
  const setPlanes = (next: PlaneInput[]) => run(room, { planes: next });
  const patchWaste = (i: number, p: Partial<WasteInput>) => setWastes(wastes.map((w, j) => (j === i ? { ...w, ...p } : w)));
  const patchPlane = (i: number, p: Partial<PlaneInput>) => setPlanes(planes.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const problems = drainageProblems(room);
  const th = thresholds(model, room);
  const fin = finishedLevel(room.floorBuildUp);
  const cx = room.x + room.w / 2, cy = room.y + room.h / 2;

  return (
    <section className="wall-faces drainage" aria-label="Drainage">
      <strong>Drainage and falls</strong>
      <span className="hint">Plan positions are mm from the plan origin. Levels are mm above the floor datum. Blank = unknown. Proposed, not a drainage design.</span>

      <div className="face-layers">
        <span className="hint">Wastes</span>
        {wastes.map((w, i) => (
          <div key={w.id} className="face-layer" data-waste={w.id}>
            <input aria-label={`Waste ${i + 1} name`} defaultValue={w.label} onBlur={(e) => { if (e.target.value.trim() !== w.label) patchWaste(i, { label: e.target.value }); }} />
            <button type="button" aria-label={`Remove ${w.label}`} onClick={() => { setPlanes(planes.map((p) => (p.waste === w.id ? { ...p, waste: null } : p))); setWastes(wastes.filter((_, j) => j !== i)); }}>Remove</button>
            <Mm label={`${w.label} x (mm)`} value={w.x} onCommit={(v) => patchWaste(i, { x: v })} />
            <Mm label={`${w.label} y (mm)`} value={w.y} onCommit={(v) => patchWaste(i, { y: v })} />
            {w.kind === "linear" && <>
              <Mm label={`${w.label} x2 (mm)`} value={w.x2 ?? w.x} onCommit={(v) => patchWaste(i, { x2: v })} />
              <Mm label={`${w.label} y2 (mm)`} value={w.y2 ?? w.y} onCommit={(v) => patchWaste(i, { y2: v })} />
            </>}
            <QuantityField label={`${w.label} level (mm)`} q={d?.wastes[i].level} onCommit={(q) => patchWaste(i, { level: q })} />
            {w.kind === "linear" && <QuantityField label={`${w.label} outlet from first end (mm)`} q={d?.wastes[i].outletAt} onCommit={(q) => patchWaste(i, { outletAt: q })} />}
            <WasteProductRow room={room} index={i} drains={drains} onLink={(product) => patchWaste(i, { product })} />
          </div>
        ))}
        <div className="face-add">
          <button type="button" onClick={() => setWastes([...wastes, { kind: "point", x: cx, y: cy }])}>Add point waste</button>
          <button type="button" onClick={() => setWastes([...wastes, { kind: "linear", x: room.x + 0.2 * room.w, y: room.y + 0.1, x2: room.x + 0.8 * room.w, y2: room.y + 0.1 }])}>Add linear waste</button>
        </div>
      </div>

      <div className="face-layers">
        <span className="hint">Floor planes (rectangles that fall toward a waste)</span>
        {planes.map((p, i) => {
          const plane = d!.planes[i];
          return (
            <div key={p.id} className="face-layer" data-plane={p.id}>
              <input aria-label={`Plane ${i + 1} name`} defaultValue={p.label} onBlur={(e) => { if (e.target.value.trim() !== p.label) patchPlane(i, { label: e.target.value }); }} />
              <button type="button" aria-label={`Remove ${p.label}`} onClick={() => setPlanes(planes.filter((_, j) => j !== i))}>Remove</button>
              <Mm label={`${p.label} x (mm)`} value={p.x} onCommit={(v) => patchPlane(i, { x: v })} />
              <Mm label={`${p.label} y (mm)`} value={p.y} onCommit={(v) => patchPlane(i, { y: v })} />
              <Mm label={`${p.label} width (mm)`} value={p.w} onCommit={(v) => patchPlane(i, { w: v })} />
              <Mm label={`${p.label} depth (mm)`} value={p.h} onCommit={(v) => patchPlane(i, { h: v })} />
              <label className="field inspector-field">
                Falls toward
                <select aria-label={`${p.label} waste`} value={p.waste ?? ""} onChange={(e) => patchPlane(i, { waste: e.target.value || null })}>
                  <option value="">— none (use 3 controls) —</option>
                  {wastes.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
                </select>
              </label>
              <QuantityField label={`${p.label} fall (mm per m)`} q={plane.fall} onCommit={(q) => patchPlane(i, { fall: q })} />
              {(p.controls ?? []).map((c, j) => (
                <div key={c.id} className="face-layer">
                  <Mm label={`${c.label} x (mm)`} value={c.x} onCommit={(v) => patchPlane(i, { controls: p.controls!.map((k, m) => (m === j ? { ...k, x: v } : k)) })} />
                  <Mm label={`${c.label} y (mm)`} value={c.y} onCommit={(v) => patchPlane(i, { controls: p.controls!.map((k, m) => (m === j ? { ...k, y: v } : k)) })} />
                  <QuantityField label={`${c.label} level (mm)`} q={plane.controls[j].level} onCommit={(q) => patchPlane(i, { controls: p.controls!.map((k, m) => (m === j ? { ...k, level: q } : k)) })} />
                  <button type="button" aria-label={`Remove ${c.label}`} onClick={() => patchPlane(i, { controls: p.controls!.filter((_, m) => m !== j) })}>Remove level</button>
                </div>
              ))}
              <button type="button" onClick={() => patchPlane(i, { controls: [...(p.controls ?? []), { label: `${p.label} level ${(p.controls?.length ?? 0) + 1}`, x: p.x + p.w / 2, y: p.y + p.h / 2, level: null }] })}>Add control level</button>
            </div>
          );
        })}
        <div className="face-add">
          <button type="button" onClick={() => setPlanes([...planes, { x: room.x, y: room.y, w: room.w, h: room.h, waste: wastes[0]?.id ?? null }])}>Add plane over whole room</button>
        </div>
      </div>

      {d && d.planes.length > 0 && <>
        <table className="face-table" aria-label="Derived floor heights">
          <thead><tr><th>Plane</th><th>Fall</th><th>Level at centre</th><th>Basis</th></tr></thead>
          <tbody>
            {d.planes.map((p) => {
              const s = planeSurface(d, p);
              const c = s.resolved ? s.level(p.x + p.w / 2, p.y + p.h / 2) : undefined;
              return (
                <tr key={p.id} data-plane-row={p.id}>
                  <td>{p.label}</td>
                  <td>{s.resolved && s.fall !== undefined ? `${Math.round(s.fall * 10000) / 10} mm/m${s.method === "waste+control" ? " (derived)" : ""}` : "—"}</td>
                  <td>{c !== undefined ? `${formatMm(c)} mm` : "unresolved"}</td>
                  <td>{s.resolved ? s.basis : s.unsupported ?? `missing ${s.missing.join(", ")}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Section room={room} />
      </>}

      {(d?.planes.length ?? 0) > 0 && (
        <div className="hint" data-role="references">
          Floor build-up finished level: {fin.resolved ? `${formatMm(fin.top!)} mm` : `unresolved (missing ${fin.missing.join(", ")})`}.
          {th.length === 0 ? " No door thresholds on this room." : th.map((t) => ` Door ${t.openingId}: ${t.level !== undefined ? `${formatMm(t.level)} mm${t.stepToFinished !== undefined ? ` (${t.stepToFinished >= 0 ? "+" : "−"}${formatMm(Math.abs(t.stepToFinished))} to finished level)` : ""}` : "no derived level"}.`).join("")}
        </div>
      )}
      {problems.length > 0 && (
        <ul className="hint" aria-label="Drainage checks">
          {problems.map((p, i) => <li key={i} data-code={p.code} style={{ color: p.severity === "error" ? "#c0392b" : undefined }}>{p.message}</li>)}
        </ul>
      )}
    </section>
  );
}
