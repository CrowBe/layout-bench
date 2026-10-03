/**
 * Issue #37 end-to-end check: a corner bath with its real outline, from the product library
 * to the plan, 3D, the trade sheet and reload.
 *
 * Numbers as printed on the Enflair Angie 1000 drawing (synthetic source link): 1000 along each
 * wall, 1178 across the curved front, 1090 from the corner, 630 high, waste 368 from each wall.
 *
 * Run with the studio dev server up:  ALZA_BASE_URL=http://127.0.0.1:5199/ node tests/outline.e2e.mjs
 */
import { chromium } from "playwright";
import { strict as assert } from "node:assert";

const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const src = [{ url: "https://example.com/angie", locator: "dimension drawing" }];
const pub = (value) => ({ value, status: "published", sources: src });

try {
  await page.goto(process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5199/");
  await page.evaluate(() => localStorage.removeItem("alza.products.v1"));
  await page.reload();
  await page.getByLabel("New project name").fill("Corner bath");
  await page.getByRole("button", { name: "Create blank" }).click();
  const run = (name, args = {}) => page.evaluate(([tool, input]) => window.__alza.runTool(tool, input), [name, args]);

  const corners = [[0, 0], [2.11, 0], [2.11, 3.02], [0, 3.02]];
  const walls = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    walls.push((await run("add_wall", { ax, ay, bx, by, thickness: 0.1, height: 2.4 })).id);
    await run("set_wall_side", { wallId: walls[i], side: "right", existing: { value: 0, status: "measured" } });
  }
  await run("add_room", { x: 0, y: 0, w: 2.11, h: 3.02, label: "Bathroom", floor: "tile" });

  // brief → submission: the outline disagreement is flagged for the reviewer, not hidden
  const req = await run("request_product", { category: "bath", brand: "Enflair", model: "Angie 1000" });
  const brief = await run("get_product_brief", { requestId: req.requestId });
  assert.ok(brief.fields.some((f) => f.key === "frontWidth" && f.when?.in.includes("corner-round")));
  const sub = await run("submit_product_spec", { requestId: req.requestId, manufacturer: "Enflair", model: "Angie 1000 Corner", code: "SB184-1000", fields: {
    length: pub(1.0), width: pub(1.0), height: pub(0.63), installation: pub("corner"), shape: pub("corner-round"),
    frontWidth: pub(1.178), frontProjection: pub(1.09), wasteFromEnd: pub(0.368), wasteFromSide: pub(0.368),
    surround: { value: null, note: "Not on the drawing." },
  }, identity: { code: { state: "known", value: "SB184-1000", sources: src } } });
  assert.equal(sub.ok, true, sub.summary);
  assert.ok(sub.warnings.some((w) => w.code === "outline_disagrees"));
  await page.getByRole("button", { name: /^Products/ }).click();
  await page.getByRole("region", { name: "Requests" }).getByRole("button", { name: /Bath/ }).click();
  const rows = page.locator("tbody tr[data-field]");
  for (let i = 0; i < await rows.count(); i++) await rows.nth(i).getByRole("button", { name: "Accept" }).click();
  await page.getByRole("button", { name: "Accept product" }).click();
  await page.getByRole("button", { name: "Back to plan" }).click();

  // placed in the B-end corner of the back wall: mirrored outline
  const productId = (await run("get_product_library")).products[0].id;
  const placed = await run("place_product", { productId, wallId: walls[0], side: "right", face: "existing", from: "b", distance: 0.5, status: "proposed" });
  assert.equal(placed.ok, true, placed.summary);
  assert.match(placed.kind, /_right$/);
  assert.equal(await page.locator(`[data-id="${placed.id}"] polygon[data-outline]`).count(), 1);
  const issues = (await run("get_issues")).issues.map((i) => i.code);
  assert.ok(!issues.includes("item_through_wall"), issues.join(","));

  // the trade sheet draws the outline, not a box
  await run("set_sheet_info", { project: "Bathroom renovation", site: "Main bathroom" });
  const sheet = await run("export_sheet", { sheet: "floor-plan", includeSvg: true });
  assert.equal(sheet.ok, true, sheet.summary);
  const pts = sheet.svg.match(new RegExp(`<polygon points="([^"]+)"[^>]*data-item="${placed.id}"`))[1].split(" ");
  assert.ok(pts.length > 20, `outline has ${pts.length} points`);

  // 3D builds without errors
  assert.equal((await run("build_3d")).ok, true);
  await page.waitForTimeout(800);

  // reload: the kind keeps its outline
  await page.reload();
  await page.locator(".project-card").filter({ hasText: "Corner bath" }).getByRole("button", { name: "Open" }).click();
  assert.equal(await page.locator(`[data-id="${placed.id}"] polygon[data-outline]`).count(), 1);

  assert.deepEqual(errors, []);
  console.log("PASS: corner bath brief with flagged outline mismatch, mirrored outline in plan, sheet and 3D, reload");
} finally {
  await browser.close();
}
