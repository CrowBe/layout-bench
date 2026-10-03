import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  products,
  productStore,
  configureProductStorage,
  initializeProductLibrary,
  PRODUCTS_KEY,
  type ProductRequest,
} from "../src/model/productLibrary";
import { memoryFiles, type FileStore } from "../src/model/productFiles";
import { categoryById, type FieldValue } from "../src/model/products";
import { identityReviewKeys } from "../src/model/productIdentity";
import { extractPdfPages, type PdfjsLike } from "../src/model/pdfText";
import {
  bundleHash,
  stableBundleValue,
  type CatalogueBundle,
  type BundlePreview,
} from "../src/model/productBundles";
import { reviewEvidence, currentReview } from "../src/model/productReview";
import { actions, store } from "../src/model/store";
import { emptyModel } from "../src/model/types";
const nodePdfjs = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLike;
function pdf() {
  const content =
      "BT /F1 12 Tf 72 720 Td (Synthetic Co pan. Width 380 mm. Original evidence.) Tj ET",
    objs = [
      "",
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let i = 1; i < objs.length; i++) {
    offsets.push(out.length);
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.map((x) => `${String(x).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
const named = (bytes: Uint8Array, mime: string, name: string) =>
  Object.assign(new Blob([bytes.slice().buffer], { type: mime }), { name });
let data: Map<string, string>,
  files: FileStore,
  writes: number,
  restore: ReturnType<typeof configureProductStorage>;
const local = () => ({
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => {
    writes++;
    data.set(key, value);
  },
  removeItem: (key: string) => {
    data.delete(key);
  },
});
const setup = () => {
  data = new Map();
  files = memoryFiles();
  writes = 0;
  configureProductStorage({
    local,
    files,
    extract: (bytes) => extractPdfPages(bytes, nodePdfjs),
  });
  productStore.setState({ requests: [], products: [], loadError: null });
  initializeProductLibrary(true);
  store.setState({ model: emptyModel(), kinds: [], undoStack: [] });
};
beforeEach(() => {
  restore = configureProductStorage({});
  setup();
});
afterEach(() => configureProductStorage(restore));
async function sourceBundle(withGeometry = false) {
  const id = products.request("toilet", {
    brand: "Synthetic Co",
    model: "Test pan",
  }).requestId as string;
  const attached = await products.attach(
    id,
    named(pdf(), "application/pdf", "pan.pdf"),
  );
  expect(attached.ok).toBe(true);
  await products.attach(id, named(png, "image/png", "photo.png"));
  const pub = (value: number | string): FieldValue => ({
    value,
    status: "published",
    sources: [{ url: `attachment:${attached.attachmentId}`, locator: "p. 1" }],
  });
  const fields: Record<string, FieldValue> = Object.fromEntries(
    categoryById("toilet")!.fields.map((f) => [
      f.key,
      { value: null, note: "Synthetic test: not supplied" },
    ]),
  );
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
  const sourced = {
      status: "published" as const,
      sources: [
        { url: `attachment:${attached.attachmentId}`, locator: "p. 1" },
      ],
    },
    geometry = {
      ...sourced,
      datum: {
        across: "fixture-centreline" as const,
        out: "fixture-back" as const,
        up: "fixture-bottom" as const,
      },
      handedness: "unknown" as const,
      outline: {
        ...sourced,
        datum: {
          across: "fixture-centreline" as const,
          out: "footprint-centre" as const,
        },
        limitation: "Synthetic source only gives envelope; no detailed profile",
      },
      fixings: [
        {
          id: "bolts",
          label: "Synthetic bolt",
          x: 0.1,
          y: 0,
          z: null,
          ...sourced,
        },
      ],
      services: [
        {
          id: "power",
          label: "Synthetic service",
          service: "power" as const,
          x: null,
          y: null,
          z: null,
          ...sourced,
        },
      ],
      clearances: [
        {
          id: "service",
          label: "Synthetic access",
          direction: "front" as const,
          distance: 0.1,
          ...sourced,
        },
      ],
    };
  expect(
    products.submit(id, {
      manufacturer: "Synthetic Co",
      model: "Test pan",
      fields,
      ...(withGeometry ? { installationGeometry: geometry } : {}),
    }).ok,
  ).toBe(true);
  for (const key of [
    ...Object.keys(fields),
    ...(withGeometry ? ["installationGeometry"] : []),
  ])
    products.review(id, key, "accepted");
  expect(products.accept(id).ok).toBe(true);
  const product = productStore.getState().products[0];
  const pending = products.request("toilet", {
    brand: "Synthetic Co",
    model: "Pending pan",
  }).requestId as string;
  await products.attach(
    pending,
    named(pdf(), "application/pdf", "pending.pdf"),
  );
  await products.attach(pending, named(png, "image/png", "pending.png"));
  const result = await products.exportBundle({
    requestIds: [pending],
    productIds: [product.id],
  });
  expect(result.ok).toBe(true);
  return result.bundle as CatalogueBundle;
}
const preview = async (bundle: CatalogueBundle) => {
  const result = await products.previewBundle(JSON.stringify(bundle));
  expect(result.ok, result.summary).toBe(true);
  return result.preview as BundlePreview;
};
const recalc = async (bundle: CatalogueBundle) => {
  bundle.bundleId = await bundleHash(
    stableBundleValue({
      requests: bundle.requests,
      products: bundle.products,
      files: bundle.files,
    }),
  );
  return bundle;
};
describe("portable original catalogue evidence (#49)", () => {
  it("transfers original bytes, citations, pending requests, review history and accepted placement independently of projects", async () => {
    const bundle = await sourceBundle();
    const originals = new Map(
      await Promise.all(
        bundle.files.map(
          async (f) =>
            [
              f.id,
              new Uint8Array(await (await files.get(f.id))!.arrayBuffer()),
            ] as const,
        ),
      ),
    );
    setup();
    const p = await preview(bundle);
    expect(productStore.getState().products).toHaveLength(0);
    expect(p.additions.requests.map((r) => r.status)).toEqual([
      "accepted",
      "open",
    ]);
    const beforeWrites = writes;
    expect((await products.importBundle(p)).ok).toBe(true);
    expect(writes - beforeWrites).toBe(1);
    expect(productStore.getState().products).toHaveLength(1);
    for (const [id, bytes] of originals)
      expect(
        new Uint8Array(
          await (await files.get(p.maps.attachments[id]))!.arrayBuffer(),
        ),
      ).toEqual(bytes);
    const product = productStore.getState().products[0],
      req = productStore
        .getState()
        .requests.find((r) => r.status === "accepted")!;
    expect(req.reviews.width.decision).toBe("accepted");
    expect(product.fields.width.sources![0].url).toBe(
      `attachment:${p.maps.attachments[bundle.files[0].id]}`,
    );
    const wall = actions.addWall(0, 0, 3, 0, 0.1, 2.4).id as string;
    actions.setWallSide(wall, "right", {
      existing: { value: 0, status: "measured" },
      layers: [],
    });
    expect(
      actions.placeProduct(product, {
        wallId: wall,
        side: "right",
        face: "existing",
        distance: 0.8,
        status: "proposed",
      }).ok,
    ).toBe(true);
    expect(store.getState().model.items[0].selectionStatus).toBe("unknown");
    initializeProductLibrary(true);
    expect(productStore.getState().products).toHaveLength(1);
    expect(
      productStore.getState().requests.find((r) => r.status === "open")!
        .attachments,
    ).toHaveLength(2);
  });
  it("is a no-op on the same original archive after ID remapping and import annotations", async () => {
    const bundle = await sourceBundle();
    const original = structuredClone(productStore.getState().requests),
      p = await preview(bundle);
    expect(p.reused).toBe(true);
    // Make a truly unrelated occupied request ID, plus orphan bytes at an incoming attachment ID.
    setup();
    const collision = structuredClone(bundle.requests[0]);
    collision.known.brand = "Unrelated local fitting";
    productStore.setState({ requests: [collision] });
    await files.put(
      bundle.files[0].id,
      new Blob(["orphan"], { type: "application/octet-stream" }),
    );
    const rawBefore = data.get(PRODUCTS_KEY),
      orphan = await files.get(bundle.files[0].id);
    const first = await preview(bundle);
    expect(first.collisions.map((c) => c.type)).toEqual(
      expect.arrayContaining(["request", "attachment"]),
    );
    expect(first.maps.requests[bundle.requests[0].id]).not.toBe(
      bundle.requests[0].id,
    );
    expect((await products.importBundle(first)).ok).toBe(true);
    expect(productStore.getState().requests[0]).toEqual(collision);
    expect(await files.get(bundle.files[0].id)).toBe(orphan);
    const imported = productStore
      .getState()
      .requests.find(
        (r) => r.id === first.maps.requests[bundle.requests[0].id],
      )!;
    expect(currentReview(imported, "width")?.decision).toBe("accepted");
    expect(imported.reviews.width.evidence).toBe(
      reviewEvidence(imported, "width"),
    );
    expect(imported.bundleImport!.remaps.attachments[bundle.files[0].id]).toBe(
      first.maps.attachments[bundle.files[0].id],
    );
    const count = productStore.getState().requests.length,
      second = await preview(bundle);
    expect(second.reused).toBe(true);
    expect(second.additions.requests).toEqual([]);
    expect((await products.importBundle(second)).ok).toBe(true);
    expect(productStore.getState().requests).toHaveLength(count);
    expect(rawBefore).not.toBe(data.get(PRODUCTS_KEY));
    expect(original).toHaveLength(2);
  });
  it("reports missing originals rather than backing up extracted text", async () => {
    await sourceBundle();
    const r = productStore.getState().requests[0];
    await files.remove(r.attachments![0].id);
    const before = structuredClone(productStore.getState().requests);
    const result = await products.exportBundle({
      requestIds: [],
      productIds: [productStore.getState().products[0].id],
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(
      /Missing original.*not an original-file backup/,
    );
    expect(productStore.getState().requests).toEqual(before);
  });
  it.each(["version", "missing-file", "bytes", "pages", "dependency"] as const)(
    "rejects %s without changing existing records or bytes",
    async (fault) => {
      const bundle = await sourceBundle();
      setup();
      const existing = products.request("vanity", { brand: "Local preserved" })
        .requestId as string;
      const before = stableBundleValue(productStore.getState().requests),
        raw = data.get(PRODUCTS_KEY);
      if (fault === "version")
        (bundle as unknown as { version: number }).version = 99;
      if (fault === "missing-file") bundle.files.pop();
      if (fault === "bytes")
        bundle.files[0].base64 = btoa("not original bytes");
      if (fault === "pages")
        bundle.requests[0].attachments![0].pages![0].text = "Forged text";
      if (fault === "dependency") bundle.requests.splice(0, 1);
      if (fault !== "version") await recalc(bundle);
      const result = await products.previewBundle(JSON.stringify(bundle));
      expect(result.ok).toBe(false);
      expect(productStore.getState().requests[0].id).toBe(existing);
      expect(stableBundleValue(productStore.getState().requests)).toBe(before);
      expect(data.get(PRODUCTS_KEY)).toBe(raw);
      expect(await files.get(bundle.files[0]?.id ?? "missing")).toBeNull();
    },
  );
  it.each([
    "first-file",
    "second-file",
    "local-quota",
    "write-after-save",
  ] as const)(
    "rolls back %s before any visible import and preserves orphan bytes",
    async (fault) => {
      const bundle = await sourceBundle();
      setup();
      products.request("vanity", { brand: "Existing" });
      await files.put("unrelated_orphan", new Blob(["kept"]));
      const p = await preview(bundle),
        before = stableBundleValue(productStore.getState().requests),
        raw = data.get(PRODUCTS_KEY),
        originalFiles = files;
      let creates = 0;
      if (fault === "first-file" || fault === "second-file")
        configureProductStorage({
          files: {
            ...files,
            add: async (id, blob) => {
              if (++creates === (fault === "first-file" ? 1 : 2))
                throw new DOMException("Disk full", "QuotaExceededError");
              await originalFiles.add!(id, blob);
            },
          },
        });
      else {
        const storage = local();
        let throws = 0;
        configureProductStorage({
          local: () => ({
            ...storage,
            setItem: (k, v) => {
              if (throws++ === 0) {
                if (fault === "write-after-save") storage.setItem(k, v);
                throw new DOMException("Full", "QuotaExceededError");
              }
              storage.setItem(k, v);
            },
          }),
        });
      }
      const result = await products.importBundle(p);
      expect(result.ok).toBe(false);
      expect(result.summary).toContain("Catalogue was not published");
      expect(stableBundleValue(productStore.getState().requests)).toBe(before);
      expect(data.get(PRODUCTS_KEY)).toBe(raw);
      expect(await (await originalFiles.get("unrelated_orphan"))!.text()).toBe(
        "kept",
      );
      for (const f of p.files) expect(await originalFiles.get(f.id)).toBeNull();
    },
  );
  it("refuses a stale preview, occupied staging ID and altered plan without overwriting them", async () => {
    const bundle = await sourceBundle();
    setup();
    let p = await preview(bundle);
    products.request("bath", { brand: "Added after preview" });
    expect((await products.importBundle(p)).ok).toBe(false);
    p = await preview(bundle);
    await files.put(p.files[0].id, new Blob(["now occupied"]));
    expect((await products.importBundle(p)).ok).toBe(false);
    expect(await (await files.get(p.files[0].id))!.text()).toBe("now occupied");
    p = await preview(bundle);
    p.additions.requests[0].known.brand = "Edited without preview";
    expect((await products.importBundle(p)).ok).toBe(false);
  });
  it("preserves a newer catalogue mutation during file staging while rolling back only staged originals", async () => {
    const bundle = await sourceBundle();
    setup();
    const p = await preview(bundle),
      originalFiles = files;
    let concurrentId: string | undefined;
    configureProductStorage({
      files: {
        ...files,
        add: async (id, blob) => {
          await originalFiles.add!(id, blob);
          if (!concurrentId)
            concurrentId = products.request("vanity", {
              brand: "New human work during staging",
            }).requestId as string;
        },
      },
    });
    const result = await products.importBundle(p);
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("Catalogue changed while staging");
    expect(productStore.getState().requests.map((r) => r.id)).toEqual([
      concurrentId,
    ]);
    expect(JSON.parse(data.get(PRODUCTS_KEY)!).requests[0].id).toBe(
      concurrentId,
    );
    for (const f of p.files) expect(await originalFiles.get(f.id)).toBeNull();
  });
  it("keeps different original bytes and exact variants distinct even with identical filenames", async () => {
    const first = await sourceBundle();
    setup();
    expect((await products.importBundle(await preview(first))).ok).toBe(true);
    const changed = structuredClone(first);
    changed.products[0].model = "Distinct physical variant";
    changed.requests[0].submission!.model = changed.products[0].model;
    const image = changed.files.find((f) => f.mime === "image/png")!,
      bytes = Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 1;
    image.base64 = btoa(String.fromCharCode(...bytes));
    image.sha256 = await bundleHash(bytes);
    await recalc(changed);
    const p = await preview(changed);
    expect(p.reused).toBe(false);
    expect(p.collisions.length).toBeGreaterThan(0);
    expect(p.maps.products[first.products[0].id]).not.toBe(
      first.products[0].id,
    );
    expect((await products.importBundle(p)).ok).toBe(true);
    expect(productStore.getState().products.map((p) => p.model)).toEqual([
      "Test pan",
      "Distinct physical variant",
    ]);
    expect(
      await bundleHash(
        new Uint8Array(await (await files.get(image.id))!.arrayBuffer()),
      ),
    ).not.toBe(image.sha256);
    expect(
      await bundleHash(
        new Uint8Array(
          await (await files.get(p.maps.attachments[image.id]))!.arrayBuffer(),
        ),
      ),
    ).toBe(image.sha256);
  });
  it.each(["category", "field", "unit"] as const)(
    "honestly refuses unsupported future %s evidence without dropping it",
    async (fault) => {
      const bundle = await sourceBundle();
      if (fault === "category") bundle.requests[1].category = "future-category";
      else if (fault === "field")
        bundle.requests[0].submission!.fields["futureField"] = {
          value: 3,
          status: "published",
          sources: [{ url: "https://example.com/spec", locator: "table" }],
        };
      else {
        const r = bundle.requests[1];
        r.mode = "human-measurement";
        r.known = { physicalItem: { label: "Synthetic future measurement" } };
        r.measurementDraft = {
          width: {
            value: 0.38,
            reference: "fixture-end",
            status: "measured",
            measurement: {
              recordedBy: "human",
              unit: "unsupported-unit" as "metres",
              date: "2026-10-03",
              evidence: "Synthetic future-unit test",
            },
          },
        };
      }
      await recalc(bundle);
      setup();
      products.request("vanity", { brand: "Prior local evidence" });
      const before = stableBundleValue(productStore.getState().requests),
        raw = data.get(PRODUCTS_KEY);
      const result = await products.previewBundle(JSON.stringify(bundle));
      expect(result.ok).toBe(false);
      expect(result.summary).toMatch(/Unsupported|not a field|unit/);
      expect(stableBundleValue(productStore.getState().requests)).toBe(before);
      expect(data.get(PRODUCTS_KEY)).toBe(raw);
    },
  );
  it("preserves reviewed geometry, unknown coordinates and source citations through collision remapping", async () => {
    const bundle = await sourceBundle(true);
    setup();
    await files.put(bundle.files[0].id, new Blob(["orphan"]));
    const p = await preview(bundle);
    expect((await products.importBundle(p)).ok).toBe(true);
    const imported = productStore.getState().products[0],
      r = productStore
        .getState()
        .requests.find((r) => r.id === imported.requestId)!;
    expect(imported.installationGeometry!.fixings![0].z).toBeNull();
    expect(imported.installationGeometry!.outline!.limitation).toContain(
      "no detailed profile",
    );
    expect(imported.installationGeometry!.sources[0].url).toBe(
      `attachment:${p.maps.attachments[bundle.files[0].id]}`,
    );
    expect(currentReview(r, "installationGeometry")?.decision).toBe("accepted");
    const result = await products.exportBundle({
      requestIds: [],
      productIds: [imported.id],
    });
    expect(result.ok).toBe(true);
    expect(
      (result.bundle as CatalogueBundle).products[0].installationGeometry,
    ).toEqual(imported.installationGeometry);
  });
  it("restores canonical state, document and bytes if a subscriber throws after publication assignment", async () => {
    const bundle = await sourceBundle();
    setup();
    products.request("vanity", { brand: "Prior local work" });
    const p = await preview(bundle),
      state = productStore.getState(),
      raw = data.get(PRODUCTS_KEY);
    const unsubscribe = productStore.subscribe((s) => {
      if (s.products.length)
        throw new Error("Synthetic UI subscriber failure after assignment");
    });
    try {
      const result = await products.importBundle(p);
      expect(result.ok).toBe(false);
      expect(result.summary).toContain("subscriber failure");
      expect(productStore.getState()).toBe(state);
      expect(data.get(PRODUCTS_KEY)).toBe(raw);
      for (const f of p.files) expect(await files.get(f.id)).toBeNull();
    } finally {
      unsubscribe();
    }
  });
  it("retains inherited measurement evidence and accepted revision dependency closure", async () => {
    const bundle = await sourceBundle(),
      parent = bundle.products[0],
      origin = bundle.requests[0];
    const child = structuredClone(origin) as ProductRequest & {
      revisionOf?: string;
    };
    child.id = "revision_request";
    child.productId = undefined;
    child.status = "open";
    child.revisionOf = parent.id;
    child.evidenceOriginRequestId = origin.id;
    child.attachments = [];
    bundle.requests.push(child);
    await recalc(bundle);
    setup();
    const p = await preview(bundle);
    expect(
      p.additions.requests.find((r) => r.id === "revision_request")!
        .evidenceOriginRequestId,
    ).toBe(origin.id);
    expect((await products.importBundle(p)).ok).toBe(true);
    const exported = await products.exportBundle({
      requestIds: ["revision_request"],
      productIds: [],
    });
    expect(exported.ok).toBe(true);
    expect((exported.bundle as CatalogueBundle).products).toHaveLength(1);
    expect((exported.bundle as CatalogueBundle).files).toHaveLength(2);
  });
});
