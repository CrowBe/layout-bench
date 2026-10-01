/**
 * Issue #5 end-to-end check: fixtures set out from wall faces, with rough-in read against the
 * frame, the fixed board and the finished tile, through tools, the Inspector, 2D and reload.
 *
 * The bathroom back wall is drawn on its surveyed existing surface with a site-confirmed frame
 * and a proposed build-up. The recorded vanity footprint (910 × 465) is set against the tile
 * face; an accepted library toilet (synthetic data) is placed against it too and brings its
 * published rough-in. A proposed service point is entered on the vanity. Changing the board
 * thickness moves the tile-face fixtures and their readings from the board and frame, while the
 * entered references stay as entered. No bath is placed: its dimensions stay unknown.
 *
 * Run with the studio dev server up:  ALZA_BASE_URL=http://127.0.0.1:5199/ node tests/fixtures.e2e.mjs
 */
import { chromium } from "playwright";
import { strict as assert } from "node:assert";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const src = [{ url: "https://example.com/pan.pdf", locator: "p. 2" }];
const pub = (value) => ({ value, status: "published", sources: src });

try {
  await page.goto(process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5199/");
  await page.evaluate(() => localStorage.removeItem("alza.products.v1"));
  await page.reload();
  await page.getByLabel("New project name").fill("Fixture set-out");
  await page.getByRole("button", { name: "Create blank" }).click();
  const run = (name, args = {}) => page.evaluate(([tool, input]) => window.__alza.runTool(tool, input), [name, args]);

  const corners = [[0, 0], [2.11, 0], [2.11, 3.02], [0, 3.02]];
  const walls = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    walls.push((await run("add_wall", { ax, ay, bx, by, thickness: 0.1, height: 2.4 })).id);
  }
  const back = walls[0];
  await run("add_room", { x: 0, y: 0, w: 2.11, h: 3.02, label: "Bathroom", floor: "tile" });
  const layers = (board) => [
    { kind: "board", name: "Villaboard", thickness: { value: board, status: "proposed" } },
    { kind: "waterproofing", thickness: { value: 0.001, status: "proposed" } },
    { kind: "adhesive", thickness: { value: 0.004, status: "proposed" } },
    { kind: "tile", thickness: { value: 0.01, status: "proposed" } },
  ];
  assert.equal((await run("set_wall_side", { wallId: back, side: "right", existing: { value: 0, status: "measured" }, frame: { value: -0.045, status: "site-confirmed" }, layers: layers(0.006) })).ok, true);

  // Vanity: the recorded footprint, set against the tile face
  await run("define_item_kind", { kind: "vanity_recorded", label: "Vanity", w: 0.91, d: 0.465, h: 0.85, category: "bath" });
  const vanity = (await run("place_item", { kind: "vanity_recorded", x: 1, y: 1 })).id;
  const anchored = await run("anchor_fixture", { itemId: vanity, wallId: back, side: "right", face: "finished", distance: 1.4, status: "proposed" });
  assert.equal(anchored.ok, true, anchored.summary);
  assert.deepEqual([anchored.x, anchored.y, anchored.rotation], [1.4, 0.2085, 0]);
  const moved = await run("move_item", { id: vanity, x: 0.5, y: 0.5 });
  assert.equal(moved.ok, false);
  assert.equal((await run("set_service_point", { itemId: vanity, label: "Wall waste", service: "waste", face: "finished", out: 0, across: 0.1, up: 0.55, status: "proposed", source: "planned with plumber" })).ok, true);

  // Toilet: an accepted library product, placed against the tile face
  const req = await run("request_product", { category: "toilet", brand: "Example Co", model: "Test Pan" });
  const submitted = await run("submit_product_spec", { requestId: req.requestId, manufacturer: "Example Co", model: "Test Pan", fields: {
    width: pub(0.381), depth: pub(0.68), height: pub(0.807), panType: pub("back-to-wall"), cistern: pub("close-coupled"), inletEntry: pub("bottom"),
    trap: pub("universal"), sTrapSetoutMin: pub(0.14), sTrapSetoutMax: pub(0.26), pTrapWasteHeight: pub(0.19),
    inletHeight: pub(0.18), inletOffset: pub(-0.18), power: pub("not-required"),
  } });
  assert.equal(submitted.ok, true, submitted.summary);
  await page.getByRole("button", { name: /^Products/ }).click();
  await page.getByRole("region", { name: "Requests" }).getByRole("button", { name: /Toilet/ }).click();
  const rows = page.locator("tbody tr[data-field]");
  for (let i = 0; i < await rows.count(); i++) await rows.nth(i).getByRole("button", { name: "Accept" }).click();
  await page.getByRole("button", { name: "Accept product" }).click();
  await page.getByRole("button", { name: "Back to plan" }).click();
  const productId = (await run("get_product_library")).products[0].id;
  const toilet = await run("place_product", { productId, wallId: back, side: "right", face: "finished", distance: 0.45, status: "proposed" });
  assert.equal(toilet.ok, true, toilet.summary);

  const read = async () => Object.fromEntries((await run("get_rough_in")).fixtures.map((f) => [f.id, f]));
  const faceValue = (point, face) => point.fromFaces.find((f) => f.face === face);
  let r = await read();
  const vw = r[vanity].servicePoints[0];
  assert.deepEqual([faceValue(vw, "frame").value, faceValue(vw, "board").value, faceValue(vw, "finished").value], [0.021, 0.015, 0]);
  assert.equal(vw.alongFromA, 1.5);
  const sTrap = r[toilet.id].servicePoints.find((p) => p.pointId === "waste-s");
  assert.deepEqual([faceValue(sTrap, "frame").value, faceValue(sTrap, "frame").max], [0.161, 0.281]);
  assert.deepEqual([faceValue(sTrap, "board").value, faceValue(sTrap, "board").max], [0.155, 0.275]);
  assert.ok(r[vanity].clearances.every((c) => c.distance === null || c.distance >= 0));
  assert.equal((await run("get_issues")).issues.filter((i) => i.code === "item_through_wall").length, 0);

  // 2D and the Inspector show the same readings
  assert.ok(await page.locator(`[data-sp="${vanity}:${vw.pointId}"]`).count() === 1);
  await page.locator(`[data-id="${vanity}"]`).first().click();
  const panel = page.getByRole("region", { name: "Fixture set-out" });
  const feed = await page.locator(".activity-feed").textContent();
  assert.doesNotMatch(feed ?? "", /move_item\s*Moved Vanity/);
  assert.match(await panel.locator(`tr[data-point="${vw.pointId}"]`).textContent(), /Wall waste.*21.*15.*0.*1500.*550/);

  // A 10 mm board: tile-face fixtures move 4 mm, readings from board and frame follow, entries stay
  assert.equal((await run("set_wall_side", { wallId: back, side: "right", layers: layers(0.01) })).ok, true);
  r = await read();
  assert.equal(r[vanity].position.y, 0.2125);
  const vw2 = r[vanity].servicePoints[0];
  assert.deepEqual([faceValue(vw2, "frame").value, faceValue(vw2, "board").value, faceValue(vw2, "finished").value], [0.025, 0.015, 0]);
  assert.deepEqual(vw2.entered, { face: "finished", out: 0, across: 0.1, up: 0.55 });
  assert.equal(r[vanity].anchor.face, "finished");
  const sTrap2 = r[toilet.id].servicePoints.find((p) => p.pointId === "waste-s");
  assert.deepEqual([faceValue(sTrap2, "frame").value, faceValue(sTrap2, "board").value], [0.165, 0.155]);
  assert.match(await panel.locator(`tr[data-point="${vw.pointId}"]`).textContent(), /Wall waste.*25.*15/);

  // No bath: nothing invents one
  assert.ok(Object.values(r).every((f) => !/bath/i.test(f.label)));

  // Reload: anchors and service points persist, positions still derived
  await page.reload();
  await page.locator(".project-card").filter({ hasText: "Fixture set-out" }).getByRole("button", { name: "Open" }).click();
  r = await read();
  assert.equal(r[vanity].position.y, 0.2125);
  assert.equal(r[toilet.id].servicePoints.length, 3);

  assert.deepEqual(errors, []);
  console.log("PASS: tile-face vanity and library toilet, refused hand move, rough-in from frame/board/finished, 2D + inspector, board change, no invented bath, reload");
} finally {
  await browser.close();
}
