/** #52: genuine human group review and revision/reload flow, with synthetic evidence only. */
import { chromium } from "playwright";
import { strict as assert } from "node:assert";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const source = {
  url: "https://example.com/synthetic-pan.pdf",
  locator: "p. 2, dimensions",
};
const pub = (value) => ({ value, status: "published", sources: [source] });
const fields = () => ({
  width: pub(0.38),
  depth: pub(0.64),
  height: pub(0.8),
  panType: pub("back-to-wall"),
  cistern: pub("close-coupled"),
  inletEntry: pub("bottom"),
  power: pub("not-required"),
  trap: pub("S"),
  sTrapSetoutMin: pub(0.14),
  sTrapSetoutMax: pub(0.2),
  inletHeight: pub(0.3),
});
const run = (name, args = {}) =>
  page.evaluate(
    ([tool, input]) => window.__alza.runTool(tool, input),
    [name, args],
  );
const detail = page.getByRole("region", { name: "Selected request" });
const row = (key) => detail.locator(`tr[data-field="${key}"]`);
async function openProducts(model) {
  if (await page.getByLabel("New project name").isVisible()) {
    await page
      .getByLabel("New project name")
      .fill(`Review reload ${Date.now()}`);
    await page.getByRole("button", { name: "Create blank" }).click();
  }
  await page.waitForFunction(() => !!window.__alza);
  if (!(await page.getByRole("region", { name: "Requests" }).isVisible()))
    await page.getByRole("button", { name: /^Products/ }).click();
  if (model)
    await page
      .getByRole("region", { name: "Requests" })
      .getByRole("button", { name: new RegExp(`Synthetic Co ${model}`) })
      .click();
}
async function create(model) {
  const form = page.getByRole("form", { name: "New product request" });
  await form.getByLabel("Category").selectOption("toilet");
  await form.getByLabel("Brand").fill("Synthetic Co");
  await form.getByLabel("Model").fill(model);
  await form.getByRole("button", { name: "Open request" }).click();
  const list = await run("list_product_requests");
  return list.requests.find((request) => request.known.model === model).id;
}
async function submit(id, model, values) {
  const result = await run("submit_product_spec", {
    requestId: id,
    manufacturer: "Synthetic Co",
    model,
    fields: values,
  });
  assert.equal(result.ok, true, result.summary);
}
async function group(groupName, count) {
  const summary = detail
    .locator("summary")
    .filter({ hasText: new RegExp(`^Review ${groupName} \\(`) });
  await summary.click();
  const evidence = detail.getByRole("table", {
    name: `${groupName} group evidence`,
  });
  assert.match(await evidence.textContent(), /published.*example\.com.*p\. 2/);
  await detail
    .getByRole("button", {
      name: `Accept ${count} clean ${groupName} fields`,
      exact: true,
    })
    .click();
}
async function saved(id) {
  return page.evaluate(
    (requestId) =>
      JSON.parse(localStorage.getItem("alza.products.v1")).requests.find(
        (request) => request.id === requestId,
      ),
    id,
  );
}
try {
  await page.goto(process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5252/");
  await page.evaluate(() => {
    localStorage.removeItem("alza.products.v1");
    localStorage.removeItem("alza.projects.v1");
  });
  await page.reload();
  await page.getByLabel("New project name").fill("Synthetic review groups");
  await page.getByRole("button", { name: "Create blank" }).click();
  await openProducts();
  const completeId = await create("Complete pan");
  await submit(completeId, "Complete pan", fields());
  await group("envelope", 3);
  await group("rough-in", 6);
  await group("installation", 2);
  assert.equal((await saved(completeId)).status, "submitted");
  assert.equal(
    Object.values((await saved(completeId)).reviews).filter(
      (review) => review.method === "group",
    ).length,
    11,
  );
  assert.equal((await run("get_product_library")).products.length, 0);
  await detail
    .getByRole("button", { name: "Accept product", exact: true })
    .click();
  assert.equal((await saved(completeId)).status, "accepted");
  await page.reload();
  await openProducts("Complete pan");
  assert.equal((await run("get_product_library")).products.length, 1);

  const mixedId = await create("Mixed pan");
  const mixed = fields();
  mixed.height = {
    value: null,
    note: "Not published after checking the guide.",
  };
  mixed.depth.reference = "frame";
  mixed.sTrapSetoutMin.alternatives = [{ value: 0.15, source }];
  mixed.pTrapWasteHeight = pub(0.18);
  await submit(mixedId, "Mixed pan", mixed);
  const completeness = detail.getByRole("region", {
    name: "Research completeness",
  });
  assert.match(
    await completeness.textContent(),
    /1 unknown.*1 conflicts.*1 datum mismatches/,
  );
  await row("inletEntry")
    .getByLabel("Reason to reject Water inlet entry")
    .fill("Confirm entry side");
  await row("inletEntry")
    .getByRole("button", { name: "Reject", exact: true })
    .click();
  await group("envelope", 1);
  await group("rough-in", 4);
  await group("installation", 2);
  await page.screenshot({
    path: "/tmp/product-review-summary.png",
    fullPage: true,
  });
  let brief = await run("get_product_brief", { requestId: mixedId });
  assert.deepEqual(brief.completeness.unknownRequired, ["height"]);
  for (const key of ["depth", "height", "sTrapSetoutMin", "pTrapWasteHeight"])
    assert.ok(brief.completeness.pending.includes(key));
  assert.deepEqual(brief.completeness.rejected, ["inletEntry"]);
  for (const tool of [
    "accept_product",
    "review_product_field",
    "review_product_group",
    "reuse_product_reviews",
  ])
    assert.notEqual(
      (await run(tool, { requestId: mixedId, group: "envelope" }))?.ok,
      true,
    );
  await detail
    .getByRole("button", { name: "Accept product", exact: true })
    .click();
  assert.match(
    await detail.getByRole("alert").last().textContent(),
    /Not accepted/,
  );
  await page.reload();
  await openProducts("Mixed pan");
  assert.match(
    await row("inletEntry").textContent(),
    /rejected: Confirm entry side/,
  );
  assert.equal((await saved(mixedId)).reviews.width.method, "group");
  await detail
    .getByLabel("Feedback for the agent")
    .fill("Recheck changed width and entry");
  await detail
    .getByRole("button", { name: "Return to agent", exact: true })
    .click();
  const corrected = structuredClone(mixed);
  corrected.width = pub(0.4);
  corrected.depth = { ...pub(0.66), reference: "frame" };
  corrected.inletEntry = pub("side");
  corrected.sTrapSetoutMin = pub(0.14);
  await submit(mixedId, "Mixed pan", corrected);
  assert.deepEqual((await saved(mixedId)).reviews, {});
  assert.equal(
    (await saved(mixedId)).previousRejections.inletEntry,
    "Confirm entry side",
  );
  assert.match(
    await row("inletEntry").textContent(),
    /Previously rejected: Confirm entry side/,
  );
  brief = await run("get_product_brief", { requestId: mixedId });
  assert.equal(brief.completeness.reuse.length, 6);
  assert.ok(
    !brief.completeness.groups
      .find((group) => group.group === "rough-in")
      .eligible.includes("inletEntry"),
  );
  await page.reload();
  await openProducts("Mixed pan");
  await detail
    .locator("summary")
    .filter({ hasText: "6 unchanged accepted reviews available" })
    .click();
  await detail
    .getByRole("button", {
      name: "Reuse 6 unchanged accepted reviews",
      exact: true,
    })
    .click();
  assert.equal((await saved(mixedId)).reviews.cistern.method, "reused");
  await group("envelope", 1);
  await group("rough-in", 1);
  for (const key of ["depth", "height", "inletEntry", "pTrapWasteHeight"])
    await row(key).getByRole("button", { name: "Accept", exact: true }).click();
  assert.equal((await saved(mixedId)).submission.fields.height.value, null);
  assert.equal((await saved(mixedId)).status, "submitted");
  await detail
    .getByRole("button", { name: "Accept product", exact: true })
    .click();
  assert.equal((await saved(mixedId)).status, "accepted");
  await page.reload();
  await openProducts("Mixed pan");
  assert.equal((await run("get_product_library")).products.length, 2);
  assert.equal((await saved(mixedId)).submission.fields.height.value, null);
  assert.deepEqual(errors, []);
  console.log(
    "PASS #52: three human groups, mixed eligibility, rejection, separate acceptance, explicit unchanged reuse and reload; unknown preserved; no agent review/accept tools",
  );
} catch (error) {
  console.error(await page.locator("body").innerText());
  await page.screenshot({
    path: "/tmp/product-review-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
