import { chromium } from "playwright";
import { strict as assert } from "node:assert";

const baseUrl = process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5173/";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
await context.addInitScript(() => {
  Object.defineProperty(document, "modelContext", { value: {
    registerTool(tool) { (window.__registeredTools ??= []).push(tool); },
  } });
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.goto(baseUrl);
  await page.getByLabel("New project name").fill("Bathroom Survey");
  await page.getByRole("button", { name: "Create blank" }).click();
  assert.equal(await page.locator(".brand-plan").textContent(), "Bathroom Survey");
  await page.getByRole("button", { name: "+ Wall" }).click();
  const svg = page.locator(".editor-svg");
  await svg.click({ position: { x: 230, y: 220 } });
  await svg.click({ position: { x: 450, y: 220 } });
  const wallCount = await page.evaluate(() => window.__alza.store.getState().model.walls.length);
  assert.equal(wallCount, 1, "UI drew one wall");
  const note = await page.evaluate(async () => JSON.parse(await window.__registeredTools.find((tool) => tool.name === "leave_note").execute({ text: "Check window height on site." })));
  assert.equal(note.ok, true);
  const kind = await page.evaluate(() => window.__alza.runTool("define_item_kind", {
    kind: "survey_vanity", label: "Survey vanity", w: 0.91, d: 0.465, h: 0.85,
  }));
  assert.equal(kind.ok, true);
  await page.getByRole("button", { name: "Model" }).click();
  await page.locator(".field").filter({ hasText: "Blueprint underlay" }).locator('input[type="file"]').setInputFiles({ name: "survey.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=", "base64") });
  await page.waitForFunction(() => Boolean(window.__alza.store.getState().model.underlay));
  await page.getByRole("button", { name: "Build 3D" }).click();
  assert.equal(await page.locator(".canvas-area canvas").count(), 1);

  await page.getByRole("button", { name: "Projects" }).click();
  const demo = page.locator(".project-card").filter({ hasText: "Sunset Loft" });
  await demo.getByRole("button", { name: "Open" }).click();
  const demoState = await page.evaluate(() => ({ model: window.__alza.store.getState().model, notes: window.__alza.store.getState().notes }));
  assert.equal(demoState.model.walls.length, 7);
  assert.equal(demoState.notes.length, 0);

  await page.getByRole("button", { name: "Projects" }).click();
  await page.locator(".project-card").filter({ has: page.getByText("Bathroom Survey", { exact: true }) }).getByRole("button", { name: "Open" }).click();
  await page.reload();
  assert.equal(await page.getByRole("heading", { name: "Choose a plan" }).count(), 1);
  const survey = page.locator(".project-card").filter({ hasText: "Bathroom Survey" });
  const downloadEvent = page.waitForEvent("download");
  await survey.getByRole("button", { name: "Export JSON" }).click();
  const download = await downloadEvent;
  const filePath = await download.path();
  const { readFileSync } = await import("node:fs");
  const exported = JSON.parse(readFileSync(filePath, "utf8"));
  assert.equal(exported.version, 1);
  assert.equal(exported.model.walls.length, 1);
  assert.equal(exported.notes.length, 1);
  assert.equal(exported.kinds[0].entry.kind, "survey_vanity");
  assert.ok(exported.model.underlay.dataUrl.startsWith("data:image/jpeg"));
  await survey.getByRole("button", { name: "Open" }).click();
  assert.equal(await page.evaluate(() => window.__alza.store.getState().model.walls.length), 1);
  assert.equal(await page.evaluate(() => window.__alza.store.getState().notes.length), 1);
  assert.equal(await page.evaluate(() => window.__alza.store.getState().kinds[0].entry.kind), "survey_vanity");
  await page.getByRole("button", { name: "Build 3D" }).click();
  assert.equal(await page.locator(".canvas-area canvas").count(), 1);

  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByLabel("Import project JSON").setInputFiles(filePath);
  await page.getByLabel("Name for imported copy").fill("Bathroom Survey Copy");
  await page.getByRole("button", { name: "Import as new project" }).click();
  assert.equal(await page.locator(".brand-plan").textContent(), "Bathroom Survey Copy");
  await page.evaluate(() => window.__alza.runTool("add_wall", { ax: 0, ay: 0, bx: 2, by: 0 }));
  assert.equal(await page.evaluate(() => window.__alza.store.getState().model.walls.length), 2);
  await page.getByRole("button", { name: "Projects" }).click();
  await page.locator(".project-card").filter({ has: page.getByText("Bathroom Survey", { exact: true }) }).getByRole("button", { name: "Open" }).click();
  assert.equal(await page.evaluate(() => window.__alza.store.getState().model.walls.length), 1);
  await page.getByRole("button", { name: "Projects" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".project-card").filter({ has: page.getByText("Bathroom Survey Copy", { exact: true }) }).getByRole("button", { name: "Delete" }).click();
  assert.equal(await page.getByText("Bathroom Survey Copy", { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  const corruptContext = await browser.newContext({ acceptDownloads: true });
  await corruptContext.addInitScript(() => localStorage.setItem("alza.projects.v1", '{"version":0,"projects":[]}'));
  const corruptPage = await corruptContext.newPage();
  await corruptPage.goto(baseUrl);
  assert.match(await corruptPage.getByRole("alert").textContent(), /Unsupported or unreadable saved library/);
  assert.equal(await corruptPage.evaluate(() => localStorage.getItem("alza.projects.v1")), '{"version":0,"projects":[]}');
  await corruptContext.close();
  console.log("PASS: UI wall, registered tool note, custom kind, underlay, 3D, demo isolation, reload, export/import, independent edits, deletion, old data protection");
} finally {
  await browser.close();
}
