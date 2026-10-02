/**
 * Issue #34 end-to-end check: a spec sheet PDF attached to a product request on the Products
 * page, its text read in the browser by pdf.js page by page, handed to the agent by
 * get_product_brief, cited by page in submit_product_spec, reviewed and accepted by a human, and
 * still there after a reload. Citations to a missing attachment or page are refused. An image
 * attachment is shown for review and the page says it has no text for the agent.
 *
 * The PDF is generated here with synthetic figures; it is not a real product's sheet.
 *
 * Run with the studio dev server up:  ALZA_BASE_URL=http://127.0.0.1:5199/ node tests/product-attachments.e2e.mjs
 * (CHROMIUM_PATH=/path/to/chrome to use a browser other than Playwright's own.)
 */
import { chromium } from "playwright";
import { strict as assert } from "node:assert";

/** A minimal text PDF, one array of lines per page. */
function makePdf(pages) {
  const objs = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((lines, i) => {
    const content = lines.map((l, j) => `BT /F1 12 Tf 72 ${720 - j * 20} Td (${l}) Tj ET`).join("\n");
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let k = 1; k < objs.length; k++) { offsets[k] = out.length; out += `${k} 0 obj\n${objs[k]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const sheet = makePdf([
  ["Example Co Test Pan - Specification", "Overall width 380 mm", "Overall height 800 mm"],
  ["Installation", "Projection from finished wall 640 mm", "S-trap set-out 140 to 200 mm", "Back-to-wall pan, close-coupled cistern, bottom inlet"],
]);
// 1×1 PNG
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// Full Chromium has the PDF viewer; Playwright's default headless shell does not.
const browser = await chromium.launch({ headless: true, channel: "chromium", ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

try {
  await page.goto(process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5199/");
  await page.evaluate(() => localStorage.removeItem("alza.products.v1"));
  await page.reload();
  await page.getByLabel("New project name").fill("Bathroom A");
  await page.getByRole("button", { name: "Create blank" }).click();
  const run = (name, args = {}) => page.evaluate(([tool, input]) => window.__alza.runTool(tool, input), [name, args]);

  // Human opens a request and attaches the sheet and a photo
  await page.getByRole("button", { name: /^Products/ }).click();
  const form = page.getByRole("form", { name: "New product request" });
  await form.getByLabel("Category").selectOption("toilet");
  await form.getByLabel("Brand").fill("Example Co");
  await form.getByLabel("Model").fill("Test Pan");
  await form.getByRole("button", { name: "Open request" }).click();
  const detail = page.getByRole("region", { name: "Selected request" });
  const files = detail.getByRole("region", { name: "Attachments" });
  await files.getByLabel("Attach spec sheet").setInputFiles({ name: "test-pan-spec.pdf", mimeType: "application/pdf", buffer: sheet });
  await files.getByRole("status").filter({ hasText: /attached as attachment:/ }).waitFor();
  assert.match(await files.getByRole("status").textContent(), /2 page\(s\) of text read for the agent/);
  await files.getByLabel("Attach spec sheet").setInputFiles({ name: "box-label.png", mimeType: "image/png", buffer: png });
  await files.getByRole("status").filter({ hasText: /box-label\.png attached/ }).waitFor();
  const photo = files.locator(".products-attachment").filter({ hasText: "box-label.png" });
  assert.match(await photo.textContent(), /no text for the agent.*paste it into the conversation/);
  await photo.getByRole("button", { name: "View" }).click();
  await photo.getByRole("img", { name: "box-label.png" }).waitFor();
  await files.getByLabel("Attach spec sheet").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  assert.match(await files.getByRole("alert").textContent(), /not a PDF or an image/);

  // The person can open the PDF itself
  const pdfRow = files.locator(".products-attachment").filter({ hasText: "test-pan-spec.pdf" });
  const [popup] = await Promise.all([context.waitForEvent("page"), pdfRow.getByRole("button", { name: "View" }).click()]);
  await popup.waitForURL(/^blob:/);
  assert.match(popup.url(), /^blob:/);
  await popup.close();

  // Agent reads the brief with the sheet's text, page by page
  const { requests } = await run("list_product_requests");
  const id = requests[0].id;
  assert.equal(requests[0].attachments.length, 2);
  const brief = await run("get_product_brief", { requestId: id });
  const pdf = brief.attachments.find((a) => a.kind === "pdf");
  const img = brief.attachments.find((a) => a.kind === "image");
  assert.equal(pdf.cite, `attachment:${pdf.id}`);
  assert.deepEqual(pdf.pages.map((p) => p.page), [1, 2]);
  assert.match(pdf.pages[1].text, /Projection from finished wall 640 mm/);
  assert.match(img.textNote, /paste it into the conversation/);
  assert.equal(img.pages, undefined);
  assert.match(brief.protocol[0], /attachment:<id>/);

  const at = (locator, att = pdf.id) => ({ url: `attachment:${att}`, locator });
  const pub = (value, locator) => ({ value, status: "published", sources: [at(locator)] });
  const fields = {
    width: pub(0.38, "p. 1"), height: pub(0.8, "p. 1"), depth: pub(0.64, "p. 2"),
    panType: pub("back-to-wall", "p. 2"), cistern: pub("close-coupled", "p. 2"), inletEntry: pub("bottom", "p. 2"),
    power: { value: "not-required", status: "published", sources: [{ url: "https://example.com/test-pan", locator: "features list" }] },
    trap: pub("S", "p. 2"), sTrapSetoutMin: pub(0.14, "p. 2"), sTrapSetoutMax: pub(0.2, "p. 2"),
    inletHeight: { value: null, note: "Not on the attached sheet (2 pages)." },
  };
  const submit = (f) => run("submit_product_spec", { requestId: id, manufacturer: "Example Co", model: "Test Pan", fields: f });
  const missingAtt = await submit({ ...fields, width: { ...fields.width, sources: [at("p. 1", "att_nope")] } });
  assert.equal(missingAtt.ok, false);
  assert.match(missingAtt.summary, /attachment:att_nope is not attached to this request/);
  const missingPage = await submit({ ...fields, depth: pub(0.64, "p. 5") });
  assert.equal(missingPage.ok, false);
  assert.match(missingPage.summary, /has 2 page\(s\); page 5 does not exist/);
  const noLocator = await submit({ ...fields, depth: { value: 0.64, status: "published", sources: [{ url: `attachment:${pdf.id}` }] } });
  assert.equal(noLocator.ok, false);
  assert.match(noLocator.summary, /needs a locator/);
  const ok = await submit(fields);
  assert.equal(ok.ok, true, ok.summary);

  // Human reviews: the citation names the sheet and its page; attachments are kept, read-only
  const depthRow = detail.locator('tr[data-field="depth"]');
  assert.match(await depthRow.textContent(), /test-pan-spec\.pdf, p\. 2/);
  assert.equal(await files.getByLabel("Attach spec sheet").count(), 0);
  const rows = detail.locator("tbody tr[data-field]");
  for (let i = 0; i < await rows.count(); i++) await rows.nth(i).getByRole("button", { name: "Accept" }).click();
  await detail.getByRole("button", { name: "Accept product" }).click();
  assert.match(await detail.textContent(), /status accepted/);

  // Reload: attachment, its text and the citations persist, and the file is still viewable
  await page.reload();
  await page.getByLabel("New project name").fill("Bathroom B");
  await page.getByRole("button", { name: "Create blank" }).click();
  const after = await run("get_product_brief", { requestId: id });
  assert.deepEqual(after.attachments.map((a) => a.name), ["test-pan-spec.pdf", "box-label.png"]);
  assert.match(after.attachments[0].pages[1].text, /S-trap set-out 140 to 200 mm/);
  const lib = await run("get_product_library");
  assert.deepEqual(lib.products[0].fields.depth.sources, [at("p. 2")]);
  await page.getByRole("button", { name: /^Products/ }).click();
  await page.getByRole("region", { name: "Requests" }).getByRole("button", { name: /Toilet suite: Example Co Test Pan/ }).click();
  const files2 = page.getByRole("region", { name: "Selected request" }).getByRole("region", { name: "Attachments" });
  await files2.locator(".products-attachment").filter({ hasText: "test-pan-spec.pdf" }).getByText("Text the agent reads").click();
  assert.match(await files2.locator('[data-page="2"]').textContent(), /Projection from finished wall 640 mm/);
  const card = page.getByRole("region", { name: "Library" }).locator("details");
  await card.locator("summary").click();
  const [popup2] = await Promise.all([context.waitForEvent("page"), card.getByRole("button", { name: "p. 2" }).first().click()]);
  await popup2.waitForURL(/^blob:.*#page=2$/);
  assert.match(popup2.url(), /^blob:.*#page=2$/);
  await popup2.close();

  assert.deepEqual(errors, []);
  console.log("PASS: PDF + image attached on the page, per-page text in the brief, bad citations refused, page citations accepted, all persisted after reload");
} finally {
  await browser.close();
}
