/**
 * Issue #75: a fitted waste is checked against its host's waste point in the host frame,
 * through tools and the Inspector. No committed screenshot is overwritten.
 *
 * Run with the studio dev server up:  ALZA_BASE_URL=http://127.0.0.1:5199/ node tests/fitted-waste.e2e.mjs
 */
import { launch } from "./browser.mjs";
import { strict as assert } from "node:assert";

const browser = await launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

try {
  await page.goto(process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5199/");
  await page.getByRole("button", { name: "Open" }).first().click();
  const run = (name, args = {}) => page.evaluate(([tool, input]) => window.__alza.runTool(tool, input), [name, args]);

  const atPoint = await run("get_issues");
  assert.equal(atPoint.ok, true, atPoint.summary);
  assert.equal(atPoint.issues.some((i) => i.code === "fitted_waste_offset"), false, "sample waste at the host point must not warn");
  assert.equal(atPoint.issues.some((i) => i.code === "fitted_waste_size"), false, "unlike hole vs connection, and unknown connection, stay silent");

  const waste = await page.evaluate(() => window.__alza.store.getState().model.items.find((i) => i.id === "bath_waste").fittedTo);
  const offset = await run("fit_item", { id: "bath_waste", host: "bath", across: waste.across + 0.15, out: waste.out });
  assert.equal(offset.ok, true, offset.summary);
  const warned = await run("get_issues");
  const offsetIssue = warned.issues.find((i) => i.code === "fitted_waste_offset");
  assert.ok(offsetIssue, "150 mm offset must warn");
  assert.match(offsetIssue.message, /150 mm/);
  assert.match(offsetIssue.message, /across the host centreline/);
  assert.match(offsetIssue.message, /bisector/);
  assert.match(offsetIssue.message, /FITTED_WASTE_OFFSET_TOLERANCE_M/);
  assert.doesNotMatch(offsetIssue.message, /compli/i);

  const atHost = await run("fit_item", { id: "bath_waste", host: "bath", atHostWaste: true });
  assert.equal(atHost.ok, true, atHost.summary);
  assert.match(atHost.summary, /at its waste point/);
  const quiet = await run("get_issues");
  assert.equal(quiet.issues.some((i) => i.code === "fitted_waste_offset"), false);

  await page.locator('[data-id="bath_waste"]').click();
  const button = page.locator("[data-fit-at-host-waste]");
  assert.equal(await button.count(), 1);
  await button.click();
  const afterClick = await run("get_issues");
  assert.equal(afterClick.issues.some((i) => i.code === "fitted_waste_offset"), false);

  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("fitted-waste e2e: ok");
} finally {
  await browser.close();
}
