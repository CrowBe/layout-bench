/**
 * Issue #9 end-to-end check: one bathroom wall with a window, set out with a chosen tile and
 * joint against the Villaboard faces of the return walls and the finished floor level. Reads
 * the cuts through WebMCP, sees them in the Inspector elevation, moves the origin 10 mm with
 * the Inspector's nudge button and compares the edge cuts and the printed sheet, raises the 3D
 * view, and confirms the drawing names the board reference and never calls the pattern as-built.
 * An unknown input is shown, not filled.
 *
 * Run with the studio dev server up:  ALZA_BASE_URL=http://127.0.0.1:5199/ node tests/wall-tiling.e2e.mjs
 */
import { launch } from "./browser.mjs";
import { strict as assert } from "node:assert";

const browser = await launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
try {
  await page.goto(process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5199/");
  await page.getByLabel("New project name").fill("Tiling check");
  await page.getByRole("button", { name: "Create blank" }).click();
  const run = (name, args = {}) => page.evaluate(([tool, input]) => window.__alza.runTool(tool, input), [name, args]);
  const P = (value) => ({ value, status: "proposed" });

  // a 2110 × 3020 bathroom drawn clockwise on the frame line: every right side faces the room
  const ids = {};
  for (const [name, ax, ay, bx, by] of [["north", 0, 0, 2.11, 0], ["east", 2.11, 0, 2.11, 3.02], ["south", 2.11, 3.02, 0, 3.02], ["west", 0, 3.02, 0, 0]]) {
    const r = await run("add_wall", { ax, ay, bx, by, thickness: 0.1, height: 2.4 });
    assert.equal(r.ok, true, r.summary);
    ids[name] = r.id;
    const s = await run("set_wall_side", {
      wallId: r.id, side: "right", frame: { value: 0, status: "measured" },
      layers: [
        { kind: "board", name: "Villaboard", thickness: P(0.01) },
        { kind: "waterproofing", thickness: P(0.001) },
        { kind: "adhesive", thickness: P(0.004) },
        { kind: "tile", thickness: P(0.01) },
      ],
    });
    assert.equal(s.ok, true, s.summary);
  }
  await run("add_room", { x: 0, y: 0, w: 2.11, h: 3.02, label: "Bathroom", floor: "tile" });
  await run("set_room_floor", {
    room: "Bathroom", substrateTop: { value: 0, status: "measured" },
    layers: [{ kind: "waterproofing", thickness: P(0.002) }, { kind: "screed", thickness: P(0.03) }, { kind: "adhesive", thickness: P(0.005) }, { kind: "tile", thickness: P(0.01) }],
  });
  const win = await run("add_window", { wallId: ids.north, t: 0.5, width: 0.9, sill: 1.0, height: 0.8 });
  assert.equal(win.ok, true, win.summary);

  // an incomplete proposal: unknowns are listed, no cuts are invented
  const partial = await run("set_wall_tiling", { wallId: ids.north, side: "right", orientation: "landscape", joint: P(0.002) });
  assert.equal(partial.ok, true, partial.summary);
  let read = await run("get_wall_tiling", { wallId: ids.north, side: "right" });
  assert.equal(read.resolved, false);
  assert.equal(read.cuts, undefined);
  assert.ok(read.missing.includes("tile length"));
  assert.ok((await run("get_issues")).issues.some((i) => i.code === "tiling_unresolved"));

  // the full proposal
  const set = await run("set_wall_tiling", {
    wallId: ids.north, side: "right", tileLength: P(0.6), tileWidth: P(0.3), reference: "board", floor: "finished",
    originFrom: "a", originAlong: P(0), originUp: P(0), tiledHeight: P(2.1),
  });
  assert.equal(set.ok, true, set.summary);
  read = await run("get_wall_tiling", { wallId: ids.north, side: "right" });
  assert.equal(read.resolved, true, read.summary);
  assert.equal(read.status, "proposed");
  assert.equal(read.limits.a.s, 0.01);
  assert.match(read.limits.a.label, /Board face/);
  assert.equal(read.floor.level, 0.047);
  assert.equal(read.cuts.a.size, 0.6);
  assert.equal(read.cuts.b.size, 0.284);
  assert.equal(read.cuts.top.size, 0.288);
  const before = read;

  // Inspector: the elevation and cut table
  await run("select_entity", { id: ids.north }).catch(() => {});
  await page.locator(`[data-id="${ids.north}"]`).first().click({ force: true });
  const panel = page.getByRole("region", { name: "Wall tiling" });
  await panel.waitFor();
  await panel.getByRole("tab", { name: /Right side · Bathroom/ }).click();
  assert.equal(await panel.getByLabel("Tile length, long edge (mm)", { exact: true }).inputValue(), "600");
  assert.ok(await panel.locator('[data-piece="cut"]').count() > 0);
  assert.match(await panel.locator('tr[data-cut="b"]').textContent(), /284/);
  await panel.locator(".tile-elevation").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "shots/wall-tiling.png" });
  const sheetBefore = (await run("export_wall_tiling", { wallId: ids.north, side: "right" })).svg;

  // move the origin 10 mm toward B with the nudge button
  await panel.getByRole("button", { name: "Move origin 10 mm toward B" }).click();
  const after = await run("get_wall_tiling", { wallId: ids.north, side: "right" });
  assert.equal(after.tiling.originAlong.value, 0.01);
  assert.equal(after.tiling.originAlong.status, "proposed");
  assert.equal(after.cuts.a.size, 0.008);
  assert.equal(after.cuts.b.size, 0.274);
  assert.deepEqual(after.cuts.top, before.cuts.top);
  assert.match(await panel.locator('tr[data-cut="b"]').textContent(), /274/);
  assert.match(await panel.locator('tr[data-cut="a"]').textContent(), /\b8\b/);

  // the printed sheet follows, names the board reference and never says as-built
  const ex = await run("export_wall_tiling", { wallId: ids.north, side: "right" });
  assert.equal(ex.ok, true);
  assert.notEqual(ex.svg, sheetBefore);
  assert.match(sheetBefore, /data-cut="b">284</);
  assert.match(ex.svg, /data-cut="b">274</);
  assert.match(ex.svg, /data-cut="a">8</);
  assert.match(ex.svg, /to board face/);
  assert.match(ex.svg, /Board face \(Villaboard\) of/);
  assert.match(ex.svg, /PROPOSED SET-OUT · NOT AS-BUILT/);
  assert.match(ex.svg, /data-status="proposed"/);
  assert.doesNotMatch(ex.svg.replace(/NOT AS-BUILT/gi, ""), /as-built/i);
  if (process.env.TILING_SHEET_PNG) {
    const sheet = await browser.newPage({ viewport: { width: 1587, height: 1123 } });
    await sheet.setContent(`<style>html,body{margin:0}svg{width:1587px;height:1123px}</style>${ex.svg}`);
    await sheet.screenshot({ path: process.env.TILING_SHEET_PNG });
    await sheet.close();
  }

  // 3D: the proposed pieces are built on the tiled face
  await page.getByRole("button", { name: /Build 3D/ }).click();
  await page.waitForSelector(".scene3d canvas", { timeout: 15000 });
  await page.screenshot({ path: "shots/wall-tiling-3d.png" });

  // a board thickness change on a return wall moves the run end; the origin is measured from
  // that face, so it moves too and the 3 mm comes off the end B cut
  const west = (await run("get_wall_faces", { wallId: ids.west, side: "right" })).sides[0].layers;
  await run("set_wall_side", { wallId: ids.west, side: "right", layers: west.map((l, i) => ({ id: l.id, kind: l.kind, name: l.name, thickness: i === 0 ? P(0.013) : l.thickness })) });
  const thick = await run("get_wall_tiling", { wallId: ids.north, side: "right" });
  assert.equal(thick.limits.a.s, 0.013);
  assert.equal(thick.origin.s, 0.023);
  assert.equal(thick.cuts.a.size, 0.008);
  assert.equal(thick.cuts.b.size, 0.271);

  // an unknown board thickness: that end is unresolved, not defaulted
  await run("set_wall_side", { wallId: ids.west, side: "right", layers: west.map((l, i) => ({ id: l.id, kind: l.kind, name: l.name, thickness: i === 0 ? null : l.thickness })) });
  const unknown = await run("get_wall_tiling", { wallId: ids.north, side: "right", includeSvg: true });
  assert.equal(unknown.cuts, undefined);
  assert.ok(unknown.missing.some((m) => m.includes("Villaboard thickness")));
  assert.match(unknown.svg, /UNRESOLVED/);

  assert.deepEqual(errors, []);
  console.log("wall tiling e2e ok");
} finally {
  await browser.close();
}
