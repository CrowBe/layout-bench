/** Synthetic planning verification only. Purchased-product acceptance waits for the actual cable data. */
import { launch } from "./browser.mjs";
import { strict as assert } from "node:assert";
import { mkdir, readFile } from "node:fs/promises";
const browser = await launch({
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
try {
  await page.goto(process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5208");
  await page.getByLabel("New project name").fill("Synthetic heating check");
  await page.getByRole("button", { name: "Create blank" }).click();
  const run = (name, args = {}) =>
    page.evaluate(
      ([name, args]) => window.__alza.runTool(name, args),
      [name, args],
    );
  const q = (value) => ({
    value,
    status: "proposed",
    source: "Synthetic geometry, not product specification",
  });
  const added = await run("add_room", {
    x: 0,
    y: 0,
    w: 2.11,
    h: 3.02,
    label: "Synthetic bathroom",
    floor: "tile",
  });
  assert.equal(added.ok, true);
  await run("set_room_floor", {
    room: added.id,
    substrateTop: q(-0.05),
    layers: [
      {
        id: "screed",
        kind: "screed",
        name: "Synthetic screed",
        thickness: q(0.04),
      },
      { kind: "tile", thickness: q(0.01) },
    ],
  });
  let set = await run("set_room_heating", {
    room: added.id,
    zoneIds: [added.id],
    depthFromBottom: q(0.02),
    path: [
      { x: 0.2, y: 0.2 },
      { x: 1.8, y: 0.2 },
      { x: 1.8, y: 0.4 },
      { x: 0.2, y: 0.4 },
    ],
  });
  assert.equal(set.ok, true, set.summary);
  let read = await run("get_room_heating", {
    room: added.id,
    includeHtml: true,
  });
  assert.equal(read.routeLength, 3.4);
  assert.equal(read.heating.length, undefined);
  assert.equal(read.section[0].level, -0.03);
  assert.match(read.html, /unknown/);
  await page.keyboard.down("Alt");
  await page.mouse.move(600, 400);
  await page.mouse.down();
  await page.mouse.move(1000, 600);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.evaluate((id) => window.__alza.actions.selectRoom(id), added.id);
  const panel = page.getByLabel("Heating cable");
  await panel.waitFor();
  assert.equal(await page.locator('[data-role="heating-route"]').count(), 1);
  assert.equal(
    await page.locator('[data-role="heating-in-floor-section"]').count(),
    1,
  );
  // Exact human edit reaches the canonical record read by tools.
  const point = page.getByLabel("Cable point 4 x (mm)", { exact: true });
  await point.fill("250");
  await point.blur();
  read = await run("get_room_heating", { room: added.id });
  assert.equal(read.heating.path[3].x, 0.25);
  assert.equal(read.routeLength, 3.35);
  const length = page.getByLabel("Cable product length (m)", { exact: true });
  await length.fill("3");
  await page
    .getByLabel("Cable product length (m) status", { exact: true })
    .selectOption("published");
  read = await run("get_room_heating", { room: added.id });
  assert.equal(read.heating.length.value, 3);
  assert.ok(read.problems.some((p) => p.code === "heating_length_exceeded"));
  await page
    .getByLabel("Cable product length (m) source", { exact: true })
    .fill("Synthetic length constraint for test only");
  await page
    .getByLabel("Cable product length (m) source", { exact: true })
    .blur();
  // Draw on the real plan; the action adds a point through the same canonical mutation.
  const before = read.heating.path.length;
  await page
    .getByRole("button", { name: "Draw cable on plan", exact: true })
    .click();
  const plan = page.locator("svg.editor-svg");
  const svg = (await plan.count())
    ? plan
    : page
        .locator("svg")
        .filter({ has: page.locator('[data-role="heating-route"]') })
        .first();
  await svg.click({ position: { x: 600, y: 450 } });
  await page.keyboard.press("Escape");
  read = await run("get_room_heating", { room: added.id });
  assert.equal(read.heating.path.length, before + 1);
  await run("set_room_heating", {
    room: added.id,
    path: [
      { x: 0.2, y: 0.2 },
      { x: 1.8, y: 0.2 },
      { x: 1.8, y: 0.4 },
      { x: 0.25, y: 0.4 },
    ],
    keepouts: [
      {
        id: "ex",
        label: "Synthetic exclusion",
        x: 0.8,
        y: 0.1,
        w: 0.05,
        h: 0.2,
        source: "Test rectangle only",
      },
    ],
  });
  read = await run("get_room_heating", { room: added.id });
  assert.ok(read.problems.some((p) => p.code === "heating_keepout"));
  // A screed edit moves the top face; cable centre stays entered relative to bottom and warning updates.
  await run("set_room_floor", {
    room: added.id,
    layers: [
      {
        id: "screed",
        kind: "screed",
        name: "Synthetic screed",
        thickness: q(0.015),
      },
      { kind: "tile", thickness: q(0.01) },
    ],
  });
  read = await run("get_room_heating", { room: added.id, includeHtml: true });
  assert.ok(read.problems.some((p) => p.code === "heating_outside_screed"));
  assert.match(read.html, /heating_outside_screed/);
  // Download is generated from the same current data; print surface preserves warnings and provenance.
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download heating review", exact: true })
    .click();
  const downloaded = await download;
  assert.equal(downloaded.suggestedFilename(), "proposed-heating-review.html");
  const reviewFile = await readFile(await downloaded.path(), "utf8");
  assert.match(reviewFile, /Synthetic length constraint for test only/);
  assert.match(reviewFile, /heating_outside_screed/);
  assert.match(reviewFile, /250 mm/);
  const popup = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Print heating / save PDF", exact: true })
    .click();
  const printed = await popup;
  await printed.waitForLoadState();
  assert.match(
    await printed.locator("body").innerText(),
    /Synthetic length constraint for test only/,
  );
  assert.match(
    await printed.locator("body").innerText(),
    /heating_outside_screed/,
  );
  await printed.close();
  await run("set_sheet_info", {
    project: "Synthetic heating review",
    site: "Test room only",
    preparedBy: "Automated test",
  });
  const content = await run("list_diagram_content");
  assert.ok(content.layers.some((l) => l.id === "floor-heating-cable"));
  assert.equal(
    content.notModelled.some((s) => s.includes("heating cable")),
    false,
  );
  const view = await run("set_diagram_view", {
    label: "Synthetic cable review",
    visible: ["floor-heating-cable"],
  });
  assert.equal(view.ok, true, view.summary);
  const diagram = await run("export_diagram_view", { includeOutputs: true });
  assert.equal(diagram.ok, true, diagram.summary);
  assert.match(diagram.svg, /PROPOSED CABLE/);
  assert.match(diagram.specHtml, /Synthetic length constraint for test only/);
  assert.doesNotMatch(diagram.svg, /Not modelled, never drawn: in-screed heating cable/);
  assert.doesNotMatch(diagram.specHtml, /no cable record supplied/);
  // Persisted readback after reload retains entered constraints and unsupplied metadata.
  const expected = read.heating;
  await page.reload();
  await page
    .locator(".project-card")
    .filter({ hasText: "Synthetic heating check" })
    .getByRole("button", { name: "Open", exact: true })
    .click();
  read = await run("get_room_heating", { room: added.id });
  assert.deepEqual(read.heating, expected);
  assert.equal(read.heating.manufacturer, undefined);
  await page.evaluate((id) => window.__alza.actions.selectRoom(id), added.id);
  await panel.scrollIntoViewIfNeeded();
  await mkdir("/tmp/layout-bench-8-evidence", { recursive: true });
  await page.screenshot({
    path: "/tmp/layout-bench-8-evidence/heating-ui.png",
  });
  // A real UI product-length edit must use the spatial route over the resolved slope.
  await run("set_room_floor", { room: added.id, layers: [
    { id: "screed", kind: "screed", thickness: q(0.04) },
    { kind: "tile", thickness: q(0.01) },
  ] });
  await run("set_room_drainage", { room: added.id, planes: [{
    id: "slope", x: 0, y: 0, w: 2.11, h: 3.02, controls: [
      { x: 0, y: 0, level: q(0) },
      { x: 2, y: 0, level: q(0.1) },
      { x: 0, y: 3, level: q(0) },
    ],
  }] });
  await run("set_room_heating", { room: added.id,
    path: [{ x: 0.2, y: 0.2 }, { x: 1.2, y: 0.2 }], keepouts: [],
  });
  await length.fill("1.001");
  await length.blur();
  read = await run("get_room_heating", { room: added.id, includeHtml: true });
  assert.equal(read.planRouteLength, 1);
  assert.equal(read.routeLength, 1.0012);
  assert.equal(read.remainingProductLength, -0.0002);
  assert.ok(read.problems.some(p => p.code === "heating_length_exceeded"));
  assert.match(await panel.innerText(), /spatial route length.*1\.0012 m/);
  assert.match(read.html, /Spatial route length \(sampled profile\): 1\.0012 m/);
  await run("set_diagram_view", { label: "Spatial cable review", visible: ["floor-heating-cable"] });
  let slopeDiagram = await run("export_diagram_view", { includeOutputs: true });
  assert.equal(slopeDiagram.ok, true, slopeDiagram.summary);
  assert.match(slopeDiagram.svg, /plan 1 m; spatial 1\.0012 m/);
  assert.match(slopeDiagram.specHtml, /-0\.0002/);
  // A narrow unresolved gap between two resolved planes withholds the spatial balance.
  const controls = [{ x: 0, y: 0, level: q(0) }, { x: 2, y: 0, level: q(0) }, { x: 0, y: 3, level: q(0) }];
  await run("set_room_drainage", { room: added.id, planes: [
    { id: "left", x: 0, y: 0, w: 0.41, h: 3.02, controls },
    { id: "right", x: 0.42, y: 0, w: 1.69, h: 3.02, controls },
  ] });
  read = await run("get_room_heating", { room: added.id, includeHtml: true });
  assert.equal(read.planRouteLength, 1);
  assert.equal(read.routeLength, undefined);
  assert.equal(read.remainingProductLength, undefined);
  assert.ok(read.problems.some(p => p.code === "heating_route_length_unknown"));
  assert.ok(!read.problems.some(p => p.code === "heating_length_exceeded"));
  assert.match(await panel.innerText(), /spatial route length.*unknown/);
  assert.match(read.html, /remaining confirmed cable length: unknown/);
  slopeDiagram = await run("export_diagram_view", { includeOutputs: true });
  assert.equal(slopeDiagram.ok, true, slopeDiagram.summary);
  assert.match(slopeDiagram.svg, /spatial unknown/);
  assert.match(slopeDiagram.specHtml, /heating_route_length_unknown/);
  await page.reload();
  await page.locator(".project-card").filter({ hasText: "Synthetic heating check" })
    .getByRole("button", { name: "Open", exact: true }).click();
  read = await run("get_room_heating", { room: added.id });
  assert.equal(read.routeLength, undefined);
  assert.equal(read.remainingProductLength, undefined);
  assert.deepEqual(errors, []);
  console.log(
    "heating e2e passed (synthetic capability only; actual purchased cable data remains pending)",
  );
} finally {
  await browser.close();
}
