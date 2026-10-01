import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { emptyModel } from "../src/model/types";
import { checkSheet } from "../src/sheets/check";
import { renderFloorPlan } from "../src/sheets/floorPlan";
import { demoProject, parseImport } from "../src/model/projects";

beforeEach(() => store.setState({ model: emptyModel(), undoStack: [], kinds: [] }));
const model = () => store.getState().model;
const codes = () => checkSheet(model(), "floor-plan").map((f) => `${f.severity}:${f.code}`);

/** The #1 example: 2110 × 3020 bathroom on its existing surfaces, back window centred, front door. */
function bathroom() {
  const corners = [[0, 0], [2.11, 0], [2.11, 3.02], [0, 3.02]];
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    ids.push(actions.addWall(ax, ay, bx, by, 0.1, 2.4).id as string);
  }
  actions.addRoom(0, 0, 2.11, 3.02, "Bathroom", "tile");
  const win = actions.addOpening("window", ids[0], { centre: 1.055 }, { width: 1.755, sill: 1.52 }).id as string;
  const door = actions.addOpening("door", ids[2], { centre: 0.52, from: "b" }, { height: 2.04 }).id as string; // width omitted: a default
  return { ids, win, door };
}

describe("trade sheet preflight and issue (#29)", () => {
  it("blocks on what would mislead, and lists unknowns as advisory", () => {
    bathroom();
    const c = codes();
    expect(c).toContain("blocking:title_block_incomplete");
    expect(c).toContain("blocking:default:opening_width_default"); // the door width would print as a measurement
    expect(c).toContain("advisory:unresolved:opening_height_default"); // window height: not on the plan
    expect(c).toContain("advisory:no_faces_recorded");
    const fix = checkSheet(model(), "floor-plan").find((f) => f.code === "default:opening_width_default")!.fix!;
    expect(fix.tool).toBe("edit_opening");
  });

  it("refuses with each open finding, issues once fixed, and records a revision", () => {
    const { door } = bathroom();
    const refused = actions.exportSheet("floor-plan");
    expect(refused.ok).toBe(false);
    expect((refused.open as { code: string }[]).map((f) => f.code).sort()).toEqual(["default:opening_width_default", "title_block_incomplete"]);
    expect(model().sheetSet?.revisions ?? []).toEqual([]);

    actions.setSheetInfo({ project: "Bathroom renovation", site: "Main bathroom", preparedBy: "Owner" });
    actions.editOpening(door, { width: 0.8 });
    const issued = actions.exportSheet("floor-plan", { note: "For plumber's quote" });
    expect(issued.ok).toBe(true);
    expect(issued.rev).toBe("A");
    expect(model().sheetSet!.revisions).toMatchObject([{ rev: "A", sheet: "floor-plan", acknowledged: [], note: "For plumber's quote" }]);
    const svg = issued.svg as string;
    expect(svg).toContain("Rev A");
    expect(svg).toContain("Bathroom renovation");
    expect(svg).toContain("D 800 ENT");
    expect(svg).toContain("W 1755 ENT");
    expect(svg).toContain("2110 ENT");
    expect(svg).toContain("NOT AS-BUILT");
    expect(svg).toMatch(/Unresolved \(\d+\)/);
    expect(actions.exportSheet("floor-plan").rev).toBe("B");
  });

  it("issues past a blocking finding only with a matching, reasoned acknowledgement, printed on the sheet", () => {
    bathroom();
    actions.setSheetInfo({ project: "Bathroom renovation", site: "Main bathroom" });
    const ref = checkSheet(model(), "floor-plan").find((f) => f.code === "default:opening_width_default")!.ref;
    expect(actions.exportSheet("floor-plan", { acknowledge: [{ code: "default:opening_width_default", ref, reason: "ok" }] }).ok).toBe(false); // reason too short
    expect(actions.exportSheet("floor-plan", { acknowledge: [{ code: "made_up", ref, reason: "a long enough reason" }] }).ok).toBe(false); // matches nothing
    const issued = actions.exportSheet("floor-plan", { acknowledge: [{ code: "default:opening_width_default", ref, reason: "Door is being replaced; width set on site" }] });
    expect(issued.ok).toBe(true);
    expect(issued.svg as string).toContain("Issued past 1 blocking finding(s)");
    expect(issued.svg as string).toContain("Door is being replaced; width set on site");
    expect(model().sheetSet!.revisions[0].acknowledged).toMatchObject([{ code: "default:opening_width_default", by: "agent" }]);
  });

  it("draws faces and rough-in when they exist, at a standard scale, and survives project JSON", () => {
    const { ids, door } = bathroom();
    actions.editOpening(door, { width: 0.8 });
    actions.setWallSide(ids[0], "right", {
      existing: { value: 0, status: "measured" }, frame: { value: -0.045, status: "site-confirmed" },
      layers: [{ kind: "board", name: "Villaboard", thickness: { value: 0.006, status: "proposed" } }, { kind: "tile", thickness: { value: 0.01, status: "proposed" } }],
    });
    actions.defineItemKind({ kind: "vanity_recorded", label: "Vanity", w: 0.91, d: 0.465, h: 0.85, category: "bath" });
    const v = actions.placeItem("vanity_recorded", 1, 1).id as string;
    actions.anchorFixture(v, { wallId: ids[0], side: "right", face: "finished", distance: 1.4, status: "proposed" });
    actions.setServicePoint(v, { label: "Wall waste", service: "waste", face: "finished", out: 0, across: 0.1, up: 0.55, status: "proposed" });
    const svg = renderFloorPlan(model(), { sheet: "floor-plan", findings: checkSheet(model(), "floor-plan"), revision: null });
    expect(svg).toContain('data-scale="20"');
    expect(svg).toContain("PREVIEW, not issued");
    expect(svg).toMatch(/data-face="[^"]+:right:finished"/);
    expect(svg).toContain("F1.1 Wall waste: frame 16 · board 10 · fin 0 · A 1500 · up 550 P");
    expect(svg).toContain("1400 from A · 0 off finished P");
    actions.setSheetInfo({ project: "Bathroom renovation", site: "Main bathroom" });
    actions.exportSheet("floor-plan");
    const loaded = parseImport(JSON.stringify({ ...demoProject(), id: "b", model: model() }));
    expect(loaded.model.sheetSet!.revisions.map((r) => r.rev)).toEqual(["A"]);
  });
});
