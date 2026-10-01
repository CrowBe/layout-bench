/**
 * Text of a PDF spec sheet, page by page (#34), read in the browser with pdf.js. Nothing is
 * uploaded and nothing is OCR'd: a scanned page has no text layer and comes back empty.
 *
 * pdf.js is loaded on first use so the studio's main bundle does not carry it.
 */

export interface PageText {
  /** 1-based, as printed in a locator ("p. 2") */
  page: number;
  text: string;
}

/** The slice of pdf.js this module uses, so a test can hand in the Node build. */
export interface PdfjsLike {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; disableFontFace?: boolean }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
      destroy(): Promise<void>;
    }>;
  };
}

/** Load the browser build and point it at its worker, bundled as a separate asset by Vite. */
async function browserPdfjs(): Promise<PdfjsLike> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs as unknown as PdfjsLike;
}

/** Join one page's text items: pdf.js marks line ends with hasEOL. */
export function pageTextFromItems(items: unknown[]): string {
  let out = "";
  for (const it of items) {
    const item = it as { str?: unknown; hasEOL?: unknown };
    if (typeof item.str === "string") out += item.str;
    if (item.hasEOL) out += "\n";
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Every page's text, page 1 first. Throws when the bytes are not a readable PDF. */
export async function extractPdfPages(data: ArrayBuffer | Uint8Array, load: () => Promise<PdfjsLike> = browserPdfjs): Promise<PageText[]> {
  const pdfjs = await load();
  // pdf.js takes ownership of (detaches) the buffer it is given, so hand it a copy
  const bytes = new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data)).slice();
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true }).promise;
  try {
    const pages: PageText[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push({ page: n, text: pageTextFromItems(content.items) });
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}
