/**
 * Fixture set-out (#5) in the Inspector: set the fixture out from a wall face, enter service
 * points, and read the rough-in the way a plumber would, as distances from each wall face.
 * Every edit goes through the same actions the tools call.
 */

import { useState } from "react";
import { actions, logActivity, type ActionResult, type ServicePointInput } from "../model/store";
import { formatMm } from "../model/geometry";
import { VALUE_STATUSES } from "../model/faces";
import { anchorPose, clearances, faceChoices, roughIn, type FaceDistance } from "../model/fixtures";
import type { Item, PlanModel, ValueStatus, WallSideName } from "../model/types";

const human = (tool: string, r: ActionResult) => {
  logActivity("human", tool, r.summary, r.ok);
  return r;
};

const mm = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v) / 1000);

function AnchorForm({ model, item }: { model: PlanModel; item: Item }) {
  const a = item.anchor;
  const [wallId, setWallId] = useState(a?.wallId ?? model.walls[0]?.id ?? "");
  const [side, setSide] = useState<WallSideName>(a?.side ?? "right");
  const [face, setFace] = useState(a?.face ?? "finished");
  const [gap, setGap] = useState(a ? formatMm(a.gap) : "0");
  const [from, setFrom] = useState<"a" | "b">(a?.from ?? "a");
  const [distance, setDistance] = useState(a ? formatMm(a.distance) : "");
  const [status, setStatus] = useState<ValueStatus>(a?.status ?? "proposed");
  const [error, setError] = useState("");
  const wall = model.walls.find((w) => w.id === wallId);
  const submit = () => {
    const d = mm(distance);
    if (d === undefined || !Number.isFinite(d)) { setError("Enter the distance from the wall end in mm."); return; }
    const r = human("anchor_fixture", actions.anchorFixture(item.id, { wallId, side, face, gap: mm(gap) ?? 0, from, distance: d, status }));
    setError(r.ok ? "" : r.summary);
  };
  return (
    <div className="fixture-anchor">
      <label className="field inspector-field">Wall
        <select aria-label="Anchor wall" value={wallId} onChange={(e) => setWallId(e.target.value)}>
          {model.walls.map((w) => <option key={w.id} value={w.id}>{w.id}</option>)}
        </select>
      </label>
      <label className="field inspector-field">Side (A→B)
        <select aria-label="Anchor side" value={side} onChange={(e) => setSide(e.target.value as WallSideName)}>
          <option value="left">left</option><option value="right">right</option>
        </select>
      </label>
      <label className="field inspector-field">Set against
        <select aria-label="Anchor face" value={face} onChange={(e) => setFace(e.target.value)}>
          {wall && faceChoices(wall, side).map((f) => <option key={f.face} value={f.face}>{f.label}</option>)}
        </select>
      </label>
      <label className="field inspector-field">Gap from face (mm)<input aria-label="Anchor gap (mm)" inputMode="decimal" value={gap} onChange={(e) => setGap(e.target.value)} /></label>
      <label className="field inspector-field">Centreline from end
        <select aria-label="Anchor end" value={from} onChange={(e) => setFrom(e.target.value as "a" | "b")}>
          <option value="a">A</option><option value="b">B</option>
        </select>
      </label>
      <label className="field inspector-field">Distance (mm)<input aria-label="Anchor distance (mm)" inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)} /></label>
      <label className="field inspector-field">Status
        <select aria-label="Anchor status" value={status} onChange={(e) => setStatus(e.target.value as ValueStatus)}>
          {VALUE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <div className="fixture-actions">
        <button type="button" onClick={submit}>{a ? "Update set-out" : "Set out from face"}</button>
        {a && <button type="button" onClick={() => human("anchor_fixture", actions.anchorFixture(item.id, null))}>Release</button>}
      </div>
      {error && <span className="inspector-error" role="alert">{error}</span>}
    </div>
  );
}

function PointForm({ item }: { item: Item }) {
  const [p, setP] = useState({ label: "", service: "waste", face: "finished", out: "", outMax: "", across: "", up: "", status: "proposed" });
  const [error, setError] = useState("");
  const set = (k: keyof typeof p) => (e: { target: { value: string } }) => setP({ ...p, [k]: e.target.value });
  const submit = () => {
    const input: ServicePointInput = {
      label: p.label, service: p.service as ServicePointInput["service"], face: p.face, status: p.status as ValueStatus,
      out: mm(p.out) ?? null, outMax: mm(p.outMax) ?? null, across: mm(p.across) ?? null, up: mm(p.up) ?? null,
    };
    const r = human("set_service_point", actions.setServicePoint(item.id, input));
    setError(r.ok ? "" : r.summary);
    if (r.ok) setP({ ...p, label: "", out: "", outMax: "", across: "", up: "" });
  };
  return (
    <details className="fixture-point-form">
      <summary>Add a service point</summary>
      <label className="field inspector-field">Label<input aria-label="Point label" value={p.label} onChange={set("label")} /></label>
      <label className="field inspector-field">Service
        <select aria-label="Point service" value={p.service} onChange={set("service")}><option>waste</option><option>water</option><option>power</option></select>
      </label>
      <label className="field inspector-field">Out from
        <select aria-label="Point face" value={p.face} onChange={set("face")}>
          {["existing", "frame", "board", "finished"].map((f) => <option key={f}>{f}</option>)}
        </select>
      </label>
      <label className="field inspector-field">Out (mm)<input aria-label="Point out (mm)" inputMode="decimal" placeholder="unknown" value={p.out} onChange={set("out")} /></label>
      <label className="field inspector-field">Out, range max (mm)<input aria-label="Point out max (mm)" inputMode="decimal" placeholder="—" value={p.outMax} onChange={set("outMax")} /></label>
      <label className="field inspector-field">Across centreline (mm, left −)<input aria-label="Point across (mm)" inputMode="decimal" placeholder="unknown" value={p.across} onChange={set("across")} /></label>
      <label className="field inspector-field">Up from finished floor (mm)<input aria-label="Point up (mm)" inputMode="decimal" placeholder="unknown" value={p.up} onChange={set("up")} /></label>
      <label className="field inspector-field">Status
        <select aria-label="Point status" value={p.status} onChange={set("status")}>{VALUE_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
      </label>
      <button type="button" onClick={submit}>Add point</button>
      {error && <span className="inspector-error" role="alert">{error}</span>}
    </details>
  );
}

const cell = (f: FaceDistance | undefined) =>
  !f ? "—" : f.resolved ? `${formatMm(f.value!)}${f.max !== undefined ? `–${formatMm(f.max)}` : ""}` : "?";

export function FixturePanel({ model, item }: { model: PlanModel; item: Item }) {
  const pose = anchorPose(model, item);
  const points = roughIn(model, item);
  const clear = item.anchor ? clearances(model, item) : [];
  return (
    <section className="fixture-panel" aria-label="Fixture set-out">
      <strong>Set-out</strong>
      {item.anchor && (
        <span className={pose.resolved ? "hint" : "inspector-warn"}>
          {pose.resolved
            ? `${formatMm(item.anchor.gap)} mm off the ${item.anchor.face} face of ${item.anchor.wallId} (${item.anchor.side}), centre ${formatMm(item.anchor.distance)} mm from end ${item.anchor.from.toUpperCase()} · ${item.anchor.status}`
            : `Position unresolved: missing ${pose.missing.join(", ")}`}
        </span>
      )}
      <AnchorForm key={`${item.id}:${item.anchor ? "a" : "-"}`} model={model} item={item} />
      {clear.length > 0 && (
        <span className="hint" data-role="clearances">
          Clearance: {clear.map((c) => `${c.direction} ${c.distance === null ? "—" : `${formatMm(c.distance)} mm`}${c.surface ? ` (${c.surface})` : ""}`).join(" · ")}
        </span>
      )}
      <strong>Rough-in</strong>
      {points.length === 0 ? <span className="hint">No service points yet.</span> : (
        <table className="face-table" aria-label="Rough-in">
          <thead><tr><th>Point</th><th>Frame</th><th>Board</th><th>Finished</th><th>From A</th><th>Up</th></tr></thead>
          <tbody>
            {points.map((r) => (
              <tr key={r.pointId} data-point={r.pointId} title={r.missing.length ? `Missing: ${r.missing.join(", ")}` : `${r.status}${r.source ? ` · ${r.source}` : ""}`}>
                <td>{r.label}<div className="hint">{r.service} · {r.status}</div>{!r.resolved && <div className="inspector-warn">missing {r.missing.join(", ")}</div>}</td>
                <td>{cell(r.fromFaces.find((f) => f.face === "frame"))}</td>
                <td>{cell(r.fromFaces.find((f) => f.face === "board"))}</td>
                <td>{cell(r.fromFaces.find((f) => f.face === "finished"))}</td>
                <td>{r.alongFromA !== undefined ? formatMm(r.alongFromA) : "?"}</td>
                <td>{r.up !== undefined ? formatMm(r.up) : "?"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <span className="hint">mm, out from each face of the anchor wall side; up from finished floor.</span>
      <PointForm item={item} />
    </section>
  );
}
