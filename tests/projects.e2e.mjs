import { launch } from "./browser.mjs";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const baseUrl = process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5199/";

const browser = await launch({ headless: true });
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
  const sample = page.locator(".project-card").filter({ hasText: "Bathroom Concept" });
  await sample.getByRole("button", { name: "Open" }).click();
  const sampleState = await page.evaluate(() => ({ model: window.__alza.store.getState().model,
    notes: window.__alza.store.getState().notes, kinds: window.__alza.store.getState().kinds }));
  assert.equal(sampleState.model.walls.length, 4);
  assert.equal(sampleState.model.items.length, 12);
  assert.ok(sampleState.notes.some((note) => /approximate|not set-out/i.test(note.text)));
  assert.equal(sampleState.kinds.length, 12);
  await page.getByRole("button", { name: "Build 3D" }).click();
  assert.equal(await page.getByLabel("3D presentation").inputValue(), "planning");
  await nextSceneFrame();
  const samplePlanning = await exportObjNames();
  assert.ok(samplePlanning.includes(sampleState.model.items[0].id), "authored bathroom fixture stays visible");
  assert.ok(!samplePlanning.some((name) => /pendant|curtain|skirting/.test(name)), "planning hides decoration");
  await page.getByLabel("3D presentation").selectOption("styled");
  await nextSceneFrame();
  const sampleStyled = await exportObjNames();
  assert.ok(sampleStyled.some((name) => name.includes("pendant")), "styled presentation remains available");
  await page.getByLabel("3D presentation").selectOption("planning");
  await page.getByRole("button", { name: "Projects" }).click();
  await page.reload();
  const persistedSample = page.locator(".project-card").filter({ hasText: "Bathroom Concept" });
  await persistedSample.getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Build 3D" }).click();
  assert.equal(await page.getByLabel("3D presentation").inputValue(), "planning", "sample presentation persists across reload");

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
  assert.equal(exported.version, 2);
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
  const chooserNames = await legacyPage.locator(".project-card strong").allTextContents();
  assert.deepEqual(chooserNames, ["Bathroom Concept", "Sunset Loft", "Kept Survey"], "new sample leads while legacy projects are preserved");
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
  assert.equal(upgraded.projects.filter((entry) => entry.id === "bathroom-concept").length, 1);
  assert.deepEqual(upgraded.projects.find((entry) => entry.id === "sunset-loft").model,
    legacyLibrary.projects[0].model, "old sample content is preserved as a saved project");
  const kept = upgraded.projects.find((entry) => entry.id === "survey-kept");
  assert.equal(kept.version, 2);
  assert.equal(kept.model.walls[0].id, "w_kept");
  assert.equal(kept.model.walls[0].ax, 1.25);
  assert.equal(kept.model.walls[0].bx, 4.5);
  assert.equal(kept.model.openings[0].id, "door_kept");
  assert.equal(kept.notes[0].text, "Leave this note");
  assert.equal(kept.kinds[0].entry.kind, "survey_vanity");
  assert.equal(kept.model.underlay.dataUrl, "data:image/png;base64,aaaa");
  await legacyPage.reload();
  assert.equal(await legacyPage.locator(".project-card").filter({ hasText: "Bathroom Concept" }).count(), 1,
    "reloading does not add a second sample");
  const shippedSample = await legacyPage.evaluate(() => window.__alza.store.getState().projects.find((entry) => entry.id === "bathroom-concept"));
  await legacyContext.close();

  // An unedited copy of an older sample is replaced on load; an edited one is kept and flagged.
  const fingerprint = (project) => {
    const text = JSON.stringify([project.model, project.notes.map(({ at: _at, ...note }) => note), project.kinds]);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
    return (hash >>> 0).toString(16).padStart(8, "0");
  };
  const olderSample = { ...shippedSample, presentation: "styled", model: { ...shippedSample.model, name: "Older Bathroom Concept" } };
  for (const [edited, label] of [[false, "unedited"], [true, "edited"]]) {
    const stored = { ...olderSample, sampleFingerprint: edited ? "00000000" : fingerprint(olderSample) };
    const context = await browser.newContext();
    await context.addInitScript((raw) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("alza.projects.v1", raw); sessionStorage.setItem("seeded", "1"); } },
      JSON.stringify({ version: 2, activeId: null, projects: [stored] }));
    const freshness = await context.newPage();
    await freshness.goto(baseUrl);
    await freshness.getByRole("heading", { name: "Choose a plan" }).waitFor();
    const card = freshness.locator(".project-card").first();
    const sample = await freshness.evaluate(() => window.__alza.store.getState().projects.find((entry) => entry.id === "bathroom-concept"));
    if (edited) {
      assert.equal(sample.model.name, "Older Bathroom Concept", "an edited sample is never replaced");
      assert.equal(await card.locator(".sample-outdated").count(), 1, "an edited older sample shows the reset banner");
      freshness.once("dialog", (dialog) => dialog.accept());
      await card.getByRole("button", { name: "Reset sample" }).click();
      await freshness.waitForFunction(() => window.__alza.store.getState().projects.find((entry) => entry.id === "bathroom-concept").model.name === "Bathroom Concept");
      assert.equal(await card.locator(".sample-outdated").count(), 0, "reset clears the banner");
    } else {
      assert.equal(sample.model.name, "Bathroom Concept", "an unedited older sample is replaced by the shipped one");
      assert.equal(sample.presentation, "styled", "replacing the sample keeps its presentation");
      assert.equal(await card.locator(".sample-outdated").count(), 0, `no banner for the ${label} sample once replaced`);
    }
    await context.close();
  }
  console.log("PASS: UI wall, registered tool note, custom kind, underlay, 3D, sample isolation, sample freshness, reload, export/import, independent edits, deletion, old data protection, v1 migration without rewrite until save");
} finally {
  await browser.close();
}
