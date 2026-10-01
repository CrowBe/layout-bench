import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { categoryById, pageOfLocator, validateSubmission, type AttachmentRef, type SpecSubmission } from "../src/model/products";
import { extractPdfPages, pageTextFromItems, type PdfjsLike } from "../src/model/pdfText";
import { memoryFiles } from "../src/model/productFiles";
import { MAX_ATTACHMENT_BYTES, PRODUCTS_KEY, configureProductStorage, initializeProductLibrary, productStore, products } from "../src/model/productLibrary";

// Synthetic spec sheet: the tests check the rules, not any real product's figures.
const nodePdfjs = async () => (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLike;

/** A minimal text PDF, one array of lines per page (an empty array is a page with no text). */
function makePdf(pages: string[][]): Uint8Array<ArrayBuffer> {
  const objs: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((lines, i) => {
    const content = lines.map((l, j) => `BT /F1 12 Tf 72 ${720 - j * 20} Td (${l}) Tj ET`).join("\n");
    objs[4 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let k = 1; k < objs.length; k++) { offsets[k] = out.length; out += `${k} 0 obj\n${objs[k]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const SHEET = [["Example Co Test Pan", "Overall width 380 mm"], ["Projection 640 mm", "Height 800 mm"], []];
const pdfFile = (pages = SHEET, name = "test-pan.pdf") => new File([makePdf(pages)], name, { type: "application/pdf" });

describe("PDF text extraction (#34)", () => {
  it("returns every page's text, 1-based, with an empty page left empty", async () => {
    const pages = await extractPdfPages(makePdf(SHEET), nodePdfjs);
    expect(pages).toEqual([
      { page: 1, text: "Example Co Test Pan\nOverall width 380 mm" },
      { page: 2, text: "Projection 640 mm\nHeight 800 mm" },
      { page: 3, text: "" },
    ]);
  });

  it("joins text items on pdf.js line ends", () => {
    expect(pageTextFromItems([{ str: "A", hasEOL: false }, { str: " B ", hasEOL: true }, { str: "C" }, { type: "beginMarkedContent" }])).toBe("A B\nC");
  });

  it("refuses bytes that are not a PDF", async () => {
    await expect(extractPdfPages(new TextEncoder().encode("not a pdf"), nodePdfjs)).rejects.toThrow();
  });

  it("reads the page from a locator", () => {
    expect(["p. 2", "p.2, fig. 1", "page 3 table 2", "pp. 4", "Pg 5", "fig. 2", ""].map(pageOfLocator)).toEqual([2, 2, 3, 4, 5, null, null]);
  });
});

// ---------------------------------------------------------------- validation
const pdf: AttachmentRef = { id: "att_1", name: "test-pan.pdf", kind: "pdf", pages: [{ page: 1, text: "width 380" }, { page: 2, text: "depth 640" }, { page: 3, text: "" }] };
const photo: AttachmentRef = { id: "att_2", name: "label.jpg", kind: "image" };
const cite = (locator: string | undefined, id = "att_1") => ({ value: 0.38, status: "published" as const, sources: [{ url: `attachment:${id}`, ...(locator !== undefined ? { locator } : {}) }] });
const web = (value: number | string) => ({ value, status: "published" as const, sources: [{ url: "https://example.com/spec.pdf", locator: "p. 1" }] });

const toilet = (width: SpecSubmission["fields"][string]): SpecSubmission => ({
  manufacturer: "Example Co", model: "Test Pan",
  fields: {
    width, depth: web(0.64), height: web(0.8), panType: web("back-to-wall"), cistern: web("close-coupled"),
    inletEntry: web("bottom"), power: web("not-required"), trap: web("S"), sTrapSetoutMin: web(0.14), sTrapSetoutMax: web(0.2), inletHeight: web(0.15),
  },
});
const check = (width: SpecSubmission["fields"][string], attachments: AttachmentRef[] = [pdf, photo]) =>
  validateSubmission(categoryById("toilet")!, toilet(width), { attachments });
const errs = (w: SpecSubmission["fields"][string], a?: AttachmentRef[]) => check(w, a).filter((p) => p.severity === "error").map((p) => `${p.code}: ${p.message}`);

describe("attachment citations (#34)", () => {
  it("accepts a citation to an existing attachment page", () => {
    expect(check(cite("p. 1"))).toEqual([]);
    expect(check(cite("p. 2, fig. 1"))).toEqual([]);
    expect(check(cite("photo of the box", "att_2"))).toEqual([]); // image: any locator
  });

  it("refuses an attachment that is not on the request", () => {
    expect(errs(cite("p. 1", "att_9"))).toEqual([expect.stringMatching(/^source_invalid: .*attachment:att_9 is not attached.*attachment:att_1 \(test-pan\.pdf\)/)]);
    expect(errs(cite("p. 1"), [])).toEqual([expect.stringMatching(/has no attachments/)]);
    expect(validateSubmission(categoryById("toilet")!, toilet(cite("p. 1"))).map((p) => p.code)).toEqual(["source_invalid"]); // no context
  });

  it("refuses a missing page, and a locator without a page", () => {
    expect(errs(cite("p. 4"))).toEqual([expect.stringMatching(/has 3 page\(s\); page 4 does not exist/)]);
    expect(errs(cite("p. 0"))).toEqual([expect.stringMatching(/page 0 does not exist/)]);
    expect(errs(cite("fig. 1"))).toEqual([expect.stringMatching(/locator to start with the page/)]);
  });

  it("still requires a locator on an attachment", () => {
    expect(errs(cite(undefined))).toEqual([expect.stringMatching(/attachment:att_1 needs a locator/)]);
    expect(errs(cite("  "))).toEqual([expect.stringMatching(/needs a locator/)]);
    expect(errs(cite(undefined, "att_2"))).toEqual([expect.stringMatching(/needs a locator/)]);
  });

  it("flags a cited page with no text for the reviewer", () => {
    expect(check(cite("p. 3")).map((p) => `${p.severity}:${p.code}`)).toEqual(["warning:attachment_page_no_text"]);
  });

  it("checks alternatives that cite attachments the same way", () => {
    const w = { ...web(0.38), alternatives: [{ value: 0.39, source: { url: "attachment:att_1", locator: "p. 7" } }] };
    expect(errs(w)).toEqual([expect.stringMatching(/^alternative_invalid: .*page 7 does not exist/)]);
  });

  it("does not take attachment: as a web link or any other scheme", () => {
    expect(errs({ value: 0.38, status: "published", sources: [{ url: "file:///spec.pdf", locator: "p. 1" }] })).toEqual([expect.stringMatching(/http\(s\) link or an attachment/)]);
  });
});

// ---------------------------------------------------------------- library flow
function fakeLocal(limit = Infinity) {
  const m = new Map<string, string>();
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (v.length > limit) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      m.set(k, v);
    },
  };
}

let restore: ReturnType<typeof configureProductStorage>;
let local: ReturnType<typeof fakeLocal>;
const setup = (limit = Infinity, files = memoryFiles()) => {
  local = fakeLocal(limit);
  configureProductStorage({ local: () => local, files, extract: (d) => extractPdfPages(d, nodePdfjs) });
  productStore.setState({ requests: [], products: [], selectedRequestId: null, loadError: null });
  initializeProductLibrary(true);
};
beforeEach(() => { restore = configureProductStorage({}); setup(); });
afterEach(() => { configureProductStorage(restore); productStore.setState({ requests: [], products: [], loadError: null }); });

const openRequest = () => products.request("toilet", { brand: "Example Co", model: "Test Pan" }).requestId as string;

describe("attaching spec sheets (#34)", () => {
  it("stores a PDF with its page text, and a submission citing its pages goes through to the library", async () => {
    const id = openRequest();
    const r = await products.attach(id, pdfFile());
    expect(r.ok).toBe(true);
    const att = productStore.getState().requests[0].attachments![0];
    expect(att).toMatchObject({ name: "test-pan.pdf", kind: "pdf", pages: [{ page: 1 }, { page: 2 }, { page: 3, text: "" }] });
    expect(att.pages![1].text).toMatch(/Projection 640 mm/);
    expect(await products.file(att.id)).not.toBeNull();

    // saved with the request; survives a reload
    const reload = () => {
      const saved = local.getItem(PRODUCTS_KEY)!;
      productStore.setState({ requests: [], products: [] }); // the next page starts empty...
      local.setItem(PRODUCTS_KEY, saved); // ...over the same browser storage
      initializeProductLibrary(true);
    };
    reload();
    expect(productStore.getState().requests[0].attachments![0].pages![1].text).toMatch(/Projection 640 mm/);

    const s = toilet({ value: 0.38, status: "published", sources: [{ url: `attachment:${att.id}`, locator: "p. 1" }] });
    s.fields.depth = { value: 0.64, status: "published", sources: [{ url: `attachment:${att.id}`, locator: "p. 2" }] };
    expect(products.submit(id, { ...s, fields: { ...s.fields, height: { value: 0.8, status: "published", sources: [{ url: `attachment:${att.id}`, locator: "p. 9" }] } } }).ok).toBe(false);
    expect(products.submit(id, s).ok).toBe(true);
    for (const k of Object.keys(s.fields)) products.review(id, k, "accepted");
    expect(products.accept(id).ok).toBe(true);
    // citations survive acceptance and reload
    reload();
    expect(productStore.getState().products[0].fields.depth.sources).toEqual([{ url: `attachment:${att.id}`, locator: "p. 2" }]);
    expect(productStore.getState().requests[0].attachments).toHaveLength(1);
    // attachments are the record once the request is no longer open
    expect((await products.detach(id, att.id)).ok).toBe(false);
  });

  it("keeps an image for review with no text", async () => {
    const id = openRequest();
    const r = await products.attach(id, new File([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], "label.jpg", { type: "image/jpeg" }));
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/no text for the agent/);
    expect(productStore.getState().requests[0].attachments![0]).not.toHaveProperty("pages");
  });

  it("refuses files over the size limit, other types and unreadable PDFs, storing nothing", async () => {
    const id = openRequest();
    const big = new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "huge.pdf", { type: "application/pdf" });
    expect((await products.attach(id, big)).summary).toMatch(/huge\.pdf is 10\.0 MB; the limit is 10 MB/);
    expect((await products.attach(id, new File(["x"], "notes.docx", { type: "application/msword" }))).summary).toMatch(/not a PDF or an image/);
    expect((await products.attach(id, new File(["not a pdf"], "bad.pdf", { type: "application/pdf" }))).summary).toMatch(/Could not read bad\.pdf as a PDF/);
    expect(productStore.getState().requests[0].attachments ?? []).toEqual([]);
  });

  it("refuses with a clear error when browser storage is full, leaving the request and the file store unchanged", async () => {
    const id = openRequest();
    const files = memoryFiles();
    const saved = local.getItem(PRODUCTS_KEY)!;
    // localStorage full: the page text does not fit
    local = fakeLocal(saved.length + 50);
    local.setItem(PRODUCTS_KEY, saved);
    configureProductStorage({ local: () => local, files });
    const r = await products.attach(id, pdfFile());
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/Browser storage is full, so test-pan\.pdf was not attached and nothing changed/);
    expect(productStore.getState().requests[0].attachments).toBeUndefined();
    expect(local.getItem(PRODUCTS_KEY)).toBe(saved);

    // IndexedDB full: the file itself does not fit
    configureProductStorage({ local: () => fakeLocal(), files: { ...files, put: async () => { throw new DOMException("full", "QuotaExceededError"); } } });
    expect((await products.attach(id, pdfFile())).summary).toMatch(/Browser storage is full/);
    expect(productStore.getState().requests[0].attachments).toBeUndefined();
  });

  it("removes the file when the library cannot be saved, and attaches only to an open request", async () => {
    const id = openRequest();
    const files = memoryFiles();
    let stored: string | null = null;
    configureProductStorage({ files: { ...files, put: async (k, b) => { stored = k; await files.put(k, b); } }, local: () => ({ getItem: () => null, setItem: () => { throw new DOMException("full", "QuotaExceededError"); } }) });
    await products.attach(id, pdfFile());
    expect(await files.get(stored!)).toBeNull();

    configureProductStorage({ local: () => fakeLocal(), files });
    products.withdraw(id);
    expect((await products.attach(id, pdfFile())).summary).toMatch(/withdrawn; attach spec sheets while it is open/);
  });
});

describe("stored attachment type (#34)", () => {
  it("stores an untyped .pdf under application/pdf, so the viewer never sniffs it", async () => {
    const id = openRequest();
    const r = await products.attach(id, new File([makePdf(SHEET)], "untyped.pdf"));
    expect(r.ok).toBe(true);
    const blob = await products.file(r.attachmentId as string);
    expect(blob?.type).toBe("application/pdf");
    expect(productStore.getState().requests[0].attachments![0].mime).toBe("application/pdf");
  });
});
