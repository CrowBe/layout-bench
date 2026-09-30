/**
 * Product library (#30): research requests and accepted products, saved in this browser and
 * shared by every project. Kept apart from the project store on purpose: a toilet researched
 * once belongs to no single plan.
 *
 * Agents may request, read and submit. Only a human accepts: acceptProduct is called from the
 * Products page and is not published as a tool.
 */

import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { categoryById, roughInPoints, validateSubmission, type FieldValue, type RoughInPoint, type SpecProblem, type SpecSubmission } from "./products";

export const PRODUCTS_KEY = "alza.products.v1";

export interface KnownDetails {
  brand?: string;
  model?: string;
  reference?: string; // quote line, product code
  link?: string;
  notes?: string;
}

export type RequestStatus = "open" | "submitted" | "accepted" | "withdrawn";

export interface FieldReview {
  decision: "accepted" | "rejected";
  reason?: string;
}

export interface ProductRequest {
  id: string;
  category: string;
  known: KnownDetails;
  status: RequestStatus;
  createdAt: number;
  submission?: SpecSubmission & { at: number; warnings: SpecProblem[] };
  reviews: Record<string, FieldReview>;
  /** what the human said when sending it back */
  feedback?: string;
  productId?: string;
}

export interface LibraryProduct {
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

const hasStorage = () => typeof localStorage !== "undefined";
let ready = false;

/** Read the library once. An unreadable library is left untouched and reported. */
export function initializeProductLibrary(): void {
  if (ready || !hasStorage()) return;
  try {
    const raw = localStorage.getItem(PRODUCTS_KEY);
    if (raw) {
      const doc = JSON.parse(raw) as Partial<LibraryDoc>;
      if (doc.version !== 1 || !Array.isArray(doc.requests) || !Array.isArray(doc.products)) {
        throw new Error("Unsupported or unreadable product library. Original browser data was kept.");
      }
      productStore.setState({ requests: doc.requests, products: doc.products });
    }
    ready = true;
  } catch (error) {
    productStore.setState({ loadError: error instanceof Error ? error.message : String(error) });
  }
}

productStore.subscribe((s, prev) => {
  if (!ready || !hasStorage() || (s.requests === prev.requests && s.products === prev.products)) return;
  try {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify({ version: 1, requests: s.requests, products: s.products }));
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
    const problems = validateSubmission(cat, submission);
    const errors = problems.filter((p) => p.severity === "error");
    if (errors.length) {
      return fail(`Submission rejected, nothing stored: ${errors.map((e) => e.message).join(" ")}`, { problems: errors });
    }
    const warnings = problems.filter((p) => p.severity === "warning");
    updateRequest(req.id, {
      status: "submitted",
      submission: { ...structuredClone(submission), at: Date.now(), warnings },
      reviews: {},
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
    if (decision === "rejected" && !reason?.trim()) return fail("Say why the value is rejected, so the agent can act on it.");
    updateRequest(req.id, { reviews: { ...req.reviews, [field]: { decision, ...(reason?.trim() ? { reason: reason.trim() } : {}) } } });
    return ok(`${field} ${decision}.`);
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
    const keys = Object.keys(req.submission.fields);
    const pending = keys.filter((k) => req.reviews[k]?.decision !== "accepted");
    if (pending.length) return fail(`Review every field first. Not accepted: ${pending.join(", ")}.`);
    const product: LibraryProduct = {
      id: uid("product"),
      category: req.category,
      manufacturer: req.submission.manufacturer.trim(),
      model: req.submission.model.trim(),
      ...(req.submission.code?.trim() ? { code: req.submission.code.trim() } : {}),
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

  removeProduct(id: string): LibraryResult {
    if (!productStore.getState().products.some((p) => p.id === id)) return fail("Product not found.");
    productStore.setState((s) => ({ products: s.products.filter((p) => p.id !== id) }));
    return ok("Product removed from the library.");
  },
};
