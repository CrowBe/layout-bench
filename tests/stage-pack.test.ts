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
import { PHASES, composePhase, countUnknown, generatePack, indexMarkdown, selectPhases, swapDir, writePhase, type Phase } from "../scripts/stage-pack";

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

  it("regenerates only the filtered phase and keeps every phase in the index", async () => {
    outDir = mkdtempSync(join(tmpdir(), "stage-pack-filter-"));
    const full = await generatePack({ outDir, phases, previews: false, date: "2026-10-05" });
    expect(full.map((w) => w.phase.slug)).toEqual(["01-post-demolition", "02-second-look"]);
    writeFileSync(join(outDir, "01-post-demolition", "plan.png"), "png");
    writeFileSync(join(outDir, "01-post-demolition", "MARK"), "untouched");

    const filtered = await generatePack({ outDir, only: ["02"], phases, previews: false, date: "2026-10-05" });
    expect(filtered.map((w) => w.phase.slug)).toEqual(["02-second-look"]);
    expect(readFileSync(join(outDir, "01-post-demolition", "MARK"), "utf8")).toBe("untouched");
    const md = readFileSync(join(outDir, "README.md"), "utf8");
    expect(md).toContain(`## ${phases[0].label}`);
    expect(md).toContain(`## ${phases[1].label}`);
    // the skipped phase keeps its existing preview in the index
    expect(md).toContain("![Plan](01-post-demolition/plan.png)");
    expect(md).toBe(indexMarkdown(full.map((w, i) => i === 0 ? { ...w, files: w.files.map((f) => f.name === "plan.svg" ? { ...f, png: "plan.png" } : f) } : w)));
  });
});

