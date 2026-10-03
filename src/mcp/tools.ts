/**
 * The 60 WebMCP tools (+ 1 dynamic, registered in bootstrap.ts).
 * Every tool calls THE SAME actions the UI buttons use — one store, human and agent co-edit.
 * Arguments accept human names ("bedroom", "sofa") as well as ids.
 */

import { actions, lookupItem, lookupWall, lookupRoom, store, type ActionResult, type AnchorInput, type OpeningPosition, type ServicePointInput, type WallSidePatch, type HeatingPatch, type FloorPatch, type DrainagePatch, type TilingPatch, type FloorTilingPatch } from "../model/store";
import { anchorPose, clearances, roughIn } from "../model/fixtures";
import { SHEETS, checkSheet, reconcile, type AckInput } from "../sheets/check";
import { catalogue, renderStageDiagram, renderStageSpec } from "../sheets/stageView";
import { applyView, composeView, currentView, recordExport, savedViews } from "../sheets/viewState";
import { recordIssued } from "../sheets/issued";
import { floorTileLayout } from "../model/floorTiling";
import { floorCutRows, renderFloorTilingSheet } from "../sheets/floorTiling";
import { TILE_FLOOR_REFERENCES, TILE_ORIENTATIONS, TILE_ORIGIN_FROM, TILE_REFERENCES, tilingLayout } from "../model/tiling";
import { cutRows, renderTilingSheet } from "../sheets/tiling";
import { catalogByKind } from "../model/catalog";
import { FACE_NAMES, LAYER_KINDS, VALUE_STATUSES, distanceToFace, nearestFootprintPoint, roomOnSide, sideFaces, sideProblems } from "../model/faces";
import type { WallSideName } from "../model/types";
import { drainageProblems, heightAt, planeSurface, sectionAlong, surfaces, thresholds } from "../model/drainage";
import { heatingEvidence } from "../model/heating";
import { renderHeatingReview } from "../sheets/heating";
import { finishedLevel } from "../model/floor";
import { FLOOR_LAYER_KINDS, DEFAULT_DATUM, floorLevels, floorProblems } from "../model/floor";
import { IDENTITY_FIELDS, SELECTION_STATUSES, type SelectionStatus } from "../model/productIdentity";
import { PRODUCT_CATEGORIES, REFERENCES, RESEARCH_PROTOCOL, applies, categoryById, type SpecSubmission } from "../model/products";
import { measurementFields } from "../model/productMeasurements";
import { productStore, products, requestEvidenceAttachments } from "../model/productLibrary";
import { productReviewSummary } from "../model/productReview";
import { checkModel } from "../model/issues";
import { CATALOG } from "../model/catalog";
import { SUPPLIER_ORIGIN, getProduct, listProducts } from "./supplier";
import { dist, formatMm, quantize, segLen } from "../model/geometry";
import { bus, EVENTS } from "../three/exportBus";
import { executeWrapped, type ToolDef } from "./registry";

const identityValueSchema = { type: "object", properties: { state: { type: "string", enum: ["known", "unknown", "not-applicable"] }, value: { type: ["string", "null"] }, sources: { type: "array", items: { type: "object" } }, note: { type: "string" }, alternatives: { type: "array", items: { type: "object" } } }, required: ["state", "value"], additionalProperties: false };
const exactSchemas = { identity: { type: "object", properties: Object.fromEntries(Object.keys(IDENTITY_FIELDS).map(k => [k, identityValueSchema])), additionalProperties: false }, componentsStatus: { type: "string", enum: ["documented", "unknown", "not-applicable"] }, components: { type: "array", items: { type: "object", properties: { name: { type: "string" }, code: identityValueSchema, quantity: { type: ["integer", "null"] }, provision: { type: "string", enum: ["included", "separately-required", "unresolved"] }, sources: { type: "array", items: { type: "object" } }, note: { type: "string" } }, required: ["name", "code", "quantity", "provision"], additionalProperties: false } } };
const num = { type: "number" } as const;
const str = { type: "string" } as const;

/** Opening position from tool input: t, or centre from a named wall end. */
const position = (i: Record<string, unknown>): OpeningPosition => ({
  t: i.t as number | undefined,
  centre: i.centre as number | undefined,
  from: i.from as "a" | "b" | undefined,
});

const quantitySchema = {
  type: ["object", "null"],
  properties: {
    value: { type: ["number", "null"], description: "metres; omit or null when unknown" },
    status: { type: "string", enum: VALUE_STATUSES },
    source: str,
  },
  additionalProperties: false,
} as const;
const sideSchema = { type: "string", enum: ["left", "right"], description: "Walking the wall from end A to end B on the plan: the side on your left or right." } as const;

const obj = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

/**
 * The house rule for reproducing someone's plan. It travels with `get_underlay` because that is
 * the tool an agent reaches for the moment a drawing is involved: the default is FIDELITY —
 * copy what is drawn, at the size it is drawn, and model anything the catalogue is missing.
 */
export const TRACING_PROTOCOL: string[] = [
  "1. Calibrate first, and get the drawing into BOTH places. You need it uploaded on the page (that is what carries the scale) AND pasted into your conversation (that is the only way you can see it) — get_underlay returns the mapping, never the pixels. Then ask the human for ONE real dimension and call calibrate_underlay with two points on the image and that distance. Measure in fractions of the image, never in pixels, and convert with the `mapping` get_underlay hands you. Note the order: clear_model also clears the underlay, so empty the plan BEFORE the image is loaded, never after.",
  "2. Copy the drawing, do not redesign it. Reproduce the walls, openings and rooms that are actually drawn — the same count, the same positions, the same proportions. Do not add rooms, move doors to where they would be tidier, or 'improve' the layout. If something in the drawing is ambiguous, place your best reading and say so with leave_note rather than inventing.",
  "3. Structure before contents: outer walls, then partitions (add_wall), then openings on the walls that carry them (add_door / add_window), then rooms (add_room), then furniture.",
  "4. Match every opening to its drawing. Doors and windows go where the plan puts them, at the width the plan shows, and add_door's `hinge` and `side` must match the swing arc drawn on the paper.",
  "5. Furnish what is drawn, piece by piece. Every symbol on the plan becomes an item — no more, no fewer. Match its position, its orientation (rotation is which way the piece FACES) and its real size.",
  "6. Never approximate a distinctive symbol with the nearest stock item. If the plan shows a corner bath, an L-shaped sofa, a piano or a kitchen island and the catalogue has no such kind, call define_item_kind to model it at the size the plan draws — optionally with `parts` for real 3D geometry — and then place it. get_item_catalog is a convenience, not a constraint.",
  "7. Sit furniture against the walls the drawing sits it against: offset the centre by depth/2 from the wall FACE (centreline ± thickness/2), not from the centreline.",
  "8. Verify, then repair. Call get_issues, fix every error it reports, and call it again until only intentional warnings remain. Finish with build_3d so the human sees the result.",
];

export const TOOLS: ToolDef[] = [
  // ------------------------------------------------------------------ reads
  {
    name: "get_model",
    title: "Read the whole plan",
    description:
      "Read the full floor plan in meters. Each wall and opening includes dimensionStatus for thickness/height or width/sill/height: defaulted, entered, or unknown for older data. Entered means supplied to the editor, not site-confirmed. Numeric defaults are layout placeholders, not surveyed dimensions. Each opening also carries its centre and jamb positions from both wall ends.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    execute: () => {
      const m = store.getState().model;
      const openings = m.openings.map((o) => {
        const w = m.walls.find((x) => x.id === o.wallId);
        if (!w) return o;
        const len = segLen(w.ax, w.ay, w.bx, w.by);
        const c = quantize(o.t * len);
        const jambs = [quantize(c - o.width / 2), quantize(c + o.width / 2)];
        return {
          ...o,
          dimensionStatus: {
            width: o.widthDefaulted === undefined ? "unknown" : o.widthDefaulted ? "defaulted" : "entered",
            ...(o.kind === "window" ? { sill: o.sillDefaulted === undefined ? "unknown" : o.sillDefaulted ? "defaulted" : "entered" } : {}),
            height: o.heightDefaulted === undefined ? "unknown" : o.heightDefaulted ? "defaulted" : "entered",
          },
          position: {
            centreFromA: c,
            centreFromB: quantize(len - c),
            nearJambFromA: jambs[0],
            nearJambFromB: quantize(len - jambs[1]),
          },
        };
      });
      return {
        ok: true,
        summary: `Plan "${m.name}": ${m.walls.length} walls, ${m.openings.length} openings, ${m.rooms.length} rooms, ${m.items.length} items.`,
        model: { ...m, walls: m.walls.map((w) => ({ ...w, dimensionStatus: {
          thickness: w.thicknessDefaulted === undefined ? "unknown" : w.thicknessDefaulted ? "defaulted" : "entered",
          height: w.heightDefaulted === undefined ? "unknown" : w.heightDefaulted ? "defaulted" : "entered",
        } })), openings },
      };
    },
  },
  {
    name: "get_issues",
    title: "Check the plan for problems",
    description:
      "Run the constraint checker over the plan. Detects: too-short walls, loose ends, collinear overlaps, mid-span crossings, openings overflowing their wall or overlapping each other, walls ending inside an opening, floating/overlapping/doorless rooms, furniture crossing walls, blocking doors/windows, or colliding, and on wall sides: out-of-order or negative build-up layers, unresolved faces (unknown frame or thickness), and a frame recorded in front of the existing surface. Use it after editing to self-repair.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    execute: () => {
      const issues = checkModel(store.getState().model);
      return {
        ok: true,
        summary: issues.length === 0 ? "0 issues — the plan is clean." : `${issues.length} issue(s) found.`,
        issues,
      };
    },
  },
  {
    name: "get_item_catalog",
    title: "Furniture catalogue",
    description: "List the furniture catalog: kind, label, footprint (width × depth in meters) and height.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    execute: () => ({
      ok: true,
      summary: `${CATALOG.length} furniture kinds available.`,
      catalog: CATALOG.map(({ kind, label, w, d, h, category }) => ({ kind, label, w, d, h, category })),
    }),
  },
  {
    name: "get_editor_state",
    title: "What the human is doing right now",
    description:
      "Read what the human is doing right now: 2D/3D view, camera mode, selected wall/item/room, current draw mode.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    execute: () => {
      const e = store.getState().editor;
      return { ok: true, summary: `View ${e.view}, camera ${e.camera}, selected wall: ${e.selectedWallId ?? "none"}.`, editor: e };
    },
  },
  {
    name: "measure",
    title: "Measure a distance",
    description:
      "Measure a distance: between two points (x1,y1)-(x2,y2), or the length of a wall by id. Returns meters.",
    inputSchema: obj(
      { x1: num, y1: num, x2: num, y2: num, wallId: str },
      [],
    ),
    annotations: { readOnlyHint: true },
    execute: (i) => {
      if (i.wallId) {
        const hit = lookupWall(i.wallId as string, true);
        if (!hit.ok) return { ok: false, summary: hit.summary };
        const w = hit.entity;
        const len = segLen(w.ax, w.ay, w.bx, w.by);
        return { ok: true, summary: `Wall ${w.id} is ${formatMm(len)} mm long.`, meters: len };
      }
      const d = dist({ x: i.x1 as number, y: i.y1 as number }, { x: i.x2 as number, y: i.y2 as number });
      return { ok: true, summary: `Distance: ${formatMm(d)} mm.`, meters: d };
    },
  },
  {
    name: "get_underlay",
    title: "Blueprint underlay + tracing protocol",
    description:
      "Read the blueprint underlay: whether a reference plan image is loaded, the world rectangle it covers (metres), the mapping from image fractions to world coordinates — and the PROTOCOL for tracing it. Call this FIRST whenever the human gives you a plan to reproduce. Tracing needs the drawing in two places and this tool tells you which are missing: uploaded on the page (carries the scale) and pasted into your conversation (the only way you can see it). This tool never returns the pixels — it returns where the drawing sits in world metres so you can convert what you measure on your own copy. Measure in fractions of the image, not pixels: the page holds a resized copy.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    execute: () => {
      const u = store.getState().model.underlay;
      if (!u)
        return {
          ok: true,
          summary:
            'No underlay loaded. Tracing needs the drawing in TWO places, and neither replaces the other: ' +
            '(1) ask the human to upload it on the page via sidebar → "Blueprint underlay" — that is what sets the scale ' +
            'and lets them watch your walls land on it; and (2) ask them to paste the SAME image into this conversation, ' +
            'because this tool returns the scale and the mapping, never the pixels — you cannot see the drawing otherwise.',
          loaded: false,
          needs: [
            'human uploads the image on the page (sidebar → "Blueprint underlay") — sets the scale',
            'human pastes the same image into this conversation — so you can read it',
            'human gives you ONE real dimension on the drawing — so calibrate_underlay can be true',
          ],
          protocol: TRACING_PROTOCOL,
        };
      return {
        ok: true,
        summary: `Underlay covers x ${u.x.toFixed(2)}..${(u.x + u.w).toFixed(2)}, y ${u.y.toFixed(2)}..${(u.y + u.h).toFixed(2)} (${u.w.toFixed(2)} × ${u.h.toFixed(2)} m), opacity ${u.opacity}. Read the drawing from the copy in your conversation, measure in FRACTIONS of it, and convert with "mapping". Follow the "protocol" field to reproduce it faithfully.`,
        loaded: true,
        rect: { x: u.x, y: u.y, w: u.w, h: u.h },
        opacity: u.opacity,
        // The page re-encodes uploads to <=1600 px, so its copy is usually a different
        // pixel size from the file the human pasted into the conversation. Fractions are
        // identical in both, which is why the mapping is expressed in fractions.
        pageImagePixels: u.pw && u.ph ? { w: u.pw, h: u.ph } : null,
        mapping: {
          howToMeasure:
            'Measure on YOUR copy of the image as fractions of its width and height: u = x_px / image_width, v = y_px / image_height, both 0..1 from the top-left corner.',
          toWorld: 'world_x = rect.x + u * rect.w ; world_y = rect.y + v * rect.h',
          metresPerFullWidth: u.w,
          metresPerFullHeight: u.h,
          warning:
            'Do not reuse pixel numbers across the two copies: the page holds a resized one. Fractions are safe, pixels are not.',
        },
        protocol: TRACING_PROTOCOL,
      };
    },
  },
  {
    name: "calibrate_underlay",
    title: "Set the drawing's true scale",
    description:
      "Scale the loaded blueprint image to real-world meters. Give two points on the image as fractions (u, v in 0..1; u = right, v = down) and the REAL distance between them in meters (e.g. a dimension printed on the plan). The underlay is resized preserving aspect, keeping the first point fixed. Call after the human uploads the plan, before tracing walls over it.",
    inputSchema: obj({ u1: num, v1: num, u2: num, v2: num, meters: num, opacity: num }, ["u1", "v1", "u2", "v2", "meters"]),
    execute: (i) =>
      actions.calibrateUnderlay(i.u1 as number, i.v1 as number, i.u2 as number, i.v2 as number, i.meters as number, i.opacity as number | undefined),
  },

  // ------------------------------------------------------------------ walls
  {
    name: "add_wall",
    title: "Add a wall",
    description:
      "Add a wall segment in meters. Omitted thickness (0.15 m) and height (2.7 m) are marked as unmeasured defaults and reported by get_issues. Supply known values explicitly; explicit entry does not mean site-confirmed.",
    inputSchema: obj(
      { ax: num, ay: num, bx: num, by: num, thickness: num, height: num },
      ["ax", "ay", "bx", "by"],
    ),
    execute: (i) =>
      actions.addWall(i.ax as number, i.ay as number, i.bx as number, i.by as number, i.thickness as number | undefined, i.height as number | undefined),
  },
  {
    name: "edit_wall",
    title: "Edit a wall",
    description: "Move endpoints or enter thickness/height of an existing wall (by id). Entering either dimension clears only that field's default warning; entry does not mean site-confirmed.",
    inputSchema: obj(
      { id: str, ax: num, ay: num, bx: num, by: num, thickness: num, height: num },
      ["id"],
    ),
    execute: (i) => actions.editWall(i.id as string, i as never),
  },
  {
    name: "remove_wall",
    title: "Remove a wall",
    description: "Remove a wall by id. Its doors and windows are removed too.",
    inputSchema: obj({ id: str }, ["id"]),
    annotations: { destructiveHint: true },
    confirm: (i) => `delete wall ${i.id} (and every door and window on it)`,
    execute: (i) => actions.removeWall(i.id as string),
  },

  // ------------------------------------------------------------------ floor assembly
  {
    name: "set_room_floor",
    title: "Record a room's floor assembly and level datum",
    description:
      "Record a room's proposed floor build-up: the datum, the top of the stripped substrate, and the layers above it from the substrate upward (waterproofing and screed in either order, then adhesive, then tile). Levels are metres, up positive, from the datum (default \"existing floor surface\" = 0); substrateTop is an offset from it and may be negative. Every value needs a status (site-confirmed, measured, published, proposed, estimated). Unknown values stay unknown: omit value, and levels above are reported unresolved rather than filled with a default or zero. Never assume the substrate type: pass it as free text only when known. Fields sent replace what is stored; layers replaces the whole list (send a layer's id to keep it). Out-of-order layers or negative thicknesses are rejected and nothing changes.",
    inputSchema: obj(
      {
        room: str,
        datum: str,
        substrate: str,
        substrateTop: quantitySchema,
        layers: {
          type: "array",
          items: obj({ id: str, kind: { type: "string", enum: FLOOR_LAYER_KINDS }, name: str, thickness: quantitySchema }, ["kind"]),
        },
      },
      ["room"],
    ),
    execute: (i) => actions.setRoomFloor(i.room as string, i as FloorPatch),
  },
  {
    name: "get_floor_levels",
    title: "Read a room's floor levels",
    description:
      "Read a room's floor assembly: the datum, the substrate top and the top of each layer (screed, tile, ...) as metres above the datum. Each level states whether it is resolved, its basis (the weakest status of its inputs), every input with its status, and what is missing. An unresolved level has no number: do not report one.",
    inputSchema: obj({ room: str }, ["room"]),
    annotations: { readOnlyHint: true },
    execute: (i) => {
      const ref = String(i.room).toLowerCase();
      const rooms = store.getState().model.rooms;
      const hits = rooms.filter((r) => r.id === i.room || r.label.toLowerCase() === ref);
      if (hits.length !== 1) return { ok: false, summary: hits.length ? `Room "${i.room}" is ambiguous; use its id.` : `No room "${i.room}". Rooms: ${rooms.map((r) => `${r.id} (${r.label})`).join(", ") || "none"}.` };
      const room = hits[0];
      const spec = room.floorBuildUp;
      const levels = floorLevels(spec);
      const summary = `Room "${room.label}" floor, datum ${spec?.datum ?? DEFAULT_DATUM}: ${spec ? `${levels.filter((l) => l.resolved).length}/${levels.length} levels resolved` : "nothing recorded"}.`;
      return { ok: true, summary, roomId: room.id, datum: spec?.datum ?? DEFAULT_DATUM, substrate: spec?.substrate, recorded: !!spec, layers: spec?.layers ?? [], levels, problems: spec ? floorProblems(spec) : [] };
    },
  },

  // ------------------------------------------------------------------ proposed heating
  {
    name: "set_room_heating",
    title: "Record proposed in-screed cable and entered product information",
    description: "Edit one canonical room heating record. Fields present replace, null clears to unknown; clear:true removes it. Geometry is metres, ratedOutput watts; each numeric constraint needs value/status/source. Manufacturer, model, productSource and requirements are user-entered text: never synthesize product specifications. zoneIds selects the room id for its entire footprint or this room's drainage plane ids. Select screedLayerId when multiple screeds exist. depthFromBottom is cable CENTRE height above screed bottom, not finished floor or cover. Path is an open polyline of straight segments, without an assumed cold tail; keepouts are entered exclusion rectangles, never auto-created from assumed requirements. Geometry conflicts are stored for review. This is planning only; manufacturer/electrician approval remains pending.",
    inputSchema: obj({ room: str, clear: { type: "boolean" },
      manufacturer: { type: ["string", "null"] }, model: { type: ["string", "null"] }, productSource: { type: ["string", "null"] }, requirements: { type: ["string", "null"] }, screedLayerId: { type: ["string", "null"] },
      length: quantitySchema, ratedOutput: { ...quantitySchema, description: "rated total watts, not metres" }, minSpacing: quantitySchema, edgeClearance: quantitySchema, depthFromBottom: quantitySchema,
      zoneIds: { type: ["array", "null"], items: str }, path: { type: ["array", "null"], maxItems: 1000, items: obj({ x: num, y: num }, ["x", "y"]) },
      keepouts: { type: ["array", "null"], maxItems: 100, items: obj({ id: str, label: str, x: num, y: num, w: num, h: num, source: str }, ["id", "label", "x", "y", "w", "h"]) },
    }, ["room"]),
    execute: (i) => actions.setRoomHeating(i.room as string, i as HeatingPatch),
  },
  {
    name: "get_room_heating",
    title: "Read cable route, length, clearances and screed section",
    description: "Read user-entered cable metadata and proposed route. planRouteLength is the XY projection; routeLength is spatial length along the sampled cable profile and is absent if any interval has unresolved screed levels or cable height. remainingProductLength compares confirmed product length with that spatial length and is also absent while the profile is unresolved. Derives exact zone union area excluding entered keep-outs (not verified heating coverage), minimum spacing between non-adjacent straight segments, zone/keep-out clearance and warnings. section follows vertices, floor-plane boundaries and interval midpoints; s is cumulative plan-projection distance. Levels above the named floor datum stay absent if inputs are unknown. Cable centre is measured above screed bottom; local sloped screed derives from the entered finished surface and layers above it. includeHtml returns a printable review with metadata provenance, exact coordinates, section and all warnings. Manufacturer/electrician sign-off is always pending.",
    inputSchema: obj({ room: str, includeHtml: { type: "boolean" } }, ["room"]),
    annotations: { readOnlyHint: true },
    execute: (i) => {
      const ref = String(i.room).toLowerCase();
      const hits = store.getState().model.rooms.filter((r) => r.id === i.room || r.label.toLowerCase() === ref);
      if (hits.length !== 1) return { ok: false, summary: hits.length ? "Ambiguous room; use its id." : "Room not found." };
      const room = hits[0];
      return { ok: true, summary: `Room "${room.label}" heating ${room.heating ? "proposed; manufacturer/electrician review pending" : "not recorded"}.`, roomId: room.id, recorded: !!room.heating, heating: room.heating ?? null, ...heatingEvidence(room), ...(i.includeHtml ? { html: renderHeatingReview(room) } : {}) };
    },
  },

  // ------------------------------------------------------------------ drainage
  {
    name: "set_room_drainage",
    title: "Record proposed wastes and sloped floor planes",
    description:
      "Record a room's proposed drainage: wastes (a point or a linear waste, in plan metres, with the finished floor level at the waste above the room's floor datum) and rectangular floor planes that fall toward a waste. A plane's heights derive from its waste level plus EITHER a fall (rise per metre run away from the waste: 0.0125 = 12.5 mm per m) OR one control level at a plan point (the fall is worked out), or from three control levels when it has no waste. Every level and fall needs a status (site-confirmed, measured, published, proposed, estimated); leave unknown ones out and the plane stays unresolved rather than getting a default slope. Drain positions and falls are usually unconfirmed: record them as proposed. Lists replace what is stored (send an id to keep an entry). Contradictions, gaps and overlaps are not rejected; read them with get_floor_heights or get_issues. This is a planning aid, not a drainage design or code-compliance verdict.",
    inputSchema: obj({
      room: str,
      wastes: { type: "array", items: obj({ id: str, label: str, kind: { type: "string", enum: ["point", "linear"] }, x: num, y: num, x2: { type: "number", description: "linear only: second end x" }, y2: { type: "number", description: "linear only: second end y" }, level: quantitySchema }, ["kind", "x", "y"]) },
      planes: { type: "array", items: obj({
        id: str, label: str, x: num, y: num, w: num, h: num,
        waste: { type: ["string", "null"], description: "id or label of a waste in this room" },
        fall: quantitySchema,
        controls: { type: "array", items: obj({ id: str, label: str, x: num, y: num, level: quantitySchema }, ["x", "y", "level"]) },
      }, ["x", "y", "w", "h"]) },
    }, ["room"]),
    execute: (i) => actions.setRoomDrainage(i.room as string, i as DrainagePatch),
  },
  {
    name: "get_floor_heights",
    title: "Read derived floor heights, falls and drainage checks",
    description:
      "Read a room's drainage: wastes, each plane's derived surface (method, fall, resolved or what is missing), the checks (contradictory levels, overlaps, gaps, falls away from the waste, unresolved planes), the floor build-up reference (finished level) and the door thresholds with their step to it. Optionally pass `points` [{x,y}] for the level at each plan point, and/or `section` {from:{x,y}, to:{x,y}, samples} for a profile along a line. Levels are metres above the room's floor datum; a point with no level says why. Do not report a number for an unresolved level.",
    inputSchema: obj({
      room: str,
      points: { type: "array", items: obj({ x: num, y: num }, ["x", "y"]) },
      section: obj({ from: obj({ x: num, y: num }, ["x", "y"]), to: obj({ x: num, y: num }, ["x", "y"]), samples: num }, ["from", "to"]),
    }, ["room"]),
    annotations: { readOnlyHint: true },
    execute: (i) => {
      const model = store.getState().model;
      const ref = String(i.room).toLowerCase();
      const hits = model.rooms.filter((r) => r.id === i.room || r.label.toLowerCase() === ref);
      if (hits.length !== 1) return { ok: false, summary: hits.length ? `Room "${i.room}" is ambiguous; use its id.` : `No room "${i.room}". Rooms: ${model.rooms.map((r) => `${r.id} (${r.label})`).join(", ") || "none"}.` };
      const room = hits[0];
      const d = room.drainage;
      const map = surfaces(d);
      const planes = (d?.planes ?? []).map((p) => {
        const { level: _level, ...s } = planeSurface(d!, p);
        return { id: p.id, label: p.label, rect: { x: p.x, y: p.y, w: p.w, h: p.h }, ...s };
      });
      const problems = drainageProblems(room);
      const pts = (i.points as { x: number; y: number }[] | undefined)?.map((p) => heightAt(d, p.x, p.y, map));
      const sec = i.section as { from: { x: number; y: number }; to: { x: number; y: number }; samples?: number } | undefined;
      const section = sec ? sectionAlong(d, sec.from, sec.to, sec.samples) : undefined;
      const finished = finishedLevel(room.floorBuildUp);
      const resolved = planes.filter((p) => p.resolved).length;
      return {
        ok: true,
        summary: d ? `Room "${room.label}" drainage: ${d.wastes.length} wastes, ${planes.length} planes (${resolved} resolved), ${problems.filter((p) => p.severity === "error").length} errors, ${problems.filter((p) => p.severity === "warning").length} warnings.` : `Room "${room.label}" has no drainage recorded.`,
        roomId: room.id, recorded: !!d, datum: room.floorBuildUp?.datum ?? DEFAULT_DATUM, wastes: d?.wastes ?? [], planes, problems,
        buildUp: { finishedLevel: finished.resolved ? finished.top : null, resolved: finished.resolved, missing: finished.missing },
        thresholds: thresholds(model, room),
        ...(pts ? { points: pts } : {}), ...(section ? { section } : {}),
      };
    },
  },

  // ------------------------------------------------------------------ wall faces
  {
    name: "set_wall_side",
    title: "Record a wall side's faces and build-up",
    description:
      "Record one side of a wall: the existing surveyed surface, the frame face, and the proposed build-up from the frame outward (board, waterproofing, adhesive, tile). Positions are metres from the wall's drawn line toward that side (negative = behind the line). Side: walking from end A to end B, \"left\" or \"right\"; get_wall_faces says which room each side faces. Every value needs a status (site-confirmed, measured, proposed, estimated). Unknown values stay unknown: omit value, and faces beyond it are reported unresolved rather than filled with a default. Never derive a frame position from the existing surface; enter it only when it has been measured or confirmed. Fields sent replace what is stored; layers replaces the whole list (send a layer's id to keep it). Out-of-order layers or negative thicknesses are rejected and nothing changes.",
    inputSchema: obj(
      {
        wallId: str,
        side: sideSchema,
        existing: quantitySchema,
        frame: quantitySchema,
        layers: {
          type: "array",
          items: obj({ id: str, kind: { type: "string", enum: LAYER_KINDS }, name: str, thickness: quantitySchema }, ["kind"]),
        },
      },
      ["wallId", "side"],
    ),
    execute: (i) => actions.setWallSide(i.wallId as string, i.side as WallSideName, i as WallSidePatch),
  },
  {
    name: "get_wall_faces",
    title: "Read a wall's reference faces",
    description:
      "Read the reference faces of a wall side: existing surface, frame, and each build-up layer's outer face, as offsets (metres) from the drawn line toward that side. Each face states whether it is resolved, its basis (the weakest status of its inputs), every input with its status, and what is missing. Also names the room each side faces.",
    inputSchema: obj({ wallId: str, side: sideSchema }, ["wallId"]),
    annotations: { readOnlyHint: true },
    execute: (i) => {
      const hit = lookupWall(i.wallId as string);
      if (!hit.ok) return { ok: false, summary: hit.summary };
      const w = hit.entity;
      const sides = (i.side ? [i.side as WallSideName] : (["left", "right"] as const)).map((side) => {
        const spec = w.sides?.[side];
        return { side, room: roomOnSide(w, side, store.getState().model.rooms), recorded: !!spec, layers: spec?.layers ?? [], faces: sideFaces(spec), problems: spec ? sideProblems(spec) : [] };
      });
      const summary = sides.map((s) => `${s.side}${s.room ? ` (${s.room})` : ""}: ${s.recorded ? `${s.faces.filter((f) => f.resolved).length}/${s.faces.length} faces resolved` : "nothing recorded"}`).join("; ");
      return { ok: true, summary: `Wall ${w.id} — ${summary}.`, wallId: w.id, sides };
    },
  },
  // ------------------------------------------------------------------ floor tiling (#10)
  {
    name: "set_floor_tiling",
    title: "Propose a floor tile set-out",
    description:
      "Record a proposed floor pattern for one rectangular room or explicit drainage plane. Units metres with {value,status,source?}. tileLength/Width are long/short edges; axis x or y aligns the long edge in plan. zone is room or a drainage plane id. originX/Y locate a tile's upper-left edge from finished west/north faces. Nothing defaults: missing wall face build-ups, tile inputs and drain cuts stay unresolved. null clears a field; clear removes the proposal. Never an ordering quantity or trade approval.",
    inputSchema: obj(
      {
        room: str,
        tileLength: quantitySchema,
        tileWidth: quantitySchema,
        joint: quantitySchema,
        originX: quantitySchema,
        originY: quantitySchema,
        axis: { type: ["string", "null"], enum: ["x", "y", null] },
        zone: { type: ["string", "null"] },
        note: { type: ["string", "null"] },
        clear: { type: "boolean" },
      },
      ["room"],
    ),
    execute: (i) =>
      actions.setFloorTiling(i.room as string, i as FloorTilingPatch),
  },
  {
    name: "get_floor_tiling",
    title: "Read floor tile cuts and unresolved fields",
    description:
      "Derive the proposed plan at finished wall faces. Returns perimeter cuts, tile pieces, door transitions, waste centre lines and fall-plane boundaries with unresolved fields. Waste aperture dimensions are not recorded, so centre-line relationships never certify cut shapes. includeSvg adds the printable diagram. Always report proposal and unresolved status.",
    inputSchema: obj({ room: str, includeSvg: { type: "boolean" } }, ["room"]),
    annotations: { readOnlyHint: true },
    execute: (i) => {
      const hit = lookupRoom(i.room as string);
      if (!hit.ok) return { ok: false, summary: hit.summary };
      const model = store.getState().model,
        room = hit.entity,
        l = floorTileLayout(model, room);
      return {
        ok: true,
        summary: `${room.label}: proposed floor tile set-out.`,
        tiling: room.floorTiling ?? null,
        ...l,
        cutTable: floorCutRows(l),
        ...(i.includeSvg ? { svg: renderFloorTilingSheet(model, room) } : {}),
      };
    },
  },
  {
    name: "export_floor_tiling",
    title: "Export the printable proposed floor tile plan",
    description:
      "Return a printable SVG floor tile proposal derived from the canonical room: perimeter cuts, finished face references, dimensions, provenance legend, doorway transition, wastes, floor-plane boundaries, notes and unresolved fields. Print from the Inspector to PDF. Does not approve installation or calculate purchase quantities.",
    inputSchema: obj({ room: str }, ["room"]),
    annotations: { readOnlyHint: true },
    execute: (i) => {
      const hit = lookupRoom(i.room as string);
      if (!hit.ok) return { ok: false, summary: hit.summary };
      const model = store.getState().model,
        room = hit.entity,
        l = floorTileLayout(model, room);
      return {
        ok: true,
        summary: `Exported ${room.label} proposed floor tile set-out.`,
        fileName: `${model.name.replace(/[^\w-]+/g, "-")}-${room.id}-floor-tiling.svg`,
        resolved: l.resolved,
        missing: l.missing,
        svg: renderFloorTilingSheet(model, room),
      };
    },
  },

  // ------------------------------------------------------------------ wall tiling (#9)
  {
    name: "set_wall_tiling",
    title: "Propose a wall tile set-out",
    description:
      "Record a PROPOSED tile set-out on one side of one wall, for review with a tiler. Lengths are metres, each { value, status }; tile sizes, joint, origin and tiled height are the user's choices, so record them as proposed (or published for a manufacturer's nominal size) and never invent them: leave out what the user has not given and the set-out reports it as unresolved. tileLength is the long edge, tileWidth the short edge; orientation landscape lays the long edge along the wall, portrait up it. reference: the face of each return wall the run is cut to, board (the fixed board face, e.g. Villaboard) or finished (tile face); it comes from set_wall_side build-ups, so record those first. floor: the level the courses are measured from, finished (top of the room's floor build-up), screed, substrate, or datum (0). Origin: one full tile sits originAlong from originFrom: a, its A-side edge from end A's reference face; b, its B-side edge from end B's reference face (both positive into the run); centre, its A-side edge from the run's centre (negative toward A), and the bottom of one full course is originUp above the floor reference. tiledHeight: top of tiling above the floor reference. Fields sent replace what is stored; null clears one; clear: true removes the side's set-out. Read the cuts with get_wall_tiling. This is not as-built, not a procurement list and not a waterproofing compliance statement.",
    inputSchema: obj({
      wallId: str, side: sideSchema,
      tileLength: quantitySchema, tileWidth: quantitySchema,
      orientation: { type: ["string", "null"], enum: [...TILE_ORIENTATIONS, null] },
      joint: quantitySchema,
      reference: { type: ["string", "null"], enum: [...TILE_REFERENCES, null] },
      floor: { type: ["string", "null"], enum: [...TILE_FLOOR_REFERENCES, null] },
      originFrom: { type: ["string", "null"], enum: [...TILE_ORIGIN_FROM, null] },
      originAlong: quantitySchema, originUp: quantitySchema, tiledHeight: quantitySchema,
      note: { type: ["string", "null"] }, clear: { type: "boolean" },
    }, ["wallId", "side"]),
    execute: (i) => actions.setWallTiling(i.wallId as string, i.side as WallSideName, i as TilingPatch),
  },
  {
    name: "get_wall_tiling",
    title: "Read a wall's proposed tile set-out and cuts",
    description:
      "Read the derived set-out of one wall side: every input with its status, the run limits (which return wall face each end is cut to, as metres along from end A), the floor reference level (metres above the room's floor datum), the origin, the tile size on the wall after orientation, the edge cuts at end A, end B, the bottom course and the top course, the cuts beside, under and over each opening, and the tile pieces (s along from A, z up from the datum). A cut is { size, of, full, gap? } in metres: size is the piece kept; full with a gap means the edge falls in or near a joint. Everything unknown is listed under missing and no cut is given for it. Always label the result as a proposed set-out, never as built. Pass includeSvg for the printable A3 elevation.",
    inputSchema: obj({ wallId: str, side: sideSchema, includeSvg: { type: "boolean" }, includePieces: { type: "boolean" } }, ["wallId", "side"]),
    annotations: { readOnlyHint: true },
    execute: (i) => {
      const hit = lookupWall(i.wallId as string);
      if (!hit.ok) return { ok: false, summary: hit.summary };
      const w = hit.entity;
      const side = i.side as WallSideName;
      if (side !== "left" && side !== "right") return { ok: false, summary: `Side must be "left" or "right", not "${String(i.side)}".` };
      const model = store.getState().model;
      const l = tilingLayout(model, w, side);
      const { pieces, ...rest } = l;
      const rows = cutRows(l);
      return {
        ok: true,
        summary: `Wall ${w.id} ${side} side tiling (proposed${w.tiling?.[side] ? "" : ", nothing recorded"}): ${rows.map((r) => `${r.label} ${r.value}`).join("; ")}.${l.missing.length ? ` Unknown: ${l.missing.join("; ")}.` : ""}`,
        recorded: !!w.tiling?.[side], tiling: w.tiling?.[side] ?? null, ...rest, cutTable: rows,
        pieceCount: pieces.length, cutPieceCount: pieces.filter((p) => p.cut).length,
        ...(i.includePieces ? { pieces } : {}),
        ...(i.includeSvg ? { svg: renderTilingSheet(model, w.id, side) } : {}),
      };
    },
  },
  {
    name: "export_wall_tiling",
    title: "Export the printable wall tile set-out",
    description:
      "Generate the printable A3 SVG elevation of one wall side's proposed tile set-out: tile size, joint, origin, the reference face each end is cut to, the floor reference, every cut, opening cuts, the status of each input and every unresolved input (printed as \"?\"). It is stamped PROPOSED SET-OUT, NOT AS-BUILT. The person can also print it to PDF from the wall's Inspector. Does not change the model.",
    inputSchema: obj({ wallId: str, side: sideSchema, title: str }, ["wallId", "side"]),
    annotations: { readOnlyHint: true },
    execute: (i) => {
      const hit = lookupWall(i.wallId as string);
      if (!hit.ok) return { ok: false, summary: hit.summary };
      const w = hit.entity;
      const side = i.side as WallSideName;
      if (side !== "left" && side !== "right") return { ok: false, summary: `Side must be "left" or "right", not "${String(i.side)}".` };
      const model = store.getState().model;
      const l = tilingLayout(model, w, side);
      const svg = renderTilingSheet(model, w.id, side, { title: i.title as string | undefined });
      return {
        ok: true,
        summary: `Exported the proposed tile set-out for wall ${w.id} ${side} side (${l.resolved ? "all inputs known" : `${l.missing.length} unresolved input(s) printed as ?`}).`,
        fileName: `${model.name.replace(/[^\w-]+/g, "-")}-${w.id}-${side}-tiling.svg`, resolved: l.resolved, missing: l.missing, svg,
      };
    },
  },
  {
    name: "measure_to_face",
    title: "Measure from a wall face",
    description:
      `Perpendicular distance from a named face of a wall side to a point (x, y) or to an item's footprint (itemId: its nearest edge). face is one of ${FACE_NAMES.join(", ")} or a layer id: existing = surveyed surface, frame = frame face, board = fixed board face (e.g. Villaboard), finished = outermost layer face. Positive means in front of the face, toward that side. The result names the face and the status of every input; if any input is unknown the distance is unresolved and the missing inputs are listed. Never report an unresolved distance as a number.`,
    inputSchema: obj(
      { wallId: str, side: sideSchema, face: str, x: num, y: num, itemId: str },
      ["wallId", "side", "face"],
    ),
    annotations: { readOnlyHint: true },
    execute: (i) => {
      const hit = lookupWall(i.wallId as string);
      if (!hit.ok) return { ok: false, summary: hit.summary };
      const w = hit.entity;
      const side = i.side as WallSideName;
      if (side !== "left" && side !== "right") return { ok: false, summary: `side must be "left" or "right".` };
      let p: { x: number; y: number } | null = null;
      let target = "";
      if (i.itemId) {
        const item = store.getState().model.items.find((it) => it.id === i.itemId);
        if (!item) return { ok: false, summary: `No item with id "${i.itemId}".` };
        p = nearestFootprintPoint(w, side, item);
        if (!p) return { ok: false, summary: `Item ${item.id} has an unknown kind, so its footprint is unknown.` };
        target = `item ${item.id} (nearest edge)`;
      } else if (typeof i.x === "number" && typeof i.y === "number") {
        p = { x: i.x, y: i.y };
        target = `point (${formatMm(i.x)}, ${formatMm(i.y)}) mm`;
      } else {
        return { ok: false, summary: "Give a point (x, y) or an itemId." };
      }
      const d = distanceToFace(w, side, i.face as string, p);
      if (!d.resolved) {
        return { ok: true, resolved: false, summary: `Unresolved: ${d.face.label} of wall ${w.id} ${side} side is unknown. Missing: ${d.face.missing.join(", ")}.`, face: d.face };
      }
      return {
        ok: true,
        resolved: true,
        summary: `${target} is ${formatMm(d.distance!)} mm from the ${d.face.label.toLowerCase()} of wall ${w.id} ${side} side (basis: ${d.face.basis}).`,
        meters: d.distance,
        face: d.face,
      };
    },
  },

  // ------------------------------------------------------------------ trade sheets (#29)
  {
    name: "set_sheet_info",
    title: "Fill in the sheet title block",
    description: "Set the title block printed on every trade sheet: project name, site or room, and who prepared it. Ask the human for these; do not invent them.",
    inputSchema: obj({ project: str, site: str, preparedBy: str }),
    execute: (i) => actions.setSheetInfo(i as { project?: string; site?: string; preparedBy?: string }),
  },
  {
    name: "list_sheets",
    title: "List the trade sheets",
    description: "List the trade sheets this plan can issue, with their number, title and revisions issued so far.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    execute: () => {
      const revisions = store.getState().model.sheetSet?.revisions ?? [];
      return {
        ok: true,
        summary: SHEETS.map((s) => `${s.number} ${s.title} (${revisions.filter((r) => r.sheet === s.id).length} revision(s))`).join("; "),
        sheets: SHEETS.map((s) => ({ ...s, revisions: revisions.filter((r) => r.sheet === s.id) })),
      };
    },
  },
  {
    name: "check_sheets",
    title: "Preflight a trade sheet",
    description:
      "Check a sheet before issuing it (sheet: floor-plan). Returns findings, each with a code, ref (the entity), severity and usually a fix (a tool and arguments to fill in). blocking findings stop export_sheet: fix them and check again. If you are confident a blocking rule is wrong for this plan, export_sheet can acknowledge it with a reason, which is printed on the sheet for the trade to see. advisory findings never block; they are what the sheet will list as unresolved. Work the list down; do not acknowledge to save effort.",
    inputSchema: obj({ sheet: { type: "string", enum: SHEETS.map((s) => s.id) } }),
    annotations: { readOnlyHint: true },
    execute: (i) => {
      const sheet = (i.sheet as string) ?? "floor-plan";
      const findings = checkSheet(store.getState().model, sheet);
      const blocking = findings.filter((f) => f.severity === "blocking");
      return {
        ok: true,
        summary: blocking.length
          ? `${blocking.length} blocking, ${findings.length - blocking.length} advisory. Not issuable yet.`
          : `Issuable. ${findings.length} advisory item(s) will be listed as unresolved on the sheet.`,
        sheet,
        issuable: blocking.length === 0,
        findings,
      };
    },
  },
  {
    name: "export_sheet",
    title: "Issue a trade sheet",
    description:
      "Issue a sheet (sheet: floor-plan) as an A3 SVG and record a new revision. Refused while blocking findings are open; the refusal lists each one with its fix. To issue past a blocking finding you believe is wrong, pass acknowledge: [{ code, ref, reason }] matching it exactly; the reason (10+ characters) is printed on the sheet. note is printed in the title block. The person can download the issued sheet from the Sheets tab; pass includeSvg: true to get the SVG text back.",
    inputSchema: obj(
      {
        sheet: { type: "string", enum: SHEETS.map((s) => s.id) },
        acknowledge: { type: "array", items: obj({ code: str, ref: str, reason: str }, ["code", "ref", "reason"]) },
        note: str,
        includeSvg: { type: "boolean" },
      },
      ["sheet"],
    ),
    execute: (i) => {
      const r = actions.exportSheet(i.sheet as string, { acknowledge: i.acknowledge as AckInput[] | undefined, note: i.note as string | undefined, by: "agent" });
      if (!r.ok) return r;
      recordIssued(store.getState().activeProjectId, i.sheet as string, r.rev as string, r.svg as string);
      const { svg, ...rest } = r;
      return i.includeSvg ? r : { ...rest, svgBytes: (svg as string).length };
    },
  },

  // ------------------------------------------------------------------ stage diagram views (#41)
  {
    name: "list_diagram_content",
    title: "List layers and objects a stage diagram can show",
    description:
      "List every layer and object of the open project that a construction-stage diagram can show, with stable ids: layer ids (e.g. walls, wall-frame, wall-board, wall-waterproofing, windows, doors, floor-screed, drainage-wastes, fixtures, services-waste) and element ids under them (e.g. wall:<wallId>, wall:<wallId>:<side>:<layerId>, opening:<id>, room:<id>:floor:<layerId>, item:<id>, item:<id>:sp:<pointId>). Only what the model really records is listed: emptyLayers are kinds with nothing recorded yet, and notModelled names absent heating records and construction content the model cannot represent (pipe and cable runs). Never claim a diagram shows those. Read-only; also returns the current view.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    execute: () => {
      const s = store.getState();
      const cat = catalogue(s.model);
      const view = currentView(s.activeProjectId);
      return {
        ok: true,
        summary: `${cat.layers.length} layer(s) with ${cat.elements.length} element(s); ${cat.emptyLayers.length} known layer kind(s) empty; not modelled: ${cat.notModelled.length}.`,
        layers: cat.layers.map((l) => ({ ...l, elements: l.elements.map((id) => ({ id, label: cat.elements.find((e) => e.id === id)!.label })) })),
        emptyLayers: cat.emptyLayers,
        notModelled: cat.notModelled,
        currentView: view,
        composedThisSession: savedViews(s.activeProjectId).map((v) => v.label),
      };
    },
  },
  {
    name: "set_diagram_view",
    title: "Compose a construction-stage view",
    description:
      "Choose exactly what the stage diagram and specification sheet show: label names the stage (e.g. \"4. Waterproofing\"), visible is the explicit list of layer ids and/or element ids from list_diagram_content (a layer id includes all its elements). Everything not listed is hidden. Any unknown id rejects the whole call and the current view stays as it was. This changes only the view: the project's walls, fixtures, service points, measurements and their statuses are not edited, copied or versioned, and undo history is untouched. To return to an earlier stage, call it again with that stage's list. Then inspect with get_diagram_view and generate with export_diagram_view.",
    inputSchema: obj({ label: str, visible: { type: "array", items: str } }, ["label", "visible"]),
    execute: (i) => {
      const s = store.getState();
      const r = applyView(s.activeProjectId, s.model, i.label, i.visible);
      if (!r.ok) return { ok: false, summary: r.summary, unknown: r.unknown, suggestions: r.suggestions };
      const hidden = r.catalogue.elements.length - r.resolution.elements.length;
      return { ok: true, summary: `View "${r.view.label}": ${r.resolution.elements.length} element(s) visible, ${hidden} hidden. The model is unchanged.`, view: r.view, visibleElements: r.resolution.elements.map((e) => e.id) };
    },
  },
  {
    name: "get_diagram_view",
    title: "Inspect the current stage view",
    description:
      "Inspect the current stage view before exporting: its label, the ids as given, every visible element with its layer, the specification rows the sheet will print (value in mm, status, the face or datum it is measured from, source, and what is missing when unknown), and the preflight findings scoped to this view (blocking: title block, broken geometry or a default that would print as a dimension, on visible content; advisory: values printed as \"?\"). Optionally pass includeSvg to preview the diagram. Read-only.",
    inputSchema: obj({ includeSvg: { type: "boolean" } }),
    annotations: { readOnlyHint: true },
    execute: (i) => {
      const s = store.getState();
      const view = currentView(s.activeProjectId);
      if (!view) return { ok: false, summary: "No stage view is set. Call list_diagram_content, then set_diagram_view." };
      const products = productStore.getState().products;
      const c = composeView(s.model, view, products);
      const { rows } = renderStageSpec(s.model, c.resolution.elements, { label: view.label, findings: c.findings, products });
      const blocking = c.findings.filter((f) => f.severity === "blocking");
      return {
        ok: true,
        summary: `View "${view.label}": ${c.resolution.elements.length} element(s), ${rows.length} spec row(s), ${rows.filter((r) => r.value === "?").length} unknown. ${blocking.length ? `${blocking.length} blocking: not exportable yet.` : "Exportable."}`,
        view,
        exportable: blocking.length === 0,
        elements: c.resolution.elements,
        spec: rows,
        findings: c.findings,
        ...(c.resolution.unknown.length ? { staleIds: c.resolution.unknown } : {}),
        ...(i.includeSvg ? { svg: renderStageDiagram(s.model, c.resolution.elements, { label: view.label, findings: c.findings, products }) } : {}),
      };
    },
  },
  {
    name: "export_diagram_view",
    title: "Generate the stage diagram and specification sheet",
    description:
      "Generate, from the current stage view only, the dimensioned A3 diagram (SVG) and the matching specification sheet (HTML table). Both list the same visible elements; unknown values print as \"?\" with what is missing and are never shown as measurements, and every value keeps its status tag and datum. The A-01 sheet rules apply to the visible content: blocking findings refuse the export until fixed, or acknowledged with acknowledge: [{ code, ref, reason }] (10+ characters, printed on both outputs). This records no sheet revision and does not change the model. The person can download both from the Sheets tab; pass includeOutputs: true to get the text back.",
    inputSchema: obj({
      acknowledge: { type: "array", items: obj({ code: str, ref: str, reason: str }, ["code", "ref", "reason"]) },
      note: str,
      includeOutputs: { type: "boolean" },
    }),
    execute: (i) => {
      const s = store.getState();
      const view = currentView(s.activeProjectId);
      if (!view) return { ok: false, summary: "No stage view is set. Call set_diagram_view first." };
      const products = productStore.getState().products;
      const c = composeView(s.model, view, products);
      // a view naming ids the model no longer has, or showing nothing, is not a stage: no acknowledgement exports it
      if (c.resolution.unknown.length || !c.resolution.elements.length) {
        return { ok: false, summary: `Not exported. ${c.resolution.unknown.length ? `The view names id(s) the model no longer has: ${c.resolution.unknown.join(", ")}.` : "Nothing is visible in this view."} Compose it again with set_diagram_view using ids from list_diagram_content.`, staleIds: c.resolution.unknown };
      }
      const result = reconcile(c.findings, Array.isArray(i.acknowledge) ? (i.acknowledge as AckInput[]) : [], "agent");
      if (!result.ok) {
        return { ok: false, summary: `Not exported. ${result.open.length} blocking finding(s) open${result.problems.length ? `; ${result.problems.join(" ")}` : ""}. Fix each one (see fix) or acknowledge it with a reason that is printed on the outputs.`, open: result.open, problems: result.problems };
      }
      const rawNote = i.note as unknown;
      const note = typeof rawNote === "string" && rawNote.trim() ? rawNote.trim().slice(0, 160) : undefined;
      const opts = { label: view.label, findings: c.findings, acknowledged: result.acknowledged, date: new Date().toISOString().slice(0, 10), note, products };
      const svg = renderStageDiagram(s.model, c.resolution.elements, opts);
      const spec = renderStageSpec(s.model, c.resolution.elements, opts);
      recordExport({ projectId: s.activeProjectId, label: view.label, date: opts.date, svg, specHtml: spec.html, elements: c.resolution.elements.map((e) => e.id), at: Date.now() });
      const advisory = c.findings.filter((f) => f.severity === "advisory").length;
      return {
        ok: true,
        summary: `Exported "${view.label}": diagram and specification sheet, ${c.resolution.elements.length} element(s), ${spec.rows.length} row(s), ${advisory} unresolved item(s) listed${result.acknowledged.length ? `, past ${result.acknowledged.length} acknowledged finding(s)` : ""}.`,
        elements: c.resolution.elements.map((e) => e.id),
        acknowledged: result.acknowledged,
        ...(i.includeOutputs ? { svg, specHtml: spec.html } : { svgBytes: svg.length, specBytes: spec.html.length }),
      };
    },
  },

  // ------------------------------------------------------------------ fixtures (#5)
  {
    name: "anchor_fixture",
    title: "Set a fixture out from a wall face",
    description:
      "Set a placed fixture out from a wall face, so its position follows that face: its back sits `gap` metres (default 0) in front of `face` on the given side of the wall, facing into that side, with its centreline `distance` metres from wall end `from` (a default, or b). face: existing, frame, board, finished, or a layer id (get_wall_faces lists them). status says how the set-out is known (usually proposed). A fixture against the finished face moves when the build-up changes; one against the frame does not. If the face is unresolved the anchor is kept but the position stays unresolved and the result lists what is missing. Pass release: true to free the fixture again.",
    inputSchema: obj(
      { itemId: str, wallId: str, side: sideSchema, face: str, gap: num, from: { type: "string", enum: ["a", "b"] }, distance: num, status: { type: "string", enum: VALUE_STATUSES }, source: str, release: { type: "boolean" } },
      ["itemId"],
    ),
    execute: (i) => i.release ? actions.anchorFixture(i.itemId as string, null) : actions.anchorFixture(i.itemId as string, i as unknown as AnchorInput),
  },
  {
    name: "set_service_point",
    title: "Enter a fixture's service point",
    description:
      "Add or replace (by id) a waste, water or power point on a fixture. out: metres from `face` of the fixture's anchor wall side (give outMax too for a range, e.g. an S-trap set-out); across: metres from the fixture centreline, facing the fixture, left negative; up: metres above the finished floor. Omit a value you do not know: the point stays unresolved and says so. status is required (proposed for a planned position, measured or site-confirmed once checked).",
    inputSchema: obj(
      { itemId: str, id: str, label: str, service: { type: "string", enum: ["waste", "water", "power"] }, face: str, out: num, outMax: num, across: num, up: num, status: { type: "string", enum: VALUE_STATUSES }, source: str },
      ["itemId", "label", "service", "face", "status"],
    ),
    execute: (i) => actions.setServicePoint(i.itemId as string, i as unknown as ServicePointInput),
  },
  {
    name: "remove_service_point",
    title: "Remove a fixture's service point",
    description: "Remove one service point from a fixture by its id.",
    inputSchema: obj({ itemId: str, pointId: str }, ["itemId", "pointId"]),
    execute: (i) => actions.removeServicePoint(i.itemId as string, i.pointId as string),
  },
  {
    name: "place_product",
    title: "Place a library product against a wall face",
    description:
      "Place an accepted product from the product library (get_product_library) against a wall face, with the same anchor fields as anchor_fixture. Its published envelope becomes the fixture's footprint and its rough-in points are copied onto it as published service points, each still measured from its datum. A product with an unknown envelope is refused rather than given an invented size.",
    inputSchema: obj(
      { productId: str, wallId: str, side: sideSchema, face: str, gap: num, from: { type: "string", enum: ["a", "b"] }, distance: num, status: { type: "string", enum: VALUE_STATUSES }, source: str },
      ["productId", "wallId", "side", "face", "distance", "status"],
    ),
    execute: (i) => {
      const product = productStore.getState().products.find((p) => p.id === i.productId);
      if (!product) return { ok: false, summary: `No accepted product "${i.productId}" in the library.` };
      return actions.placeProduct(product, i as unknown as AnchorInput);
    },
  },
  {
    name: "get_rough_in",
    title: "Read the rough-in set-out",
    description:
      "The plumber's view of each fixture (or one, by itemId): where it is set out from, its clearances to the nearest wall surfaces, and every service point read as distances out from the existing surface, frame, board and finished face of its wall side, along from both wall ends, and up from the finished floor. Each distance names its face; anything that depends on an unknown value is unresolved and lists what is missing.",
    inputSchema: obj({ itemId: str }),
    annotations: { readOnlyHint: true },
    execute: (i) => {
      const model = store.getState().model;
      let items = model.items.filter((it) => it.anchor || it.servicePoints?.length);
      if (i.itemId) {
        const hit = lookupItem(i.itemId as string);
        if (!hit.ok) return { ok: false, summary: hit.summary, candidates: hit.candidates };
        items = [hit.entity];
      }
      const fixtures = items.map((it) => {
        const pose = anchorPose(model, it);
        const points = roughIn(model, it);
        return {
          id: it.id,
          label: catalogByKind(it.kind)?.label ?? it.kind,
          ...(it.productId ? { productId: it.productId } : {}),
          productIdentity: it.productIdentity ?? null,
          selectionStatus: it.selectionStatus ?? "unknown",
          anchor: it.anchor ?? null,
          position: pose.resolved ? { x: pose.x, y: pose.y, rotation: pose.rotation, alongFromA: pose.alongFromA, backOffset: pose.backOffset } : { unresolved: pose.missing },
          clearances: clearances(model, it),
          servicePoints: points,
        };
      });
      const open = fixtures.reduce((n, f) => n + f.servicePoints.filter((p) => !p.resolved).length, 0);
      return { ok: true, summary: `${fixtures.length} fixture(s); ${fixtures.reduce((n, f) => n + f.servicePoints.length, 0)} service point(s), ${open} unresolved.`, fixtures };
    },
  },

  {
    name: "set_fixture_selection",
    title: "Record a project fixture selection",
    description: "Record unknown, proposed, purchased or reused on one project fixture. Research acceptance never establishes purchasing status.",
    inputSchema: obj({ itemId: str, status: { type: "string", enum: SELECTION_STATUSES } }, ["itemId", "status"]),
    execute: i => actions.setFixtureSelection(i.itemId as string, i.status as SelectionStatus),
  },
  // ------------------------------------------------------------------ products (#30)
  {
    name: "request_product",
    title: "Open a product research request",
    description:
      `Open a request to research one product for the product library. category: ${PRODUCT_CATEGORIES.map((c) => `${c.id} (${c.label})`).join(", ")}. Give whatever identifies it: brand, model, reference (quote line or product code), link, notes. Then read its brief with get_product_brief.`,
    inputSchema: obj(
      { category: { type: "string", enum: PRODUCT_CATEGORIES.map((c) => c.id) }, brand: str, model: str, reference: str, link: str, notes: str, ...exactSchemas },
      ["category"],
    ),
    execute: (i) => products.request(i.category as string, i as Record<string, string>),
  },
  {
    name: "list_product_requests",
    title: "List product research requests",
    description: "List product research requests with their status (open = needs research, submitted = waiting for human review, accepted, withdrawn) and any feedback from the reviewer.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    execute: () => {
      const { requests } = productStore.getState();
      return {
        ok: true,
        summary: `${requests.length} request(s); ${requests.filter((r) => r.status === "open").length} open.`,
        requests: requests.map((r) => ({ id: r.id, category: r.category, known: r.known, status: r.status, ...(r.mode ? { mode: r.mode } : {}), ...(r.feedback ? { feedback: r.feedback } : {}), ...(r.attachments?.length ? { attachments: r.attachments.map((a) => ({ id: a.id, name: a.name, kind: a.kind })) } : {}) })),
      };
    },
  },
  {
    name: "get_product_brief",
    title: "Read a product research brief",
    description:
      "Read the brief for a product request: what the human knows, the protocol to follow, the service points (roughIn) the fields feed, and every field to find with its unit (lengths in metres), definition, reference datum, allowed options or range, and whether it is required. A field with `when` applies only when that other field has one of the listed values. Includes any previous submission and the reviewer's feedback. `attachments` are spec sheets the person attached: a PDF comes with its text page by page; cite it as source { url: \"attachment:<id>\", locator: \"p. <n>\" }. An image attachment has no text: ask the person to paste it into the conversation if you need it.",
    inputSchema: obj({ requestId: str }, ["requestId"]),
    annotations: { readOnlyHint: true },
    execute: (i) => {
      const req = productStore.getState().requests.find((r) => r.id === i.requestId);
      if (!req) return { ok: false, summary: `No product request "${i.requestId}".` };
      const cat = categoryById(req.category)!;
      const current = req.submission?.fields ?? req.measurementDraft ?? {};
      const fields = req.mode ? measurementFields(cat) : cat.fields;
      return {
        ok: true,
        summary: `${cat.label} brief for ${[req.known.brand, req.known.model].filter(Boolean).join(" ") || req.known.physicalItem?.label || req.known.reference || req.known.link}: ${cat.fields.length} fields, status ${req.status}.`,
        requestId: req.id,
        ...(req.mode ? { mode: req.mode, humanOnly: true, measurementDraft: req.measurementDraft } : {}),
        status: req.status,
        completeness: productReviewSummary(req),
        category: { id: cat.id, label: cat.label },
        ...(cat.placement ? { placement: cat.placement } : {}),
        known: req.known,
        protocol: req.mode ? ["This is a human measurement record. Read evidence and unknowns; only the person can record or submit measurements with the page controls. Do not submit as published research or infer values from photos."] : [...RESEARCH_PROTOCOL, "Record exact identity { code, finish, configuration, handedness }: each { state: known|unknown|not-applicable, value: exact text|null, sources: [{url, locator}], alternatives? }. Known and not-applicable require evidence. Components: { name, code: identity evidence, quantity: whole number|null, provision: included|separately-required|unresolved, sources } with componentsStatus documented|unknown|not-applicable. Never infer purchasing status or guess a variant."],
        identityFields: IDENTITY_FIELDS,
        references: REFERENCES,
        fields: fields.map((f) => ({ ...f, unit: f.type === "length" ? "metres" : f.type === "count" ? "count" : f.type, ...(f.when ? { appliesNow: applies(f, current) } : {}) })),
        roughIn: cat.roughIn,
        attachments: requestEvidenceAttachments(req).map((a) => ({
          id: a.id,
          cite: `attachment:${a.id}`,
          name: a.name,
          kind: a.kind,
          ...(a.kind === "pdf"
            ? { pageCount: a.pages?.length ?? 0, pages: a.pages ?? [], ...(a.pages?.some((p) => p.text.trim()) ? {} : { textNote: "No text layer on any page (a scan?). Nothing is OCR'd: ask the person to paste the figures, or find a published source." }) }
            : { textNote: "An image: no text is extracted. It is for the person's review; if you need what it shows, ask them to paste it into the conversation." }),
        })),
        submitShape: req.mode ? "Human measurement requests can only be edited and submitted in the Products page; submit_product_spec refuses this request." : "submit_product_spec { requestId, manufacturer, model, code?, identity?, componentsStatus?, components?, fields: { <key>: { value, status, sources: [{ url, locator }], reference?, note?, alternatives? } } } — url is an http(s) link or attachment:<id>; for an attachment the locator starts with the page, e.g. \"p. 2, fig. 1\"",
        ...(req.submission ? { previousSubmission: req.submission } : {}),
        ...(req.feedback ? { feedback: req.feedback } : {}),
      };
    },
  },
  {
    name: "submit_product_spec",
    title: "Submit a completed product brief",
    description:
      "Submit the researched values for an open product request. Each field: value (metres for lengths; null when not found), status (always published: a manufacturer or retailer figure), sources [{ url, locator }] where url is an http(s) link or attachment:<id> for a spec sheet attached to this request, and locator (page, figure, table or section; for an attachment, a page it has, e.g. \"p. 2\") is required, optional reference when the source measures from a different datum than the brief asks, note (required for a required field left null: where you looked), alternatives when sources disagree. Errors (no source, out of range, wrong unit, missing required field) reject the whole submission and nothing is stored. A human reviews and accepts it on the Products page; you cannot accept it.",
    inputSchema: obj(
      {
        requestId: str,
        manufacturer: str,
        model: str,
        code: str,
        ...exactSchemas,
        fields: { type: "object", additionalProperties: { type: "object" } },
      },
      ["requestId", "manufacturer", "model", "fields"],
    ),
    execute: (i) => products.submit(i.requestId as string, i as unknown as SpecSubmission),
  },
  {
    name: "get_product_library",
    title: "Read the product library",
    description: "Read the accepted products shared by every project: manufacturer, model, category, each field with its value, status and sources, and roughIn: service points whose axes (across, out, up) each name their datum. An unresolved point lists the fields it is missing. Values marked published are manufacturer figures, not site measurements.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    execute: () => {
      const { products: list } = productStore.getState();
      return { ok: true, summary: `${list.length} product(s) in the library.`, products: list };
    },
  },

  // ------------------------------------------------------------------ openings
  {
    name: "add_door",
    title: "Add a door",
    description:
      "Add a door on a wall. Position: t: position of the CENTER along the wall (0..1); or give centre (metres from the named wall end to the CENTER) with from (\"a\" = the wall's A endpoint, the default; \"b\" = its B endpoint). Lengths in metres, stored to 0.1 mm. Omitted width defaults to 0.9 m; omitted height defaults to 2.1 m (never above the wall). Each omitted dimension is flagged separately as unmeasured and get_issues reports it until explicitly entered. A door wider than 1.2 m is built as a double door with two leaves. The vano is clamped so it always fits inside the wall; too-wide doors are rejected with the wall length. hinge picks the jamb the hinges sit on (\"a\" = the wall's A end, the default; \"b\" = the B end) and side picks which way the leaf swings, as seen walking the wall from A to B: \"right\" (default) or \"left\". Match these to the swing arc drawn on the plan.",
    inputSchema: obj(
      {
        wallId: str,
        t: num,
        centre: num,
        from: { type: "string", enum: ["a", "b"] },
        width: num,
        height: num,
        hinge: { type: "string", enum: ["a", "b"] },
        side: { type: "string", enum: ["left", "right"] },
      },
      ["wallId"],
    ),
    execute: (i) =>
      actions.addOpening("door", i.wallId as string, position(i), { width: i.width as number | undefined, height: i.height as number | undefined }, {
        hinge: i.hinge as "a" | "b" | undefined,
        side: i.side as "left" | "right" | undefined,
      }),
  },
  {
    name: "set_door_swing",
    title: "Change how a door opens",
    description:
      "Change how an existing door opens: hinge (\"a\" | \"b\" — which jamb carries the hinges) and/or side (\"left\" | \"right\" — which way the leaf swings, walking the wall from its A endpoint to its B endpoint). Re-run build_3d to see it.",
    inputSchema: obj({ id: str, hinge: { type: "string", enum: ["a", "b"] }, side: { type: "string", enum: ["left", "right"] } }, ["id"]),
    execute: (i) => actions.setDoorSwing(i.id as string, i.hinge as "a" | "b" | undefined, i.side as "left" | "right" | undefined),
  },
  {
    name: "add_window",
    title: "Add a window",
    description:
      "Add a window on a wall. Position: t: position of the CENTER along the wall (0..1); or give centre (metres from the named wall end to the CENTER) with from (\"a\" = the wall's A endpoint, the default; \"b\" = its B endpoint). Lengths in metres, stored to 0.1 mm. Omitted width defaults to 1.2 m, sill to 0.9 m above the floor, and height to 1.2 m reduced to fit the wall. Each omitted dimension is flagged separately as unmeasured and get_issues reports it until explicitly entered. The vano is kept inside the wall and the result says if it had to move.",
    inputSchema: obj({ wallId: str, t: num, centre: num, from: { type: "string", enum: ["a", "b"] }, width: num, sill: num, height: num }, ["wallId"]),
    execute: (i) =>
      actions.addOpening("window", i.wallId as string, position(i), {
        width: i.width as number | undefined,
        sill: i.sill as number | undefined,
        height: i.height as number | undefined,
      }),
  },
  {
    name: "move_opening",
    title: "Move a door or window",
    description: "Move a door or window along its wall to a new center position t (0..1). Clamped to fit.",
    inputSchema: obj({ id: str, t: num }, ["id", "t"]),
    execute: (i) => actions.moveOpening(i.id as string, i.t as number),
  },
  {
    name: "edit_opening",
    title: "Set a door or window exactly",
    description:
      "Set an existing door or window exactly, in metres (stored to 0.1 mm): its position as centre from wall end a or b, or t (0..1), and/or width, sill (windows only) and height. Entering a dimension clears only that field's default warning; entry alone does not mean site-confirmed.",
    inputSchema: obj(
      { id: str, t: num, centre: num, from: { type: "string", enum: ["a", "b"] }, width: num, sill: num, height: num },
      ["id"],
    ),
    execute: (i) =>
      actions.editOpening(i.id as string, {
        ...position(i),
        width: i.width as number | undefined,
        sill: i.sill as number | undefined,
        height: i.height as number | undefined,
      }),
  },
  {
    name: "remove_opening",
    title: "Remove a door or window",
    description: "Remove a door or window by id.",
    inputSchema: obj({ id: str }, ["id"]),
    annotations: { destructiveHint: true },
    confirm: (i) => `remove opening ${i.id}`,
    execute: (i) => actions.removeOpening(i.id as string),
  },

  // ------------------------------------------------------------------ rooms
  {
    name: "add_room",
    title: "Add a room",
    description:
      "Add a room: a metric rectangle (x, y = top-left corner, w, h in meters) with a label and floor finish (oak | tile | carpet | concrete).",
    inputSchema: obj(
      { x: num, y: num, w: num, h: num, label: str, floor: str },
      ["x", "y", "w", "h", "label"],
    ),
    execute: (i) => actions.addRoom(i.x as number, i.y as number, i.w as number, i.h as number, i.label as string, i.floor as string | undefined),
  },
  {
    name: "update_room",
    title: "Update a room",
    description: "Update a room by id or label (e.g. \"bedroom\"): move, resize, relabel, or change floor finish.",
    inputSchema: obj(
      { id: str, x: num, y: num, w: num, h: num, label: str, floor: str },
      ["id"],
    ),
    execute: (i) => actions.updateRoom(i.id as string, i as never),
  },
  {
    name: "remove_room",
    title: "Remove a room",
    description: "Remove a room by id or label.",
    inputSchema: obj({ id: str }, ["id"]),
    annotations: { destructiveHint: true },
    confirm: (i) => `remove the room "${i.id}"`,
    execute: (i) => actions.removeRoom(i.id as string),
  },

  // ------------------------------------------------------------------ furniture
  {
    name: "place_item",
    title: "Place furniture",
    description:
      "Place furniture from the catalog at (x, y) = center in meters. rotation (degrees, counterclockwise) sets which way the piece FACES: 0 = faces +y (down/south on the plan), 90 = faces +x (right/east), 180 = faces -y (up/north), 270 = faces -x (left/west). The back of a sofa, bed headboard, wardrobe or counter is opposite the facing direction — so a sofa against the SOUTH wall needs rotation 180, and one against the WEST wall needs rotation 90. To sit a piece flush against a wall, offset its center by depth/2 from the wall FACE (centerline ± thickness/2), not from the centerline. Use get_item_catalog for footprints; get_issues reports crossings and blocked doors.",
    inputSchema: obj({ kind: str, x: num, y: num, rotation: num }, ["kind", "x", "y"]),
    execute: (i) => actions.placeItem(i.kind as string, i.x as number, i.y as number, i.rotation as number | undefined),
  },
  {
    name: "define_item_kind",
    title: "Model a new piece of furniture",
    description:
      "Create a piece of furniture that is NOT in the catalogue, then place it with place_item. Use this whenever the plan draws something the catalogue does not have, or draws it at a different size — a corner bath, an L-shaped sofa, a kitchen island, a piano. Do NOT approximate with the nearest stock item when the plan shows something specific: define the real thing. " +
      "Required: kind (a stable snake_case id), label, and the true footprint w × d and height h in METRES. " +
      "Optional `parts` models it in 3D from primitives; without it the piece is blocked out from its footprint. Each part is { shape: \"box\" | \"cylinder\" | \"sphere\", x, y, z, w, h, d, color, rotation }, in the piece's OWN local frame: x runs along its width, z along its depth, y is height above the floor and is the part's BOTTOM (a 0.4 m tall seat resting on the floor is y:0, h:0.4). The piece faces +z, so a backrest sits at negative z and the front is positive z — that keeps it consistent with the rotation convention in place_item. For a cylinder, w is the diameter and d makes it an ellipse. Optional `outline` gives the piece its real plan shape (a curved bath, a rounded basin): { start: {x, y}, segments: [{ to: {x, y}, via?: {x, y} }] }, closing back to start; a segment with via is an arc through that point. Coordinates are metres in the piece's frame: x across its width (centre 0), y from its back (-d/2) to its front (+d/2); the outline must stay inside the w × d box and touch its back edge. The outline is used for the plan, the trade sheet, clash checks and clearances, and is extruded in 3D when there are no parts. Sizes are metres, colours are hex.",
    inputSchema: obj(
      {
        kind: str,
        label: str,
        w: num,
        d: num,
        h: num,
        color: str,
        category: { type: "string", enum: ["living", "bedroom", "kitchen", "bath", "office", "decor"] },
        parts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              shape: { type: "string", enum: ["box", "cylinder", "sphere"] },
              x: num,
              y: num,
              z: num,
              w: num,
              h: num,
              d: num,
              color: str,
              rotation: num,
            },
            required: [],
            additionalProperties: false,
          },
        },
        outline: {
          type: "object",
          properties: {
            start: { type: "object", properties: { x: num, y: num }, required: ["x", "y"], additionalProperties: false },
            segments: { type: "array", items: { type: "object", properties: { to: { type: "object", properties: { x: num, y: num }, required: ["x", "y"], additionalProperties: false }, via: { type: "object", properties: { x: num, y: num }, required: ["x", "y"], additionalProperties: false } }, required: ["to"], additionalProperties: false } },
          },
          required: ["start", "segments"],
          additionalProperties: false,
        },
      },
      ["kind", "label", "w", "d", "h"],
    ),
    execute: (i) =>
      actions.defineItemKind({
        kind: i.kind as string,
        label: i.label as string,
        w: i.w as number,
        d: i.d as number,
        h: i.h as number,
        color: i.color as string | undefined,
        category: i.category as string | undefined,
        parts: i.parts as never,
        outline: i.outline as never,
      }),
  },
  {
    name: "move_item",
    title: "Move or rotate furniture",
    description: "Move or rotate a furniture item by id or kind (e.g. \"sofa\"). Same rotation convention as place_item: 0 faces +y, 90 faces +x, 180 faces -y, 270 faces -x.",
    inputSchema: obj({ id: str, x: num, y: num, rotation: num }, ["id"]),
    execute: (i) => actions.moveItem(i.id as string, i.x as number | undefined, i.y as number | undefined, i.rotation as number | undefined),
  },
  {
    name: "remove_item",
    title: "Remove furniture",
    description: "Remove a furniture item by id or kind.",
    inputSchema: obj({ id: str }, ["id"]),
    annotations: { destructiveHint: true },
    confirm: (i) => `remove the ${i.id}`,
    execute: (i) => actions.removeItem(i.id as string),
  },

  // ------------------------------------------------------------------ model / view
  {
    name: "set_plan_name",
    title: "Rename the plan",
    description: "Rename the plan.",
    inputSchema: obj({ name: str }, ["name"]),
    execute: (i) => actions.setPlanName(i.name as string),
  },
  {
    name: "clear_model",
    title: "Erase the whole plan",
    description: "Clear the whole plan (walls, openings, rooms, furniture, notes). Use when the user asks to start over.",
    inputSchema: obj({}),
    annotations: { destructiveHint: true },
    confirm: () => "erase the whole plan — every wall, opening, room and piece of furniture",
    execute: () => actions.clearModel(),
  },
  {
    name: "build_3d",
    title: "Raise the plan into 3D",
    description:
      "Raise the plan into 3D: extrudes walls with real openings, resolves corner joints, builds furniture, and switches the human's view to the 3D scene. Call after drawing so the user sees the result.",
    inputSchema: obj({}),
    execute: () => actions.build3d(),
  },
  {
    name: "set_camera",
    title: "Move the 3D camera",
    description:
      "Move the 3D camera: \"orbit\" (default 3/4 view), \"top\" (plan view from above), \"walk\" (first-person at 1.6 m — the user walks with WASD). Implies switching to 3D.",
    inputSchema: obj({ mode: { type: "string", enum: ["orbit", "top", "walk"] } }, ["mode"]),
    execute: (i) => actions.setCamera(i.mode as "orbit" | "top" | "walk"),
  },

  {
    name: "set_doors",
    title: "Open or shut the doors in 3D",
    description:
      "Swing the door leaves in the 3D scene open or shut (build_3d must have run). state: \"open\", \"closed\" or \"toggle\". Pass an opening id to act on one door, or omit it to act on every door in the plan. The human can do the same by clicking a leaf in the 3D view.",
    inputSchema: obj({ state: { type: "string", enum: ["open", "closed", "toggle"] }, id: str }, ["state"]),
    execute: (i) => {
      const id = i.id as string | undefined;
      const doors = store.getState().model.openings.filter((o) => o.kind === "door");
      if (id && !doors.some((o) => o.id === id)) return { ok: false, summary: `No door with id "${id}".` };
      if (doors.length === 0) return { ok: false, summary: "The plan has no doors yet." };
      bus.emit(EVENTS.SET_DOORS, { state: i.state as string, id });
      const n = id ? 1 : doors.length;
      return { ok: true, summary: `${n} door(s) set to "${i.state}".` };
    },
  },

  // ------------------------------------------------------------------ cross-origin (partner catalogue)
  {
    name: "get_supplier_catalog",
    title: "Supplier catalogue (cross-origin)",
    description:
      "Read the furniture catalogue published by the PARTNER ORIGIN (Nordika) as its own WebMCP tools — sku, name, category, real footprint in metres, price and stock. Reno Layouts discovers those tools with getTools({fromOrigins}) and calls them with executeTool(), so the data crosses origins in the browser with no server in between. Filter with category (living | bedroom | office | dining), maxPrice, maxWidth (metres) or inStock. Pair it with place_supplier_product to drop a real product into the plan at its true size.",
    inputSchema: obj({ category: str, maxPrice: num, maxWidth: num, inStock: { type: "boolean" } }, []),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (i) => {
      try {
        const { products, transport } = await listProducts(i as Record<string, unknown>);
        return {
          ok: true,
          summary: `${products.length} product(s) from ${SUPPLIER_ORIGIN} via ${transport === "webmcp" ? "cross-origin WebMCP" : "postMessage fallback"}.`,
          origin: SUPPLIER_ORIGIN,
          transport,
          products,
        };
      } catch (err) {
        return { ok: false, summary: `Supplier unreachable: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  },
  {
    name: "place_supplier_product",
    title: "Place a supplier product",
    description:
      "Buy-in-place: fetch one product from the partner origin by sku, add it to this plan's catalogue at the supplier's REAL dimensions, and place it at (x, y) = centre in metres with the usual rotation convention. The constraint checker then treats it like any other piece, so a sofa that does not fit is caught before anyone orders it.",
    inputSchema: obj({ sku: str, x: num, y: num, rotation: num }, ["sku", "x", "y"]),
    execute: async (i) => {
      let product;
      try {
        const res = await getProduct(String(i.sku));
        product = res.product;
      } catch (err) {
        return { ok: false, summary: `Supplier unreachable: ${err instanceof Error ? err.message : String(err)}` };
      }
      if (!product) return { ok: false, summary: `The supplier has no product "${i.sku}".` };
      const imported = actions.importSupplierProduct(product);
      const kind = imported.kind as string;
      const placed = actions.placeItem(kind, i.x as number, i.y as number, i.rotation as number | undefined);
      if (!placed.ok) return placed;
      const stock = product.stock === 0 ? " — note: currently OUT OF STOCK at the supplier" : "";
      return {
        ok: true,
        summary: `${product.name} (${product.sku}, ${product.w} × ${product.d} m, €${product.price}) placed from ${SUPPLIER_ORIGIN}${stock}.`,
        id: placed.id,
        product,
      };
    },
  },

  // ------------------------------------------------------------------ collaboration
  {
    name: "leave_note",
    title: "Leave a note on the plan",
    description:
      "Leave a note on the plan for the human (or read theirs): design rationale, questions, measurements to verify. Notes are visible in the Notes panel.",
    inputSchema: obj({ text: str }, ["text"]),
    execute: (i) => actions.leaveNote("agent", i.text as string),
  },
  {
    name: "get_notes",
    title: "Read the notes on the plan",
    description: "Read all notes left on the plan by the human and by agents.",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
    execute: () => {
      const notes = store.getState().notes;
      return { ok: true, summary: `${notes.length} note(s).`, notes };
    },
  },
];

/** The dynamic tool — registered only while the human has a wall selected (see bootstrap.ts). */
export const EXTEND_SELECTED_WALL: ToolDef = {
  name: "extend_selected_wall",
  title: "Extend the wall the human selected",
  description:
    "DYNAMIC TOOL — available only while the human has a wall selected. Extends the wall the human is pointing at by `meters` (positive grows, negative shrinks) from its `end` (\"a\" = start, \"b\" = end).",
  inputSchema: obj({ meters: num, end: { type: "string", enum: ["a", "b"] } }, ["meters", "end"]),
  execute: (i) => {
    const id = store.getState().editor.selectedWallId;
    if (!id) return { ok: false, summary: "No wall is selected right now — the human must select one first." };
    const w = store.getState().model.walls.find((x) => x.id === id);
    if (!w) return { ok: false, summary: "Selected wall no longer exists." };
    const len = segLen(w.ax, w.ay, w.bx, w.by);
    const dx = (w.bx - w.ax) / len;
    const dy = (w.by - w.ay) / len;
    const m = i.meters as number;
    const patch =
      (i.end as string) === "a"
        ? { ax: w.ax - dx * m, ay: w.ay - dy * m }
        : { bx: w.bx + dx * m, by: w.by + dy * m };
    return actions.editWall(id, patch);
  },
};

/**
 * Runner behind the on-page ToolRunner. It goes through the SAME wrapper WebMCP uses —
 * approval gate, activity log and all — so the fallback path is not a second code path.
 */
export async function runToolManually(name: string, input: Record<string, never>): Promise<ActionResult> {
  const def = [...TOOLS, EXTEND_SELECTED_WALL].find((t) => t.name === name);
  if (!def) return { ok: false, summary: `Unknown tool "${name}".` };
  return executeWrapped(def, input);
}

export { bus, EVENTS };
