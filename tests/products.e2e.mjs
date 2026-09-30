/**
 * Issue #30 end-to-end check: a request opened on the Products page, completed by the agent
 * through tools, reviewed and accepted by a human on the page, and found again from another
 * project after a reload. Product data is synthetic; sources point at example.com.
 *
 * Run with the studio dev server up:  ALZA_BASE_URL=http://127.0.0.1:5199/ node tests/products.e2e.mjs
 */
import { chromium } from "playwright";
import { strict as assert } from "node:assert";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const sheet = { url: "https://example.com/pan-spec.pdf", locator: "p. 2" };
const pub = (value) => ({ value, status: "published", sources: [sheet] });

try {
  await page.goto(process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5199/");
  await page.evaluate(() => localStorage.removeItem("alza.products.v1"));
  await page.reload();
  await page.getByLabel("New project name").fill("Bathroom A");
  await page.getByRole("button", { name: "Create blank" }).click();
  const run = (name, args = {}) => page.evaluate(([tool, input]) => window.__alza.runTool(tool, input), [name, args]);

  // Human opens two requests on the page
  await page.getByRole("button", { name: /^Products/ }).click();
  const form = page.getByRole("form", { name: "New product request" });
  await form.getByLabel("Category").selectOption("vanity");
  await form.getByLabel("Notes").fill("910 × 465 footprint from #1");
  await form.getByRole("button", { name: "Open request" }).click();
  assert.match(await form.getByRole("alert").textContent(), /identifies the product/);
  await form.getByLabel("Brand").fill("Example Co");
  await form.getByLabel("Model").fill("Test Vanity 900");
  await form.getByRole("button", { name: "Open request" }).click();
  await form.getByLabel("Category").selectOption("toilet");
  await form.getByLabel("Brand").fill("Example Co");
  await form.getByLabel("Model").fill("Test Pan");
  await form.getByRole("button", { name: "Open request" }).click();

  // Agent reads the brief and completes it
  const list = await run("list_product_requests");
  assert.deepEqual(list.requests.map((r) => [r.category, r.status]), [["vanity", "open"], ["toilet", "open"]]);
  const toiletId = list.requests[1].id;
  const brief = await run("get_product_brief", { requestId: toiletId });
  assert.equal(brief.category.id, "toilet");
  assert.ok(brief.protocol.length >= 5);
  assert.ok(brief.fields.find((f) => f.key === "sTrapSetoutMin").reference === "finished-wall");

  const fields = {
    width: pub(0.38), depth: pub(0.64), height: pub(0.8),
    panType: pub("wall-faced"), trap: pub("S"),
    sTrapSetoutMin: { ...pub(0.14), alternatives: [{ value: 0.135, source: { url: "https://example.org/listing", locator: "dimensions table" } }] },
    sTrapSetoutMax: pub(0.2),
    inletHeight: { value: null, note: "Not on the spec sheet or the installation guide." },
  };
  const wrongUnit = await run("submit_product_spec", { requestId: toiletId, manufacturer: "Example Co", model: "Test Pan", fields: { ...fields, depth: pub(640) } });
  assert.equal(wrongUnit.ok, false);
  assert.match(wrongUnit.summary, /outside .* metres/);
  const claimedMeasured = await run("submit_product_spec", { requestId: toiletId, manufacturer: "Example Co", model: "Test Pan", fields: { ...fields, width: { value: 0.38, status: "measured" } } });
  assert.equal(claimedMeasured.ok, false);
  assert.match(claimedMeasured.summary, /must be `published`/);
  const submitted = await run("submit_product_spec", { requestId: toiletId, manufacturer: "Example Co", model: "Test Pan", fields });
  assert.equal(submitted.ok, true, submitted.summary);
  assert.deepEqual(submitted.warnings.map((w) => w.code).sort(), ["required_unknown", "sources_disagree"]);

  // There is no tool that accepts a product
  const noAccept = await run("accept_product", { requestId: toiletId });
  assert.notEqual(noAccept?.ok, true);

  // Human reviews on the page
  await page.getByRole("button", { name: /^Products/ }).filter({ hasText: "1 to review" }).count().then((n) => assert.equal(n, 1));
  await page.getByRole("region", { name: "Requests" }).getByRole("button", { name: /Toilet suite: Example Co Test Pan/ }).click();
  const detail = page.getByRole("region", { name: "Selected request" });
  assert.match(await detail.locator('tr[data-field="sTrapSetoutMin"]').textContent(), /140 mm.*example\.com.*example\.org\/listing \(dimensions table\) gives 135 mm, not 140 mm/);
  assert.match(await detail.locator('tr[data-field="inletHeight"]').textContent(), /unknown.*Not on the spec sheet/);
  await detail.getByRole("button", { name: "Accept product" }).click();
  assert.match(await detail.getByRole("alert").last().textContent(), /Review every field first/);
  const rows = detail.locator("tbody tr[data-field]");
  for (let i = 0; i < await rows.count(); i++) await rows.nth(i).getByRole("button", { name: "Accept" }).click();
  await detail.getByRole("button", { name: "Accept product" }).click();
  assert.match(await detail.textContent(), /status accepted/);
  const card = page.getByRole("region", { name: "Library" }).locator("details");
  assert.match(await card.textContent(), /Example Co Test Pan · Toilet suite · 380 × 640 × 800 mm/);
  await card.locator("summary").click();
  assert.match(await card.locator('tr[data-point="waste-s"]').textContent(), /140–200 mm from finished wall/);
  assert.match(await card.locator('tr[data-point="inlet"]').textContent(), /missing inletOffset, inletHeight/);

  // Reload, open another project: the library is still there, figures still published, unknown still unknown
  await page.reload();
  await page.getByLabel("New project name").fill("Bathroom B");
  await page.getByRole("button", { name: "Create blank" }).click();
  const lib = await run("get_product_library");
  assert.equal(lib.products.length, 1);
  assert.equal(lib.products[0].fields.depth.status, "published");
  assert.equal(lib.products[0].fields.inletHeight.value, null);
  assert.deepEqual(lib.products[0].roughIn.map((p) => [p.id, p.resolved]), [["waste-s", true], ["inlet", false]]);
  await page.getByRole("button", { name: /^Products/ }).click();
  assert.equal(await page.getByRole("region", { name: "Library" }).locator("details").count(), 1);
  const reqs = await run("list_product_requests");
  assert.deepEqual(reqs.requests.map((r) => r.status), ["open", "accepted"]);

  assert.deepEqual(errors, []);
  console.log("PASS: page request, agent brief + rejected + accepted submission, no accept tool, human review, library across projects after reload");
} finally {
  await browser.close();
}
