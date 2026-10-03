import { installationReading, localPointReading, clearanceRegions, type FixtureInstallation } from "../model/installation";
/**
 * Fixture set-out (#5) in the Inspector: set the fixture out from a wall face, enter service
 * points, and read the rough-in the way a plumber would, as distances from each wall face.
 * Every edit goes through the same actions the tools call.
 */

import { ExactIdentity } from "./ProductIdentity";
import { SELECTION_STATUSES, type SelectionStatus } from "../model/productIdentity";
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

/** Millimetres typed into a field: blank is unknown; anything that is not a number is NaN, never silently unknown. */
const mm = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v.trim()) / 1000);
const badNumbers = (fields: Record<string, string>): string[] =>
  Object.entries(fields).filter(([, v]) => v.trim() !== "" && !Number.isFinite(Number(v.trim()))).map(([k]) => k);

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
    const bad = badNumbers({ gap, distance });
    if (bad.length) { setError(`Not a number in mm: ${bad.join(", ")}.`); return; }
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
        <select aria-label="Anchor side" value={side} onChange={(e) => {
          const next = e.target.value as WallSideName;
          setSide(next);
          if (wall && !faceChoices(wall, next).some((f) => f.face === face)) setFace("finished");
        }}>
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
    const bad = badNumbers({ out: p.out, "range max": p.outMax, across: p.across, up: p.up });
    if (bad.length) { setError(`Not a number in mm: ${bad.join(", ")}. Leave a field blank if it is unknown.`); return; }
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

function InstallationForm({model,item}:{model:PlanModel;item:Item}) {
  const p=item.installation!;
  const [height,setHeight]=useState(p.height?.value===undefined?"":formatMm(p.height.value));
  const [room,setRoom]=useState(p.roomId??"");const [datum,setDatum]=useState(p.floorDatum);
  const [orientation,setOrientation]=useState(String(p.orientation));const [mirror,setMirror]=useState(p.mirror);
  const [source,setSource]=useState(p.height?.source??"");const [error,setError]=useState("");
  const submit=()=>{if(!Number.isFinite(Number(orientation)) || height.trim()!=="" && !Number.isFinite(Number(height))){setError("Enter finite height and orientation values.");return;}
    const next:FixtureInstallation={...p,roomId:room,floorDatum:datum,orientation:Number(orientation),mirror,...(height.trim()?{height:{value:Number(height)/1000,status:"proposed",source}}:{height:undefined})};
    const r=human("set_fixture_installation",actions.setFixtureInstallation(item.id,next));setError(r.ok?"":r.summary);};
  const lv=installationReading(model,item);
  return <section aria-label="Fixture installation"><strong>Installation placement</strong>
    <label className="field">Floor room<select aria-label="Installation floor room" value={room} onChange={e=>setRoom(e.target.value)}><option value="">unknown</option>{model.rooms.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
    <label className="field">Floor datum<select aria-label="Installation floor datum" value={datum} onChange={e=>setDatum(e.target.value as FixtureInstallation["floorDatum"])}><option value="finished-floor">Finished floor</option><option value="substrate-top">Substrate top</option></select></label>
    <label className="field">Product bottom above floor (mm)<input aria-label="Installation bottom height (mm)" placeholder="unknown" value={height} onChange={e=>setHeight(e.target.value)}/></label>
    <label className="field">Placement source<input aria-label="Installation placement source" value={source} onChange={e=>setSource(e.target.value)}/></label>
    <label className="field">Orientation from anchor (degrees)<input aria-label="Installation orientation (degrees)" value={orientation} onChange={e=>setOrientation(e.target.value)}/></label>
    <label><input aria-label="Mirror installation" type="checkbox" checked={mirror} onChange={e=>setMirror(e.target.checked)}/> Mirror documented reversible product</label>
    <button type="button" onClick={submit}>Update installation placement</button>
    <p className="hint" data-installed-level>{lv.resolved?`Bottom ${formatMm(lv.bottom!)} mm; top ${formatMm(lv.top!)} mm above ${lv.datum} · ${lv.basis}`:`Installation unresolved: ${lv.missing.join(", ")}`}</p>
    {lv.limitations.map((message,i)=><p className="inspector-warn" key={i}>{message}</p>)}
    <p className="hint">{item.installationGeometry?.outline?.shape ? "Planning geometry extrudes the sourced plan outline through product height." : "Envelope fallback: no sourced outline supplied; exact planning envelope."}</p>
    <p className="hint">Height edits are proposed project placement. Source dimensions and product installation requirements retain their evidence.</p>
    {error&&<span role="alert" className="inspector-error">{error}</span>}
  </section>;
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
      {/* keyed on the stored anchor, so an edit made elsewhere (the agent) resets the form */}
      {item.productIdentity && <ExactIdentity product={item.productIdentity} />}
      <label className="field inspector-field">Project selection<select aria-label="Project selection" value={item.selectionStatus ?? "unknown"} onChange={e => human("set_fixture_selection", actions.setFixtureSelection(item.id, e.target.value as SelectionStatus))}>{SELECTION_STATUSES.map(status => <option key={status}>{status}</option>)}</select></label>
      <AnchorForm key={`${item.id}:${JSON.stringify(item.anchor ?? null)}`} model={model} item={item} />
      {item.installation && <InstallationForm key={JSON.stringify(item.installation)} model={model} item={item}/>}
      {item.installationGeometry && <section aria-label="Fixings and access evidence">
        <strong>Fixings and access</strong>
        <span className="hint">{item.installationGeometry.outline?.shape?"Sourced line/arc plan outline; 3D is a height extrusion.":`Envelope fallback: ${item.installationGeometry.outline?.limitation??"No sourced outline supplied"}`}</span>
        {(item.installationGeometry.fixings??[]).map(p=>{const r=localPointReading(model,item,p);return <p className="hint" key={p.id}>{p.label}: x {r.x===undefined?"?":formatMm(r.x)} / y {r.y===undefined?"?":formatMm(r.y)} / level {r.level===undefined?"?":formatMm(r.level)} mm · {r.basis}<br/>{r.source}</p>;})}
        {clearanceRegions(model,item).map(r=><p className="hint" key={r.id}>{r.label}: {r.direction} {r.distance===null?"?":formatMm(r.distance)} mm ({r.status}); distinct from physical footprint.<br/>{r.sources.map(s=>`${s.url} (${s.locator})`).join("; ")}</p>)}
      </section>}
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
