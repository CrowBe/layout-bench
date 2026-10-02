/** #10 real browser flow: propose finished-face floor pattern, edit it 10 mm in Inspector,
 * compare drawn cuts and downloaded SVG, persist/reload, recalculate build-up and waste,
 * and retain unresolved drain and wall fields. Run against a dev server with ALZA_BASE_URL. */
import { chromium } from "playwright";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const run = (name, input = {}) =>
  page.evaluate(([n, i]) => window.__alza.runTool(n, i), [name, input]);
const P = (value) => ({ value, status: "proposed" });
try {
  await page.goto(process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5290/");
  await page.getByLabel("New project name").fill("Floor set-out check");
  await page.getByRole("button", { name: "Create blank" }).click();
  const ids = {};
  for (const [name, ax, ay, bx, by] of [
    ["north", 0, 0, 2.11, 0],
    ["east", 2.11, 0, 2.11, 3.02],
    ["south", 2.11, 3.02, 0, 3.02],
    ["west", 0, 3.02, 0, 0],
  ]) {
    const wall = await run("add_wall", {
      ax,
      ay,
      bx,
      by,
      thickness: 0.1,
      height: 2.4,
    });
    assert.equal(wall.ok, true, wall.summary);
    ids[name] = wall.id;
    assert.equal(
      (
        await run("set_wall_side", {
          wallId: wall.id,
          side: "right",
          frame: { value: 0, status: "measured" },
          layers: [
            { kind: "board", thickness: P(0.01) },
            { kind: "tile", thickness: P(0.015) },
          ],
        })
      ).ok,
      true,
    );
  }
  const room = await run("add_room", {
    x: 0,
    y: 0,
    w: 2.11,
    h: 3.02,
    label: "Bathroom",
    floor: "tile",
  });
  assert.equal(room.ok, true, room.summary);
  await run("add_door", { wallId: ids.south, t: 0.5, width: 0.8, height: 2 });
  assert.equal(
    (
      await run("set_floor_tiling", {
        room: "Bathroom",
        axis: "x",
        zone: "room",
      })
    ).ok,
    true,
  );
  let read = await run("get_floor_tiling", {
    room: "Bathroom",
    includeSvg: true,
  });
  assert.equal(read.resolved, false);
  assert.equal(read.cuts, undefined);
  assert.match(read.svg, /UNRESOLVED/);
  assert.equal(
    (
      await run("set_floor_tiling", {
        room: "Bathroom",
        tileLength: P(0.6),
        tileWidth: P(0.3),
        joint: P(0.002),
        originX: P(0),
        originY: P(0),
      })
    ).ok,
    true,
  );
  read = await run("get_floor_tiling", { room: "Bathroom" });
  assert.equal(read.cuts.east.size, 0.254);
  assert.equal(read.bounds.x0, 0.025);
  assert.equal(read.resolved, false);
  assert.ok(read.missing.some((m) => m.includes("drain position")));
  await page.locator(`[data-id="${room.id}"]`).first().click({ force: true });
  const panel = page.getByRole("region", { name: "Floor tiling" });
  await panel.waitFor();
  assert.equal(
    await panel
      .getByLabel("Floor tile length (mm)", { exact: true })
      .inputValue(),
    "600",
  );
  assert.ok((await panel.locator('[data-piece="cut"]').count()) > 0);
  const before = (await run("export_floor_tiling", { room: "Bathroom" })).svg;
  await panel
    .getByRole("button", { name: "Move floor origin 10 mm right" })
    .click();
  const after = await run("get_floor_tiling", { room: "Bathroom" });
  assert.equal(after.tiling.originX.value, 0.01);
  assert.equal(after.tiling.originX.status, "proposed");
  assert.equal(after.cuts.west.size, 0.008);
  assert.equal(after.cuts.east.size, 0.244);
  assert.match(await panel.locator('[data-cut="west"]').textContent(), /8/);
  assert.match(await panel.locator('[data-cut="east"]').textContent(), /244/);
  const exported = await run("export_floor_tiling", { room: "Bathroom" });
  assert.notEqual(exported.svg, before);
  assert.match(exported.svg, /west cut: 8/);
  assert.match(exported.svg, /finished face/);
  assert.match(exported.svg, /NOT AS-BUILT/);
  assert.match(exported.svg, /data-door=/);
  const dl = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Download floor set-out (SVG)" })
    .click();
  const file = await dl;
  assert.equal(await readFile(await file.path(), "utf8"), exported.svg);
  await panel
    .getByLabel("Floor tiler field notes")
    .fill("Confirm threshold movement joint on site");
  await panel.getByLabel("Floor tiler field notes").blur();
  assert.equal(
    (await run("get_floor_tiling", { room: "Bathroom" })).tiling.note,
    "Confirm threshold movement joint on site",
  );
  await run("set_room_drainage", {
    room: "Bathroom",
    wastes: [
      {
        id: "w",
        kind: "linear",
        label: "Channel",
        x: 0.1,
        y: 0.1,
        x2: 1.9,
        y2: 0.1,
        level: P(0),
      },
    ],
    planes: [
      {
        id: "shower",
        label: "Shower",
        x: 0,
        y: 0,
        w: 2.11,
        h: 1,
        waste: "w",
        fall: P(0.01),
      },
      {
        id: "main",
        label: "Main",
        x: 0,
        y: 1,
        w: 2.11,
        h: 2.02,
        waste: "w",
        fall: P(0.01),
      },
    ],
  });
  assert.equal(await panel.locator('[data-waste="w"]').count(), 1);
  assert.equal(await panel.locator('[data-plane="shower"]').count(), 1);
  const waste = (await run("get_floor_tiling", { room: "Bathroom" })).wastes[0]
    .relation;
  await run("set_room_drainage", {
    room: "Bathroom",
    wastes: [
      {
        id: "w",
        kind: "linear",
        x: 0.2,
        y: 0.1,
        x2: 1.9,
        y2: 0.1,
        level: P(0),
      },
    ],
  });
  assert.notEqual(
    (await run("get_floor_tiling", { room: "Bathroom" })).wastes[0].relation,
    waste,
  );
  await panel.getByLabel("Floor tile zone").selectOption("shower");
  assert.equal(
    (await run("get_floor_tiling", { room: "Bathroom" })).bounds.y1,
    1,
  );
  await panel.getByLabel("Floor tile zone").selectOption("room");
  await panel.locator(".tile-elevation").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/floor-tiling-inspector.png" });
  const sheet = await browser.newPage({
    viewport: { width: 1587, height: 1123 },
  });
  await sheet.setContent(
    `<style>body{margin:0}svg{width:1587px;height:1123px}</style>${(await run("export_floor_tiling", { room: "Bathroom" })).svg}`,
  );
  await sheet.screenshot({ path: "/tmp/floor-tiling-sheet.png" });
  await sheet.close();
  await page.reload();
  await page
    .locator(".project-card")
    .filter({ hasText: "Floor set-out check" })
    .getByRole("button", { name: "Open", exact: true })
    .click();
  assert.equal(
    (await run("get_floor_tiling", { room: "Bathroom" })).tiling.originX.value,
    0.01,
  );
  assert.equal(
    (await run("get_floor_tiling", { room: "Bathroom" })).tiling.note,
    "Confirm threshold movement joint on site",
  );
  await run("set_wall_side", {
    wallId: ids.west,
    side: "right",
    frame: P(0.005),
  });
  assert.equal(
    (await run("get_floor_tiling", { room: "Bathroom" })).cuts.east.size,
    0.239,
  );
  await run("set_room_drainage", {
    room: "Bathroom",
    planes: [
      {
        id: "narrow",
        label: "Narrow zone",
        x: 0.04,
        y: 0.025,
        w: 0.4,
        h: 0.4,
        waste: "w",
        fall: P(0.01),
      },
    ],
  });
  await run("set_floor_tiling", { room: "Bathroom", tileWidth: P(0.6) });
  await page.locator(`[data-id="${room.id}"]`).first().click({ force: true });
  await panel.getByLabel("Floor tile zone").selectOption("narrow");
  const narrow = await run("get_floor_tiling", {
    room: "Bathroom",
    includeSvg: true,
  });
  assert.equal(narrow.pieces.length, 1);
  for (const edge of ["west", "east", "north", "south"]) {
    assert.equal(narrow.cuts[edge].size, 0.4);
    assert.equal(narrow.cuts[edge].full, false);
    assert.match(await panel.locator(`[data-cut="${edge}"]`).textContent(), /400/);
    assert.match(narrow.svg, new RegExp(`${edge} cut: 400`));
  }
  await run("set_wall_side", { wallId: ids.west, side: "right", frame: null });
  const missing = await run("get_floor_tiling", {
    room: "Bathroom",
    includeSvg: true,
  });
  assert.equal(missing.cuts, undefined);
  assert.match(missing.svg, /frame face position/);
  assert.ok(missing.missing.some((m) => m.includes("frame face")));
  assert.deepEqual(errors, []);
  console.log("floor tiling e2e ok");
} finally {
  await browser.close();
}
