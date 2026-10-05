import { useState } from "react";
import {
  actions,
  logActivity,
  useAppStore,
  uid,
  type HeatingPatch,
} from "../model/store";
import type { Room, ThermostatLocationKind } from "../model/types";
import { formatMm } from "../model/geometry";
import {
  CABLE_DEPTH_DATUM,
  WALL_SETBACK_DATUM,
  heatingEvidence,
  heatingProductLocks,
} from "../model/heating";
import { heatingSectionSvg, renderHeatingReview } from "../sheets/heating";
import { QuantityField } from "./WallFaces";
import { download } from "./download";
import { useProductStore } from "../model/productLibrary";
import type { HeatingFigure } from "../model/heatingProduct";

export function Heating({ room }: { room: Room }) {
  const mode = useAppStore((s) => s.editor.drawMode);
  const [error, setError] = useState("");
  const [point, setPoint] = useState({ x: "", y: "" });
  const [keepout, setKeepout] = useState({
    label: "",
    x: "",
    y: "",
    w: "",
    h: "",
    source: "",
  });
  const library = useProductStore((s) => s.products);
  const h = room.heating,
    e = heatingEvidence(room, library);
  const locks = heatingProductLocks(h, library);
  const cables = library.filter((p) => p.category === "heating-cable");
  const thermostats = library.filter((p) => p.category === "thermostat");
  const figureText = (f: HeatingFigure | undefined, asMm = false) =>
    !f || f.value === undefined
      ? `unknown (${f?.kind ?? "unknown"}${f?.note ? `; ${f.note}` : ""})`
      : `${asMm ? `${formatMm(f.value)} mm` : `${f.value} ${f.unit}`} · ${f.kind}${f.formula ? ` · ${f.formula}` : ""}${f.source ? ` · ${f.source}` : ""}`;
  const run = (patch: HeatingPatch) => {
    const r = actions.setRoomHeating(room.id, patch);
    logActivity("human", "set_room_heating", r.summary, r.ok);
    setError(r.ok ? "" : r.summary);
    return r;
  };
  const points = h?.path ?? [],
    keepouts = h?.keepouts ?? [];
  const pointEdit = (i: number, key: "x" | "y", value: string) => {
    if (!value.trim() || !Number.isFinite(Number(value))) {
      setError("Enter a finite coordinate in mm.");
      return;
    }
    run({
      path: points.map((p, j) =>
        j === i ? { ...p, [key]: Number(value) / 1000 } : p,
      ),
    });
  };
  return (
    <section className="wall-faces heating-panel" aria-label="Heating cable">
      <strong>Proposed in-screed heating</strong>
      <span className="hint">
        Blank = unknown. Length, output and coverage come from a referenced heating-cable
        brief when one is set; they are not copied onto this record. Manufacturer and
        electrician review pending. No electrical or compliance approval.
      </span>
      <label className="field inspector-field">
        Heating-cable product
        <select
          aria-label="Heating-cable product"
          value={h?.cableProductId ?? ""}
          onChange={(ev) => run({ cableProductId: ev.target.value || null })}
        >
          <option value="">{h?.cableSpecification ? "Project snapshot (no library id)" : "none — enter length on this record"}</option>
          {cables.map((p) => (
            <option key={p.id} value={p.id}>{p.physicalItem?.label || [p.manufacturer, p.model].filter(Boolean).join(" ") || p.id}</option>
          ))}
        </select>
      </label>
      <label className="field inspector-field">
        Thermostat product
        <select
          aria-label="Thermostat product"
          value={h?.thermostatProductId ?? ""}
          onChange={(ev) => run({ thermostatProductId: ev.target.value || null })}
        >
          <option value="">{h?.thermostatSpecification ? "Project snapshot (no library id)" : "none"}</option>
          {thermostats.map((p) => (
            <option key={p.id} value={p.id}>{p.physicalItem?.label || [p.manufacturer, p.model].filter(Boolean).join(" ") || p.id}</option>
          ))}
        </select>
      </label>
      {(
        ["manufacturer", "model", "productSource", "requirements"] as const
      ).map((k) => {
        const lockedValue = k === "manufacturer" ? e.cable.manufacturer : k === "model" ? e.cable.model : undefined;
        const locked = k === "manufacturer" ? locks.manufacturer : k === "model" ? locks.model : false;
        const shown = locked ? (lockedValue ?? "") : (h?.[k] ?? "");
        return (
        <label className="field inspector-field" key={k}>
          {
            {
              manufacturer: "Cable manufacturer",
              model: "Cable model",
              productSource: "Cable product source",
              requirements: "Cable installation requirements",
            }[k]
          }
          <textarea
            aria-label={`Cable ${k}`}
            key={shown}
            defaultValue={shown}
            placeholder="unknown"
            readOnly={locked}
            onBlur={(event) => {
              if (locked) return;
              if (event.target.value !== (h?.[k] ?? ""))
                run({ [k]: event.target.value || null });
            }}
          />
        </label>
        );
      })}
      {locks.length && (
        <p className="hint" aria-label="Cable product length (m)">
          Cable product length (m): {figureText(e.cable.length)} (locked to the heating-cable brief)
        </p>
      )}
      {locks.ratedOutput && (
        <p className="hint" aria-label="Rated output (W)">
          Rated output (W): {figureText(e.cable.ratedOutput)} (locked to the heating-cable brief)
        </p>
      )}
      {([
        ...(locks.length ? [] : [["length", "Cable product length (m)", 1] as const]),
        ...(locks.ratedOutput ? [] : [["ratedOutput", "Rated output (W)", 1] as const]),
        ["minSpacing", "Minimum cable spacing (mm)", 1000] as const,
        ["edgeClearance", "Boundary / keep-out clearance (mm)", 1000] as const,
        ["depthFromBottom", "Cable centre above screed bottom (mm)", 1000] as const,
      ]).map(([k, label, scale]) => (
        <div key={k}>
          <QuantityField
            label={label}
            scale={scale}
            q={h?.[k]}
            onCommit={(q) => run({ [k]: q })}
          />
          <label className="field inspector-field">
            {label} source
            <input
              aria-label={`${label} source`}
              placeholder="unknown"
              key={h?.[k]?.source ?? ""}
              defaultValue={h?.[k]?.source ?? ""}
              onBlur={(event) => {
                if (event.target.value !== (h?.[k]?.source ?? ""))
                  run({ [k]: { ...h?.[k], source: event.target.value } });
              }}
            />
          </label>
        </div>
      ))}
      <label className="field inspector-field">
        Screed layer
        <select
          aria-label="Heating screed layer"
          value={h?.screedLayerId ?? ""}
          onChange={(ev) => run({ screedLayerId: ev.target.value || null })}
        >
          <option value="">Auto only if one screed layer</option>
          {room.floorBuildUp?.layers
            .filter((l) => l.kind === "screed")
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </select>
      </label>
      <span className="hint">Cable centre datum: {CABLE_DEPTH_DATUM}.</span>
      <span className="hint">Entered edge clearance datum: {WALL_SETBACK_DATUM}. Keep-outs are only those entered with a source; none are inferred from fixtures.</span>
      <label className="field inspector-field">
        Thermostat location
        <textarea
          aria-label="Thermostat location"
          key={h?.thermostatLocation?.description ?? ""}
          defaultValue={h?.thermostatLocation?.description ?? ""}
          placeholder="unknown — not inferred from the IP code"
          onBlur={(event) => {
            const description = event.target.value.trim();
            if (!description) {
              if (h?.thermostatLocation) run({ thermostatLocation: null });
              return;
            }
            run({
              thermostatLocation: {
                description,
                ...(h?.thermostatLocation?.source ? { source: h.thermostatLocation.source } : {}),
                ...(h?.thermostatLocation?.kind ? { kind: h.thermostatLocation.kind } : {}),
              },
            });
          }}
        />
      </label>
      <label className="field inspector-field">
        Thermostat location source
        <input
          aria-label="Thermostat location source"
          key={h?.thermostatLocation?.source ?? ""}
          defaultValue={h?.thermostatLocation?.source ?? ""}
          placeholder="unknown"
          onBlur={(event) => {
            if (!h?.thermostatLocation) return;
            const source = event.target.value.trim();
            if (source === (h.thermostatLocation.source ?? "")) return;
            const location = { ...h.thermostatLocation };
            if (source) location.source = source;
            else delete location.source;
            run({ thermostatLocation: location });
          }}
        />
      </label>
      <label className="field inspector-field">
        Thermostat location kind
        <select
          aria-label="Thermostat location kind"
          value={h?.thermostatLocation?.kind ?? ""}
          onChange={(ev) => {
            if (!h?.thermostatLocation) return;
            const kind = ev.target.value as ThermostatLocationKind | "";
            run({
              thermostatLocation: {
                ...h.thermostatLocation,
                ...(kind ? { kind } : { kind: undefined }),
              },
            });
          }}
        >
          <option value="">unknown (IP check stays required)</option>
          <option value="outside-wet-room">outside a wet room</option>
          <option value="wet-room">wet room</option>
        </select>
      </label>
      <span className="hint">
        Select zones. Whole room uses the room footprint; floor planes use their
        entered bounds. No screed or exclusions are assumed.
      </span>
      {[
        { id: room.id, label: "Whole room" },
        ...(room.drainage?.planes ?? []),
      ].map((z) => (
        <label className="heating-zone" key={z.id}>
          <input
            type="checkbox"
            checked={h?.zoneIds.includes(z.id) ?? false}
            onChange={(ev) =>
              run({
                zoneIds: ev.target.checked
                  ? [...(h?.zoneIds ?? []), z.id]
                  : (h?.zoneIds ?? []).filter((id) => id !== z.id),
              })
            }
          />
          {z.label}
        </label>
      ))}
      <button
        type="button"
        onClick={() =>
          actions.setDrawMode(mode === "heating" ? "select" : "heating")
        }
      >
        {mode === "heating" ? "Finish cable drawing" : "Draw cable on plan"}
      </button>
      <span className="hint">
        Click to append route points; Escape finishes. Edit exact coordinates
        below (plan origin, mm). Route uses straight segments; bends require
        trade review.
      </span>
      {points.map((p, i) => (
        <div className="heating-point" key={`${i}:${p.x}:${p.y}`}>
          <span>Point {i + 1}</span>
          {(["x", "y"] as const).map((k) => (
            <label className="field inspector-field" key={k}>
              {k} (mm)
              <input
                aria-label={`Cable point ${i + 1} ${k} (mm)`}
                defaultValue={formatMm(p[k])}
                inputMode="decimal"
                onBlur={(ev) => {
                  if (ev.target.value !== formatMm(p[k]))
                    pointEdit(i, k, ev.target.value);
                }}
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() => run({ path: points.filter((_, j) => i !== j) })}
          >
            Remove point {i + 1}
          </button>
        </div>
      ))}
      <div className="heating-point">
        {(["x", "y"] as const).map((k) => (
          <label className="field inspector-field" key={k}>
            New point {k} (mm)
            <input
              aria-label={`New cable point ${k} (mm)`}
              value={point[k]}
              onChange={(ev) => setPoint({ ...point, [k]: ev.target.value })}
            />
          </label>
        ))}
        <button
          type="button"
          onClick={() => {
            if (!point.x.trim() || !point.y.trim()) {
              setError("Enter both point coordinates.");
              return;
            }
            if (
              run({
                path: [
                  ...points,
                  { x: Number(point.x) / 1000, y: Number(point.y) / 1000 },
                ],
              }).ok
            )
              setPoint({ x: "", y: "" });
          }}
        >
          Add cable point
        </button>
      </div>
      <strong>Entered keep-outs</strong>
      {keepouts.map((r) => (
        <div key={r.id} className="heating-point">
          <span>{r.label}</span>
          {(["x", "y", "w", "h"] as const).map((k) => (
            <label className="field inspector-field" key={k}>
              {k} (mm)
              <input
                aria-label={`${r.label} ${k} (mm)`}
                key={r[k]}
                defaultValue={formatMm(r[k])}
                onBlur={(ev) => {
                  if (ev.target.value !== formatMm(r[k]))
                    run({
                      keepouts: keepouts.map((v) =>
                        v.id === r.id
                          ? {
                              ...v,
                              [k]: ev.target.value.trim()
                                ? Number(ev.target.value) / 1000
                                : NaN,
                            }
                          : v,
                      ),
                    });
                }}
              />
            </label>
          ))}
          <span className="hint">{r.source || "Source unknown"}</span>
          <button
            type="button"
            onClick={() =>
              run({ keepouts: keepouts.filter((v) => v.id !== r.id) })
            }
          >
            Remove {r.label}
          </button>
        </div>
      ))}
      {(Object.keys(keepout) as (keyof typeof keepout)[]).map((k) => (
        <label className="field inspector-field" key={k}>
          New keep-out {k}
          {["x", "y", "w", "h"].includes(k) ? " (mm)" : ""}
          <input
            aria-label={`New keep-out ${k}`}
            value={keepout[k]}
            onChange={(ev) => setKeepout({ ...keepout, [k]: ev.target.value })}
          />
        </label>
      ))}
      <button
        type="button"
        onClick={() => {
          if (
            !keepout.label.trim() ||
            ["x", "y", "w", "h"].some(
              (k) => !keepout[k as keyof typeof keepout].trim(),
            )
          ) {
            setError("Enter keep-out label and all four dimensions.");
            return;
          }
          if (
            run({
              keepouts: [
                ...keepouts,
                {
                  id: uid("keepout"),
                  label: keepout.label,
                  x: Number(keepout.x) / 1000,
                  y: Number(keepout.y) / 1000,
                  w: Number(keepout.w) / 1000,
                  h: Number(keepout.h) / 1000,
                  source: keepout.source,
                },
              ],
            }).ok
          )
            setKeepout({ label: "", x: "", y: "", w: "", h: "", source: "" });
        }}
      >
        Add keep-out
      </button>
      {error && (
        <span className="inspector-error" role="alert">
          {error}
        </span>
      )}
      <p aria-label="Heating evidence">
        Product length: {figureText(e.cable.length)} · rated output: {figureText(e.cable.ratedOutput)} · coverage {figureText(e.cable.coverageMin)}–{figureText(e.cable.coverageMax)} · derived spacing ({e.spacingNote}): {figureText(e.cable.spacingMin, true)}–{figureText(e.cable.spacingMax, true)}.
        Cable current: {figureText(e.cable.ratedCurrent)} · thermostat switching current: {figureText(e.thermostat.ratedCurrent)} · cable voltage: {figureText(e.cable.ratedVoltage)} · thermostat voltage {figureText(e.thermostat.voltageMin)}–{figureText(e.thermostat.voltageMax)} · printed IP: {e.thermostat.ingressProtection?.value ?? "unknown"} ({e.thermostat.ingressProtection?.kind ?? "unknown"}).
        Plan route length: {figureText(e.figures.planRouteLength)} · spatial route length (sampled profile): {figureText(e.figures.spatialRouteLength)} · remaining confirmed cable length: {figureText(e.figures.remainingProductLength)} · drawn-path envelope: {figureText(e.figures.pathEnvelopeArea)} · selected {e.selectedArea} m² · excluding
        keep-outs {e.availableArea} m². Minimum non-adjacent spacing:{" "}
        {e.minimumNonAdjacentSpacing === undefined
          ? "unknown"
          : formatMm(e.minimumNonAdjacentSpacing) + " mm (modelled)"}
        . Boundary clearance:{" "}
        {e.edgeDistance === undefined
          ? "unknown"
          : formatMm(e.edgeDistance) + " mm"}
        . {e.coverageNote} {e.lengthNote}
      </p>
      <p className="hint">{e.sectionNote}</p>
      <div
        className="heating-section"
        dangerouslySetInnerHTML={{ __html: heatingSectionSvg(room) }}
      />
      {e.problems.map((p, i) => (
        <span
          key={i}
          className={
            p.severity === "error" ? "inspector-error" : "inspector-warn"
          }
        >
          {p.message}
        </span>
      ))}
      <button
        type="button"
        onClick={() =>
          download(
            "proposed-heating-review.html",
            renderHeatingReview(room),
            "text/html",
          )
        }
      >
        Download heating review
      </button>
      <button
        type="button"
        onClick={() => {
          const win = window.open("", "_blank");
          if (!win) return;
          win.document.write(renderHeatingReview(room));
          win.document.close();
          win.focus();
          win.print();
        }}
      >
        Print heating / save PDF
      </button>
    </section>
  );
}
