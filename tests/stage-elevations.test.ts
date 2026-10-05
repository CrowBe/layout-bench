/**
 * Stage wall elevations: each wall side a stage view shows gets its own drawing, from the same
 * visible set as the plan. Fixtures, service points and openings appear on the face they stand
 * against, at their heights; hidden layers and objects do not; unknown heights are listed, not drawn.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { emptyModel } from "../src/model/types";
import { resolveVisible } from "../src/sheets/stageView";
import { elevationSurfaces, renderStageElevation } from "../src/sheets/stageElevation";
import { resolveFace } from "../src/model/faces";

const model = () => store.getState().model;
const P = (value: number) => ({ value, status: "proposed" as const });
const M = (value: number) => ({ value, status: "measured" as const, source: "site survey" });

beforeEach(() => store.setState({ model: emptyModel(), undoStack: [], kinds: [] }));

function bathroom() {
  const corners = [[0, 0], [2.11, 0], [2.11, 3.02], [0, 3.02]];
  const walls: string[] = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    walls.push(actions.addWall(ax, ay, bx, by, 0.1, 2.4).id as string);
  }
  actions.addRoom(0, 0, 2.11, 3.02, "Bathroom", "tile");
  const win = actions.addOpening("window", walls[0], { centre: 1.055 }, { width: 1.755, sill: 1.52, height: 0.6 }).id as string;
  for (const w of walls) {
    actions.setWallSide(w, "right", {
      existing: M(0), frame: { value: -0.015, status: "site-confirmed", source: "strip-out" },
      layers: [{ kind: "board", name: "Villaboard 6 mm", thickness: P(0.006) }, { kind: "waterproofing", name: "Membrane", thickness: P(0.001) }, { kind: "tile", name: "Wall tile", thickness: P(0.009) }],
    });
  }
  actions.setRoomFloor("Bathroom", { substrateTop: M(-0.02), layers: [{ kind: "screed", thickness: P(0.03) }, { kind: "tile", thickness: P(0.01) }] });
  actions.defineItemKind({ kind: "vanity_e", label: "Vanity", w: 0.91, d: 0.465, h: 0.85, category: "bath" });
  actions.defineItemKind({ kind: "rail_e", label: "Towel rail", w: 0.142, d: 0.1, h: 0.9, category: "bath", elevation: 0.5 });
  const vanity = actions.placeItem("vanity_e", 1, 1).id as string;
  actions.anchorFixture(vanity, { wallId: walls[1], side: "right", face: "finished", distance: 1.7, status: "proposed" });
  actions.setServicePoint(vanity, { id: "vw", label: "Basin waste", service: "waste", face: "frame", out: 0, across: 0.1, up: 0.5, status: "proposed" });
  actions.setServicePoint(vanity, { id: "gpo", label: "GPO", service: "power", face: "frame", out: 0, across: 0.3, status: "proposed" }); // up unknown
  const rail = actions.placeItem("rail_e", 0.1, 1.5).id as string;
  actions.anchorFixture(rail, { wallId: walls[3], side: "right", face: "finished", distance: 1.5, status: "proposed" });
  return { walls, win, vanity, rail };
}

const ids = (visible: string[]) => resolveVisible(model(), visible).elements;
const opts = { label: "Fit-out", findings: [] };

describe("stage wall elevations", () => {
  it("offers one surface per room-facing wall side the view shows", () => {
    const { walls } = bathroom();
    const s = elevationSurfaces(model(), ids(["walls", "fixtures"]));
    expect(s.map((x) => x.id)).toEqual(walls.map((w) => `${w}:right`));
    expect(s.every((x) => x.room === "Bathroom")).toBe(true);
    // a view with no wall content has no elevations
    expect(elevationSurfaces(model(), ids(["fixtures"]))).toEqual([]);
  });

  it("draws fixtures, openings and service points on the face they stand against, with heights", () => {
    const { walls, win, vanity, rail } = bathroom();
    const els = ids(["walls", "windows", "wall-tile", "floor-tile", "fixtures", "services-waste", "services-power"]);
    const east = renderStageElevation(model(), els, walls[1], "right", opts);
    expect(east).toContain(`data-element="item:${vanity}"`);
    expect(east).not.toContain(`data-element="item:${rail}"`);
    expect(east).toContain(`data-element="item:${vanity}:sp:vw"`);
    expect(east).toContain("500 AFF");
    // the GPO has no height: it is listed with "?" and never placed
    expect(east).not.toMatch(new RegExp(`<circle[^>]*item:${vanity}:sp:gpo`));
    expect(east).toMatch(/GPO: .*up \?/);
    // the run is dimensioned between the finished faces of the return walls
    expect(east).toMatch(/3018 between finished faces of the return walls/);
    const west = renderStageElevation(model(), els, walls[3], "right", opts);
    expect(west).toContain(`data-element="item:${rail}"`);
    expect(west).toMatch(/envelope bottom 500/);
    const north = renderStageElevation(model(), els, walls[0], "right", opts);
    expect(north).toContain(`data-element="opening:${win}"`);
    expect(north).toMatch(/jambs 176\.5 \/ 1931\.5 from finished face at A/);
    // the tile grid appears only once a set-out is recorded for the face
    expect(north).not.toContain("data-piece");
    expect(north).toMatch(/no tile set-out recorded/);
    actions.setWallTiling(walls[0], "right", { tileLength: P(0.6), tileWidth: P(0.3), orientation: "landscape", joint: P(0.002), reference: "finished", floor: "finished", originFrom: "centre", originAlong: P(0), originUp: P(0), tiledHeight: P(2.3) });
    expect(renderStageElevation(model(), els, walls[0], "right", opts)).toContain('data-piece="cut"');
  });

  it("dashes a kind-elevation envelope and leaves a floor-standing fixture solid", () => {
    const { walls, vanity, rail } = bathroom();
    const els = ids(["walls", "fixtures"]);
    const west = renderStageElevation(model(), els, walls[3], "right", opts);
    expect(west).toMatch(new RegExp(`stroke-dasharray="1.2 0.6"[^>]*data-element="item:${rail}"`));
    const east = renderStageElevation(model(), els, walls[1], "right", opts);
    expect(east).toContain(`data-element="item:${vanity}"`);
    expect(east).not.toMatch(new RegExp(`stroke-dasharray[^>]*data-element="item:${vanity}"`));
  });

  it("shows only what the stage shows", () => {
    const { walls, vanity } = bathroom();
    const frameOnly = renderStageElevation(model(), ids(["walls", "wall-frame", "services-waste"]), walls[1], "right", { ...opts, label: "Rough-in" });
    expect(frameOnly).not.toContain(`data-element="item:${vanity}"`);
    expect(frameOnly).toContain(`data-element="item:${vanity}:sp:vw"`);
    expect(frameOnly).toMatch(/between frame faces of the return walls/);
    expect(frameOnly).toMatch(/3050 between frame faces/);
    expect(frameOnly).not.toContain("data-piece");
    const board = renderStageElevation(model(), ids(["walls", "wall-board"]), walls[1], "right", opts);
    expect(board).toMatch(/between board faces of the return walls/);
  });

  it("mirrors a left-side face so end A reads on the right", () => {
    actions.addWall(0, 0, 2, 0, 0.1, 2.4);
    actions.addRoom(0, -2, 2, 2, "Hall", "tile"); // on the left of A→B on screen
    const w = model().walls[0].id;
    const s = elevationSurfaces(model(), ids(["walls"]));
    expect(s).toEqual([{ wallId: w, side: "left", id: `${w}:left`, room: "Hall" }]);
    expect(renderStageElevation(model(), ids(["walls"]), w, "left", opts)).toMatch(/end A on the right/);
    // with no floor build-up recorded, heights are read from the existing floor and say so
    actions.defineItemKind({ kind: "cab_e", label: "Cabinet", w: 0.6, d: 0.3, h: 0.8, category: "bath" });
    const cab = actions.placeItem("cab_e", 0.5, -0.2).id as string;
    const svg = renderStageElevation(model(), ids(["walls", "fixtures"]), w, "left", opts);
    expect(svg).toContain(`data-element="item:${cab}"`);
    expect(svg).toMatch(/0–800 above existing floor surface E · stands on the existing floor \(no floor/);
  });

  it("resolves a layer kind as the outer face of the last layer of that kind", () => {
    const { walls } = bathroom();
    const side = model().walls.find((w) => w.id === walls[0])!.sides!.right;
    expect(resolveFace(side, "waterproofing")).toMatchObject({ resolved: true, offset: -0.008 }); // frame −15 + board 6 + membrane 1
    expect(resolveFace(side, "adhesive")).toMatchObject({ resolved: false });
  });

  it("never edits the model", () => {
    const { walls } = bathroom();
    const before = JSON.stringify(model());
    for (const w of walls) renderStageElevation(model(), ids(["walls", "wall-tile", "fixtures", "services-waste"]), w, "right", opts);
    expect(JSON.stringify(model())).toBe(before);
  });
});
