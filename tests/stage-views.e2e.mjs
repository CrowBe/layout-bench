/**
 * Issue #41 end-to-end check: construction-stage views over one canonical bathroom.
 *
 * Builds the bathroom through the tools, then composes, inspects and exports stage views by
 * visibility alone. An unknown id (a heating-cable layer the model does not have) is refused
 * with nothing changed. Switching stages changes what the diagram and specification sheet show;
 * the project model is byte-identical before and after. The Sheets tab shows the composed view
 * and downloads both outputs.
 *
 * Run with the studio dev server up:  ALZA_BASE_URL=http://127.0.0.1:5199/ node tests/stage-views.e2e.mjs
 */
import { chromium } from "playwright";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

try {
  await page.goto(process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5199/");
  await page.getByLabel("New project name").fill("Stage views");
  await page.getByRole("button", { name: "Create blank" }).click();
  const run = (name, args = {}) => page.evaluate(([tool, input]) => window.__alza.runTool(tool, input), [name, args]);
  const modelJson = () => page.evaluate(() => JSON.stringify(window.__alza.store.getState().model));
  const P = (value) => ({ value, status: "proposed" });

  const corners = [[0, 0], [2.11, 0], [2.11, 3.02], [0, 3.02]];
  const walls = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    walls.push((await run("add_wall", { ax, ay, bx, by, thickness: 0.1, height: 2.4 })).id);
    await run("set_wall_side", { wallId: walls[i], side: "right", existing: { value: 0, status: "measured", source: "survey" }, frame: { value: -0.015, status: "site-confirmed" },
      layers: [{ kind: "board", name: "Villaboard 6 mm", thickness: P(0.006) }, { kind: "waterproofing", name: "Membrane", thickness: P(0.001) }, { kind: "adhesive", name: "Adhesive" }, { kind: "tile", name: "Wall tile", thickness: P(0.009) }] });
  }
  await run("add_room", { x: 0, y: 0, w: 2.11, h: 3.02, label: "Bathroom", floor: "tile" });
  await run("add_window", { wallId: walls[0], centre: 1.055, width: 1.755, sill: 1.52, height: 0.6 });
  await run("add_door", { wallId: walls[2], centre: 0.52, from: "b", width: 0.8, height: 2.04 });
  await run("set_room_floor", { room: "Bathroom", substrateTop: { value: -0.02, status: "measured" }, layers: [{ kind: "waterproofing", thickness: P(0.001) }, { kind: "screed", thickness: P(0.03) }, { kind: "adhesive", thickness: P(0.004) }, { kind: "tile", thickness: P(0.01) }] });
  await run("define_item_kind", { kind: "vanity_e2e", label: "Vanity", w: 0.91, d: 0.465, h: 0.85, category: "bath" });
  const vanity = (await run("place_item", { kind: "vanity_e2e", x: 1, y: 1 })).id;
  await run("anchor_fixture", { itemId: vanity, wallId: walls[1], side: "right", face: "frame", gap: 0.03, distance: 1.7, status: "proposed" });
  await run("set_service_point", { itemId: vanity, id: "vw", label: "Wall waste", service: "waste", face: "frame", out: 0, across: 0.1, up: 0.55, status: "proposed", source: "install guide p. 3" });
  await run("set_service_point", { itemId: vanity, id: "gpo", label: "GPO", service: "power", face: "frame", out: 0, across: 0.3, status: "proposed" });
  await run("set_sheet_info", { project: "Bathroom renovation", site: "Main bathroom", preparedBy: "Owner" });

  const before = await modelJson();
  const undoBefore = await page.evaluate(() => window.__alza.store.getState().undoStack.length);

  // What can be shown: real layers only, and what is not modelled
  const content = await run("list_diagram_content");
  assert.equal(content.ok, true);
  const layerIds = content.layers.map((l) => l.id);
  for (const l of ["walls", "wall-frame", "wall-board", "wall-waterproofing", "floor-screed", "fixtures", "services-waste", "services-power"]) assert.ok(layerIds.includes(l), l);
  assert.ok(!layerIds.some((l) => /heat/.test(l)));
  assert.match(content.notModelled.join(" "), /heating cable/);

  // An unknown id is refused whole
  const refused = await run("set_diagram_view", { label: "5. Heating cable", visible: ["floor-screed", "floor-heating-cable"] });
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.unknown, ["floor-heating-cable"]);
  // a known layer kind with nothing recorded is refused too, and the reason says so
  const empty = await run("set_diagram_view", { label: "3. Rough-in", visible: ["walls", "services-water"] });
  assert.equal(empty.ok, false);
  assert.match(empty.summary, /services-water: a known layer kind with nothing recorded/);
  assert.equal((await run("get_diagram_view")).ok, false);

  const shell = ["walls", "rooms", "doors", "windows"];
  const stages = [
    ["1. Post-demolition", [...shell, "wall-existing", "wall-frame", "floor-substrate"]],
    ["2. Initial surfacing and window", [...shell, "wall-frame", "wall-board", "floor-substrate"]],
    ["3. Plumbing and electrical rough-in", [...shell, "wall-frame", "services-waste", "services-power"]],
    ["4. Waterproofing", [...shell, "wall-board", "wall-waterproofing", "floor-waterproofing"]],
    ["5. In-screed heating cable (not modelled: substrate shown)", [...shell, "floor-substrate", "floor-waterproofing"]],
    ["6. Screed", [...shell, "floor-screed"]],
    ["7. Adhesive", [...shell, "wall-adhesive", "floor-adhesive"]],
    ["8. Tiles", [...shell, "wall-tile", "floor-tile"]],
    ["9. Fit-out", [...shell, "wall-tile", "floor-tile", "fixtures", "services-waste", "services-power"]],
  ];
  const outputs = [];
  for (const [label, visible] of stages) {
    const set = await run("set_diagram_view", { label, visible });
    assert.equal(set.ok, true, `${label}: ${set.summary}`);
    const view = await run("get_diagram_view");
    assert.equal(view.exportable, true, `${label}: ${JSON.stringify(view.findings.filter((f) => f.severity === "blocking"))}`);
    const out = await run("export_diagram_view", { includeOutputs: true });
    assert.equal(out.ok, true, out.summary);
    const svgIds = new Set([...out.svg.matchAll(/data-element="([^"]+)"/g)].map((m) => m[1]));
    const specIds = new Set([...out.specHtml.matchAll(/data-element="([^"]+)"/g)].map((m) => m[1]));
    const visibleIds = new Set(view.elements.map((e) => e.id));
    for (const id of svgIds) assert.ok(visibleIds.has(id), `${label}: diagram shows hidden ${id}`);
    assert.deepEqual([...specIds].sort(), [...visibleIds].sort(), `${label}: spec rows differ from the view`);
    assert.deepEqual(out.elements.sort(), [...visibleIds].sort());
    outputs.push(out);
  }
  // rough-in shows the GPO with its unknown height as "?", never a number
  assert.match(outputs[2].specHtml, /GPO[\s\S]*?up from finished floor \(mm\)<\/td><td>\?<\/td>/);
  assert.match(outputs[2].specHtml, /install guide p\. 3/);
  // the fit-out shows the vanity; post-demolition does not
  assert.ok(outputs[8].svg.includes(`data-element="item:${vanity}"`));
  assert.ok(!outputs[0].svg.includes(`data-element="item:${vanity}"`));
  // the adhesive stage keeps the unknown adhesive unknown
  assert.match(outputs[6].svg, /Adhesive \? \(position unresolved\)/);
  assert.equal(new Set(outputs.map((o) => o.svg)).size, 9);

  // The canonical model is untouched by nine compose/inspect/export cycles
  assert.equal(await modelJson(), before);
  assert.equal(await page.evaluate(() => window.__alza.store.getState().undoStack.length), undoBefore);
  assert.equal((await run("list_sheets")).sheets[0].revisions.length, 0);

  // Switch back to an earlier stage: same content as before
  await run("set_diagram_view", { label: stages[2][0], visible: stages[2][1] });
  const back = await run("export_diagram_view", { includeOutputs: true });
  assert.deepEqual(back.elements.sort(), outputs[2].elements.sort());

  // A person sees the stage view and downloads both outputs from the Sheets tab
  await page.getByRole("button", { name: "Sheets", exact: true }).click();
  const card = page.locator(".stage-view-card");
  assert.match(await card.textContent(), /3\. Plumbing and electrical rough-in: \d+ element\(s\) visible/);
  assert.equal(await card.locator("svg[data-sheet='stage-view']").count(), 1);
  const dl = page.waitForEvent("download");
  await card.getByRole("button", { name: /spec \(HTML\)/ }).click();
  const file = readFileSync(await (await dl).path(), "utf8");
  assert.match(file, /Specification: 3\. Plumbing and electrical rough-in/);

  assert.deepEqual(errors, []);
  console.log("PASS: real layers listed, unknown id refused, 9 stages composed and exported with matching diagram/spec content, model unchanged, switch back, Sheets tab download");
} finally {
  await browser.close();
}
