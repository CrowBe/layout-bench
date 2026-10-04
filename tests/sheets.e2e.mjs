/**
 * Issue #29 end-to-end check: the bathroom from #1 issued as sheet A-01.
 *
 * 2110 × 3020 existing surfaces, 800 door, centred 1755 window with its height unknown. The
 * agent loop: check_sheets reports blocking findings with fixes; the agent fills the title
 * block and enters the door width, checks again, and issues rev A. The unknown window height is
 * listed as unresolved on the sheet. Entering it and issuing rev B drops it from the list.
 * A person then issues rev C from the Sheets tab past a blocking finding, acknowledged with a
 * reason that is printed on the sheet, and can download the issued SVG.
 *
 * Run with the studio dev server up:  ALZA_BASE_URL=http://127.0.0.1:5199/ node tests/sheets.e2e.mjs
 */
import { launch } from "./browser.mjs";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const browser = await launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

try {
  await page.goto(process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5199/");
  await page.getByLabel("New project name").fill("Sheet check");
  await page.getByRole("button", { name: "Create blank" }).click();
  const run = (name, args = {}) => page.evaluate(([tool, input]) => window.__alza.runTool(tool, input), [name, args]);

  // A fresh project has no title block: the Sheets tab must still open (review on #36)
  await page.getByRole("button", { name: "Sheets", exact: true }).click();
  assert.equal(await page.locator(".sheets-panel").count(), 1);
  assert.match(await page.locator(".sheets-panel").textContent(), /title block needs a project name/);

  const corners = [[0, 0], [2.11, 0], [2.11, 3.02], [0, 3.02]];
  const walls = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    walls.push((await run("add_wall", { ax, ay, bx, by, thickness: 0.1, height: 2.4 })).id);
    await run("set_wall_side", { wallId: walls[i], side: "right", existing: { value: 0, status: "measured", source: "survey" } });
  }
  await run("add_room", { x: 0, y: 0, w: 2.11, h: 3.02, label: "Bathroom", floor: "tile" });
  const win = (await run("add_window", { wallId: walls[0], centre: 1.055, width: 1.755, sill: 1.52 })).id; // height unknown
  const door = (await run("add_door", { wallId: walls[2], centre: 0.52, from: "b", height: 2.04 })).id; // width not given

  // Agent loop: check, fix, check, issue
  let check = await run("check_sheets", { sheet: "floor-plan" });
  assert.equal(check.issuable, false);
  const blockingCodes = check.findings.filter((f) => f.severity === "blocking").map((f) => f.code).sort();
  assert.deepEqual(blockingCodes, ["default:opening_width_default", "title_block_incomplete"]);
  assert.equal(check.findings.find((f) => f.code === "default:opening_width_default").fix.tool, "edit_opening");
  const refused = await run("export_sheet", { sheet: "floor-plan" });
  assert.equal(refused.ok, false);
  assert.equal(refused.open.length, 2);

  await run("set_sheet_info", { project: "Bathroom renovation", site: "Main bathroom", preparedBy: "Owner" });
  await run("edit_opening", { id: door, width: 0.8 });
  check = await run("check_sheets", { sheet: "floor-plan" });
  assert.equal(check.issuable, true);
  const revA = await run("export_sheet", { sheet: "floor-plan", note: "For plumber's quote", includeSvg: true });
  assert.equal(revA.ok, true, revA.summary);
  assert.equal(revA.rev, "A");
  assert.match(revA.svg, /window [^<]*default height/i);
  assert.match(revA.svg, /2110 ENT · [^<]*A→B \(existing surface\)</); // walls drawn on the surveyed existing surfaces
  assert.match(revA.svg, /D 800 ENT/);
  assert.match(revA.svg, /W 1755 ENT/);

  // Enter the window height and issue again: it leaves the unresolved list
  await run("edit_opening", { id: win, height: 0.6 });
  const revB = await run("export_sheet", { sheet: "floor-plan", includeSvg: true });
  assert.equal(revB.rev, "B");
  assert.doesNotMatch(revB.svg, /window [^<]*default height/i);
  assert.match(revB.svg, /Rev B · \d{4}-\d{2}-\d{2}/);

  // A person issues past a blocking finding from the Sheets tab
  const door2 = (await run("add_door", { wallId: walls[3], centre: 1.5, height: 2.04 })).id; // another defaulted width
  await page.getByRole("button", { name: "Sheets", exact: true }).click();
  const panel = page.locator(".sheets-panel");
  await panel.getByRole("button", { name: /^Issue rev/ }).click();
  assert.match(await panel.getByRole("status").textContent(), /Not issued. 1 blocking/);
  await panel.getByLabel(`Acknowledge default:opening_width_default on ${door2}`).fill("Linen cupboard door: width set by the joiner");
  await panel.getByRole("button", { name: /^Issue rev C/ }).click();
  assert.match(await panel.getByRole("status").textContent(), /Issued A-01 rev C, past 1 acknowledged/);
  const downloadEvent = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Download rev C (SVG)" }).click();
  const file = readFileSync(await (await downloadEvent).path(), "utf8");
  assert.match(file, /Issued past 1 blocking finding/);
  assert.match(file, /Linen cupboard door: width set by the joiner/);
  const sheets = await run("list_sheets");
  assert.deepEqual(sheets.sheets[0].revisions.map((r) => [r.rev, r.acknowledged.length]), [["A", 0], ["B", 0], ["C", 1]]);
  assert.equal(sheets.sheets[0].revisions[2].acknowledged[0].by, "human");

  // The preview renders in the tab
  assert.equal(await panel.locator(".sheets-preview svg[data-sheet='floor-plan']").count(), 1);

  assert.deepEqual(errors, []);
  console.log("PASS: agent check/fix/issue loop, unresolved window height listed then cleared, human acknowledgement printed, download, revisions");
} finally {
  await browser.close();
}
