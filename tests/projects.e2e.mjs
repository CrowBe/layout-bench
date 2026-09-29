import { chromium } from "playwright";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const baseUrl = process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5199/";

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

async function exportObjNames() {
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export OBJ" }).click();
  const download = await downloadEvent;
  const contents = readFileSync(await download.path(), "utf8");
  return contents.split("\n").filter((line) => line.startsWith("o ")).map((line) => line.slice(2));
}

async function exportPng() {
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Snapshot PNG" }).click();
  const download = await downloadEvent;
  return readFileSync(await download.path());
}

async function nextSceneFrame() {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

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

  // A small authored room verifies the planning scene and its OBJ use the same decoration policy.
  const originalSurveyModel = await page.evaluate(() => structuredClone(window.__alza.store.getState().model));
  await page.evaluate(() => window.__alza.store.setState({ model: {
    name: "Small room",
    walls: [
      { id: "north", ax: 0, ay: 0, bx: 4, by: 0, thickness: 0.15, height: 2.7 },
      { id: "east", ax: 4, ay: 0, bx: 4, by: 3, thickness: 0.15, height: 2.7 },
      { id: "south", ax: 4, ay: 3, bx: 0, by: 3, thickness: 0.15, height: 2.7 },
      { id: "west", ax: 0, ay: 3, bx: 0, by: 0, thickness: 0.15, height: 2.7 },
    ],
    openings: [
      { id: "door_small", kind: "door", wallId: "south", t: 0.25, width: 0.9, sill: 0, height: 2.1 },
      { id: "window_small", kind: "window", wallId: "north", t: 0.5, width: 1.2, sill: 0.9, height: 1.2 },
    ],
    rooms: [{ id: "room_small", x: 0.075, y: 0.075, w: 3.85, h: 2.85, label: "Room", floor: "tile" }],
    items: [{ id: "fixture_authored", kind: "sofa", x: 2.4, y: 1.8, rotation: 0 }],
    underlay: null,
  } }));
  await page.getByLabel("3D presentation").selectOption("planning");
  await nextSceneFrame();
  const smallRoomPlanning = await exportObjNames();
  const smallRoomPlanningPng = await exportPng();
  assert.ok(smallRoomPlanning.includes("fixture_authored"), "authored fixture stays in the planning OBJ");
  assert.ok(smallRoomPlanning.some((name) => name === "north"), "authored walls stay in the planning OBJ");
  assert.ok(smallRoomPlanning.includes("door_small:frame") && smallRoomPlanning.includes("window_small:frame"),
    "authored openings stay in the planning OBJ");
  assert.ok(!smallRoomPlanning.some((name) => /pendant|curtain|skirting/.test(name)), "planning OBJ omits decoration");
  const smallRoomBefore = await page.evaluate(() => JSON.stringify(window.__alza.store.getState().model));
  await page.getByLabel("3D presentation").selectOption("styled");
  await nextSceneFrame();
  const smallRoomStyled = await exportObjNames();
  const smallRoomStyledPng = await exportPng();
  assert.ok(smallRoomStyled.some((name) => name.includes("pendant")), "styled presentation retains demo pendant");
  assert.notDeepEqual(smallRoomPlanningPng, smallRoomStyledPng, "PNG capture reflects the selected presentation");
  await page.getByLabel("3D presentation").selectOption("planning");
  assert.equal(await page.evaluate(() => JSON.stringify(window.__alza.store.getState().model)), smallRoomBefore,
    "changing presentation does not modify canonical plan geometry");
  await page.evaluate((model) => window.__alza.store.setState({ model }), originalSurveyModel);

  await page.getByRole("button", { name: "Projects" }).click();
  const demo = page.locator(".project-card").filter({ hasText: "Sunset Loft" });
  await demo.getByRole("button", { name: "Open" }).click();
  const demoState = await page.evaluate(() => ({ model: window.__alza.store.getState().model, notes: window.__alza.store.getState().notes }));
  assert.equal(demoState.model.walls.length, 7);
  assert.equal(demoState.notes.length, 0);
  assert.equal(await page.getByLabel("3D presentation").count(), 0);
  await page.getByRole("button", { name: "Build 3D" }).click();
  assert.equal(await page.getByLabel("3D presentation").inputValue(), "styled", "Sunset Loft retains its styled presentation");
  await page.getByLabel("3D presentation").selectOption("planning");
  await nextSceneFrame();
  const sunsetPlanning = await exportObjNames();
  assert.ok(sunsetPlanning.includes("item_sofa"), "authored Sunset Loft fixture remains visible");
  assert.ok(!sunsetPlanning.some((name) => /pendant|curtain|skirting/.test(name)), "planning mode hides Sunset Loft decoration");
  await page.getByRole("button", { name: "Projects" }).click();
  await page.reload();
  const persistedDemo = page.locator(".project-card").filter({ hasText: "Sunset Loft" });
  await persistedDemo.getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Build 3D" }).click();
  assert.equal(await page.getByLabel("3D presentation").inputValue(), "planning", "presentation persists across reload");

  await page.getByRole("button", { name: "Projects" }).click();
  await page.locator(".project-card").filter({ has: page.getByText("Bathroom Survey", { exact: true }) }).getByRole("button", { name: "Open" }).click();
  await page.reload();
  assert.equal(await page.getByRole("heading", { name: "Choose a plan" }).count(), 1);
  const survey = page.locator(".project-card").filter({ hasText: "Bathroom Survey" });
  const downloadEvent = page.waitForEvent("download");
  await survey.getByRole("button", { name: "Export JSON" }).click();
  const download = await downloadEvent;
  const filePath = await download.path();
  const exported = JSON.parse(readFileSync(filePath, "utf8"));
  assert.equal(exported.version, 1);
  assert.equal(exported.presentation, "planning");
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
