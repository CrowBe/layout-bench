import {
  actions,
  logActivity,
  useAppStore,
  type FloorTilingPatch,
} from "../model/store";
import type { Room } from "../model/types";
import { floorTileLayout } from "../model/floorTiling";
import {
  floorTilingPrintHtml,
  floorCutRows,
  floorTileDrawing,
  renderFloorTilingSheet,
} from "../sheets/floorTiling";
import { QuantityField, toInput } from "./WallFaces";
import { download } from "./download";
export function FloorTiling({ room }: { room: Room }) {
  const model = useAppStore((s) => s.model),
    t = room.floorTiling,
    l = floorTileLayout(model, room);
  const set = (p: FloorTilingPatch) => {
    const r = actions.setFloorTiling(room.id, p);
    logActivity("human", "set_floor_tiling", r.summary, r.ok);
    return r;
  };
  const move = (axis: "originX" | "originY", delta: number) => {
    const q = t?.[axis];
    if (q?.value !== undefined)
      set({
        [axis]: {
          ...toInput(q)!,
          value: q.value + delta,
          status: q.status ?? "proposed",
        },
      });
  };
  const svg = () => renderFloorTilingSheet(model, room);
  return (
    <section className="wall-tiling" aria-label="Floor tiling">
      <strong>Floor tile set-out (proposed)</strong>
      <span className="hint">
        Sizes in mm; blank stays unknown. Grid is cut to the finished wall
        faces. Waste lines show position; aperture cuts require site
        confirmation.
      </span>
      <label className="field inspector-field">
        Floor tile zone
        <select
          aria-label="Floor tile zone"
          value={t?.zone ?? ""}
          onChange={(e) => set({ zone: e.target.value || null })}
        >
          <option value="">— not chosen —</option>
          <option value="room">Whole room, finished faces</option>
          {room.drainage?.planes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} floor plane
            </option>
          ))}
        </select>
      </label>
      <QuantityField
        label="Floor tile length (mm)"
        q={t?.tileLength}
        onCommit={(q) => set({ tileLength: q })}
      />
      <QuantityField
        label="Floor tile width (mm)"
        q={t?.tileWidth}
        onCommit={(q) => set({ tileWidth: q })}
      />
      <label className="field inspector-field">
        Floor set-out axis
        <select
          aria-label="Floor set-out axis"
          value={t?.axis ?? ""}
          onChange={(e) =>
            set({ axis: (e.target.value || null) as "x" | "y" | null })
          }
        >
          <option value="">— not chosen —</option>
          <option value="x">Long edge along X (right)</option>
          <option value="y">Long edge along Y (down)</option>
        </select>
      </label>
      <QuantityField
        label="Floor grout joint (mm)"
        q={t?.joint}
        onCommit={(q) => set({ joint: q })}
      />
      <QuantityField
        label="Floor origin X from finished west (mm)"
        q={t?.originX}
        onCommit={(q) => set({ originX: q })}
      />
      <QuantityField
        label="Floor origin Y from finished north (mm)"
        q={t?.originY}
        onCommit={(q) => set({ originY: q })}
      />
      <div
        className="tile-elevation"
        dangerouslySetInnerHTML={{ __html: floorTileDrawing(l, room) }}
      />
      <div className="tile-nudge">
        {(
          [
            ["originX", -0.01, "left"],
            ["originX", 0.01, "right"],
            ["originY", -0.01, "up"],
            ["originY", 0.01, "down"],
          ] as const
        ).map(([a, d, name]) => (
          <button
            key={name}
            disabled={!l.origin}
            aria-label={`Move floor origin 10 mm ${name}`}
            onClick={() => move(a, d)}
          >
            {name} 10
          </button>
        ))}
      </div>
      <table className="face-table" aria-label="Floor tile cuts">
        <thead>
          <tr>
            <th>Perimeter</th>
            <th>mm</th>
          </tr>
        </thead>
        <tbody>
          {floorCutRows(l).map((c) => (
            <tr key={c.edge} data-cut={c.edge}>
              <td>{c.edge}</td>
              <td>{c.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="hint">{l.faces.map((f) => f.label).join(" · ")}</span>
      <label className="field inspector-field">
        Floor tiler field notes
        <textarea
          aria-label="Floor tiler field notes"
          key={t?.note ?? ""}
          defaultValue={t?.note ?? ""}
          onBlur={(e) => set({ note: e.target.value || null })}
        />
      </label>
      {l.missing.length > 0 && (
        <ul aria-label="Unresolved floor tiling fields">
          {l.missing.map((m) => (
            <li key={m} className="inspector-warn">
              Unknown: {m}
            </li>
          ))}
        </ul>
      )}
      {l.problems
        .filter((p) => p.code !== "floor_tiling_unresolved")
        .map((p) => (
          <span
            key={p.message}
            className={
              p.severity === "error" ? "inspector-error" : "inspector-warn"
            }
          >
            {p.message}
          </span>
        ))}
      <div className="sheets-actions">
        <button
          onClick={() =>
            download(
              `${model.name.replace(/[^\w-]+/g, "-")}-${room.id}-floor-tiling.svg`,
              svg(),
              "image/svg+xml",
            )
          }
        >
          Download floor set-out (SVG)
        </button>
        <button
          onClick={() => {
            const w = window.open("", "_blank");
            if (!w) return;
            w.document.write(floorTilingPrintHtml(svg()));
            w.document.close();
            w.focus();
            w.print();
          }}
        >
          Print floor / save as PDF
        </button>
        {t && (
          <button onClick={() => set({ clear: true })}>
            Clear floor set-out
          </button>
        )}
      </div>
    </section>
  );
}
