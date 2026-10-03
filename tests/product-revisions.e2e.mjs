/** #53: real human revision acceptance, cancellation and selected updates with immutable history. */
import { chromium } from "playwright";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
    viewport: { width: 1500, height: 1100 },
  }),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const base = process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5353/";
const run = (name, args = {}) =>
  page.evaluate(
    ([name, args]) => window.__alza.runTool(name, args),
    [name, args],
  );
const source = {
  url: "https://example.com/synthetic-revision.pdf",
  locator: "p. 2, verification only",
};
const pub = (value) => ({ value, status: "published", sources: [source] });
const fields = {
  width: pub(0.9),
  depth: pub(0.45),
  height: pub(0.6),
  mounting: pub("wall-hung"),
  benchHeight: pub(0.85),
  wasteOffset: { ...pub(0), reference: "fixture-centreline" },
  wasteHeight: pub(0.5),
  tapHoles: pub(1),
};
const spec = {
  manufacturer: "Synthetic Co",
  model: "Synthetic Vanity",
  fields,
};
try {
  await page.goto(base);
  await page.getByLabel("New project name").fill("Catalogue revisions #53");
  await page.getByRole("button", { name: "Create blank" }).click();
  await page.getByRole("button", { name: /^Products/ }).click();
  const form = page.getByRole("form", { name: "New product request" }),
    detail = page.getByRole("region", { name: "Selected request" });
  await form.getByLabel("Category").selectOption("vanity");
  await form.getByLabel("Brand").fill(spec.manufacturer);
  await form.getByLabel("Model").fill(spec.model);
  await form.getByRole("button", { name: "Open request", exact: true }).click();
  let requests = (await run("list_product_requests")).requests,
    request = requests.at(-1);
  assert.equal(
    (await run("submit_product_spec", { requestId: request.id, ...spec })).ok,
    true,
  );
  const review = async () => {
    const rows = detail.locator("tbody tr[data-field]");
    for (let index = 0; index < (await rows.count()); index++) {
      const button = rows
        .nth(index)
        .getByRole("button", { name: "Accept", exact: true });
      if (await button.count()) await button.click();
    }
    await detail
      .getByRole("button", { name: "Accept product", exact: true })
      .click();
  };
  await review();
  assert.match(await detail.textContent(), /status accepted/);
  const first = (await run("get_product_library")).products[0];
  const wall = (
    await run("add_wall", {
      ax: 0,
      ay: 0,
      bx: 5,
      by: 0,
      thickness: 0.1,
      height: 2.4,
    })
  ).id;
  assert.equal(
    (
      await run("set_wall_side", {
        wallId: wall,
        side: "right",
        existing: { value: 0, status: "measured" },
        frame: { value: 0, status: "measured" },
        layers: [],
      })
    ).ok,
    true,
  );
  const anchor = {
    wallId: wall,
    side: "right",
    face: "existing",
    distance: 1,
    status: "proposed",
  };
  const selected = (
    await run("place_product", { productId: first.id, ...anchor })
  ).id;
  const other = (
    await run("place_product", { productId: first.id, ...anchor, distance: 3 })
  ).id;
  assert.equal(
    (
      await run("set_service_point", {
        itemId: selected,
        id: "waste",
        label: "Synthetic surveyed waste",
        service: "waste",
        face: "finished",
        across: 0.12,
        out: 0.06,
        up: 0.51,
        status: "measured",
        source: "Synthetic site override",
      })
    ).ok,
    true,
  );
  await run("set_sheet_info", {
    project: "Revision verification",
    site: "Synthetic only",
    preparedBy: "Human test",
  });
  await run("set_diagram_view", {
    label: "Before revision",
    visible: ["walls", "fixtures", "services-waste"],
  });
  const diagram = await run("get_diagram_view"),
    acknowledge = diagram.findings
      .filter((f) => f.severity === "blocking")
      .map((f) => ({
        code: f.code,
        ref: f.ref,
        reason: "Synthetic verification fixture",
      }));
  const output = await run("export_diagram_view", {
    acknowledge,
    includeOutputs: true,
  });
  assert.equal(output.ok, true, output.summary);
  const check = await run("check_sheets", { sheet: "floor-plan" });
  const issued = await run("export_sheet", {
    sheet: "floor-plan",
    acknowledge: (check.findings ?? [])
      .filter((f) => f.severity === "blocking")
      .map((f) => ({
        code: f.code,
        ref: f.ref,
        reason: "Synthetic verification fixture",
      })),
  });
  assert.equal(issued.ok, true, issued.summary);
  const before = (await run("get_model")).model,
    issuedHistory = before.sheetSet.revisions[0],
    stageHistory = before.sheetSet.stageExports[0];
  assert.equal(typeof issuedHistory.content.svg, "string");
  const firstCard = page.locator(`[data-product="${first.id}"]`);
  await firstCard.locator("summary").click();
  await firstCard
    .getByRole("button", { name: "Draft catalogue revision", exact: true })
    .click();
  request = (await run("list_product_requests")).requests.at(-1);
  assert.match(
    await detail
      .getByRole("region", { name: "Catalogue revision comparison" })
      .textContent(),
    /Accepting this record does not update/,
  );
  const corrected = {
    ...spec,
    fields: { ...fields, width: pub(1), wasteHeight: pub(0.55) },
  };
  assert.equal(
    (await run("submit_product_spec", { requestId: request.id, ...corrected }))
      .ok,
    true,
  );
  await detail
    .getByRole("button", { name: "Accept product", exact: true })
    .click();
  assert.match(
    await detail.getByRole("alert").last().textContent(),
    /Review every field/,
  );
  await detail
    .locator('tr[data-field="width"]')
    .getByLabel("Reason to reject Overall width")
    .fill("Synthetic check of width needed");
  await detail
    .locator('tr[data-field="width"]')
    .getByRole("button", { name: "Reject", exact: true })
    .click();
  await detail
    .getByLabel("Feedback for the agent")
    .fill("Correct source locator");
  await detail
    .getByRole("button", { name: "Return to agent", exact: true })
    .click();
  corrected.fields.width = {
    ...pub(1),
    sources: [{ ...source, locator: "p. 3, corrected verification width" }],
  };
  assert.equal(
    (await run("submit_product_spec", { requestId: request.id, ...corrected }))
      .ok,
    true,
  );
  assert.match(
    await detail.locator('tr[data-field="width"]').textContent(),
    /Previously rejected/,
  );
  await review();
  assert.match(await detail.textContent(), /status accepted/);
  const second = (await run("get_product_library")).products.at(-1);
  assert.equal(second.revision.number, 2);
  assert.deepEqual((await run("get_model")).model, before);
  const card = page.locator(`[data-product="${second.id}"]`);
  await card.locator("summary").click();
  const update = card.getByRole("region", {
    name: "Update selected fixture revisions",
  });
  await update
    .getByLabel(`Update instance ${selected}`, { exact: true })
    .check();
  await update
    .getByRole("button", {
      name: "Preview selected instance updates",
      exact: true,
    })
    .click();
  assert.match(
    await update
      .getByRole("region", { name: "Selected instance update preview" })
      .textContent(),
    /900.*1000/s,
  );
  assert.match(await update.textContent(), /Synthetic site override/);
  assert.equal(
    await update
      .getByRole("button", {
        name: "Apply revision to selected instances",
        exact: true,
      })
      .isEnabled(),
    false,
  );
  await update
    .getByRole("button", { name: "Cancel update preview", exact: true })
    .click();
  assert.deepEqual((await run("get_model")).model, before);
  assert.notEqual(
    (
      await run("apply_product_revision", {
        productId: second.id,
        itemIds: [selected],
      })
    )?.ok,
    true,
  );
  await update
    .getByRole("button", {
      name: "Preview selected instance updates",
      exact: true,
    })
    .click();
  await update.getByLabel("Acknowledge selected revision preview").check();
  await update
    .getByRole("button", {
      name: "Apply revision to selected instances",
      exact: true,
    })
    .click();
  let changed = (await run("get_model")).model;
  assert.equal(
    changed.items.find((i) => i.id === selected).productId,
    second.id,
  );
  assert.deepEqual(
    changed.items.find((i) => i.id === other),
    before.items.find((i) => i.id === other),
  );
  assert.deepEqual(
    changed.items.find((i) => i.id === selected).anchor,
    before.items.find((i) => i.id === selected).anchor,
  );
  assert.equal(
    changed.items.find((i) => i.id === selected).servicePoints[0].across,
    0.12,
  );
  assert.deepEqual(changed.sheetSet.revisions[0], issuedHistory);
  await page.getByRole("button", { name: "Back to plan", exact: true }).click();
  await page.getByRole("button", { name: /^Sheets/ }).click();
  assert.match(
    await page.textContent("body"),
    /Historical export: current planning evidence differs/,
  );
  assert.match(
    await page.textContent("body"),
    /historical: planning evidence has changed/,
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.deepEqual((await run("get_model")).model.items, before.items);
  assert.deepEqual(
    (await run("get_model")).model.sheetSet.revisions[0],
    issuedHistory,
  );
  await page.getByRole("button", { name: /^Products/ }).click();
  await page
    .locator(`[data-product="${second.id}"]`)
    .locator("summary")
    .click();
  const redo = page
    .locator(`[data-product="${second.id}"]`)
    .getByRole("region", { name: "Update selected fixture revisions" });
  await redo.getByLabel(`Update instance ${selected}`, { exact: true }).check();
  await redo
    .getByRole("button", {
      name: "Preview selected instance updates",
      exact: true,
    })
    .click();
  await redo.getByLabel("Acknowledge selected revision preview").check();
  await redo
    .getByRole("button", {
      name: "Apply revision to selected instances",
      exact: true,
    })
    .click();
  changed = JSON.parse(JSON.stringify((await run("get_model")).model));
  await page.reload();
  await page
    .locator(".project-card")
    .filter({ hasText: "Catalogue revisions #53" })
    .getByRole("button", { name: "Open", exact: true })
    .click();
  assert.deepEqual((await run("get_model")).model.items, changed.items);
  assert.equal((await run("get_product_library")).products.length, 2);
  await page.getByRole("button", { name: /^Projects/ }).click();
  const event = page.waitForEvent("download");
  await page
    .locator(".project-card")
    .filter({ hasText: "Catalogue revisions #53" })
    .getByRole("button", { name: "Export JSON", exact: true })
    .click();
  const raw = readFileSync(await (await event).path(), "utf8");
  const fresh = await browser.newContext(),
    fp = await fresh.newPage();
  fp.on("pageerror", (error) => errors.push(String(error)));
  await fp.goto(base);
  await fp.getByLabel("Import project JSON").setInputFiles({
    name: "revisions.json",
    mimeType: "application/json",
    buffer: Buffer.from(raw),
  });
  await fp
    .getByRole("button", { name: "Import as new project", exact: true })
    .click();
  const frun = (name, args = {}) =>
    fp.evaluate(
      ([name, args]) => window.__alza.runTool(name, args),
      [name, args],
    );
  assert.equal((await frun("get_product_library")).products.length, 0);
  const imported = (await frun("get_model")).model;
  assert.deepEqual(imported.items, changed.items);
  assert.deepEqual(imported.sheetSet.revisions[0], issuedHistory);
  assert.deepEqual(imported.sheetSet.stageExports[0], stageHistory);
  await fp.getByRole("button", { name: /^Sheets/ }).click();
  assert.match(
    await fp.locator('[aria-label="Archived stage output"]').textContent(),
    /Historical export/,
  );
  assert.equal((await frun("build_3d")).ok, true);
  await fresh.close();
  // A reversible corner reanchor must transform its pinned shape without consulting mutable kinds.
  await page
    .locator(".project-card")
    .filter({ hasText: "Catalogue revisions #53" })
    .getByRole("button", { name: "Open", exact: true })
    .click();
  const bathFields = {
    length: pub(1.2),
    width: pub(1.2),
    height: pub(0.5),
    shape: pub("corner-round"),
    frontWidth: pub(1.4),
    frontProjection: pub(1.1),
    installation: pub("corner"),
    surround: pub("none-required"),
    wasteFromEnd: pub(0.2),
    wasteFromSide: pub(0.5),
  };
  const identity = {
    code: { state: "unknown", value: null },
    finish: { state: "unknown", value: null },
    configuration: { state: "unknown", value: null },
    handedness: { state: "known", value: "reversible", sources: [source] },
  };
  const bathRequest = await run("request_product", {
    category: "bath",
    brand: "Synthetic",
    model: "Reversible corner",
    identity,
  });
  assert.equal(
    (
      await run("submit_product_spec", {
        requestId: bathRequest.requestId,
        manufacturer: "Synthetic",
        model: "Reversible corner",
        identity,
        fields: bathFields,
      })
    ).ok,
    true,
  );
  await page.getByRole("button", { name: /^Products/ }).click();
  await review();
  const bath = (await run("get_product_library")).products.at(-1);
  const cornerPlacement = await run("place_product", {
    productId: bath.id,
    ...anchor,
    distance: 0.8,
  });
  assert.equal(cornerPlacement.ok, true, cornerPlacement.summary);
  const left = (await run("get_model")).model.items.find(
    (i) => i.id === cornerPlacement.id,
  );
  assert.equal(
    (await run("anchor_fixture", { itemId: left.id, ...anchor, distance: 4.2 }))
      .ok,
    true,
  );
  const right = (await run("get_model")).model.items.find(
    (i) => i.id === left.id,
  );
  assert.equal(right.kind, right.productGeometry.kind);
  assert.equal(
    right.productGeometry.outline.start.x,
    -left.productGeometry.outline.start.x,
  );
  assert.equal(
    (await run("define_item_kind", { ...right.productGeometry, w: 2 })).ok,
    true,
  );
  await run("set_diagram_view", {
    label: "Pinned reanchored corner",
    visible: [`item:${right.id}`],
  });
  const pinned = await run("get_diagram_view");
  assert.equal(
    pinned.spec.find((row) => row.property === "footprint w × d (mm)").value,
    `${Math.round(right.productGeometry.w*1000)} × ${Math.round(right.productGeometry.d*1000)}`,
  );
  await page.reload();
  await page
    .locator(".project-card")
    .filter({ hasText: "Catalogue revisions #53" })
    .getByRole("button", { name: "Open", exact: true })
    .click();
  const reloaded = (await run("get_model")).model.items.find(
    (i) => i.id === right.id,
  );
  assert.equal(reloaded.productGeometry.kind, reloaded.kind);
  assert.equal(reloaded.productGeometry.w, right.productGeometry.w);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: human revision draft/rejection/correction/acceptance → preview cancel → explicit selected apply with override retention → historical outputs → undo → reload/download/fresh import with pinned revisions",
  );
} finally {
  await browser.close();
}
