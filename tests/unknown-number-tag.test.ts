/**
 * D-ENG-071: a value that has a number but whose status is unknown prints that number with its
 * `?` tag, on the plan, the elevation and the specification alike. A missing value prints `?`
 * alone and never gains a number.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { demoProject } from "../src/model/projects";
import { renderStageDiagram, renderStageSpec, resolveVisible } from "../src/sheets/stageView";
import { renderStageElevation } from "../src/sheets/stageElevation";
import { tag } from "../src/sheets/floorPlan";

const sample = () => demoProject().model;
const opts = { label: "D-ENG-071", findings: [] };
const flat = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const rowFor = (html: string, property: string) =>
  html.split("</tr>").find((row) => row.includes(`<td>${property}</td>`))!;

describe("unknown measurements print their number with the ? tag", () => {
  it("agrees across the plan, elevation and specification for the sample window", () => {
    const model = sample();
    const elements = resolveVisible(model, ["walls", "wall-frame", "rooms", "doors", "windows", "floor-substrate"]).elements;
    const width = renderStageSpec(model, elements, opts).rows.find((r) => r.element === "opening:window_n" && r.property === "width (mm)")!;
    expect(width).toMatchObject({ value: "1810", status: "unknown" });

    const printed = `${width.value} ${tag(width.status)}`;
    expect(printed).toBe("1810 ?");
    expect(renderStageDiagram(model, elements, opts)).toContain(`W ${printed}`);
    expect(renderStageElevation(model, elements, "wall_n", "right", opts)).toContain(`WINDOW ${printed}`);

    const specRow = rowFor(renderStageSpec(model, elements, opts).html, "width (mm)");
    expect(flat(specRow)).toContain(printed);
    expect(flat(specRow).match(/\?/g)).toHaveLength(1);
  });

  it("prints a null value as ? alone, with no invented number", () => {
    const model = sample();
    const bath = resolveVisible(model, ["fixtures"]).elements.find((el) => el.ref === "bath")!;
    const spec = renderStageSpec(model, [bath], opts);
    const row = spec.rows.find((r) => r.property === "wasteConnectionDiameter")!;
    expect(row).toMatchObject({ value: "?", status: "unknown" });
    expect(row.value).not.toMatch(/\d/);
    const htmlRow = rowFor(spec.html, "wasteConnectionDiameter");
    expect(htmlRow).toContain("<td>?</td><td>? unknown</td>");
  });

  it("states the ruling in AGENTS.md", () => {
    const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
    expect(agents).toContain("Decision D-ENG-071");
    expect(agents).toContain("1810 ?");
    expect(agents).toMatch(/missing\s+\(null, no number\) prints `\?` alone/);
    expect(agents).not.toContain('Outputs print unknowns as "?"');
  });
});
