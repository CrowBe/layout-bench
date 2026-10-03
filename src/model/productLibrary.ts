/**
 * Product library (#30): research requests and accepted products, saved in this browser and
 * shared by every project. Kept apart from the project store on purpose: a toilet researched
 * once belongs to no single plan.
 *
 * Agents may request, read and submit. Only a human accepts: acceptProduct is called from the
 * Products page and is not published as a tool.
 */

import { identityOf, validateIdentity, isExactProduct, type ProductIdentity, type ProductComponent, type ExactProduct } from "./productIdentity";
import { safeUrl } from "./products";
import { currentReview, prepareReviewRevision, productReviewSummary, requiredReviewKeys, reviewEvidence, REVIEW_GROUPS } from "./productReview";
import type { FieldGroup } from "./products";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { ATTACHMENT_PREFIX, categoryById, roughInPoints, validateSubmission, type FieldValue, type RoughInPoint, type SpecProblem, type SpecSubmission } from "./products";
import { extractPdfPages, type PageText } from "./pdfText";
import { indexedDbFiles, memoryFiles, type FileStore } from "./productFiles";

export const PRODUCTS_KEY = "alza.products.v1";

export interface KnownDetails {
  brand?: string;
  model?: string;
  reference?: string; // quote line, product code
  link?: string;
  notes?: string;
  identity?: ProductIdentity;
  components?: ProductComponent[];
  componentsStatus?: ExactProduct["componentsStatus"];
}

export type RequestStatus = "open" | "submitted" | "accepted" | "withdrawn";

export interface FieldReview {
  decision: "accepted" | "rejected";
  reason?: string;
  /** Evidence reviewed by the human; absent on legacy records. */
  evidence?: string;
  method?: "individual" | "group" | "reused";
}

/** Largest file a request takes (#34). Spec sheets are rarely over a few MB. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/**
 * A spec sheet the person attached to a request (#34). Its bytes are in IndexedDB under the
 * same id; this record, with a PDF's text page by page, is saved with the library.
 */
export interface ProductAttachment {
  id: string;
  name: string;
  kind: "pdf" | "image";
  mime: string;
  size: number;
  addedAt: number;
  /** PDF only, page 1 first; a page with no text layer (a scan) has empty text */
  pages?: PageText[];
}

export interface ProductRequest {
  id: string;
  category: string;
  known: KnownDetails;
  status: RequestStatus;
  createdAt: number;
  submission?: SpecSubmission & { at: number; warnings: SpecProblem[] };
  reviews: Record<string, FieldReview>;
  /** Unchanged approvals require an explicit human reuse action after revision. */
  reuseCandidates?: Record<string, FieldReview>;
  /** Previously rejected fields must be reviewed individually, even after correction. */
  individualOnly?: string[];
  /** Preserve the human's reason when corrected evidence invalidates a rejection. */
  previousRejections?: Record<string, string>;
  /** what the human said when sending it back */
  feedback?: string;
  productId?: string;
  /** spec sheets the person attached; absent on requests saved before #34 */
  attachments?: ProductAttachment[];
}

export interface LibraryProduct extends ExactProduct {
  id: string;
  category: string;
  manufacturer: string;
  model: string;
  code?: string;
  fields: Record<string, FieldValue>;
  /** service points derived from the accepted fields, each axis naming its datum */
  roughIn: RoughInPoint[];
  requestId: string;
  acceptedAt: number;
}

/** Compare evidence records, including omissions. Persisted warning lists are only a cache. */
function requestEvidenceWarnings(knownDetails: KnownDetails, submission: SpecSubmission): SpecProblem[] {
  const identity = identityOf(submission);
  const identityWarnings = Object.entries(knownDetails.identity ?? {}).flatMap(([key, known]) => {
    const found = identity[key as keyof ProductIdentity];
    return known.state !== "unknown" && (known.state !== found.state || known.value !== found.value) ? [{ field: `identity.${key}`, severity: "warning" as const, code: "identity_conflict", message: `identity.${key}: request says ${known.value ?? known.state}; research says ${found.value ?? found.state}. Human review required.` }] : [];
  });
  const componentWarnings = (knownDetails.components ?? []).flatMap(known => {
    const found = submission.components?.find(c => c.name === known.name);
    if (!found) return [{ field: "components", severity: "warning" as const, code: "identity_conflict", message: `${known.name}: request documents code ${known.code.value ?? known.code.state}, quantity ${known.quantity ?? "unknown"}, ${known.provision}; research omits this component. Human review required.` }];
    const differs = known.code.state !== "unknown" && (known.code.state !== found.code.state || known.code.value !== found.code.value) || known.quantity !== null && known.quantity !== found.quantity || known.provision !== "unresolved" && known.provision !== found.provision;
    return differs ? [{ field: "components", severity: "warning" as const, code: "identity_conflict", message: `${known.name}: component code, quantity or provision conflicts with the request. Human review required.` }] : [];
  });
  const knownStatus = knownDetails.componentsStatus ?? "unknown", submittedStatus = submission.componentsStatus ?? "unknown";
  if (knownStatus !== "unknown" && knownStatus !== submittedStatus) componentWarnings.unshift({ field: "components", severity: "warning", code: "identity_conflict", message: `Component status: request says ${knownStatus}; research says ${submittedStatus}. Human review required.` });
  return [...identityWarnings, ...componentWarnings];
}

/** Pending review always derives conflicts anew; accepted history keeps its recorded warnings. */
export function productReviewWarnings(request: ProductRequest): SpecProblem[] {
  if (!request.submission) return [];
  const category = categoryById(request.category);
  const warnings = [...request.submission.warnings, ...(request.status === "submitted" ? [
    ...requestEvidenceWarnings(request.known, request.submission),
    ...(category ? validateSubmission(category, request.submission, { attachments: request.attachments ?? [] }) : []),
  ] : [])];
  return [...new Map(warnings.map(w => [`${w.field}:${w.code}:${w.message}`, w])).values()];
}

interface LibraryDoc {
  version: 1;
  requests: ProductRequest[];
  products: LibraryProduct[];
}

interface LibraryState extends LibraryDoc {
  open: boolean;
  selectedRequestId: string | null;
  loadError: string | null;
}

export interface LibraryResult {
  ok: boolean;
  summary: string;
  [k: string]: unknown;
}

const ok = (summary: string, extra: Record<string, unknown> = {}): LibraryResult => ({ ok: true, summary, ...extra });
const fail = (summary: string, extra: Record<string, unknown> = {}): LibraryResult => ({ ok: false, summary, ...extra });
const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const productStore = createStore<LibraryState>(() => ({
  version: 1, requests: [], products: [], open: false, selectedRequestId: null, loadError: null,
}));
export const useProductStore = <T>(selector: (s: LibraryState) => T): T => useStore(productStore, selector);

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

/** Where the library and its files live. Tests swap these for in-memory ones. */
const io: { local: () => KeyValueStore | null; files: FileStore; extract: (data: ArrayBuffer) => Promise<PageText[]> } = {
  local: () => (typeof localStorage !== "undefined" ? localStorage : null),
  files: typeof indexedDB !== "undefined" ? indexedDbFiles : memoryFiles(),
  extract: (data) => extractPdfPages(data),
};

/** Replace the storage or PDF reader (tests). Returns the previous settings. */
export function configureProductStorage(next: Partial<typeof io>): typeof io {
  const prev = { ...io };
  Object.assign(io, next);
  return prev;
}

const hasStorage = () => io.local() !== null;
let ready = false;

const docOf = (s: Pick<LibraryDoc, "requests" | "products">) => JSON.stringify({ version: 1, requests: s.requests, products: s.products });

/** Browsers report a full store as QuotaExceededError (code 22, or 1014 in old Firefox). */
export function isQuotaError(error: unknown): boolean {
  const e = error as { name?: string; code?: number } | null;
  return !!e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);
}

const storageFull = (name: string) =>
  `Browser storage is full, so ${name} was not attached and nothing changed. Remove attachments or library products you no longer need, or export and remove old projects, then try again.`;

/** Read the library once. An unreadable library is left untouched and reported. */
export function initializeProductLibrary(force = false): void {
  if ((ready && !force) || !hasStorage()) return;
  ready = false;
  try {
    const raw = io.local()!.getItem(PRODUCTS_KEY);
    if (raw) {
      const doc = JSON.parse(raw) as Partial<LibraryDoc>;
      if (doc.version !== 1 || !Array.isArray(doc.requests) || !Array.isArray(doc.products)) {
        throw new Error("Unsupported or unreadable product library. Original browser data was kept.");
      }
      if (!doc.products.every(isExactProduct) || !doc.requests.every(r => r && r.known
        && isExactProduct({ manufacturer: "", model: "", identity: r.known.identity, components: r.known.components, componentsStatus: r.known.componentsStatus })
        && (r.submission === undefined || isExactProduct(r.submission)))) throw new Error("Invalid product identity evidence. Original browser data was kept.");
      productStore.setState({ loadError: null, requests: doc.requests.map(r => ({ ...r, known: { ...r.known, identity: identityOf(r.known) }, ...(r.status === "submitted" && r.submission ? { submission: { ...r.submission, warnings: productReviewWarnings(r) } } : {}) })), products: doc.products.map(p => ({ ...p, identity: identityOf(p), components: p.components ?? [], componentsStatus: p.componentsStatus ?? "unknown" })) });
    }
    ready = true;
  } catch (error) {
    productStore.setState({ loadError: error instanceof Error ? error.message : String(error) });
  }
}

productStore.subscribe((s, prev) => {
  if (!ready || !hasStorage() || (s.requests === prev.requests && s.products === prev.products)) return;
  try {
    io.local()!.setItem(PRODUCTS_KEY, docOf(s));
  } catch (error) {
    productStore.setState({ loadError: `Product library save failed: ${error instanceof Error ? error.message : String(error)}` });
  }
});

const updateRequest = (id: string, patch: Partial<ProductRequest>) =>
  productStore.setState((s) => ({ requests: s.requests.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));

const findRequest = (id: string): ProductRequest | undefined => productStore.getState().requests.find((r) => r.id === id);

export const products = {
  show(open = true) { productStore.setState({ open }); },
  select(id: string | null) { productStore.setState({ selectedRequestId: id }); },

  request(category: string, known: KnownDetails): LibraryResult {
    const cat = categoryById(category);
    if (!cat) return fail(`Unknown category "${category}". Use one of the categories get_product_brief lists.`);
    const clean: KnownDetails = {};
    for (const k of ["brand", "model", "reference", "link", "notes"] as const) {
      const v = known?.[k];
      if (typeof v === "string" && v.trim()) clean[k] = v.trim();
    }
    if (!clean.brand && !clean.model && !clean.reference && !clean.link) {
      return fail("Say something that identifies the product: brand, model, a quote reference or a link.");
    }
    if (known.identity !== undefined || known.components !== undefined || known.componentsStatus !== undefined) {
      const problems = validateIdentity({ manufacturer: "", model: "", identity: known.identity, components: known.components, componentsStatus: known.componentsStatus }, (sources) => sources.length > 0 && sources.every((s) => s && typeof s === "object" && safeUrl((s as {url?: unknown}).url) && typeof (s as {locator?: unknown}).locator === "string" && (s as {locator: string}).locator.trim()) ? null : "Give an http(s) source and locator.");
      if (problems.some(p => p.severity === "error")) return fail(problems.map(p => p.message).join(" "));
    }
    clean.identity = structuredClone(identityOf(known));
    if (known.components !== undefined) clean.components = structuredClone(known.components);
    if (known.componentsStatus !== undefined) clean.componentsStatus = known.componentsStatus;
    const req: ProductRequest = { id: uid("preq"), category: cat.id, known: clean, status: "open", createdAt: Date.now(), reviews: {} };
    productStore.setState((s) => ({ requests: [...s.requests, req], selectedRequestId: req.id }));
    return ok(`${cat.label} request ${req.id} opened. Read its brief with get_product_brief.`, { requestId: req.id });
  },

  /** Store an agent's completed brief. Errors reject it whole; warnings go to the reviewer. */
  submit(requestId: string, submission: SpecSubmission): LibraryResult {
    const req = findRequest(requestId);
    if (!req) return fail(`No product request "${requestId}".`);
    if (req.status !== "open") return fail(`Request ${req.id} is ${req.status}; only an open request takes a submission.`);
    const cat = categoryById(req.category)!;
    const problems = validateSubmission(cat, submission, { attachments: req.attachments ?? [] });
    const errors = problems.filter((p) => p.severity === "error");
    if (errors.length) {
      return fail(`Submission rejected, nothing stored: ${errors.map((e) => e.message).join(" ")}`, { problems: errors });
    }
    const identity = identityOf(submission);
    const warnings = [...problems, ...requestEvidenceWarnings(req.known, submission)].filter((p) => p.severity === "warning");
    const next: ProductRequest = {
      ...req, status: "submitted",
      submission: { ...structuredClone(submission), ...(submission.identity ? { identity: structuredClone(identity) } : {}), at: Date.now(), warnings },
      reviews: {},
    };
    const revision = prepareReviewRevision(req, next);
    updateRequest(req.id, {
      status: next.status, submission: next.submission, ...revision,
      feedback: undefined,
    });
    return ok(
      `Submitted for human review.${warnings.length ? ` Flagged for the reviewer: ${warnings.map((w) => w.message).join(" ")}` : ""}`,
      { warnings },
    );
  },

  review(requestId: string, field: string, decision: FieldReview["decision"], reason?: string): LibraryResult {
    const req = findRequest(requestId);
    if (!req?.submission || req.status !== "submitted") return fail("Only a submitted request can be reviewed.");
    if (!requiredReviewKeys(req).includes(field)) return fail("Only a submitted or flagged field can be reviewed.");
    if (!["accepted", "rejected"].includes(decision)) return fail("Choose accepted or rejected.");
    if (decision === "rejected" && !reason?.trim()) return fail("Say why the value is rejected, so the agent can act on it.");
    const rejection = decision === "rejected" ? reason!.trim() : req.reviews[field]?.decision === "rejected" ? req.reviews[field].reason : undefined;
    updateRequest(req.id, {
      reviews: { ...req.reviews, [field]: { decision, evidence: reviewEvidence(req, field), method: "individual", ...(reason?.trim() ? { reason: reason.trim() } : {}) } },
      ...(rejection ? {
        individualOnly: [...new Set([...(req.individualOnly ?? []), field])],
        previousRejections: { ...req.previousRejections, [field]: rejection },
      } : {}),
    });
    return ok(`${field} ${decision}.`);
  },

  /** Human only; recompute eligibility at the click, never trust the displayed count. */
  reviewGroup(requestId: string, group: FieldGroup): LibraryResult {
    const req = findRequest(requestId);
    if (!req?.submission || req.status !== "submitted") return fail("Only a submitted request can be reviewed.");
    if (!REVIEW_GROUPS.includes(group)) return fail("Choose envelope, rough-in or installation.");
    const keys = productReviewSummary(req).groups.find(g => g.group === group)!.eligible;
    if (!keys.length) return fail(`No clean pending ${group} fields are eligible.`);
    const reviews = { ...req.reviews };
    for (const key of keys) reviews[key] = { decision: "accepted", evidence: reviewEvidence(req, key), method: "group" };
    updateRequest(req.id, { reviews });
    return ok(`Human accepted ${keys.length} clean ${group} field(s). Final product acceptance is separate.`, { reviewed: keys });
  },

  /** Human explicitly confirms reuse of the unchanged evidence shown in the page. */
  reuseReviews(requestId: string): LibraryResult {
    const req = findRequest(requestId);
    if (!req?.submission || req.status !== "submitted") return fail("Only a submitted request can reuse reviews.");
    const keys = productReviewSummary(req).reuse;
    if (!keys.length) return fail("No unchanged accepted reviews can be reused.");
    const reviews = { ...req.reviews };
    for (const key of keys) reviews[key] = { ...req.reuseCandidates![key], method: "reused" };
    updateRequest(req.id, { reviews });
    return ok(`Human reused ${keys.length} unchanged accepted review(s).`, { reviewed: keys });
  },

  /** Send a submission back to the agent with the reviewer's reasons. */
  returnToAgent(requestId: string, feedback: string): LibraryResult {
    const req = findRequest(requestId);
    if (!req || req.status !== "submitted") return fail("Only a submitted request can be returned.");
    const rejected = Object.entries(req.reviews).filter(([, r]) => r.decision === "rejected").map(([k, r]) => `${k}: ${r.reason}`);
    const text = [feedback.trim(), ...rejected].filter(Boolean).join(" · ");
    if (!text) return fail("Say what needs another look, or reject a field with a reason.");
    updateRequest(req.id, { status: "open", feedback: text });
    return ok("Returned to the agent.");
  },

  /** Human only. Every submitted field must be reviewed and accepted. */
  accept(requestId: string): LibraryResult {
    const req = findRequest(requestId);
    if (!req?.submission || req.status !== "submitted") return fail("Only a submitted request can be accepted.");
    const errors = productReviewWarnings(req).filter(w => w.severity === "error");
    if (errors.length) return fail(`Submission needs correction: ${errors.map(e => e.message).join(" ")}`);
    const pending = requiredReviewKeys(req).filter((k) => currentReview(req, k)?.decision !== "accepted");
    if (pending.length) return fail(`Review every field first. Not accepted: ${pending.join(", ")}.`);
    const product: LibraryProduct = {
      id: uid("product"),
      category: req.category,
      manufacturer: req.submission.manufacturer.trim(),
      model: req.submission.model.trim(),
      ...(req.submission.identity?.code?.state === "known" ? { code: req.submission.identity.code.value!.trim() } : req.submission.code?.trim() ? { code: req.submission.code.trim() } : {}),
      identity: structuredClone(identityOf(req.submission)),
      components: structuredClone(req.submission.components ?? []),
      componentsStatus: req.submission.componentsStatus ?? "unknown",
      fields: structuredClone(req.submission.fields),
      roughIn: roughInPoints(categoryById(req.category)!, req.submission.fields),
      requestId: req.id,
      acceptedAt: Date.now(),
    };
    productStore.setState((s) => ({
      products: [...s.products, product],
      requests: s.requests.map((r) => (r.id === req.id ? { ...r, status: "accepted" as const, productId: product.id } : r)),
    }));
    return ok(`${product.manufacturer} ${product.model} added to the product library.`, { productId: product.id });
  },

  withdraw(requestId: string): LibraryResult {
    const req = findRequest(requestId);
    if (!req || req.status === "accepted") return fail("Only an open or submitted request can be withdrawn.");
    updateRequest(req.id, { status: "withdrawn" });
    return ok("Request withdrawn.");
  },

  /**
   * Attach a spec sheet the person holds (#34). A PDF's text is read page by page in the
   * browser; an image is kept for the person to look at. The file is refused whole when it is
   * too large, unreadable or does not fit in browser storage: nothing is half-saved.
   */
  async attach(requestId: string, file: Blob & { name?: string }): Promise<LibraryResult> {
    const req = findRequest(requestId);
    if (!req) return fail(`No product request "${requestId}".`);
    if (req.status !== "open") return fail(`Request ${req.id} is ${req.status}; attach spec sheets while it is open.`);
    const name = (file.name ?? "").trim() || "spec sheet";
    const mime = file.type || (/\.pdf$/i.test(name) ? "application/pdf" : "");
    const kind = mime === "application/pdf" ? "pdf" : IMAGE_TYPES[mime] ? "image" : null;
    if (!kind) return fail(`${name} is not a PDF or an image (PNG, JPEG, WebP or GIF).`);
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return fail(`${name} is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${MAX_ATTACHMENT_BYTES / 1048576} MB per file. Attach just the specification pages.`);
    }
    if (file.size === 0) return fail(`${name} is empty.`);
    let pages: PageText[] | undefined;
    if (kind === "pdf") {
      try {
        pages = await io.extract(await file.arrayBuffer());
      } catch (error) {
        return fail(`Could not read ${name} as a PDF (${error instanceof Error ? error.message : String(error)}). Nothing was attached.`);
      }
    }
    const att: ProductAttachment = { id: uid("att"), name, kind, mime, size: file.size, addedAt: Date.now(), ...(pages ? { pages } : {}) };
    try {
      // stored under the type that was checked, so viewing it never depends on the browser's
      // guess for an untyped file (a typeless blob: URL may be sniffed as a page)
      await io.files.put(att.id, file.type === mime ? file : new Blob([file], { type: mime }));
    } catch (error) {
      return fail(isQuotaError(error) ? storageFull(name) : `Could not store ${name} in this browser: ${error instanceof Error ? error.message : String(error)}. Nothing was attached.`);
    }
    // the request may have moved on while the file was read
    const now = findRequest(requestId);
    if (!now || now.status !== "open") {
      await io.files.remove(att.id).catch(() => {});
      return fail(`Request ${requestId} is no longer open; ${name} was not attached.`);
    }
    const state = productStore.getState();
    const requests = state.requests.map((r) => (r.id === now.id ? { ...r, attachments: [...(r.attachments ?? []), att] } : r));
    // write first, so a full localStorage refuses the attachment instead of leaving it unsaved
    const local = ready ? io.local() : null;
    if (local) {
      try {
        local.setItem(PRODUCTS_KEY, docOf({ requests, products: state.products }));
      } catch (error) {
        await io.files.remove(att.id).catch(() => {});
        return fail(isQuotaError(error) ? storageFull(name) : `Product library save failed: ${error instanceof Error ? error.message : String(error)}. ${name} was not attached.`);
      }
    }
    productStore.setState({ requests, ...(state.loadError?.startsWith("Product library save failed") ? { loadError: null } : {}) });
    const text = !pages ? "An image has no text for the agent: it is for your review."
      : pages.some((p) => p.text.trim()) ? `${pages.length} page(s) of text read for the agent.`
      : `${pages.length} page(s), but no text could be read (a scanned sheet?). Scans are not OCR'd, so the agent cannot read it.`;
    return ok(`${name} attached as ${ATTACHMENT_PREFIX}${att.id}. ${text}`, { attachmentId: att.id });
  },

  /** Remove an attachment from an open request. A submission that cites it will be refused. */
  async detach(requestId: string, attachmentId: string): Promise<LibraryResult> {
    const req = findRequest(requestId);
    const att = req?.attachments?.find((a) => a.id === attachmentId);
    if (!req || !att) return fail("Attachment not found.");
    if (req.status !== "open") return fail(`Request ${req.id} is ${req.status}; its attachments are kept as the record of what was cited.`);
    updateRequest(req.id, { attachments: req.attachments!.filter((a) => a.id !== attachmentId) });
    await io.files.remove(attachmentId).catch(() => {});
    return ok(`${att.name} removed.`);
  },

  /** The attached file itself, for the person to view. Null when this browser no longer has it. */
  file(attachmentId: string): Promise<Blob | null> {
    return io.files.get(attachmentId).catch(() => null);
  },

  removeProduct(id: string): LibraryResult {
    if (!productStore.getState().products.some((p) => p.id === id)) return fail("Product not found.");
    productStore.setState((s) => ({ products: s.products.filter((p) => p.id !== id) }));
    return ok("Product removed from the library.");
  },
};
