/**
 * Issue #4 end-to-end check: wall reference faces through WebMCP tools, the Inspector and the
 * 2D plan, surviving a reload.
 *
 * One surveyed wall span (the bathroom's 2110 mm back wall, drawn on the existing surface),
 * one site-confirmed frame position, and a proposed build-up on the bathroom side. A point
 * 100 mm off the existing surface is measured from frame, board and finished tile; changing
 * the board thickness in the Inspector moves the board and finished distances only. An
 * unknown thickness gives an unresolved result, never a number.
 *
 * Run with the studio dev server up:  ALZA_BASE_URL=http://127.0.0.1:5199/ node tests/wall-faces.e2e.mjs
 */
import { launch } from "./browser.mjs";
import { strict as assert } from "node:assert";

const browser = await launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
try {
  await page.goto(process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5199/");
  await page.getByLabel("New project name").fill("Faces check");
  await page.getByRole("button", { name: "Create blank" }).click();
  const run = (name, args = {}) => page.evaluate(([tool, input]) => window.__alza.runTool(tool, input), [name, args]);

  const wall = await run("add_wall", { ax: 0, ay: 0, bx: 2.11, by: 0, thickness: 0.1, height: 2.4 });
  assert.equal(wall.ok, true);
  await run("add_room", { x: 0, y: 0, w: 2.11, h: 3.02, label: "Bathroom", floor: "tile" });

  const empty = await run("get_wall_faces", { wallId: wall.id });
  assert.deepEqual(empty.sides.map((s) => [s.side, s.room, s.recorded]), [["left", null, false], ["right", "Bathroom", false]]);

  const set = await run("set_wall_side", {
    wallId: wall.id,
    side: "right",
    existing: { value: 0, status: "measured", source: "survey" },
    frame: { value: -0.045, status: "site-confirmed" },
    layers: [
      { kind: "board", name: "Villaboard", thickness: { value: 0.006, status: "proposed" } },
      { kind: "waterproofing", thickness: { value: 0.001, status: "proposed" } },
      { kind: "adhesive", thickness: { value: 0.004, status: "proposed" } },
      { kind: "tile", thickness: { value: 0.01, status: "proposed" } },
    ],
  });
  assert.equal(set.ok, true, set.summary);
  const measure = async (face) => run("measure_to_face", { wallId: wall.id, side: "right", face, x: 1, y: 0.1 });
  assert.equal((await measure("frame")).meters, 0.145);
  assert.equal((await measure("board")).meters, 0.139);
  assert.equal((await measure("finished")).meters, 0.124);
  assert.match((await measure("board")).summary, /139 mm from the board face \(villaboard\)/i);

  const rejected = await run("set_wall_side", { wallId: wall.id, side: "right", layers: [{ kind: "tile" }, { kind: "board" }] });
  assert.equal(rejected.ok, false);
  assert.equal((await measure("finished")).meters, 0.124);

  // 2D: every resolved face is drawn on the bathroom side
  const drawn = await page.locator(`[data-face^="${wall.id}:right:"]`).count();
  assert.equal(drawn, 6);

  // Inspector: select the wall, pick the right side, change the board thickness
  await page.locator(`[data-id="${wall.id}"]`).first().click();
  const panel = page.getByRole("region", { name: "Wall faces" });
  await panel.getByRole("tab", { name: /Right side · Bathroom/ }).click();
  await panel.getByLabel("Reference face").selectOption("frame");
  const board = panel.getByLabel("Villaboard thickness (mm)", { exact: true });
  assert.equal(await board.inputValue(), "6");
  await board.fill("10");
  await board.press("Enter");
  assert.equal((await measure("frame")).meters, 0.145);
  assert.equal((await measure("board")).meters, 0.135);
  assert.equal((await measure("finished")).meters, 0.12);
  const lastRow = panel.locator("tr").last();
  assert.match(await lastRow.textContent(), /-20 mm.*25 mm.*proposed/);

  // Unknown tile thickness: blank in the Inspector, unresolved everywhere
  const tile = panel.getByLabel("Tile thickness (mm)", { exact: true });
  await tile.fill("");
  await tile.press("Enter");
  const unresolved = await measure("finished");
  assert.equal(unresolved.resolved, false);
  assert.equal(unresolved.meters, undefined);
  assert.deepEqual(unresolved.face.missing, ["Tile thickness"]);
  assert.match(await panel.locator("tr").last().textContent(), /unresolved.*missing Tile thickness/);
  assert.equal(await page.locator(`[data-face^="${wall.id}:right:"]`).count(), 5);
  const issues = (await run("get_issues")).issues.map((i) => i.code);
  assert.ok(issues.includes("wall_face_unresolved"));

  // Reload: the side, its statuses and the unknown survive
  await page.reload();
  await page.locator(".project-card").filter({ hasText: "Faces check" }).getByRole("button", { name: "Open" }).click();
  const after = await run("get_wall_faces", { wallId: wall.id, side: "right" });
  const faces = Object.fromEntries(after.sides[0].faces.map((f) => [f.face, f]));
  assert.equal(faces.frame.offset, -0.045);
  assert.equal(faces.frame.basis, "site-confirmed");
  assert.equal(faces.existing.basis, "measured");
  assert.equal(after.sides[0].faces.at(-1).resolved, false);
  assert.equal((await measure("board")).meters, 0.135);

  assert.deepEqual(errors, []);
  console.log("PASS: tools, rejection, 2D faces, inspector edit, unknown thickness, issues, reload");
} finally {
  await browser.close();
}
