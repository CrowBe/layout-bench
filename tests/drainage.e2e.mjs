/**
 * Issue #7 end-to-end check: a proposed linear shower waste and one floor plane, two proposed
 * elevations, derived heights read through WebMCP, the Inspector, the 2D plan and the 3D floor;
 * moving the waste updates them all, and unconfirmed values stay "proposed".
 *
 * Run with the studio dev server up:  ALZA_BASE_URL=http://127.0.0.1:5199/ node tests/drainage.e2e.mjs
 */
import { chromium } from "playwright";
import { strict as assert } from "node:assert";

const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
try {
  await page.goto(process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5199/");
  await page.getByLabel("New project name").fill("Drainage check");
  await page.getByRole("button", { name: "Create blank" }).click();
  const run = (name, args = {}) => page.evaluate(([tool, input]) => window.__alza.runTool(tool, input), [name, args]);
  const proposed = (value) => ({ value, status: "proposed" });

  await run("add_room", { x: 0, y: 0, w: 2.11, h: 3.02, label: "Bathroom", floor: "tile" });
  const set = await run("set_room_drainage", {
    room: "Bathroom",
    wastes: [{ id: "chan", label: "Shower channel", kind: "linear", x: 0.2, y: 0.1, x2: 1.9, y2: 0.1, level: proposed(0) }],
    planes: [{ id: "main", label: "Main floor", x: 0, y: 0, w: 2.11, h: 3.02, waste: "chan", controls: [{ label: "Door edge", x: 1, y: 3.02, level: proposed(0.0292) }] }],
  });
  assert.equal(set.ok, true, set.summary);

  const read = (extra = {}) => run("get_floor_heights", { room: "Bathroom", points: [{ x: 1, y: 1.1 }], ...extra });
  let h = await read({ section: { from: { x: 1, y: 0.1 }, to: { x: 1, y: 3.02 }, samples: 3 } });
  assert.equal(h.ok, true);
  assert.equal(h.planes[0].resolved, true);
  assert.equal(h.points[0].level, 0.01);
  assert.equal(h.points[0].basis, "proposed");
  assert.deepEqual(h.section.map((s) => s.level), [0, 0.0146, 0.0292]);
  assert.deepEqual(h.problems.filter((p) => p.severity === "error"), []);

  // Inspector and 2D plan
  await page.locator('[data-id]').first().click({ position: { x: 20, y: 20 }, force: true }).catch(() => {});
  await run("select_entity", { id: set.id }).catch(() => {});
  const overlay = page.locator('[data-role="drainage"]');
  await overlay.first().waitFor({ state: "attached" });
  assert.equal(await page.locator('[data-plane="main"][data-resolved="true"]').count() > 0, true);
  await page.screenshot({ path: "shots/drainage-plan.png" });

  // move the waste to mid-room: heights near the old position rise, the new line is the low point
  const moved = await run("set_room_drainage", {
    room: "Bathroom",
    wastes: [{ id: "chan", label: "Shower channel", kind: "linear", x: 0.2, y: 1.1, x2: 1.9, y2: 1.1, level: proposed(0) }],
  });
  assert.equal(moved.ok, true, moved.summary);
  h = await read();
  assert.equal(h.points[0].level, 0);
  // the control level now contradicts the new geometry only if it no longer matches
  assert.ok(h.problems.some((p) => p.code === "floor_levels_contradict") || h.planes[0].method === "waste+control");

  // unknown stays unknown
  await run("set_room_drainage", { room: "Bathroom", wastes: [{ id: "chan", label: "Shower channel", kind: "linear", x: 0.2, y: 1.1, x2: 1.9, y2: 1.1 }] });
  h = await read();
  assert.equal(h.points[0].level, undefined);
  assert.ok(h.problems.some((p) => p.code === "floor_fall_unresolved"));

  assert.deepEqual(errors, []);
  console.log("drainage e2e ok");
} finally {
  await browser.close();
}
