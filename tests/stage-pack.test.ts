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
import { PHASES, composePhase, countUnknown, indexMarkdown, writePhase } from "../scripts/stage-pack";

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
