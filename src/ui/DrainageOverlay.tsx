/**
 * Plan overlay for a room's drainage (#7): plane tints, downhill arrows, level annotations,
 * wastes and control points. A waste linked to a drain brief (#82) draws its grate at the
 * brief's size and its outlet where that is resolved; otherwise a centre line or dot. Read-only; every number comes from model/drainage.ts, and an
 * unresolved plane is drawn hatched with "?" rather than a guessed level.
 */

import { surfaces, type PlaneSurface } from "../model/drainage";
import { formatMm } from "../model/geometry";
import type { FloorPlane, Room } from "../model/types";
import { grateOutline, outletPosition, wasteProduct } from "../model/wasteProduct";

const lvl = (m: number) => `${m >= 0 ? "+" : "−"}${formatMm(Math.abs(m))}`;

/** Unit vector pointing downhill at a plane's centre, or null when flat. */
function downhill(s: PlaneSurface, p: FloorPlane, waste?: { ax: number; ay: number; bx: number; by: number }): { x: number; y: number } | null {
  let g: { x: number; y: number } | null = null;
  if (s.gradient) g = { x: -s.gradient.x, y: -s.gradient.y };
  else if (waste) {
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    const dx = waste.bx - waste.ax, dy = waste.by - waste.ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.min(1, Math.max(0, ((cx - waste.ax) * dx + (cy - waste.ay) * dy) / l2)) : 0;
    const nx = waste.ax + dx * t - cx, ny = waste.ay + dy * t - cy;
    g = { x: nx, y: ny };
    if ((s.fall ?? 0) < 0) g = { x: -nx, y: -ny };
  }
  if (!g) return null;
  const len = Math.hypot(g.x, g.y);
  return len < 1e-9 ? null : { x: g.x / len, y: g.y / len };
}

export function DrainageOverlay({ room, S }: { room: Room; S: number }) {
  const d = room.drainage;
  if (!d) return null;
  const map = surfaces(d);
  const fs = Math.max(9, Math.min(13, S * 0.12));
  return (
    <g data-role="drainage" pointerEvents="none">
      <defs>
        <pattern id={`unres-${room.id}`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="#c0392b" strokeWidth="1" opacity="0.5" />
        </pattern>
      </defs>
      {d.planes.map((p) => {
        const s = map.get(p.id)!;
        const waste = p.wasteId ? d.wastes.find((w) => w.id === p.wasteId) : undefined;
        const cx = (p.x + p.w / 2) * S, cy = (p.y + p.h / 2) * S;
        const dir = s.resolved ? downhill(s, p, waste) : null;
        const L = Math.min(p.w, p.h) * S * 0.3;
        const centre = s.resolved ? s.level(p.x + p.w / 2, p.y + p.h / 2) : undefined;
        return (
          <g key={p.id} data-plane={p.id} data-resolved={s.resolved}>
            <rect x={p.x * S} y={p.y * S} width={p.w * S} height={p.h * S}
              fill={s.resolved ? "#4f86b0" : `url(#unres-${room.id})`} fillOpacity={s.resolved ? 0.14 : 1}
              stroke={s.resolved ? "#4f86b0" : "#c0392b"} strokeDasharray="5 3" strokeWidth={1} />
            {dir && L > 6 && (
              <g stroke="#2f6a96" strokeWidth={1.6} fill="#2f6a96">
                <line x1={cx - dir.x * L} y1={cy - dir.y * L} x2={cx + dir.x * L} y2={cy + dir.y * L} />
                <polygon points={`${cx + dir.x * L},${cy + dir.y * L} ${cx + dir.x * (L - 8) - dir.y * 4},${cy + dir.y * (L - 8) + dir.x * 4} ${cx + dir.x * (L - 8) + dir.y * 4},${cy + dir.y * (L - 8) - dir.x * 4}`} />
              </g>
            )}
            <text x={cx + 4} y={cy + fs + 4} fontSize={fs} fill={s.resolved ? "#2f6a96" : "#c0392b"}>
              {p.label}{s.resolved && s.fall !== undefined ? (s.fall === 0 ? " · flat" : ` · ${s.fall < 0 ? "reverse " : ""}fall 1:${Math.round(1 / Math.abs(s.fall))}`) : " · unresolved"}
            </text>
            <text x={cx + 4} y={cy - 4} fontSize={fs} fill={s.resolved ? "#2f6a96" : "#c0392b"} data-role="plane-level">
              {centre !== undefined ? `${lvl(centre)} mm` : "?"}
            </text>
            {p.controls.map((c) => (
              <g key={c.id}>
                <circle cx={c.x * S} cy={c.y * S} r={3} fill="#fff" stroke="#2f6a96" />
                <text x={c.x * S + 5} y={c.y * S - 4} fontSize={fs - 1} fill="#2f6a96">
                  {c.level.value !== undefined ? `${lvl(c.level.value)}${c.level.status ? ` ${c.level.status}` : ""}` : "?"}
                </text>
              </g>
            ))}
          </g>
        );
      })}
      {d.wastes.map((w) => {
        const info = wasteProduct(w);
        const grate = grateOutline(w, info);
        const outlet = outletPosition(w, info);
        return (
        <g key={w.id} data-waste={w.id} data-product={info?.productId}>
          {grate
            ? <>
                <polygon data-role="grate" points={grate.map((p) => `${p.x * S},${p.y * S}`).join(" ")} fill="#1c1c1c" fillOpacity={0.55} stroke="#1c1c1c" strokeWidth={1} />
                {w.kind === "linear" && <line x1={w.ax * S} y1={w.ay * S} x2={w.bx * S} y2={w.by * S} stroke="#f5f1e8" strokeWidth={1} strokeDasharray="3 2" />}
              </>
            : w.kind === "linear"
              ? <line x1={w.ax * S} y1={w.ay * S} x2={w.bx * S} y2={w.by * S} stroke="#1c1c1c" strokeWidth={5} strokeLinecap="round" opacity={0.75} />
              : <circle cx={w.ax * S} cy={w.ay * S} r={7} fill="#1c1c1c" opacity={0.75} />}
          {outlet.x !== undefined && outlet.y !== undefined && (
            <circle data-role="outlet" cx={outlet.x * S} cy={outlet.y * S} r={Math.max(3, ((outlet.diameter ?? 0.05) / 2) * S)} fill="none" stroke="#c97a1e" strokeWidth={1.5} />
          )}
          <text x={((w.ax + w.bx) / 2) * S + 6} y={((w.ay + w.by) / 2) * S - 8} fontSize={fs} fill="#1c1c1c">
            {w.label} {w.level?.value !== undefined ? `${lvl(w.level.value)} mm${w.level.status ? ` (${w.level.status})` : ""}` : "level ?"}
          </text>
        </g>
        );
      })}
    </g>
  );
}
