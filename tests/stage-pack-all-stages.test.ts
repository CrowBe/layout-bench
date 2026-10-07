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
    // the sample's recorded route has 56 points; the full view prints each point and each level sample
    expect(SAMPLE.rooms[0].heating!.path).toHaveLength(56);
    expect(full.length).toBeGreaterThan(100);
    expect(compact.length).toBeLessThanOrEqual(40);
    const spec = read(slugOf("05"), "spec.html");
    expect(spec.match(/data-element="room:bathroom:heating"/g)!.length).toBe(compact.length);
    // first recorded point is (0.15, 2.855) m from the plan origin; the first run goes east to 2.01
    const points = compact.find((r) => r.property.startsWith("route points"))!;
    expect(points.property).toBe("route points 1–56 x / y (mm)");
    expect(points.value).toMatch(/^1: 150 \/ 2855 P; 2: 2010 \/ 2855 P; /);
    expect(points.value.split("; ")).toHaveLength(56);
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

  it("04 shows the floor membrane only, its top from the estimated slab plus the owner's ~1.5 mm, tagged E", () => {
    const svg = read(slugOf("04"), "elevation-wall_n-right.svg");
    // owner, 7 Oct 2026: liquid polyurethane about 1.5 mm (E) on the slab at −120 (E): top −118.5 E
    expect(flat(svg)).toContain("Membrane (Bastion liquid polyurethane) top -118.5 E above existing floor surface");
    expect(svg).toContain('data-element="room:bathroom:floor:floor_membrane"');
    expect(dataElements(svg).some((e) => e.includes("_waterproofing"))).toBe(false); // no wall membrane layer: its extent is a note (#88)
    expect(read(slugOf("04"), "spec.html")).toMatch(/Membrane \(Bastion liquid polyurethane\)<\/td>[\s\S]*?<td>top level \(mm\)<\/td><td>-118\.5<\/td><td>E estimated/);
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

// ---------------------------------------------------------------------------------- fix round 1

/** a sheet's text as one line, so a label wrapped over panel rows still reads as one */
const flat = (svg: string) => svg.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ");
const TAG = "(?:SC|M|PUB|P|E|DER|MOD|ENT|DEF|NAM|\\?)";
const specCells = (html: string, element: string, property: string) => {
  const tr = [...html.matchAll(/<tr data-element="([^"]*)"[^>]*>([\s\S]*?)<\/tr>/g)].find((m) => m[1] === element && new RegExp(`<td>${property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</td>`).test(m[2]));
  return tr ? [...tr[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]) : undefined;
};

describe("stage 05 spec fits one printed A4 landscape page (whole sheet)", () => {
  it("prints the whole 05 spec sheet on one page, with every reference and unresolved item still present", async () => {
    // @ts-expect-error: the shared e2e helper is plain JS
    const { launch } = await import("./browser.mjs");
    const browser = await launch();
    try {
      const page = await browser.newPage();
      await page.goto(`file://${join(outDir, slugOf("05"), "spec.html")}`);
      const pdf: Buffer = await page.pdf({ preferCSSPageSize: true });
      // the page count of the printed PDF, independent of the renderer: one /Type /Page object
      expect((pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
    } finally {
      await browser.close();
    }
  }, 60000);

  it("keeps every fact: each [n] reference resolves, and the cable's long sources are in the reference list", () => {
    const html = read(slugOf("05"), "spec.html");
    const refs = [...html.matchAll(/<td>\[(\d+)\]<\/td>/g)].map((m) => Number(m[1]));
    const list = [...(/<ol class="notes">([\s\S]*?)<\/ol>/.exec(html)?.[1] ?? "").matchAll(/<li>/g)].length;
    expect(refs.length).toBeGreaterThan(0);
    expect(Math.max(...refs)).toBe(list);
    expect(html).toContain("heated length 42.5 m"); // the carton text, whole, in the reference list
    expect(html).toContain("coverage 3.7–5.1 m²");
  });
});

describe("compact heating keeps the problem messages (stage 05)", () => {
  it("prints the coverage warning with its figures, in the spec's Unresolved list and in the index", () => {
    // independent figure: the room is 2.11 m × 3.02 m less the bath keep-out (1.028 × 1.018 m)
    const room = SAMPLE.rooms.find((r) => r.heating)!;
    const area = Math.round((room.w * room.h - 1.028 * 1.018) * 1e4) / 1e4;
    expect(area).toBe(5.3257);
    const unresolved = /<h2>Unresolved in this view[\s\S]*$/.exec(read(slugOf("05"), "spec.html"))![0];
    expect(unresolved).toMatch(/heating_coverage_range: Zone area excluding entered keep-outs 5\.3257 m²/);
    expect(unresolved).toContain("3.7–5.1 m²");
    const md = readFileSync(join(outDir, "README.md"), "utf8");
    const section = md.slice(md.indexOf(`## ${PHASES.find((p) => p.slug === slugOf("05"))!.label}`), md.indexOf(`## ${PHASES.find((p) => p.slug === slugOf("06"))!.label}`));
    expect(section).toMatch(/heating_coverage_range: Zone area excluding entered keep-outs 5\.3257 m²/);
    // every problem code on the compact row has its message listed
    const html = read(slugOf("05"), "spec.html");
    const cell = specCells(html, "room:bathroom:heating", "open item codes (see Unresolved)")![1];
    // a long cell prints as [n]: resolve it through the reference list
    const ref = /^\[(\d+)\]$/.exec(cell);
    const value = ref ? [...(/<ol class="notes">([\s\S]*?)<\/ol>/.exec(html)![1]).matchAll(/<li>([\s\S]*?)<\/li>/g)][Number(ref[1]) - 1][1] : cell;
    const codes = value.split(", ");
    expect(codes.length).toBeGreaterThan(0);
    for (const c of new Set(codes)) expect(unresolved, c).toContain(`heating cable: ${c}:`);
  });
});

describe("plan cable annotation agrees with the spec (stage 05)", () => {
  it("prints the plan route length with its MOD tag and names the datum, as the spec does", () => {
    const room = SAMPLE.rooms.find((r) => r.heating)!;
    const path = room.heating!.path;
    // independent: the XY length of the recorded 30-point route
    const length = path.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - path[i].x, p.y - path[i].y), 0);
    expect(length).toBeCloseTo(42.5, 3);
    const plan = flat(read(slugOf("05"), "plan.svg"));
    expect(plan).toMatch(/PROPOSED CABLE: route length along the drawn path in plan \(XY projection\) 42\.5 m MOD; along the sampled cable profile \? ;? ?trade review pending|PROPOSED CABLE: route length along the drawn path in plan \(XY projection\) 42\.5 m MOD; along the sampled cable profile \?; trade review pending/);
    const row = specCells(read(slugOf("05"), "spec.html"), "room:bathroom:heating", "plan route length (m)")!;
    expect(row[1]).toBe("42.5");
    expect(row[2]).toBe("MOD modelled");
  });
});

describe("fit-out elevations print no stand-in heights and no unsupported set-out (stage 09)", () => {
  // sample items whose kind carries a catalogue elevation stand-in and whose record has no elevation
  const standIns = ["bath_mixer", "bath_waste", "basin_mixer", "shower_system", "shower_mixer", "towel_rail", "towel_rail_2", "shaving_cabinet"];
  const svgs = () => ["wall_n", "wall_e", "wall_s", "wall_w"].map((w) => read(slugOf("09"), `elevation-${w}-right.svg`));

  it("draws none of them, and lists each with '?' for its height", () => {
    expect(SAMPLE.items.filter((i) => standIns.includes(i.id)).every((i) => !i.productSpecification?.fields.elevation || i.productSpecification.fields.elevation.value === null)).toBe(true);
    for (const svg of svgs()) for (const id of standIns) expect(svg, id).not.toMatch(new RegExp(`<rect[^>]*data-element="item:${id}"`));
    const north = flat(read(slugOf("09"), "elevation-wall_n-right.svg"));
    const east = flat(read(slugOf("09"), "elevation-wall_e-right.svg"));
    // owner, 7 Oct 2026: the bath set moved to the right wall, so no fitting is on the window wall
    expect(north).not.toMatch(/Bath mixer/);
    expect(east).toMatch(/Bath mixer and spout: position along the face \? \(no wall set-out recorded\) · height \? · elevation above the finished floor is not recorded/);
    for (const label of ["Bath waste"]) expect(north).toMatch(new RegExp(`${label}: position along the face \\? \\(no wall set-out recorded\\) · height \\? · elevation above the finished floor is not recorded`));
    // the old catalogue stand-ins (mixer 800 plate / 865 envelope, waste 590) are not printed anywhere
    for (const svg of svgs()) expect(flat(svg)).not.toMatch(/\b(748|865|590–|590 [A-Z?]|1200 [A-Z?] to)/);
  });

  it("agrees with the spec: no sample fixture has a wall anchor, so none prints a set-out from end A", () => {
    expect(SAMPLE.items.some((i) => i.anchor)).toBe(false);
    const spec = read(slugOf("09"), "spec.html");
    for (const it of SAMPLE.items) expect(specCells(spec, `item:${it.id}`, "set-out")?.[1], it.id).toBe("?");
    for (const svg of svgs()) {
      const text = flat(svg);
      expect(text).not.toMatch(/\d from finished face at A/); // no number "from <face> at A" for an unanchored fixture
      const rows = text.match(/F\d+ [A-Z][^:]*: position along the face[^·]*/g) ?? [];
      for (const r of rows) expect(r).toContain("? (no wall set-out recorded)");
    }
    expect(flat(read(slugOf("09"), "plan.svg"))).not.toMatch(/\d+ \w+ from [A-B] · \d+/);
  });

  it("keeps the floor-standing fixtures it can place, with the weakest status of the floor and the envelope", () => {
    // the vanity stands on the proposed finished floor (tile 0 P) and its measured 850 height: the top is no stronger than P
    const east = flat(read(slugOf("09"), "elevation-wall_e-right.svg"));
    expect(east).toMatch(/F9 Vanity: position along the face \? \(no wall set-out recorded\) · 0 P to 850 P above existing floor surface/);
    expect(SAMPLE.items.find((i) => i.id === "vanity")!.productIdentity).toBeDefined();
  });
});

describe("a recorded elevation is drawn with its own status (real elevation path)", () => {
  it("draws the sample's bath mixer once its record carries a proposed elevation, tagged P, and never from the kind", () => {
    const model = structuredClone(SAMPLE);
    const mixer = model.items.find((i) => i.id === "bath_mixer")!;
    mixer.productSpecification!.fields.elevation = { value: 0.9, status: "proposed", note: "owner" };
    const els = resolveVisible(model, ["walls", "rooms", "floor-substrate", "floor-tile", "fixtures"]).elements;
    const svg = renderStageElevation(model, els, "wall_e", "right", { label: "t", findings: [] });
    expect(svg).toMatch(/<rect[^>]*stroke-dasharray="1.2 0.6"[^>]*data-element="item:bath_mixer"/);
    // floor top P (tile 0) + recorded 900 = 900, no stronger than P; top adds the published envelope height
    expect(flat(svg)).toMatch(/F2 Bath mixer and spout: position along the face \? \(no wall set-out recorded\) · 900 P to \d+(\.\d)? P above/);
  });
});

describe("every number on the stage-pack plan and elevation labels carries one status tag", () => {
  const stages = PHASES.map((p) => p.slug);
  /** label families the sheets print for a dimension; wrapped panel rows are checked through the flattened text */
  const untagged = (t: string) => {
    const s = t.replace(/(-?\d+(?:\.\d+)?) \/ (-?\d+(?:\.\d+)?)/g, "$2").replace(/(-?\d+(?:\.\d+)?)–(-?\d+(?:\.\d+)?)/g, "$2");
    return [...s.matchAll(new RegExp(`(-?\\d+(?:\\.\\d+)?)(?![\\d.])(?! ?(?:m |mm )?${TAG}(?![A-Za-z]))`, "g"))].map((m) => m[1]);
  };
  it("plan labels: wall run, opening width, centre line, fixture set-out, waste level, fall, cable length", () => {
    for (const slug of stages) {
      const texts = [...read(slug, "plan.svg").matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => flat(m[1]));
      for (const t of texts.filter((x) => !x.startsWith("•") && /^(W|D) \d|^c\/l |A→B|FL |: fall |BOTTOM |from [A-B] ·|PROPOSED CABLE/.test(x) || /^\d+ (ENT|E) · /.test(x))) {
        const bare = untagged(t.replace(/^.* (?=FL )/, "").replace(/^PROPOSED CABLE: .*?\(XY projection\)/, "PROPOSED CABLE:").replace(/ENT · [a-z]+ A→B \(.*\)$/, "ENT").replace(/[A-Za-z]+ \d{2,}[ -][^,]*,/g, ""));
        expect(bare, `${slug}: ${t}`).toEqual([]);
      }
    }
  });
  it("elevation labels: openings, jambs, sill, floor levels, wall height, run, fixture positions and heights, service heights", () => {
    for (const slug of stages) for (const w of ["wall_n", "wall_e", "wall_s", "wall_w"]) {
      const svg = read(slug, `elevation-${w}-right.svg`);
      const texts = [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => flat(m[1]));
      for (const t of texts.filter((x) => /^(DOOR|WINDOW) |^sill |^jambs |wall height above|between .* of the return walls| AFF$/.test(x) || /^[^:]+ [+-]?\d+ (SC|M|PUB|P|E|ENT|DER|\?)$/.test(x))) {
        expect(untagged(t.replace(/^(DOOR|WINDOW) /, "").replace(/^.* (?=[+-]\d+ \S+$)/, "").replace(/^(\d+) between .* \((\S+)\)$/, "$1 $2")), `${slug}/${w}: ${t}`).toEqual([]);
      }
      // fixture rows in the panel: the 'F<n> <name>: <span> · <heights> · note' text, with the note and its words excluded
      for (const m of flat(svg).matchAll(/F\d+ [A-Z][A-Za-z ]+: ([^·]+) · ([^·]+?) above /g)) {
        expect(untagged(m[1]), `${slug}/${w}: ${m[0]}`).toEqual([]);
        expect(untagged(m[2]), `${slug}/${w}: ${m[0]}`).toEqual([]);
      }
    }
  });
});
