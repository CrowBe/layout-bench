import { chromium } from "playwright";
import { strict as assert } from "node:assert";

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
  assert.equal(exported.version, 2);
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

  const legacyLibrary = {
    version: 1,
    activeId: null,
    projects: [
      {
        version: 1,
        id: "sunset-loft",
        model: { name: "Sunset Loft", walls: [], openings: [], rooms: [], items: [], underlay: null },
        notes: [],
        kinds: [],
      },
      {
        version: 1,
        id: "survey-kept",
        model: {
          name: "Kept Survey",
          walls: [{ id: "w_kept", ax: 1.25, ay: 0.5, bx: 4.5, by: 0.5, thickness: 0.2, height: 2.4 }],
          openings: [{ id: "door_kept", kind: "door", wallId: "w_kept", t: 0.4, width: 0.9, sill: 0, height: 2.1, hinge: "a", side: "right" }],
          rooms: [{ id: "room_kept", x: 1, y: 1, w: 3, h: 2, label: "Survey room", floor: "tile" }],
          items: [{ id: "item_kept", kind: "desk", x: 2, y: 1.5, rotation: 90 }],
          underlay: { dataUrl: "data:image/png;base64,aaaa", opacity: 0.45, x: 0.1, y: 0.2, w: 6, h: 4 },
        },
        notes: [{ id: "note_kept", author: "human", text: "Leave this note", at: 1700000000000 }],
        kinds: [{ entry: { kind: "survey_vanity", label: "Survey vanity", w: 0.91, d: 0.465, h: 0.85 } }],
      },
    ],
  };
  const legacyRaw = JSON.stringify(legacyLibrary);
  const legacyContext = await browser.newContext();
  await legacyContext.addInitScript((raw) => localStorage.setItem("alza.projects.v1", raw), legacyRaw);
  const legacyPage = await legacyContext.newPage();
  await legacyPage.goto(baseUrl);
  await legacyPage.getByRole("heading", { name: "Choose a plan" }).waitFor();
  assert.equal(await legacyPage.evaluate(() => localStorage.getItem("alza.projects.v1")), legacyRaw, "opening the chooser must not rewrite a v1 library");
  const migrated = await legacyPage.evaluate(() => {
    const project = window.__alza.store.getState().projects.find((entry) => entry.id === "survey-kept");
    return { version: project.version, wall: project.model.walls[0], note: project.notes[0].text, kind: project.kinds[0].entry.kind };
  });
  assert.equal(migrated.version, 2);
  assert.equal(migrated.wall.ax, 1.25);
  assert.equal(migrated.wall.bx, 4.5);
  assert.equal(migrated.note, "Leave this note");
  assert.equal(migrated.kind, "survey_vanity");
  await legacyPage.locator(".project-card").filter({ hasText: "Kept Survey" }).getByRole("button", { name: "Open" }).click();
  await legacyPage.waitForFunction(() => JSON.parse(localStorage.getItem("alza.projects.v1")).version === 2);
  const upgraded = await legacyPage.evaluate(() => JSON.parse(localStorage.getItem("alza.projects.v1")));
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.activeId, "survey-kept");
  const kept = upgraded.projects.find((entry) => entry.id === "survey-kept");
  assert.equal(kept.version, 2);
  assert.equal(kept.model.walls[0].id, "w_kept");
  assert.equal(kept.model.walls[0].ax, 1.25);
  assert.equal(kept.model.walls[0].bx, 4.5);
  assert.equal(kept.model.openings[0].id, "door_kept");
  assert.equal(kept.notes[0].text, "Leave this note");
  assert.equal(kept.kinds[0].entry.kind, "survey_vanity");
  assert.equal(kept.model.underlay.dataUrl, "data:image/png;base64,aaaa");
  await legacyContext.close();
  console.log("PASS: UI wall, registered tool note, custom kind, underlay, 3D, demo isolation, reload, export/import, independent edits, deletion, old data protection, v1 migration without rewrite until save");
} finally {
  await browser.close();
}
