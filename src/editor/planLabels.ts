/**
 * Plan text grows with the view scale so a zoomed-out drawing stays readable, then stops.
 * A small room auto-fits at a much higher px-per-metre than Sunset Loft (the loft is
 * larger, so the same canvas yields a smaller scale). Uncapped, the bathroom's room name
 * becomes several dozen pixels, covers the back-wall dimension, and runs past the room.
 * The caps sit near the loft's auto-fit size: that plan keeps body-size labels, and the
 * bathroom stops getting bigger once it is already easy to read.
 */

import type { Room, Wall } from "../model/types";
import { formatMm, segLen, segPoint } from "../model/geometry";

const ROOM_FONT_MIN = 10;
const ROOM_FONT_MAX = 24;
const DIM_FONT_MIN = 9;
const DIM_FONT_MAX = 18;
export const ROOM_FONT_FAMILY = "Inter, sans-serif";
export const DIM_FONT_FAMILY = "ui-monospace, monospace";
/** px of dimension text per metre of view scale, shared by the layout and the SVG label. */
export const DIM_FONT_PER_METRE = 0.22;
/** Baseline of a wall dimension, metres off the wall centreline along its plan normal. */
export const DIM_OFFSET_M = 0.22;

export function planFontPx(scale: number, perMetre: number, minPx: number, maxPx: number): number {
  return Math.min(maxPx, Math.max(minPx, Math.round(perMetre * scale)));
}

export function dimensionFontPx(scale: number): number {
  return planFontPx(scale, DIM_FONT_PER_METRE, DIM_FONT_MIN, DIM_FONT_MAX);
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

export function textWidthPx(text: string, fontSize: number, family: string): number {
  if (measureCtx === undefined) {
    measureCtx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) return text.length * fontSize * 0.56;
  measureCtx.font = `${fontSize}px ${family}`;
  return measureCtx.measureText(text).width;
}

export interface PxBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boxesOverlap(a: PxBox, b: PxBox, gap: number): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

export function wallDimensionAnchor(wall: Wall, offsetM: number): { x: number; y: number; len: number } | null {
  const len = segLen(wall.ax, wall.ay, wall.bx, wall.by);
  if (!(len > 1e-6)) return null;
  const mid = segPoint({ x: wall.ax, y: wall.ay }, { x: wall.bx, y: wall.by }, 0.5);
  const nx = (-(wall.by - wall.ay) / len) * offsetM;
  const ny = ((wall.bx - wall.ax) / len) * offsetM;
  return { x: mid.x + nx, y: mid.y + ny, len };
}

/** Ink box of a centred dimension. Wider and taller than the glyphs so the room name stays clear of the real text. */
export function dimensionInk(wall: Wall, scale: number, fontPx: number): PxBox | null {
  const anchor = wallDimensionAnchor(wall, DIM_OFFSET_M);
  if (!anchor) return null;
  const width = textWidthPx(formatMm(anchor.len), fontPx, DIM_FONT_FAMILY) + fontPx * 0.4;
  const baseline = anchor.y * scale;
  const ascent = fontPx * 1.05;
  const descent = fontPx * 0.45;
  return { x: anchor.x * scale - width / 2, y: baseline - ascent, w: width, h: ascent + descent };
}

export interface RoomLabelLayout {
  x: number;
  /** Alphabetic baseline of the first line, in SVG user units. */
  y: number;
  fontSize: number;
  lines: string[];
  lineDy: number;
  /** Ink box used to keep the name inside the room and clear of dimensions. */
  box: PxBox;
}

/**
 * Room name plus area, inside the room rectangle and clear of wall dimensions.
 * Shrinks, then wraps onto a second line, when the measured width would cross the inset.
 */
export function layoutRoomLabel(room: Room, walls: Wall[], scale: number): RoomLabelLayout {
  const area = `${(room.w * room.h).toFixed(1)} m²`;
  const full = `${room.label} · ${area}`;
  const dimFont = dimensionFontPx(scale);
  const dims = walls.flatMap((wall) => {
    const ink = dimensionInk(wall, scale, dimFont);
    return ink ? [ink] : [];
  });

  const roomLeft = room.x * scale;
  const roomTop = room.y * scale;
  const roomW = Math.max(0, room.w * scale);
  const roomH = Math.max(0, room.h * scale);
  let edge = Math.max(6, 0.06 * scale);
  if (edge * 2 > roomW - 4) edge = Math.max(1, (roomW - 4) / 2);
  if (edge * 2 > roomH - 4) edge = Math.max(1, Math.min(edge, (roomH - 4) / 2));
  const left = roomLeft + edge;
  const top = roomTop + edge;
  const bottom = roomTop + roomH - edge;
  const maxWidth = Math.max(4, roomW - edge * 2);
  // Slack for the difference between canvas measureText and SVG glyph bounds.
  const fitWidth = Math.max(4, maxWidth - 8);

  const fit = (texts: string[], start: number) => {
    let fontSize = start;
    let widths = texts.map((text) => textWidthPx(text, fontSize, ROOM_FONT_FAMILY));
    while (Math.max(...widths) > fitWidth && fontSize > ROOM_FONT_MIN) {
      fontSize -= 1;
      widths = texts.map((text) => textWidthPx(text, fontSize, ROOM_FONT_FAMILY));
    }
    return { fontSize, widths };
  };

  const startSize = planFontPx(scale, 0.28, ROOM_FONT_MIN, ROOM_FONT_MAX);
  let lines = [full];
  let fitted = fit(lines, startSize);
  if (fitted.widths[0] > fitWidth) {
    lines = [room.label, area];
    fitted = fit(lines, startSize);
  }

  const { fontSize } = fitted;
  const lineDy = Math.round(fontSize * 1.25);
  const blockW = Math.min(maxWidth, Math.max(...fitted.widths));
  // Default alphabetic baseline: most of the em sits above y, a little below it.
  const ascent = fontSize * 0.92;
  const descent = fontSize * 0.35;
  const blockH = ascent + (lines.length - 1) * lineDy + descent;

  let inkTop = top;
  const hits = (topPx: number) =>
    dims.some((dim) => boxesOverlap({ x: left, y: topPx, w: blockW, h: blockH }, dim, 8));
  let guard = 0;
  while (hits(inkTop) && inkTop + blockH < bottom && guard < 500) {
    inkTop += 2;
    guard += 1;
  }
  if (inkTop + blockH > bottom) inkTop = Math.max(top, bottom - blockH);

  return { x: left, y: inkTop + ascent, fontSize, lines, lineDy, box: { x: left, y: inkTop, w: blockW, h: blockH } };
}

/** A fixture's name is drawn inside its footprint only when it fits there; a small wall fitting would spill over its neighbours. */
export function labelFits(label: string, widthPx: number, depthPx: number, fontPx: number): boolean {
  return textWidthPx(label, fontPx, ROOM_FONT_FAMILY) <= widthPx - 4 && fontPx * 1.2 <= depthPx;
}
