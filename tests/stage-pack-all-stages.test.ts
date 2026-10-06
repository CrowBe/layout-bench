/**
 * Stage pack, all nine stages, through the real generatePack on the real sample: every stage
 * renders, the stopgap views label what the sample does not record (driven by the phase's flag),
 * the heating spec is the compact form, and the printed tags follow the weakest-input ladder.
 * Figures are asserted against the sample's own recorded values, not against the helpers.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { emptyModel } from "../src/model/types";
import { demoProject } from "../src/model/projects";
import { catalogue, resolveVisible, specRows } from "../src/sheets/stageView";
import { renderStageElevation } from "../src/sheets/stageElevation";
import { resetViews } from "../src/sheets/viewState";
import { PHASES, composePhase, generatePack, indexMarkdown, type Phase } from "../scripts/stage-pack";

let outDir: string;
let written: Awaited<ReturnType<typeof generatePack>>;
const read = (slug: string, name: string) => readFileSync(join(outDir, slug, name), "utf8");
const slugOf = (n: string) => PHASES.find((p) => p.slug.startsWith(n))!.slug;
const SAMPLE = demoProject().model;
const dataElements = (svg: string) => [...svg.matchAll(/data-element="([^"]*)"/g)].map((m) => m[1]);

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), "stage-pack-all-"));
  written = await generatePack({ outDir, previews: false, date: "2026-10-06" });
});
afterAll(() => rmSync(outDir, { recursive: true, force: true }));
beforeEach(() => resetViews());

describe("all nine stages", () => {
  it("writes a plan, an elevation per room-facing wall, and a spec for every stage 01-09", () => {
    expect(PHASES.map((p) => p.slug.slice(0, 2))).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09"]);
    expect(written.map((w) => w.phase.slug)).toEqual(PHASES.map((p) => p.slug));
    for (const p of PHASES) {
      const files = readdirSync(join(outDir, p.slug)).sort();
      // the sample's four walls each face the bathroom on their right side
      expect(files, p.slug).toEqual(["elevation-wall_e-right.svg", "elevation-wall_n-right.svg", "elevation-wall_s-right.svg", "elevation-wall_w-right.svg", "plan.svg", "spec.html"]);
      expect(read(p.slug, "spec.html")).toContain(`Specification: ${p.label}`);
    }
  });

  it("shows each stage's own layers: a layer outside the stage never appears in its plan", () => {
    const layersIn = (slug: string) => new Set(dataElements(read(slug, "plan.svg")));
    // 05 is the only stage with the heating cable; 08 the only one with wall tiles' set-out in the plan list
    expect(layersIn(slugOf("05")).has("room:bathroom:heating")).toBe(true);
    for (const n of ["01", "02", "03", "04", "06", "07", "08", "09"]) expect(layersIn(slugOf(n)).has("room:bathroom:heating"), n).toBe(false);
    // fixtures only at fit-out; floor planes only once screed is laid
    expect([...layersIn(slugOf("09"))].some((e) => e.startsWith("item:"))).toBe(true);
    for (const n of ["01", "02", "03", "04", "05", "06", "07", "08"]) expect([...layersIn(slugOf(n))].some((e) => e.startsWith("item:")), n).toBe(false);
    expect([...layersIn(slugOf("06"))].some((e) => e.includes(":plane:"))).toBe(true);
    expect([...layersIn(slugOf("04"))].some((e) => e.includes(":plane:"))).toBe(false);
  });

  it("indexes every stage", () => {
    const md = readFileSync(join(outDir, "README.md"), "utf8");
    for (const p of PHASES) expect(md).toContain(`## ${p.label}`);
    expect(md).not.toContain("Not generated yet.");
  });
});

describe("heating cable compact spec (stage 05)", () => {
  const heating = catalogue(SAMPLE).elements.find((e) => e.type === "heating")!;

  it("cuts the sample's heating rows from one-per-point to a printable handful, keeping every number tagged", () => {
    const full = specRows(SAMPLE, heating);
    const compact = specRows(SAMPLE, heating, undefined, true);
    // the sample's recorded route has 30 points; the full view prints each point and each level sample
    expect(SAMPLE.rooms[0].heating!.path).toHaveLength(30);
    expect(full.length).toBeGreaterThan(100);
    expect(compact.length).toBeLessThanOrEqual(40);
    const spec = read(slugOf("05"), "spec.html");
    expect(spec.match(/data-element="room:bathroom:heating"/g)!.length).toBe(compact.length);
    // first recorded point is (0.15, 2.9) m from the plan origin; second (0.15, 0.16)
    const points = compact.find((r) => r.property.startsWith("route points"))!;
    expect(points.property).toBe("route points 1–30 x / y (mm)");
    expect(points.value).toMatch(/^1: 150 \/ 2900 P; 2: 150 \/ 160 P; /);
    expect(points.value.split("; ")).toHaveLength(30);
    expect(points.datum).toBe("plan origin");
    // every point in the compact value carries a tag
    for (const part of points.value.split("; ")) expect(part).toMatch(/ P$/);
  });

  it("keeps unknown cable levels as '?' with what is missing, never a number", () => {
    const levels = specRows(SAMPLE, heating, undefined, true).find((r) => r.property.startsWith("cable level"))!;
    expect(levels.value).toBe("?");
    expect(levels.status).toBe("unknown");
    expect(levels.missing!.some((m) => /thickness/.test(m))).toBe(true);
  });

  it("does not print one unresolved item per sampled level", () => {
    const md = written.find((w) => w.phase.slug === slugOf("05"))!;
    // the full view lists a "cable level at N m" finding per sample (91 of them); compact lists one
    expect(md.advisory.filter((m) => /cable level at/.test(m))).toHaveLength(1);
  });

  it("is used by stage 05 only", () => {
    expect(PHASES.filter((p) => p.compact).map((p) => p.slug)).toEqual([slugOf("05")]);
    expect(read(slugOf("01"), "spec.html")).not.toContain("route points");
  });
});

describe("stopgap views", () => {
  const services = ["Waste service points", "Water service points", "Power service points"];

  it("only the three stages whose layers the sample lacks are stopgaps, and each says what is not recorded", () => {
    expect(PHASES.filter((p) => p.stopgap).map((p) => p.slug.slice(0, 2))).toEqual(["03", "04", "09"]);
    for (const n of ["03", "09"]) {
      for (const s of services) {
        expect(read(slugOf(n), "plan.svg"), n).toContain(`${s}: not recorded in the sample, so not drawn or listed.`);
        expect(read(slugOf(n), "spec.html"), n).toContain(`${s}: not recorded in the sample, so not drawn or listed.`);
        expect(read(slugOf(n), "elevation-wall_n-right.svg"), n).toContain(`${s}: not recorded`);
      }
    }
    expect(read(slugOf("04"), "plan.svg")).toContain("Wall waterproofing membrane: not recorded in the sample");
    expect(read(slugOf("04"), "spec.html")).toContain("Wall waterproofing membrane: not recorded in the sample");
    // non-stopgap stages print no such section
    for (const n of ["01", "02", "05", "06", "07", "08"]) {
      expect(read(slugOf(n), "plan.svg"), n).not.toContain("STOPGAP VIEW");
      expect(read(slugOf(n), "spec.html"), n).not.toContain("stopgap");
    }
  });

  it("the sample really has none of the layers the stopgaps name, and never draws a service point or wall membrane", () => {
    const cat = catalogue(SAMPLE);
    for (const l of ["services-waste", "services-water", "services-power", "wall-waterproofing"]) expect(cat.emptyLayers).toContain(l);
    expect(cat.layers.map((l) => l.id)).toContain("floor-waterproofing");
    for (const n of ["03", "04", "09"]) {
      const els = dataElements(read(slugOf(n), "plan.svg"));
      expect(els.some((e) => e.includes(":sp:") || e.includes("waterproofing")), n).toBe(false);
    }
  });

  it("03 draws the frame and the drains, the drains dashed", () => {
    const plan = read(slugOf("03"), "plan.svg");
    const els = dataElements(plan);
    expect(els).toEqual(expect.arrayContaining(["wall:wall_n:right:frame", "room:bathroom:waste:linear_drain", "room:bathroom:waste:square_waste"]));
    for (const id of ["room:bathroom:waste:linear_drain", "room:bathroom:waste:square_waste"]) {
      const tag = plan.match(new RegExp(`<[^>]*data-element="${id}"[^>]*>`))![0];
      expect(tag).toContain("stroke-dasharray");
    }
  });

  it("04 shows the floor membrane only; its thickness is unrecorded so its level prints '?', never a line", () => {
    const svg = read(slugOf("04"), "elevation-wall_n-right.svg");
    expect(svg).toContain("Waterproofing on the slab top: ?");
    expect(svg).not.toContain('data-element="room:bathroom:floor:floor_membrane"');
    expect(dataElements(svg).some((e) => e.includes("_waterproofing"))).toBe(false);
    expect(read(slugOf("04"), "spec.html")).toMatch(/Waterproofing on the slab<\/td>[\s\S]*?<td>top level \(mm\)<\/td><td>\?<\/td>/);
  });

  it("09 draws the fixtures dashed, with no services", () => {
    const plan = read(slugOf("09"), "plan.svg");
    const fixtures = [...plan.matchAll(/<polygon[^>]*data-element="item:[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(fixtures).toHaveLength(SAMPLE.items.length);
    for (const f of fixtures) expect(f).toContain("stroke-dasharray");
  });

  it("is driven by the phase flag, not by note text", () => {
    const flagged = PHASES.find((p) => p.slug.startsWith("03"))!;
    const model = structuredClone(SAMPLE);
    model.sheetSet = { titleBlock: { project: model.name, site: "Bathroom (no site address recorded)" }, revisions: [] };
    // the same visible set without the flag renders no not-recorded section, even though the label still says 'stopgap'
    const unflagged: Phase = { ...flagged, stopgap: undefined };
    const a = composePhase("flag-a", model, unflagged);
    expect(a.composed.resolution.elements.length).toBeGreaterThan(0);
    // a flag naming a layer the model does record is refused instead of printing a false 'not recorded'
    const stale: Phase = { ...flagged, stopgap: { dashed: [], notRecorded: [{ layer: "floor-waterproofing", label: "Floor membrane" }] } };
    expect(() => composePhase("flag-b", model, stale)).toThrow(/recorded in the model now/);
    // dashing a layer the stage does not show is refused
    const stray: Phase = { ...flagged, stopgap: { dashed: ["fixtures"], notRecorded: [] } };
    expect(() => composePhase("flag-c", model, stray)).toThrow(/does not show/);
  });

  it("names the stopgap in the README", () => {
    const md = indexMarkdown(written);
    expect(md).toContain("Stopgap view, not recorded: Waste service points; Water service points; Power service points.");
    expect(md).toContain("Stopgap view, not recorded: Wall waterproofing membrane.");
  });
});

describe("round-5 tags on the elevation", () => {
  const opts = { label: "t", findings: [] };
  beforeEach(() => store.setState({ model: emptyModel(), undoStack: [], kinds: [] }));

  function room(frameE: "site-confirmed" | "measured" | "estimated", frameW: "site-confirmed" | "measured" | "estimated") {
    const corners = [[0, 0], [2.11, 0], [2.11, 3.02], [0, 3.02]];
    const walls: string[] = [];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4];
      walls.push(actions.addWall(ax, ay, bx, by, 0.1, 2.4).id as string);
    }
    actions.addRoom(0, 0, 2.11, 3.02, "Bathroom", "tile");
    actions.addOpening("window", walls[0], { centre: 1.055 }, { width: 1.755, sill: 1.52, height: 0.6 });
    // walls[3] is the north wall's end A return; walls[1] its end B return
    walls.forEach((w, i) => actions.setWallSide(w, "right", { existing: { value: 0, status: "measured", source: "site" }, frame: { value: -0.015, status: i === 1 ? frameE : i === 3 ? frameW : "measured", source: "check" }, layers: [] }));
    return walls;
  }
  const north = (walls: string[]) => renderStageElevation(store.getState().model, resolveVisible(store.getState().model, ["walls", "wall-frame", "windows", "rooms"]).elements, walls[0], "right", opts);

  it("prints one status for the run, the weakest of its two ends", () => {
    for (const [e, w, want] of [["site-confirmed", "estimated", "E"], ["estimated", "site-confirmed", "E"], ["measured", "site-confirmed", "M"], ["site-confirmed", "site-confirmed", "SC"]] as const) {
      store.setState({ model: emptyModel(), undoStack: [], kinds: [] });
      const svg = north(room(e, w));
      const run = svg.match(/data-dim="run">([^<]*)</)![1];
      expect(run, `${e}/${w}`).toMatch(new RegExp(`\\(${want}\\)$`));
      expect(run).not.toMatch(/\([A-Z]+\/[A-Z]+\)/);
    }
  });

  it("the sample's run prints (E), where it used to print (E/E)", () => {
    const svg = read(slugOf("01"), "elevation-wall_n-right.svg");
    expect(svg).toContain("2200 between frame faces of the return walls (E)");
    expect(svg).not.toContain("(E/E)");
  });

  it("tags the End A / End B positions with the face's status", () => {
    const svg = read(slugOf("01"), "elevation-wall_n-right.svg");
    expect(svg).toContain("End A: Frame face of wall_w (right side) at 5 E along the drawn line.");
    expect(svg).toContain("End B: Frame face of wall_e (right side) at 2205 E along the drawn line.");
    // the recorded frame faces are estimated and 5 mm off the drawn line (the sample's own figure)
    expect(SAMPLE.walls.find((w) => w.id === "wall_w")!.sides!.right!.frame).toMatchObject({ value: 0.005, status: "estimated" });
  });

  it("tags the opening centre in the plan as entered", () => {
    const plan = read(slugOf("01"), "plan.svg");
    // 1105 mm and 1640 mm are the sample's own centres from end A
    expect(plan).toContain("c/l 1105 ENT from A");
    expect(plan).toContain("c/l 1640 ENT from A");
    expect(plan).not.toMatch(/c\/l \d+ from A/);
  });

  it("prints a jamb as its weakest input only, never two tags", () => {
    const walls = room("site-confirmed", "site-confirmed");
    const svg = north(walls);
    // entered width and entered centre against a site-confirmed face: ENT, and no SC alongside it
    expect(svg).toMatch(/jambs [\d.]+ \/ [\d.]+ ENT from [^<]+ at A/);
    expect(svg).not.toMatch(/jambs [^<]*(ENT\/SC|SC\/ENT|ENT SC|SC ENT)/);
  });
});
