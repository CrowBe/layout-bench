/**
 * Inspector — exact numeric editing of the selected wall, opening, room or item.
 * Values are shown and typed in millimetres and go through the same store actions the tools
 * call, so a typed value is stored exactly as an agent's would be (0.1 mm precision, no snap).
 */

import { useEffect, useState } from "react";
import { actions, logActivity, useAppStore, type ActionResult } from "../model/store";
import { formatMm, segLen } from "../model/geometry";
import { catalogByKind } from "../model/catalog";
import { roomOnSide } from "../model/faces";
import { WallFaces } from "./WallFaces";
import { FixturePanel } from "./FixturePanel";

/** A text field that shows a stored value and commits a new one on Enter or blur. */
function NumberField({ label, value, unit, onCommit }: {
  label: string;
  value: number;
  unit: "mm" | "°";
  onCommit: (value: number) => ActionResult;
}) {
  const shown = unit === "mm" ? formatMm(value) : String(value);
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState("");
  useEffect(() => setDraft(shown), [shown]);

  const commit = () => {
    if (draft.trim() === shown) return;
    const n = Number(draft.trim());
    if (draft.trim() === "" || !Number.isFinite(n)) {
      setError(`"${draft}" is not a number.`);
      setDraft(shown);
      return;
    }
    const result = onCommit(unit === "mm" ? n / 1000 : n);
    setError(result.ok ? "" : result.summary);
    if (!result.ok) setDraft(shown);
  };

  return (
    <label className="field inspector-field">
      {label}
      <input
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(shown);
        }}
      />
      {error && <span className="inspector-error" role="alert">{error}</span>}
    </label>
  );
}

function DimensionStatus({ field, defaulted, onEnter }: { field: string; defaulted?: boolean; onEnter: () => void }) {
  if (defaulted === false) return <span className="hint">{field}: entered; site confirmation is not recorded.</span>;
  return <span className="inspector-warn">{field}: {defaulted ? "default placeholder" : "older value, provenance unknown"}. Not a surveyed value. <button type="button" onClick={onEnter}>Enter displayed value</button></span>;
}

/** Run a human edit and log it on the activity feed, like every other UI action. */
const human = (tool: string, run: () => ActionResult) => () => {
  const r = run();
  logActivity("human", tool, r.summary, r.ok);
  return r;
};

export function Inspector() {
  const model = useAppStore((s) => s.model);
  const editor = useAppStore((s) => s.editor);

  const opening = model.openings.find((o) => o.id === editor.selectedOpeningId);
  const wall = model.walls.find((w) => w.id === editor.selectedWallId);
  const room = model.rooms.find((r) => r.id === editor.selectedRoomId);
  const item = model.items.find((i) => i.id === editor.selectedItemId);

  if (opening) {
    const host = model.walls.find((w) => w.id === opening.wallId);
    if (!host) return null;
    const len = segLen(host.ax, host.ay, host.bx, host.by);
    const centre = opening.t * len;
    const edit = (patch: Parameters<typeof actions.editOpening>[1]) => human("edit_opening", () => actions.editOpening(opening.id, patch))();
    return (
      <aside className="inspector" aria-label="Selected opening">
        <strong>{opening.kind === "door" ? "Door" : "Window"} <code>{opening.id}</code></strong>
        <span className="hint">On wall <code>{host.id}</code> ({formatMm(len)} mm). End A is the wall's start point.</span>
        <NumberField label="Centre from wall end A (mm)" unit="mm" value={centre} onCommit={(v) => edit({ centre: v, from: "a" })} />
        <NumberField label="Centre from wall end B (mm)" unit="mm" value={len - centre} onCommit={(v) => edit({ centre: v, from: "b" })} />
        <NumberField label="Width (mm)" unit="mm" value={opening.width} onCommit={(v) => edit({ width: v })} />
        <DimensionStatus field="Width" defaulted={opening.widthDefaulted} onEnter={() => edit({ width: opening.width })} />
        {opening.kind === "window" && <NumberField label="Sill (mm)" unit="mm" value={opening.sill} onCommit={(v) => edit({ sill: v })} />}
        {opening.kind === "window" && <DimensionStatus field="Sill" defaulted={opening.sillDefaulted} onEnter={() => edit({ sill: opening.sill })} />}
        <NumberField label="Height (mm)" unit="mm" value={opening.height} onCommit={(v) => edit({ height: v })} />
        <DimensionStatus field="Height" defaulted={opening.heightDefaulted} onEnter={() => edit({ height: opening.height })} />
      </aside>
    );
  }

  if (wall) {
    const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
    const edit = (patch: Parameters<typeof actions.editWall>[1]) => human("edit_wall", () => actions.editWall(wall.id, patch))();
    /** Change the length by moving end B along the wall's own direction. */
    const setLength = (next: number) =>
      edit({ bx: wall.ax + ((wall.bx - wall.ax) / len) * next, by: wall.ay + ((wall.by - wall.ay) / len) * next });
    return (
      <aside className="inspector" aria-label="Selected wall">
        <strong>Wall <code>{wall.id}</code></strong>
        <NumberField label="End A x (mm)" unit="mm" value={wall.ax} onCommit={(v) => edit({ ax: v })} />
        <NumberField label="End A y (mm)" unit="mm" value={wall.ay} onCommit={(v) => edit({ ay: v })} />
        <NumberField label="End B x (mm)" unit="mm" value={wall.bx} onCommit={(v) => edit({ bx: v })} />
        <NumberField label="End B y (mm)" unit="mm" value={wall.by} onCommit={(v) => edit({ by: v })} />
        <NumberField label="Length, moving end B (mm)" unit="mm" value={len} onCommit={setLength} />
        <NumberField label="Thickness (mm)" unit="mm" value={wall.thickness} onCommit={(v) => edit({ thickness: v })} />
        <DimensionStatus field="Thickness" defaulted={wall.thicknessDefaulted} onEnter={() => edit({ thickness: wall.thickness })} />
        <NumberField label="Height (mm)" unit="mm" value={wall.height} onCommit={(v) => edit({ height: v })} />
        <DimensionStatus field="Height" defaulted={wall.heightDefaulted} onEnter={() => edit({ height: wall.height })} />
        <WallFaces wall={wall} roomFor={(side) => roomOnSide(wall, side, model.rooms)} />
      </aside>
    );
  }

  if (room) {
    const edit = (patch: Parameters<typeof actions.updateRoom>[1]) => human("update_room", () => actions.updateRoom(room.id, patch))();
    return (
      <aside className="inspector" aria-label="Selected room">
        <strong>{room.label}</strong>
        <NumberField label="Left edge x (mm)" unit="mm" value={room.x} onCommit={(v) => edit({ x: v })} />
        <NumberField label="Top edge y (mm)" unit="mm" value={room.y} onCommit={(v) => edit({ y: v })} />
        <NumberField label="Width (mm)" unit="mm" value={room.w} onCommit={(v) => edit({ w: v })} />
        <NumberField label="Depth (mm)" unit="mm" value={room.h} onCommit={(v) => edit({ h: v })} />
      </aside>
    );
  }

  if (item) {
    const cat = catalogByKind(item.kind);
    const move = (x?: number, y?: number, rotation?: number) => human("move_item", () => actions.moveItem(item.id, x, y, rotation))();
    return (
      <aside className="inspector" aria-label="Selected item">
        <strong>{cat?.label ?? item.kind}</strong>
        {cat && <span className="hint">{formatMm(cat.w)} × {formatMm(cat.d)} mm footprint</span>}
        {item.anchor
          ? <span className="hint">Centre ({formatMm(item.x)}, {formatMm(item.y)}) mm, facing {item.rotation}°, derived from its set-out.</span>
          : <>
            <NumberField label="Centre x (mm)" unit="mm" value={item.x} onCommit={(v) => move(v)} />
            <NumberField label="Centre y (mm)" unit="mm" value={item.y} onCommit={(v) => move(undefined, v)} />
            <NumberField label="Rotation (°)" unit="°" value={item.rotation} onCommit={(v) => move(undefined, undefined, v)} />
          </>}
        <FixturePanel model={model} item={item} />
      </aside>
    );
  }

  return null;
}
