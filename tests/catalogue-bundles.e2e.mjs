/** #49: actual manual bundle download, independent-browser preview/import, original bytes,
 * pending research/human review, placement, reload and project JSON independence. All data synthetic. */
import { chromium } from "playwright";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
function makePdf(pages) {
  const objs = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((lines, i) => {
    const content = lines
      .map((l, j) => `BT /F1 12 Tf 72 ${720 - j * 20} Td (${l}) Tj ET`)
      .join("\n");
    objs[4 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] =
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let k = 1; k < objs.length; k++) {
    offsets[k] = out.length;
    out += `${k} 0 obj\n${objs[k]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join("")}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const base = process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5349/";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const browser = await chromium.launch({
  headless: true,
  channel: "chromium",
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
});
const source = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
  }),
  destination = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
  });
const page = await source.newPage(),
  other = await destination.newPage(),
  errors = [];
for (const p of [page, other]) p.on("pageerror", (e) => errors.push(String(e)));
const tool = (p, name, args = {}) =>
  p.evaluate(([n, a]) => window.__alza.runTool(n, a), [name, args]);
const openProject = async (p, name) => {
  await p.goto(base);
  await p.getByLabel("New project name").fill(name);
  await p.getByRole("button", { name: "Create blank" }).click();
  await p.getByRole("button", { name: /^Products/ }).click();
};
const detail = (p) => p.getByRole("region", { name: "Selected request" });
const create = async (p, model, attach = true, category = "toilet") => {
  const form = p.getByRole("form", { name: "New product request" });
  await form.getByLabel("Category").selectOption(category);
  await form.getByLabel("Brand").fill("Synthetic Co");
  await form.getByLabel("Model").fill(model);
  await form.getByRole("button", { name: "Open request" }).click();
  if (attach) {
    const files = detail(p).getByRole("region", { name: "Attachments" }),
      pdf = makePdf([
        [
          `Synthetic Co ${model} - test evidence`,
          category === "mirror"
            ? "Mirror: width 600 mm, depth 30 mm, height 800 mm; surface mounted, power not required"
            : "Width 380 mm, depth 640 mm, height 800 mm",
          "S trap setout 140 to 200 mm; back-to-wall; close-coupled; bottom inlet",
          "Power not required. Test figures, not an actual product. Fixing x100 mm y0 mm z600 mm; access above 50 mm.",
        ],
      ]);
    await files.getByLabel("Attach spec sheet").setInputFiles({
      name: "shared-name.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    });
    await files
      .getByRole("status")
      .filter({ hasText: /attached as attachment:/ })
      .waitFor({ timeout: 8000 });
    assert.match(
      await files.getByRole("status").textContent(),
      /1 page\(s\) of text read/,
    );
    await files.getByLabel("Attach spec sheet").setInputFiles({
      name: "shared-photo.png",
      mimeType: "image/png",
      buffer: png,
    });
    await files
      .getByRole("status")
      .filter({ hasText: /shared-photo.png attached/ })
      .waitFor();
  }
  return (await tool(p, "list_product_requests")).requests.at(-1).id;
};
const submit = async (p, id, model, code) => {
  const brief = await tool(p, "get_product_brief", { requestId: id }),
    pdf = brief.attachments.find((a) => a.kind === "pdf"),
    pub = (value) => ({
      value,
      status: "published",
      sources: [{ url: pdf.cite, locator: "p. 1" }],
    });
  const fields = Object.fromEntries(
    brief.fields.map((f) => [
      f.key,
      {
        value: null,
        note: "Synthetic test: no figure supplied by original evidence.",
      },
    ]),
  );
  if (brief.category.id === "mirror")
    Object.assign(fields, {
      width: pub(0.6),
      depth: pub(0.03),
      height: pub(0.8),
      kind: pub("mirror"),
      mounting: pub("surface"),
      fixingLayout: pub("Synthetic x100 y0 z600 fixing"),
      accessRequirements: pub("Synthetic 50 mm above"),
      power: pub("not-required"),
    });
  else
    Object.assign(fields, {
      width: pub(0.38),
      depth: pub(0.64),
      height: pub(0.8),
      panType: pub("back-to-wall"),
      cistern: pub("close-coupled"),
      inletEntry: pub("bottom"),
      trap: pub("S"),
      sTrapSetoutMin: pub(0.14),
      sTrapSetoutMax: pub(0.2),
      power: pub("not-required"),
    });
  const identity = {
    code: {
      state: "known",
      value: code,
      sources: [{ url: pdf.cite, locator: "p. 1" }],
    },
    finish: { state: "unknown", value: null },
    configuration: { state: "unknown", value: null },
    handedness: { state: "unknown", value: null },
  };
  const evidence = {
    status: "published",
    sources: [{ url: pdf.cite, locator: "p. 1" }],
  };
  const installationGeometry = {
    ...evidence,
    datum: {
      across: "fixture-centreline",
      out: "fixture-back",
      up: "fixture-bottom",
    },
    handedness: "unknown",
    outline: {
      ...evidence,
      datum: { across: "fixture-centreline", out: "footprint-centre" },
      limitation: "Synthetic sheet provides envelope only",
    },
    fixings: [
      {
        id: "bracket",
        label: "Synthetic fixing",
        x: 0.1,
        y: 0,
        z: 0.6,
        ...evidence,
      },
    ],
    clearances: [
      {
        id: "lift",
        label: "Synthetic access",
        direction: "above",
        distance: 0.05,
        ...evidence,
      },
    ],
  };
  const result = await tool(p, "submit_product_spec", {
    requestId: id,
    manufacturer: "Synthetic Co",
    model,
    identity,
    fields,
    ...(brief.category.id === "mirror" || model === "Variant A"
      ? { installationGeometry }
      : {}),
  });
  assert.equal(result.ok, true, result.summary);
  return fields;
};
const accept = async (p) => {
  const rows = detail(p).locator("tbody tr[data-field]");
  for (let i = 0; i < (await rows.count()); i++)
    await rows
      .nth(i)
      .getByRole("button", { name: "Accept", exact: true })
      .click();
  if (
    await detail(p)
      .getByRole("button", {
        name: "Accept installation geometry",
        exact: true,
      })
      .count()
  )
    await detail(p)
      .getByRole("button", {
        name: "Accept installation geometry",
        exact: true,
      })
      .click();
  await detail(p)
    .getByRole("button", { name: "Accept product", exact: true })
    .click();
  assert.match(await detail(p).textContent(), /status accepted/);
};
const preview = async (p, raw) => {
  const section = p.getByRole("region", { name: "Portable catalogue" });
  await section.getByLabel("Preview catalogue bundle").setInputFiles({
    name: "catalogue.json",
    mimeType: "application/json",
    buffer: Buffer.from(raw),
  });
  await section
    .getByRole("region", { name: "Catalogue import preview" })
    .waitFor();
  return section;
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fetchBlob = async (p, url) =>
  Buffer.from(
    await p.evaluate(
      async (url) =>
        Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),
      url,
    ),
  );
try {
  await openProject(page, "Bundle source #49");
  const a = await create(page, "Variant A");
  await submit(page, a, "Variant A", "SYNTH-A");
  await accept(page);
  const b = await create(page, "Variant B");
  await submit(page, b, "Variant B", "SYNTH-B");
  await accept(page);
  const pending = await create(page, "Pending variant", true, "mirror");
  const transfer = page.getByRole("region", { name: "Portable catalogue" });
  await transfer
    .getByText("Select products and pending requests", { exact: true })
    .click();
  const choices = transfer.getByRole("checkbox", { name: /^Export product/ });
  assert.equal(await choices.count(), 2);
  await choices.nth(0).check();
  await choices.nth(1).check();
  await transfer
    .getByRole("checkbox", { name: `Export request ${pending}` })
    .check();
  const download = page.waitForEvent("download");
  await transfer
    .getByRole("button", { name: "Export selected catalogue bundle" })
    .click();
  const raw = readFileSync(await (await download).path(), "utf8"),
    bundle = JSON.parse(raw);
  assert.equal(bundle.products.length, 2);
  assert.equal(bundle.requests.length, 3);
  assert.equal(bundle.files.length, 6);
  for (const f of bundle.files) {
    assert.equal(sha(Buffer.from(f.base64, "base64")), f.sha256);
    assert.equal(Buffer.from(f.base64, "base64").length, f.size);
  }
  assert.notEqual(
    bundle.files[0].sha256,
    bundle.files[2].sha256,
    "Same PDF filename does not collapse differing original bytes",
  );
  await openProject(other, "Bundle destination #49");
  const localId = await create(other, "Unrelated preserved", false);
  // Deliberate local-ID collision fixture; the unrelated local evidence remains intact.
  await other.evaluate(
    ([oldId, newId]) => {
      const doc = JSON.parse(localStorage.getItem("alza.products.v1"));
      doc.requests.find((r) => r.id === oldId).id = newId;
      localStorage.setItem("alza.products.v1", JSON.stringify(doc));
    },
    [localId, bundle.requests[0].id],
  );
  await other.reload();
  await other
    .locator(".project-card")
    .filter({ hasText: "Bundle destination #49" })
    .getByRole("button", { name: "Open", exact: true })
    .click();
  await other.getByRole("button", { name: /^Products/ }).click();
  const beforeModel = JSON.stringify((await tool(other, "get_model")).model),
    section = await preview(other, raw);
  assert.equal((await tool(other, "get_product_library")).products.length, 0);
  assert.match(
    await section.textContent(),
    /2 product additions · 3 request additions · 6 file additions/,
  );
  assert.equal(
    await section
      .getByRole("table", { name: "Catalogue ID collisions" })
      .count(),
    1,
  );
  await other.screenshot({
    path: "/tmp/catalogue-transfer-preview.png",
    fullPage: true,
  });
  await section
    .getByRole("button", { name: "Import previewed catalogue bundle" })
    .click();
  await section
    .getByRole("status")
    .filter({ hasText: /Imported 2 accepted products/ })
    .waitFor();
  assert.equal(
    JSON.stringify((await tool(other, "get_model")).model),
    beforeModel,
  );
  const requests = (await tool(other, "list_product_requests")).requests,
    receivedPending = requests.find((r) => r.known.model === "Pending variant");
  assert.equal(requests.length, 4);
  assert.ok(requests.some((r) => r.known.model === "Unrelated preserved"));
  assert.notEqual(receivedPending.id, pending);
  const library = (await tool(other, "get_product_library")).products;
  assert.deepEqual(
    library.map((p) => p.identity.code.value),
    ["SYNTH-A", "SYNTH-B"],
  );
  assert.ok(
    library.every(
      (p) => p.id !== bundle.products[0].id && p.id !== bundle.products[1].id,
    ),
  );
  // Read actual IndexedDB original bytes after import, beyond metadata/text equality.
  const receivedBytes = await other.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("alza.products.files", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const doc = JSON.parse(localStorage.getItem("alza.products.v1")),
      result = {};
    for (const r of doc.requests)
      for (const a of r.attachments ?? []) {
        const blob = await new Promise((resolve, reject) => {
          const q = db
            .transaction("files", "readonly")
            .objectStore("files")
            .get(a.id);
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => reject(q.error);
        });
        result[a.id] = Array.from(new Uint8Array(await blob.arrayBuffer()));
      }
    db.close();
    return result;
  });
  const localDoc = await other.evaluate(() =>
    JSON.parse(localStorage.getItem("alza.products.v1")),
  );
  for (const f of bundle.files) {
    const mapped = localDoc.requests.find(
      (r) => r.bundleImport?.bundleId === bundle.bundleId,
    ).bundleImport.remaps.attachments[f.id];
    assert.equal(sha(Buffer.from(receivedBytes[mapped])), f.sha256);
  }
  const files = detail(other).getByRole("region", { name: "Attachments" }),
    pdfRow = files
      .locator(".products-attachment")
      .filter({ hasText: "shared-name.pdf" }),
    imageRow = files
      .locator(".products-attachment")
      .filter({ hasText: "shared-photo.png" });
  const popupEvent = destination.waitForEvent("page");
  await pdfRow.getByRole("button", { name: "View", exact: true }).click();
  const popup = await popupEvent;
  await popup.waitForURL(/^blob:/);
  const originalPending = bundle.requests.find((r) => r.id === pending),
    filePdf = bundle.files.find(
      (f) =>
        f.id === originalPending.attachments.find((a) => a.kind === "pdf").id,
    );
  assert.equal(sha(await fetchBlob(other, popup.url())), filePdf.sha256);
  await popup.close();
  await imageRow.getByRole("button", { name: "View", exact: true }).click();
  const image = imageRow.getByRole("img");
  await image.waitFor();
  assert.equal(
    sha(await fetchBlob(other, await image.getAttribute("src"))),
    sha(png),
  );
  assert.equal(await image.evaluate((el) => el.naturalWidth), 1);
  const again = await preview(other, raw);
  assert.match(
    await again.textContent(),
    /0 product additions · 0 request additions · 0 file additions/,
  );
  await again
    .getByRole("button", { name: "Confirm already-present bundle" })
    .click();
  assert.equal((await tool(other, "get_product_library")).products.length, 2);
  await submit(other, receivedPending.id, "Pending variant", "SYNTH-PENDING");
  await accept(other);
  const finalProduct = (await tool(other, "get_product_library")).products.at(
    -1,
  );
  const wall = await tool(other, "add_wall", {
    ax: 0,
    ay: 0,
    bx: 3,
    by: 0,
    thickness: 0.1,
    height: 2.4,
  });
  await tool(other, "set_wall_side", {
    wallId: wall.id,
    side: "right",
    existing: { value: 0, status: "measured" },
    layers: [],
  });
  const room = await tool(other, "add_room", {
    x: 0,
    y: 0,
    w: 3,
    h: 3,
    label: "Synthetic mount datum",
    floor: "tile",
  });
  const q = (value) => ({
    value,
    status: "proposed",
    source: "Synthetic explicitly entered installation",
  });
  await tool(other, "set_room_floor", {
    room: room.id,
    substrateTop: q(0),
    layers: [],
  });
  const placed = await tool(other, "place_product", {
    productId: finalProduct.id,
    wallId: wall.id,
    side: "right",
    face: "existing",
    distance: 0.8,
    status: "proposed",
    installation: {
      mounting: "wall",
      roomId: room.id,
      floorDatum: "finished-floor",
      height: q(0.9),
      mirror: false,
      orientation: 0,
    },
  });
  assert.equal(placed.ok, true, placed.summary);
  const item = (await tool(other, "get_model")).model.items[0];
  const rough = (await tool(other, "get_rough_in", { itemId: placed.id }))
    .fixtures[0];
  assert.equal(rough.installedLevels.bottom, 0.9);
  assert.equal(rough.fixings[0].level, 1.5);
  assert.match(rough.fixings[0].source, /attachment:att_import_/);
  assert.equal((await tool(other, "build_3d")).ok, true);
  assert.equal(item.selectionStatus, "unknown");
  assert.match(
    item.productSpecification.fields.width.sources[0].url,
    /attachment:att_import_/,
  );
  await other.reload();
  await other
    .locator(".project-card")
    .filter({ hasText: "Bundle destination #49" })
    .getByRole("button", { name: "Open", exact: true })
    .click();
  assert.equal((await tool(other, "get_product_library")).products.length, 3);
  assert.deepEqual(
    (await tool(other, "get_model")).model.items[0].productSpecification,
    JSON.parse(JSON.stringify(item.productSpecification)),
  );
  assert.equal(
    (await tool(page, "get_product_library")).products.length,
    2,
    "Source browser stays independent",
  );
  await other.getByRole("button", { name: /^Products/ }).click();
  const changedPreview = await preview(other, raw);
  assert.match(
    await changedPreview.textContent(),
    /prior imported records changed/,
  );
  await changedPreview
    .getByRole("button", { name: "Cancel catalogue import" })
    .click();
  assert.equal((await tool(other, "get_product_library")).products.length, 3);
  await other.getByRole("button", { name: "Back to plan" }).click();
  await other.getByRole("button", { name: /^Projects/ }).click();
  const projectDownload = other.waitForEvent("download");
  await other
    .locator(".project-card")
    .filter({ hasText: "Bundle destination #49" })
    .getByRole("button", { name: "Export JSON" })
    .click();
  const projectRaw = readFileSync(await (await projectDownload).path(), "utf8");
  assert.deepEqual(
    JSON.parse(projectRaw).model.items[0].productSpecification,
    JSON.parse(JSON.stringify(item.productSpecification)),
  );
  const fresh = await browser.newContext(),
    fp = await fresh.newPage();
  await fp.goto(base);
  await fp.getByLabel("Import project JSON").setInputFiles({
    name: "project.json",
    mimeType: "application/json",
    buffer: Buffer.from(projectRaw),
  });
  await fp.getByRole("button", { name: "Import as new project" }).click();
  assert.equal((await tool(fp, "get_product_library")).products.length, 0);
  assert.deepEqual(
    (await tool(fp, "get_model")).model.items[0].productSpecification,
    JSON.parse(JSON.stringify(item.productSpecification)),
  );
  await fresh.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: two independent browsers, actual bundle download/preview/ID remap/import, original SHA bytes in IndexedDB and reopened PDF/image, unchanged reimport no-op, pending research→human review→placement, reload and independent project JSON",
  );
} catch (error) {
  console.error(
    "Selected UI:",
    await detail(other)
      .textContent()
      .catch(() => "Unavailable"),
  );
  console.error("Page errors:", errors);
  throw error;
} finally {
  await browser.close();
}
