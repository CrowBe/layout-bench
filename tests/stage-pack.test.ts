/**
 * Stage pack generator: unknown counts stay status-honest, and a failed render must not
 * wipe the previous phase folder. Tests go through composePhase / writePhase / indexMarkdown
 * and the real sheet builders, not a reimplemented pack.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoProject } from "../src/model/projects";
import type { PlanModel } from "../src/model/types";
import { renderStageSpec } from "../src/sheets/stageView";
import { resetViews } from "../src/sheets/viewState";
import { PHASES, composePhase, countUnknown, generatePack, indexMarkdown, invokedAsCli, localDate, packDate, selectPhases, swapDir, writePhase, type Phase } from "../scripts/stage-pack";

beforeEach(() => resetViews());

function titledSample(): PlanModel {
  const model = structuredClone(demoProject().model);
  model.sheetSet = { titleBlock: { project: model.name, site: "Bathroom (no site address recorded)" }, revisions: [] };
  return model;
}

describe("stage pack unknown count", () => {
  it("matches the spec's unknown statuses, including numeric values tagged unknown", async () => {
    const model = titledSample();
    const phase = PHASES[0];
    const { composed, acknowledged } = composePhase("pack-unknown", model, phase);
    const spec = renderStageSpec(model, composed.resolution.elements, { label: phase.label, findings: composed.findings });
    const unknownStatus = spec.rows.filter((r) => r.status === "unknown");
    const questionValues = spec.rows.filter((r) => r.value === "?");
    expect(unknownStatus.length).toBeGreaterThan(questionValues.length);
    expect(unknownStatus.some((r) => r.value !== "?")).toBe(true);
    expect(unknownStatus.map((r) => r.property).sort()).toEqual(expect.arrayContaining([
      "thickness (mm)", "height (mm)", "width (mm)", "sill above floor (mm)",
    ]));

    const outDir = mkdtempSync(join(tmpdir(), "stage-pack-unknown-"));
    try {
      const written = await writePhase(phase, {
        model, elements: composed.resolution.elements, findings: composed.findings, acknowledged, date: "2026-10-05", outDir,
      });
      expect(written.unknown).toBe(unknownStatus.length);
      expect(written.unknown).toBe(countUnknown(spec.rows));
      expect(countUnknown(spec.rows)).toBe(spec.rows.filter((r) => r.status === "unknown" || r.value === "?").length);
      const md = indexMarkdown([written]);
      expect(md).toContain(`Specification: ${spec.rows.length} row(s), ${unknownStatus.length} unknown.`);
      expect(md).not.toContain(`Specification: ${spec.rows.length} row(s), ${questionValues.length} unknown.`);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe("stage pack atomic phase write", () => {
  let outDir: string;
  afterEach(() => { if (outDir) rmSync(outDir, { recursive: true, force: true }); });

  it("leaves the previous phase folder untouched when a later render fails", async () => {
    const model = titledSample();
    const phase = PHASES[0];
    const { composed, acknowledged } = composePhase("pack-atomic-fail", model, phase);
    outDir = mkdtempSync(join(tmpdir(), "stage-pack-atomic-"));
    const dest = join(outDir, phase.slug);
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "KEEP.txt"), "previous pack");
    writeFileSync(join(dest, "plan.svg"), "<svg>old</svg>");

    await expect(writePhase(phase, {
      model, elements: composed.resolution.elements, findings: composed.findings, acknowledged, date: "2026-10-05", outDir,
      previews: async () => { throw new Error("chromium failed"); },
    })).rejects.toThrow(/chromium failed/);

    expect(readFileSync(join(dest, "KEEP.txt"), "utf8")).toBe("previous pack");
    expect(readFileSync(join(dest, "plan.svg"), "utf8")).toBe("<svg>old</svg>");
    expect(existsSync(join(outDir, `.${phase.slug}.tmp`))).toBe(false);
    expect(existsSync(`${dest}.bak`)).toBe(false);
  });

  it("swaps the new phase folder into place only after every output succeeds", async () => {
    const model = titledSample();
    const phase = PHASES[0];
    const { composed, acknowledged } = composePhase("pack-atomic-ok", model, phase);
    outDir = mkdtempSync(join(tmpdir(), "stage-pack-swap-"));
    const dest = join(outDir, phase.slug);
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "KEEP.txt"), "previous pack");

    const written = await writePhase(phase, {
      model, elements: composed.resolution.elements, findings: composed.findings, acknowledged, date: "2026-10-05", outDir,
    });
    expect(existsSync(join(dest, "KEEP.txt"))).toBe(false);
    expect(readFileSync(join(dest, "plan.svg"), "utf8")).toContain("data-sheet=\"stage-view\"");
    expect(readFileSync(join(dest, "spec.html"), "utf8")).toContain("data-sheet=\"stage-spec\"");
    expect(written.files.map((f) => f.name)).toEqual(expect.arrayContaining(["plan.svg", "spec.html"]));
    expect(existsSync(join(outDir, `.${phase.slug}.tmp`))).toBe(false);
  });
});

describe("stage pack swap recovery", () => {
  let outDir: string;
  afterEach(() => { if (outDir) rmSync(outDir, { recursive: true, force: true }); });

  it("restores the only copy from .bak after an interrupted swap, then replaces it", () => {
    outDir = mkdtempSync(join(tmpdir(), "stage-pack-bak-"));
    const dest = join(outDir, "01-phase");
    // an earlier swap moved dest aside and died before the new folder landed
    mkdirSync(`${dest}.bak`, { recursive: true });
    writeFileSync(join(`${dest}.bak`, "plan.svg"), "<svg>only copy</svg>");
    const tmp = join(outDir, ".01-phase.tmp");
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, "plan.svg"), "<svg>new</svg>");

    swapDir(tmp, dest);
    expect(readFileSync(join(dest, "plan.svg"), "utf8")).toBe("<svg>new</svg>");
    expect(existsSync(`${dest}.bak`)).toBe(false);
  });

  it("keeps the restored copy when the new folder cannot be swapped in", () => {
    outDir = mkdtempSync(join(tmpdir(), "stage-pack-bak-fail-"));
    const dest = join(outDir, "01-phase");
    mkdirSync(`${dest}.bak`, { recursive: true });
    writeFileSync(join(`${dest}.bak`, "plan.svg"), "<svg>only copy</svg>");

    expect(() => swapDir(join(outDir, "missing.tmp"), dest)).toThrow();
    expect(readFileSync(join(dest, "plan.svg"), "utf8")).toBe("<svg>only copy</svg>");
  });
});

describe("stage pack phase filter and index", () => {
  let outDir: string;
  afterEach(() => { if (outDir) rmSync(outDir, { recursive: true, force: true }); });
  const phases: Phase[] = [PHASES[0], { ...PHASES[0], slug: "02-second-look", label: "2. Second look at the frame" }];

  it("rejects a filter that matches no phase, writing nothing", async () => {
    expect(() => selectPhases(["99"], phases)).toThrow(/No phase matches 99/);
    outDir = mkdtempSync(join(tmpdir(), "stage-pack-nomatch-"));
    await expect(generatePack({ outDir, only: ["99"], phases, previews: false, date: "2026-10-05" })).rejects.toThrow(/No phase matches/);
    expect(existsSync(join(outDir, "README.md"))).toBe(false);
  });

  it("regenerates only the filtered phase and keeps every phase in the index, read from disk", async () => {
    outDir = mkdtempSync(join(tmpdir(), "stage-pack-filter-"));
    const full = await generatePack({ outDir, phases, previews: false, date: "2026-10-05" });
    expect(full.map((w) => w.phase.slug)).toEqual(["01-post-demolition", "02-second-look"]);
    const fullMd = readFileSync(join(outDir, "README.md"), "utf8");
    expect(fullMd).toContain(`Specification: ${full[0].rows} row(s), ${full[0].unknown} unknown.`);
    writeFileSync(join(outDir, "01-post-demolition", "plan.png"), "png");
    writeFileSync(join(outDir, "01-post-demolition", "MARK"), "untouched");

    const filtered = await generatePack({ outDir, only: ["02"], phases, previews: false, date: "2026-10-05" });
    expect(filtered.map((w) => w.phase.slug)).toEqual(["02-second-look"]);
    expect(readFileSync(join(outDir, "01-post-demolition", "MARK"), "utf8")).toBe("untouched");
    const md = readFileSync(join(outDir, "README.md"), "utf8");
    // same files on disk, same index, plus the preview that now exists for the skipped phase
    expect(md).toBe(fullMd.replace("[plan.svg](01-post-demolition/plan.svg)\n", "[plan.svg](01-post-demolition/plan.svg)\n\n![Plan](01-post-demolition/plan.png)\n"));
  });

  it("indexes a skipped phase from its committed sheets, not the current model, and lists a missing phase as not generated", async () => {
    outDir = mkdtempSync(join(tmpdir(), "stage-pack-disk-"));
    const three: Phase[] = [...phases, { ...PHASES[0], slug: "03-never-run", label: "3. Never generated" }];
    await generatePack({ outDir, only: ["01", "02"], phases: three, previews: false, date: "2026-10-05" });

    // the committed phase 01 sheets now differ from what the model would render: one row and one
    // elevation fewer, and an extra open item
    const dir = join(outDir, "01-post-demolition");
    const spec = readFileSync(join(dir, "spec.html"), "utf8");
    const rows = [...spec.matchAll(/<tr data-element="[^"]*"[^>]*>[\s\S]*?<\/tr>/g)];
    const unknownBefore = rows.filter((r) => r[0].includes(' class="unknown"') || /<td>\? unknown<\/td>/.test(r[0])).length;
    const dropped = rows.find((r) => /<td>\? unknown<\/td>/.test(r[0]) && !r[0].includes("rowspan"))![0];
    writeFileSync(join(dir, "spec.html"), spec.replace(dropped, "").replace(/<h2>Unresolved in this view \(\d+\)<\/h2><ul>/, '<h2>Unresolved in this view (1)</h2><ul><li>Slab level &amp; falls to confirm</li>'));
    rmSync(join(dir, "elevation-wall_w-right.svg"));

    await generatePack({ outDir, only: ["02"], phases: three, previews: false, date: "2026-10-05" });
    const md = readFileSync(join(outDir, "README.md"), "utf8");
    const section = md.slice(md.indexOf(`## ${three[0].label}`), md.indexOf(`## ${three[1].label}`));
    expect(section).toContain(`Specification: ${rows.length - 1} row(s), ${unknownBefore - 1} unknown.`);
    expect(section).toContain("- Slab level & falls to confirm");
    expect(section).not.toContain("elevation-wall_w-right.svg");
    expect(section).toContain("elevation-wall_n-right.svg");
    // the phase never written is listed, with nothing linked
    const missing = md.slice(md.indexOf(`## ${three[2].label}`));
    expect(missing).toContain("Not generated yet.");
    expect(missing).not.toContain("03-never-run/");
    expect(existsSync(join(outDir, "03-never-run"))).toBe(false);
  });
});

describe("stage pack date", () => {
  it("builds the local date from its parts", () => {
    expect(localDate(new Date(2026, 0, 5, 7, 30))).toBe("2026-01-05");
    expect(localDate(new Date(2026, 9, 6, 0, 1))).toBe("2026-10-06");
  });

  it("uses a valid STAGE_PACK_DATE, ignores an empty one and rejects a malformed one", () => {
    const now = new Date(2026, 9, 6, 8, 0);
    expect(packDate("2026-10-05", now)).toBe("2026-10-05");
    expect(packDate("", now)).toBe("2026-10-06");
    expect(packDate("   ", now)).toBe("2026-10-06");
    expect(packDate(undefined, now)).toBe("2026-10-06");
    for (const bad of ["10/5/2026", "2026-13-01", "2026-02-30", "2026-1-5"]) expect(() => packDate(bad, now)).toThrow(/YYYY-MM-DD/);
  });
});

describe("stage pack CLI gate", () => {
  it("runs the script through vite-node --script, which sets argv[1] to it", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
    expect(pkg.scripts["stage-pack"]).toBe("vite-node --script scripts/stage-pack.ts");
  });

  it("generates only when argv[1] is this script", () => {
    expect(invokedAsCli(join(__dirname, "..", "scripts", "stage-pack.ts"))).toBe(true);
    // what argv[1] is without --script: the vite-node binary, so the pack would silently not run
    expect(invokedAsCli(join(__dirname, "..", "node_modules", "vite-node", "vite-node.mjs"))).toBe(false);
    expect(invokedAsCli(undefined)).toBe(false);
  });
});

describe("stage pack not-modelled list", () => {
  let outDir: string;
  afterEach(() => { if (outDir) rmSync(outDir, { recursive: true, force: true }); });
  const notModelledOf = (md: string, label: string) => {
    const section = md.slice(md.indexOf(`## ${label}`));
    const block = section.slice(section.indexOf("Not modelled (never drawn):")).split("\n").slice(2);
    const end = block.findIndex((l) => !l.startsWith("- "));
    return block.slice(0, end < 0 ? undefined : end).map((l) => l.slice(2));
  };
  const specList = (spec: string) => /Not modelled, so never listed: ([^<]*?)\.<\/p>/.exec(spec)![1].split("; ");

  it("prints the spec's full list in the README, qualifiers included", async () => {
    outDir = mkdtempSync(join(tmpdir(), "stage-pack-notmodelled-"));
    await generatePack({ outDir, previews: false, date: "2026-10-05" });
    const spec = readFileSync(join(outDir, PHASES[0].slug, "spec.html"), "utf8");
    const listed = notModelledOf(readFileSync(join(outDir, "README.md"), "utf8"), PHASES[0].label);
    expect(listed).toEqual(specList(spec));
    expect(listed.join("; ")).toContain("(only the points are modelled)");
  });

  it("keeps a long list whole even where the plan wraps it, and fails loudly when the spec has none", async () => {
    outDir = mkdtempSync(join(tmpdir(), "stage-pack-longlist-"));
    const two: Phase[] = [PHASES[0], { ...PHASES[0], slug: "02-second-look", label: "2. Second look at the frame" }];
    await generatePack({ outDir, phases: two, previews: false, date: "2026-10-05" });
    const dir = join(outDir, two[0].slug);
    const long = [
      "pipe and cable runs between service points (only the points are modelled)",
      "in-screed heating cable route (no route recorded, and the cable cannot be shortened)",
      "noggings and frame members behind the board (frame faces only, not studs)",
    ];
    expect(long.join("; ").length).toBeGreaterThan(129);
    const spec = readFileSync(join(dir, "spec.html"), "utf8");
    writeFileSync(join(dir, "spec.html"), spec.replace(/Not modelled, so never listed: [^<]*?\.<\/p>/, `Not modelled, so never listed: ${long.join("; ")}.</p>`));
    // the plan line as it prints when it wraps: split over two text elements
    const plan = readFileSync(join(dir, "plan.svg"), "utf8");
    writeFileSync(join(dir, "plan.svg"), plan.replace(/Not modelled, never drawn: [^<]*<\/text>/, "Not modelled, never drawn: pipe and cable runs between service points; in-screed</text><text>heating cable route.</text>"));

    await generatePack({ outDir, only: ["02"], phases: two, previews: false, date: "2026-10-05" });
    const md = readFileSync(join(outDir, "README.md"), "utf8");
    expect(notModelledOf(md, two[0].label)).toEqual(long);

    writeFileSync(join(dir, "spec.html"), spec.replace(/Not modelled, so never listed: [^<]*?\.<\/p>/, "</p>"));
    await expect(generatePack({ outDir, only: ["02"], phases: two, previews: false, date: "2026-10-05" })).rejects.toThrow(/no "Not modelled, so never listed" line/);
  });
});

