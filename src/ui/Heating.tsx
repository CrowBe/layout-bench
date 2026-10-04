import { useState } from "react";
import {
  actions,
  logActivity,
  useAppStore,
  uid,
  type HeatingPatch,
} from "../model/store";
import type { Heating as HeatingSpec, Room } from "../model/types";
import { formatMm } from "../model/geometry";
import { heatingEvidence } from "../model/heating";
import { heatingSectionSvg, renderHeatingReview } from "../sheets/heating";
import { QuantityField } from "./WallFaces";
import { download } from "./download";
import { useProductStore } from "../model/productLibrary";
import { impliedSpacing } from "../model/heatingProduct";

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
  const h = room.heating,
    e = heatingEvidence(room);
  const library = useProductStore((s) => s.products);
  const pin = (role: "cable" | "controller", id: string) => {
    const product = library.find((p) => p.id === id);
    const r = actions.setHeatingProduct(room.id, role, id === "" ? null : product ?? null);
    logActivity("human", "use_heating_product", r.summary, r.ok);
    setError(r.ok ? "" : r.summary);
  };
  const pitch = impliedSpacing(h?.cableProduct?.specification);
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
  const quantities = [
    ["length", "Cable product length (m)", 1],
    ["ratedOutput", "Rated output (W)", 1],
    ["minSpacing", "Minimum cable spacing (mm)", 1000],
    ["edgeClearance", "Boundary / keep-out clearance (mm)", 1000],
    ["depthFromBottom", "Cable centre above screed bottom (mm)", 1000],
  ] as const;
  return (
    <section className="wall-faces heating-panel" aria-label="Heating cable">
      <strong>Proposed in-screed heating</strong>
      <span className="hint">
        Blank = unknown. Enter product/trade information with its source.
        Manufacturer and electrician review pending.
      </span>
      {(["cable", "controller"] as const).map((role) => {
        const category = role === "cable" ? "heating-cable" : "thermostat";
        const pinned = role === "cable" ? h?.cableProduct : h?.controller;
        return (
          <label className="field" key={role}>
            {role === "cable" ? "Cable product from the library" : "Controller product from the library"}
            <select aria-label={`Heating ${role} product`} value={pinned?.productId ?? ""} onChange={(ev) => pin(role, ev.target.value)}>
              <option value="">none (enter figures by hand)</option>
              {library.filter((p) => p.category === category).map((p) => <option key={p.id} value={p.id}>{p.manufacturer || "unnamed"} {p.model}</option>)}
              {pinned && !library.some((p) => p.id === pinned.productId) && <option value={pinned.productId}>{pinned.manufacturer || "unnamed"} {pinned.model} (not in this browser's library)</option>}
            </select>
          </label>
        );
      })}
      {pitch && <span className="hint" data-implied-spacing>Cable label coverage implies {formatMm(pitch.min)}–{formatMm(pitch.max)} mm between runs.</span>}
      {(
        ["manufacturer", "model", "productSource", "requirements"] as const
      ).map((k) => (
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
            key={h?.[k] ?? ""}
            defaultValue={h?.[k] ?? ""}
            placeholder="unknown"
            onBlur={(event) => {
              if (event.target.value !== (h?.[k] ?? ""))
                run({ [k]: event.target.value || null });
            }}
          />
        </label>
      ))}
      {quantities.map(([k, label, scale]) => (
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
        Plan route length: {e.planRouteLength} m · spatial route length (sampled profile): {e.routeLength === undefined ? "unknown" : `${e.routeLength} m`} · remaining confirmed cable length: {e.remainingProductLength === undefined ? "unknown" : `${e.remainingProductLength} m`} · selected {e.selectedArea} m² · excluding
        keep-outs {e.availableArea} m². Minimum non-adjacent spacing:{" "}
        {e.minimumNonAdjacentSpacing === undefined
          ? "unknown"
          : formatMm(e.minimumNonAdjacentSpacing) + " mm"}
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
