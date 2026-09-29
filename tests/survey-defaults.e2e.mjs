import { chromium } from "playwright";
import { strict as assert } from "node:assert";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
try {
  await page.goto(process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5199/");
  await page.getByLabel("New project name").fill("Synthetic survey");
  await page.getByRole("button", { name: "Create blank" }).click();
  const run = (name, args = {}) => page.evaluate(([tool, input]) => window.__alza.runTool(tool, input), [name, args]);
  const wall = await run("add_wall", { ax: 0, ay: 0, bx: 4, by: 0 });
  assert.equal(wall.ok, true);
  const door = await run("add_door", { wallId: wall.id, centre: 1, height: 2.05 });
  const window = await run("add_window", { wallId: wall.id, centre: 3, width: 0.8, height: 1.1 });
  assert.equal(door.ok && window.ok, true);
  const model = (await run("get_model")).model;
  assert.deepEqual(model.walls[0].dimensionStatus, { thickness: "defaulted", height: "defaulted" });
  assert.deepEqual(model.openings.map((o) => o.dimensionStatus), [
    { width: "defaulted", height: "entered" },
    { width: "entered", sill: "defaulted", height: "entered" },
  ]);
  const codes = (await run("get_issues")).issues.map((i) => i.code);
  for (const code of ["wall_thickness_default", "wall_height_default", "opening_width_default", "opening_sill_default"]) assert.ok(codes.includes(code), code);
  assert.ok(!codes.includes("opening_height_default"));
  await page.locator(`[data-id="${wall.id}"]`).first().click();
  assert.match(await page.getByLabel("Selected wall").textContent(), /Thickness: default placeholder/);
  await run("edit_wall", { id: wall.id, thickness: 0.15 });
  await run("edit_opening", { id: window.id, sill: 0.9 });
  await page.reload();
  await page.locator(".project-card").filter({ hasText: "Synthetic survey" }).getByRole("button", { name: "Open" }).click();
  const after = (await run("get_model")).model;
  assert.deepEqual(after.walls[0].dimensionStatus, { thickness: "entered", height: "defaulted" });
  assert.deepEqual(after.openings[1].dimensionStatus, { width: "entered", sill: "entered", height: "entered" });
  assert.equal(after.openings[0].dimensionStatus.width, "defaulted");
  await page.getByRole("button", { name: "Projects" }).click();
  const card = page.locator(".project-card").filter({ hasText: "Synthetic survey" });
  const downloadEvent = page.waitForEvent("download");
  await card.getByRole("button", { name: "Export JSON" }).click();
  const backup = await downloadEvent;
  const backupPath = await backup.path();
  const { readFileSync } = await import("node:fs");
  const exported = JSON.parse(readFileSync(backupPath, "utf8"));
  assert.equal(exported.model.walls[0].thicknessDefaulted, false);
  assert.equal(exported.model.walls[0].heightDefaulted, true);
  await page.getByLabel("Import project JSON").setInputFiles(backupPath);
  await page.getByLabel("Name for imported copy").fill("Imported survey");
  await page.getByRole("button", { name: "Import as new project" }).click();
  const imported = (await run("get_model")).model;
  assert.deepEqual(imported.walls[0].dimensionStatus, { thickness: "entered", height: "defaulted" });
  assert.equal(imported.openings[0].dimensionStatus.width, "defaulted");
  console.log("PASS: browser tool readback, warnings, inspector, independent edits, reload, export/import");
} finally {
  await browser.close();
}
