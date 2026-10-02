/** #47 regression story. All sources and fitting identities below are synthetic. */
import { chromium } from "playwright";
import { strict as assert } from "node:assert";

const base = process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5248/";
const browser = await chromium.launch({ headless: true });
const errors = [];
const source = { url: "https://example.com/synthetic-components.pdf", locator: "p. 2, components" };
const pub = value => ({ value, status: "published", sources: [source] });
const known = value => ({ state: "known", value, sources: [source] });
const component = { name: "Waste", code: known("WASTE-32"), quantity: 1, provision: "separately-required", sources: [source] };
const vanity = { manufacturer: "Synthetic Co", model: "Synthetic omission", fields: { width: pub(.9), depth: pub(.45), height: pub(.6), mounting: pub("wall-hung"), benchHeight: pub(.85), wasteHeight: pub(.5), tapHoles: pub(1) } };
const runOn = page => (name, args = {}) => page.evaluate(([name, args]) => window.__alza.runTool(name, args), [name, args]);
async function start(context, name) {
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(base);
  await page.getByLabel("New project name").fill(name);
  await page.getByRole("button", { name: "Create blank" }).click();
  return page;
}
async function acceptOnPage(detail) {
  const rows = detail.locator("tr[data-field]");
  for (let i = 0; i < await rows.count(); i++) await rows.nth(i).getByRole("button", { name: "Accept", exact: true }).click();
  await detail.getByRole("button", { name: "Accept product" }).click();
  assert.match(await detail.textContent(), /status accepted/);
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await start(context, "Synthetic review regressions");
  const run = runOn(page);
  await page.getByRole("button", { name: /^Products/ }).click();
  const req = await run("request_product", { category: "vanity", brand: "Synthetic Co", model: vanity.model, componentsStatus: "documented", components: [component] });
  // Research omits the entire new component block, as a legacy agent may do.
  const omitted = await run("submit_product_spec", { requestId: req.requestId, ...vanity });
  assert.equal(omitted.ok, true, omitted.summary);
  assert.ok(omitted.warnings.some(w => /WASTE-32.*separately-required.*omits/.test(w.message)));
  const detail = page.getByRole("region", { name: "Selected request" });
  const evidence = detail.getByRole("region", { name: "Exact product identity" });
  assert.equal(await evidence.count(), 2);
  assert.match(await evidence.first().textContent(), /WASTE-32.*separately-required/s);
  assert.match(await evidence.last().textContent(), /request says documented; research says unknown/);
  await detail.getByRole("button", { name: "Accept product" }).click();
  assert.match(await detail.getByRole("alert").last().textContent(), /components/);
  const componentRow = detail.locator('tr[data-field="components"]');
  await componentRow.getByLabel("Reason to reject components").fill("The supplied sheet requires WASTE-32 separately");
  await componentRow.getByRole("button", { name: "Reject", exact: true }).click();
  assert.match(await componentRow.textContent(), /rejected: The supplied sheet requires WASTE-32 separately/);
  await detail.getByRole("button", { name: "Return to agent" }).click();
  assert.match(await detail.textContent(), /Returned to the agent: components: The supplied sheet requires WASTE-32 separately/);
  assert.equal((await run("submit_product_spec", { requestId: req.requestId, ...vanity, componentsStatus: "documented", components: [component] })).ok, true);
  await acceptOnPage(detail);
  assert.equal(await evidence.count(), 2); // Request evidence remains available after acceptance.
  assert.match(await evidence.first().textContent(), /WASTE-32.*separately-required/s);
  assert.match(await evidence.last().textContent(), /WASTE-32.*separately-required/s);
  assert.equal((await run("get_product_library")).products[0].components[0].provision, "separately-required");

  const wall = await run("add_wall", { ax: 0, ay: 0, bx: 4, by: 0, thickness: .1, height: 2.4 });
  assert.equal((await run("set_wall_side", { wallId: wall.id, side: "right", existing: { value: 0, status: "measured" }, layers: [] })).ok, true);
  for (const hand of ["left", "right", "reversible", "legacy"]) {
    const bath = { manufacturer: "Synthetic Co", model: `Synthetic ${hand} bath`, ...(hand !== "legacy" ? { identity: { code: known(`BATH-${hand}`), handedness: known(hand) } } : {}), fields: { length: pub(1.2), width: pub(1.2), height: pub(.5), installation: pub("corner"), shape: pub("corner-round"), frontWidth: pub(1.5), frontProjection: pub(1.1), wasteFromEnd: pub(.2), wasteFromSide: pub(.2), surround: pub("tiled-frame") } };
    const request = await run("request_product", { category: "bath", brand: "Synthetic Co", model: bath.model });
    const submitted = await run("submit_product_spec", { requestId: request.requestId, ...bath });
    assert.equal(submitted.ok, true, submitted.summary);
    await acceptOnPage(detail);
    const product = (await run("get_product_library")).products.at(-1);
    const initialDistance = hand === "right" ? 3.2 : .8;
    const placed = await run("place_product", { productId: product.id, wallId: wall.id, side: "right", face: "existing", distance: initialDistance, status: "proposed" });
    assert.equal(placed.ok, true, placed.summary);
    const opposite = hand === "right" ? "left" : "right";
    const catalogue = await run("get_item_catalog");
    const oppositeKind = `product_${product.id}_${opposite}`;
    const fixed = ["left", "right"].includes(hand);
    assert.equal(JSON.stringify(catalogue).includes(oppositeKind), !fixed);
    if (fixed) assert.equal((await run("place_item", { kind: oppositeKind, x: 3.2, y: 1 })).ok, false);
    const moved = await run("anchor_fixture", { itemId: placed.id, wallId: wall.id, side: "right", face: "existing", distance: hand === "right" ? .8 : 3.2, status: "proposed" });
    assert.equal(moved.ok, !fixed, moved.summary);
  }
  await page.screenshot({ path: "/tmp/layout-bench-47-review-recovery.png", fullPage: true });
  await context.close();

  for (const invalid of ["identity", "components"]) {
    const submission = { ...vanity, identity: { finish: known("Chrome") }, componentsStatus: "documented", components: [structuredClone(component)], at: 0, warnings: [] };
    if (invalid === "identity") submission.identity.finish = null;
    else submission.components[0].code = null;
    const raw = JSON.stringify({ version: 1, products: [], requests: [{ id: "corrupt-synthetic", category: "vanity", known: { brand: "Synthetic Co" }, status: "submitted", createdAt: 0, reviews: {}, submission }] });
    const context = await browser.newContext();
    await context.addInitScript(raw => localStorage.setItem("alza.products.v1", raw), raw);
    const recovery = await start(context, `Synthetic corrupt ${invalid}`);
    await recovery.getByRole("button", { name: /^Products/ }).click();
    assert.match(await recovery.getByRole("alert").textContent(), /Invalid product identity evidence.*Original browser data was kept/);
    assert.deepEqual((await runOn(recovery)("list_product_requests")).requests, []);
    await runOn(recovery)("request_product", { category: "vanity", brand: "Synthetic recovery attempt" });
    assert.equal(await recovery.evaluate(() => localStorage.getItem("alza.products.v1")), raw);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log("PASS #47 regressions: omitted components flagged, visible evidence/rejection reasons, corrected human acceptance, fixed hand has no opposite catalogue entry, reversible/legacy movement, malformed saved submissions preserve raw data without page errors");
} finally { await browser.close(); }
