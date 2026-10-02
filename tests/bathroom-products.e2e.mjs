/** #50: explicitly synthetic product evidence; genuine page human review, library reload,
 * supported canonical placement/diagram/specification and explicit refusal of unsupported modes.
 * ALZA_BASE_URL=http://127.0.0.1:5250/ node tests/bathroom-products.e2e.mjs */
import { chromium } from "playwright";
import { strict as assert } from "node:assert";
import { fittingCases, pub, unknown, powered } from "./bathroom-products-fixtures.mjs";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
try {
  await page.goto(process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5250/");
  await page.getByLabel("New project name").fill("Synthetic fitting flow #50");
  await page.getByRole("button", { name: "Create blank" }).click();
  const run = (name, args = {}) => page.evaluate(([tool, input]) => window.__alza.runTool(tool, input), [name, args]);
  await page.getByRole("button", { name: /^Products/ }).click();
  const form = page.getByRole("form", { name: "New product request" });
  const detail = page.getByRole("region", { name: "Selected request" });
  const requestIds = [];
  for (const c of fittingCases) {
    await form.getByLabel("Category").selectOption(c.category);
    await form.getByLabel("Brand").fill("Synthetic Co");
    await form.getByLabel("Model").fill(`Synthetic ${c.category}`);
    await form.getByLabel("Notes").fill("Explicitly synthetic test evidence; example.com is not a real specification.");
    await form.getByRole("button", { name: "Open request" }).click();
    const req = (await run("list_product_requests")).requests.at(-1);
    requestIds.push(req.id);
    const brief = await run("get_product_brief", { requestId: req.id });
    assert.equal(brief.category.id, c.category);
    assert.ok(brief.placement.limitation);
    assert.ok(brief.fields.every((f) => f.definition && f.unit && (f.type !== "length" || f.reference)));
    const fields = { ...c.fields, [c.unknownKey]: unknown() };
    const bad = await run("submit_product_spec", { requestId: req.id, manufacturer: "Synthetic Co", model: `Synthetic ${c.category}`, fields: { ...fields, width: pub(600) } });
    assert.equal(bad.ok, false, bad.summary);
    const result = await run("submit_product_spec", { requestId: req.id, manufacturer: "Synthetic Co", model: `Synthetic ${c.category}`, fields });
    assert.equal(result.ok, true, result.summary);
    assert.ok(result.warnings.some((w) => w.code === "required_unknown" && w.field === c.unknownKey));
    assert.notEqual((await run("accept_product", { requestId: req.id }))?.ok, true);
    await detail.getByRole("button", { name: "Accept product" }).click();
    assert.match(await detail.getByRole("alert").last().textContent(), /Review every field/);
    assert.match(await detail.locator(`tr[data-field="${c.unknownKey}"]`).textContent(), /unknown.*Synthetic test/);
    const rows = detail.locator("tbody tr[data-field]");
    for (let i = 0; i < await rows.count(); i++) await rows.nth(i).getByRole("button", { name: "Accept", exact: true }).click();
    await detail.getByRole("button", { name: "Accept product" }).click();
    assert.match(await detail.textContent(), /status accepted/);
  }

  // Conditional variants pass the same real human review boundary.
  const variants = [
    { category: "shower-screen", fields: { ...fittingCases[2].fields, opening: pub("hinged"), openingWidth: unknown(), openingLayout: pub("Synthetic: left pivot, outward swing 0–90 degrees from closed plane.") }, missing: "openingLayout" },
    { category: "mirror", fields: { ...fittingCases[5].fields, ...powered, mounting: pub("recessed"), recessDepth: unknown(), recessOpening: pub("Synthetic: 600 × 800 mm clear opening at finished wall.") }, missing: "powerRequirements" },
    { category: "towel-rail", fields: { ...fittingCases[4].fields, heating: pub("dual"), waterConnection: unknown() }, missing: "powerConnection" },
    { category: "towel-rail", supported: true, fields: { ...fittingCases[4].fields, mounting: pub("floor-standing"), fixingLayout: unknown() }, missing: "powerHeight" },
  ];
  for (const [i, c] of variants.entries()) {
    const req = await run("request_product", { category: c.category, brand: "Synthetic Co", model: `Conditional ${i}` });
    assert.equal(req.ok, true);
    const invalid = { ...c.fields }; delete invalid[c.missing];
    assert.equal((await run("submit_product_spec", { requestId: req.requestId, manufacturer: "Synthetic Co", model: `Conditional ${i}`, fields: invalid })).ok, false);
    const submit = await run("submit_product_spec", { requestId: req.requestId, manufacturer: "Synthetic Co", model: `Conditional ${i}`, fields: c.fields });
    assert.equal(submit.ok, true, submit.summary);
    const rows = detail.locator("tbody tr[data-field]");
    for (let j = 0; j < await rows.count(); j++) await rows.nth(j).getByRole("button", { name: "Accept", exact: true }).click();
    await detail.getByRole("button", { name: "Accept product" }).click();
  }
  assert.equal(await page.getByRole("region", { name: "Library" }).locator("details").count(), 10);
  await page.reload();
  await page.getByLabel("New project name").fill("Synthetic placement #50");
  await page.getByRole("button", { name: "Create blank" }).click();
  const lib = await run("get_product_library");
  assert.equal(lib.products.length, 10);
  for (const c of fittingCases) {
    const p = lib.products.find((p) => p.model === `Synthetic ${c.category}`);
    assert.equal(p.fields[c.unknownKey].value, null);
    assert.equal(p.fields.width.status, "published");
  }
  const wall = await run("add_wall", { ax: 0, ay: 0, bx: 3, by: 0, thickness: 0.1, height: 2.4 });
  assert.equal(wall.ok, true);
  assert.equal((await run("set_wall_side", { wallId: wall.id, side: "right", existing: { value: 0, status: "measured" }, frame: { value: 0, status: "measured" }, layers: [{ kind: "tile", thickness: { value: 0.01, status: "proposed" } }] })).ok, true);
  const modelJson = () => page.evaluate(() => JSON.stringify(window.__alza.store.getState().model));
  for (const p of lib.products) {
    const c = fittingCases.find((c) => p.model === `Synthetic ${c.category}`);
    const variant = variants.find((_, i) => p.model === `Conditional ${i}`);
    const before = await modelJson();
    const result = await run("place_product", { productId: p.id, wallId: wall.id, side: "right", face: "finished", distance: p.category === "tapware" ? 0.5 : p.category === "towel-rail" ? 2.65 : 1.8, status: "proposed", source: "Synthetic project set-out, separate from published product requirements" });
    assert.equal(result.ok, c?.supported ?? variant?.supported ?? false, result.summary);
    if (!result.ok) {
      assert.match(result.summary, /Unsupported product placement.*#51/);
      assert.equal(await modelJson(), before);
    }
  }
  await run("set_sheet_info", { project: "Synthetic product placement", site: "Test only", preparedBy: "Synthetic reviewer" });
  assert.equal((await run("set_diagram_view", { label: "Synthetic fit-out", visible: ["walls", "fixtures", "services-water", "services-power"] })).ok, true);
  const view = await run("get_diagram_view", { includeSvg: true });
  assert.equal(view.ok, true, view.summary);
  assert.equal(view.exportable, true, JSON.stringify(view.findings));
  assert.ok(view.spec.some((r) => r.property === "width" && r.status === "published" && r.datum === "fixture-end"));
  assert.ok(view.spec.some((r) => r.property === "fixingLayout" && r.value === "?"));
  const exported = await run("export_diagram_view", { includeOutputs: true });
  assert.equal(exported.ok, true, exported.summary);
  assert.match(exported.svg, /Synthetic tapware/);
  assert.match(exported.specHtml, /Synthetic shower-screen/);
  assert.match(exported.specHtml, /synthetic-fitting\.pdf/);
  assert.deepEqual(errors, []);
  console.log("PASS: six synthetic briefs plus hinged/powered/recessed/dual/floor-standing conditionals → genuine human review → persisted library → three supported placements and explicit refusals → canonical diagram/specification");
} finally { await browser.close(); }
