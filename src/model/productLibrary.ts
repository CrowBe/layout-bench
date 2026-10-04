import { validInstallationGeometry, type InstallationGeometry } from "./installation";
/**
 * Product library (#30): research requests and accepted products, saved in this browser and
 * shared by every project. Kept apart from the project store on purpose: a toilet researched
 * once belongs to no single plan.
 *
 * Agents may request, read and submit. Only a human accepts: acceptProduct is called from the
 * Products page and is not published as a tool.
 */

import { identityOf, validateIdentity, isExactProduct, type ProductIdentity, type ProductComponent, type ExactProduct } from "./productIdentity";
import { exportCatalogueBundle, previewCatalogueBundle, recordsFingerprint, stableBundleValue, bundleHash, validateBundleRecords, type BundlePreview, type ImportProvenance } from "./productBundles";
import { safeUrl } from "./products";
import { isPhysicalItem, isProductSpecification, unknownMeasurementFields, validateMeasurementFields, type PhysicalItem } from "./productMeasurements";
import { currentReview, prepareReviewRevision, productReviewSummary, requiredReviewKeys, reviewEvidence, REVIEW_GROUPS } from "./productReview";
import type { FieldGroup } from "./products";
import { revisionOf, revisionVariantProblems, validProductRevision, type ProductRevision } from "./productRevision";
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
  physicalItem?: PhysicalItem;
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
  bundleImport?: ImportProvenance;
  id: string;
  category: string;
  known: KnownDetails;
  status: RequestStatus;
  createdAt: number;
  submission?: SpecSubmission & { at: number; warnings: SpecProblem[] };
  reviews: Record<string, FieldReview>;
  /** Human-started correction of this accepted product; exact variants stay separate. */
  revisionOf?: string;
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
  mode?: "human-measurement";
  measurementDraft?: Record<string, FieldValue>;
  /** Read-only evidence owned by a prior request; inherited files cannot be detached here. */
  evidenceOriginRequestId?: string;
}

export interface LibraryProduct extends ExactProduct {
  bundleImport?: ImportProvenance;
  id: string;
  category: string;
  manufacturer: string;
  model: string;
  code?: string;
  fields: Record<string, FieldValue>;
  /** service points derived from the accepted fields, each axis naming its datum */
  roughIn: RoughInPoint[];
  installationGeometry?: InstallationGeometry;
  requestId: string;
  acceptedAt: number;
  revision?: ProductRevision;
  recordingMode?: "human-measurement";
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
export function productReviewWarnings(request: ProductRequest, requests = productStore.getState().requests): SpecProblem[] {
  if (!request.submission) return [];
  const category = categoryById(request.category);
  const warnings = [...request.submission.warnings, ...(request.status === "submitted" ? [
    ...requestEvidenceWarnings(request.known, request.submission),
    ...(category ? request.mode === "human-measurement" ? validateMeasurementFields(category, request.submission.fields, { attachments: requestEvidenceAttachments(request, requests) }) : validateSubmission(category, request.submission, { attachments: requestEvidenceAttachments(request, requests) }) : []),
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
export function requestEvidenceAttachments(request: ProductRequest, requests = productStore.getState().requests): ProductAttachment[] {
  const result = new Map<string, ProductAttachment>(), visited = new Set<string>();
  let current: ProductRequest | undefined = request;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    for (const attachment of current.attachments ?? []) if (!result.has(attachment.id)) result.set(attachment.id, attachment);
    current = current.evidenceOriginRequestId ? requests.find(r => r.id === current!.evidenceOriginRequestId) : undefined;
  }
  return [...result.values()];
}
export const useProductStore = <T>(selector: (s: LibraryState) => T): T => useStore(productStore, selector);

type KeyValueStore = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage,"removeItem">>;

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
let bundleCommitInFlight = false;
const bundlePreviews = new WeakMap<BundlePreview, string>();
const previewSignature = (p: BundlePreview) => stableBundleValue({ base:p.base, rawBase:p.rawBase, maps:p.maps, additions:p.additions, files:p.files.map(f=>({id:f.id,sha256:f.sha256,originalId:f.originalId})), reused:p.reused });

const docOf = (s: Pick<LibraryDoc, "requests" | "products">) => JSON.stringify({ version: 1, requests: s.requests, products: s.products });

/** Compare the saved and canonical catalogue after the same version-1 display defaults.
 * A fresh raw document alone does not mean this tab has incorporated another tab's work. */
const normalizedRecords = (records: Pick<LibraryDoc, "requests" | "products">) => ({
  requests: records.requests.map(r => ({ ...r, known: { ...r.known, identity: identityOf(r.known) }, ...(r.status === "submitted" && r.submission ? { submission: { ...r.submission, warnings: productReviewWarnings(r, records.requests) } } : {}) })),
  products: records.products.map(p => ({ ...p, identity: identityOf(p), components: p.components ?? [], componentsStatus: p.componentsStatus ?? "unknown" })),
});
function savedCatalogueMatches(state: Pick<LibraryDoc, "requests" | "products">, raw: string | null): boolean {
  if(raw === null) return state.requests.length === 0 && state.products.length === 0;
  try {
    const doc = JSON.parse(raw) as Partial<LibraryDoc>;
    return doc.version === 1 && Array.isArray(doc.requests) && Array.isArray(doc.products)
      && recordsFingerprint(normalizedRecords(state)) === recordsFingerprint(normalizedRecords(doc as LibraryDoc));
  } catch { return false; }
}


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
      if (!doc.products.every(p => isExactProduct(p) && (p.installationGeometry === undefined || validInstallationGeometry(p.installationGeometry))) || !doc.requests.every(r => r && r.known
        && isExactProduct({ manufacturer: "", model: "", identity: r.known.identity, components: r.known.components, componentsStatus: r.known.componentsStatus, physicalItem: r.known.physicalItem })
        && (r.submission === undefined || isExactProduct(r.submission) && (r.submission.installationGeometry === undefined || validInstallationGeometry(r.submission.installationGeometry))))) throw new Error("Invalid product identity evidence. Original browser data was kept.");
      if (!doc.products.every(p => isProductSpecification({ category: p.category, fields: p.fields, acceptedAt: p.acceptedAt, recordingMode: p.recordingMode })) || !doc.requests.every(r => (!r.mode || r.mode === "human-measurement") && (r.evidenceOriginRequestId === undefined || typeof r.evidenceOriginRequestId === "string") && (r.submission === undefined || isProductSpecification({ category: r.category, fields: r.submission.fields, acceptedAt: r.submission.at, recordingMode: r.mode })) && (!r.measurementDraft || isProductSpecification({ category: r.category, fields: r.measurementDraft, acceptedAt: r.createdAt, recordingMode: r.mode })))) throw new Error("Invalid product measurement evidence. Original browser data was kept.");
      if (!doc.products.every(p => p.revision === undefined || validProductRevision(p.revision)) || !doc.requests.every(r => r.revisionOf === undefined || typeof r.revisionOf === "string")) throw new Error("Invalid product revision history. Original browser data was kept.");
      productStore.setState({ loadError: null, ...normalizedRecords(doc as LibraryDoc) });
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

/** Reused fittings, and printed-label capture for items bought but not yet fitted. */
export const HUMAN_MEASURABLE = ["vanity", "toilet", "bath", "heating-cable", "thermostat", "waste"];

export const products = {
  /** Manual human transfer only. No catalogue/import write capability is exposed to agents. */
  async exportBundle(selection: { requestIds: string[]; productIds: string[] }): Promise<LibraryResult> {
    try {
      if (productStore.getState().loadError) return fail("Resolve the unreadable library before exporting evidence.");
      const state = productStore.getState(), before = recordsFingerprint(state);
      const bundle = await exportCatalogueBundle(state, selection, id => io.files.get(id));
      if (recordsFingerprint(productStore.getState()) !== before) return fail("Catalogue changed while exporting. Export the current evidence again.");
      return ok(`Original-file bundle ready: ${bundle.products.length} products, ${bundle.requests.length} requests and ${bundle.files.length} original files.`, { bundle });
    } catch(error) { return fail(error instanceof Error ? error.message : String(error)); }
  },

  async previewBundle(raw: string): Promise<LibraryResult> {
    try {
      if (!io.local() || productStore.getState().loadError) return fail("Readable browser storage is required before importing catalogue evidence.");
      const state = productStore.getState(), local = io.local()!, before = recordsFingerprint(state), rawBase = local.getItem(PRODUCTS_KEY);
      if (!savedCatalogueMatches(state, rawBase)) return fail("The saved catalogue changed in another tab or no longer matches this tab. Reload the page to read the saved catalogue before previewing; nothing was imported or overwritten.");
      const preview = await previewCatalogueBundle(raw, state, rawBase, id => io.files.get(id), io.extract);
      if (recordsFingerprint(productStore.getState()) !== before || local.getItem(PRODUCTS_KEY) !== rawBase) return fail("Catalogue changed during preview. Preview the bundle again.");
      bundlePreviews.set(preview, previewSignature(preview));
      return ok(`Preview: ${preview.additions.products.length} products, ${preview.additions.requests.length} requests and ${preview.files.length} original files to add${preview.reused ? "; already present unchanged" : ""}.`, { preview });
    } catch(error) { return fail(error instanceof Error ? error.message : String(error)); }
  },

  async importBundle(preview: BundlePreview): Promise<LibraryResult> {
    const local = io.local(), state = productStore.getState(), staged: string[] = [];
    let attemptedPersistence = false, attemptedPublication = false;
    let attemptedDocument: string | null = null;
    if (bundleCommitInFlight) return fail("Another catalogue import is still committing.");
    if (!local || state.loadError || bundlePreviews.get(preview) !== previewSignature(preview)) return fail("This import preview is unavailable or changed. Preview the original bundle again.");
    const unchanged = () => recordsFingerprint(productStore.getState()) === preview.base && local.getItem(PRODUCTS_KEY) === preview.rawBase;
    if (!unchanged()) return fail("Catalogue changed after preview. Preview again before committing.");
    if (preview.reused) return ok("The same records and original bytes already exist. Nothing was duplicated or overwritten.");
    bundleCommitInFlight = true;
    try {
      validateBundleRecords(preview.additions);
      for (const file of preview.files) {
        if (await io.files.get(file.id)) throw new Error("A staged file ID is already occupied. Preview again; existing bytes were preserved.");
        if (await bundleHash(new Uint8Array(await file.blob.arrayBuffer())) !== file.sha256) throw new Error("Preview original-file bytes changed. Preview again.");
        if (!io.files.add) throw new Error("This file store cannot create original evidence without overwriting existing bytes. Import is unavailable.");
        await io.files.add(file.id, file.blob);
        staged.push(file.id);
      }
      if (!unchanged()) throw new Error("Catalogue changed while staging original files. Preview again.");
      const next = { requests: [...state.requests, ...preview.additions.requests], products: [...state.products, ...preview.additions.products] };
      // Persist once before publishing. The normal subscription must not issue a second write.
      attemptedPersistence = true; attemptedDocument = docOf(next);
      local.setItem(PRODUCTS_KEY, attemptedDocument);
      const wasReady = ready; ready = false;
      try { attemptedPublication = true; productStore.setState({ ...next, loadError: null, selectedRequestId: preview.additions.requests.at(-1)?.id ?? state.selectedRequestId }); }
      finally { ready = wasReady; }
      bundlePreviews.delete(preview);
      return ok(`Imported ${preview.additions.products.length} accepted products, ${preview.additions.requests.length} requests and ${staged.length} original files. Existing project instances and selection statuses were preserved.`, { imported: preview.maps });
    } catch(error) {
      const rollbackErrors: string[] = [];
      if (attemptedPublication) {
        const wasReady = ready; ready = false;
        // Zustand assigns state before notifying subscribers. A throwing subscriber must
        // not leave records visible after their bytes/document are rolled back.
        try { productStore.setState(state, true); } catch { /* Assignment already restored; subscriber errors cannot veto it. */ }
        finally { ready = wasReady; }
      }
      for (const id of staged) try { await io.files.remove(id); } catch { rollbackErrors.push(id); }
      // A conforming localStorage write is atomic. Recover write-after-save faults only
      // while the document still belongs to this attempt; cleanup can allow newer work.
      if (attemptedPersistence) try { if (local.getItem(PRODUCTS_KEY) === attemptedDocument) { if (preview.rawBase === null && local.removeItem) local.removeItem(PRODUCTS_KEY); else local.setItem(PRODUCTS_KEY, preview.rawBase ?? docOf(state)); } } catch { rollbackErrors.push("library document"); }
      return fail(`${error instanceof Error ? error.message : String(error)} Catalogue was not published.${rollbackErrors.length ? ` Cleanup failed for ${rollbackErrors.join(", ")}; retained staged bytes are not visible catalogue evidence.` : " Staged files were rolled back."}`);
    } finally { bundleCommitInFlight = false; }
  },

  show(open = true) { productStore.setState({ open }); },
  select(id: string | null) { productStore.setState({ selectedRequestId: id }); },

  /** Human only: preserve the accepted request and open a separate correction draft. */
  reviseProduct(productId: string): LibraryResult {
    const product = productStore.getState().products.find(p => p.id === productId);
    if (!product) return fail("Accepted product not found.");
    const origin = findRequest(product.requestId);
    if (!origin?.submission || origin.status !== "accepted") return fail("The original accepted evidence is unavailable; do not invent revision history.");
    const req: ProductRequest = {
      ...structuredClone(origin), id: uid("preq"), status: "open", createdAt: Date.now(), productId: undefined,
      revisionOf: product.id, evidenceOriginRequestId: origin.id, attachments: [],
      ...(origin.mode ? { measurementDraft: structuredClone(product.fields) } : {}),
      feedback: `Correction draft of catalogue revision ${revisionOf(product).number}. Preserve the exact variant; changed identity requires a distinct product.`,
    };
    productStore.setState(s => ({ requests: [...s.requests, req], selectedRequestId: req.id }));
    return ok("Revision draft opened. The accepted specification and placed fixtures remain unchanged.", { requestId: req.id });
  },

  /** Human only; a physical label identifies the fitting without manufacturing a SKU. */
  openMeasurements(category: string, physicalItem: PhysicalItem, initial?: Record<string, FieldValue>, evidenceOriginRequestId?: string): LibraryResult {
    const cat = categoryById(category);
    if (!cat || !HUMAN_MEASURABLE.includes(category)) return fail(`The human measurement flow supports ${HUMAN_MEASURABLE.join(", ")}.`);
    if (!isPhysicalItem(physicalItem)) return fail("Give the physical fitting a label; manufacturer and model can stay unknown.");
    if (evidenceOriginRequestId && findRequest(evidenceOriginRequestId)?.status !== "accepted") return fail("Original accepted evidence request is missing from this browser.");
    const req: ProductRequest = { ...(evidenceOriginRequestId ? { evidenceOriginRequestId } : {}), id: uid("preq"), category, known: { physicalItem: structuredClone(physicalItem) }, mode: "human-measurement", status: "open", createdAt: Date.now(), reviews: {}, measurementDraft: structuredClone(initial ?? unknownMeasurementFields(cat)) };
    productStore.setState(s => ({ requests: [...s.requests, req], selectedRequestId: req.id }));
    return ok(`Measurements opened for ${physicalItem.label}. Record evidence, then submit for human review.`, { requestId: req.id });
  },

  /** Human UI action; never exposed as an agent write tool. */
  recordMeasurement(requestId: string, field: string, value: FieldValue): LibraryResult {
    const req = findRequest(requestId);
    if (!req || req.mode !== "human-measurement" || req.status !== "open") return fail("Only an open human measurement record can be edited.");
    const candidate = { ...req.measurementDraft, [field]: structuredClone(value) };
    const errors = validateMeasurementFields(categoryById(req.category)!, candidate, { attachments: requestEvidenceAttachments(req) }).filter(p => p.severity === "error" && p.field === field);
    if (errors.length) return fail(errors.map(p => p.message).join(" "));
    // Working selection never removes earlier evidence, even if a caller omits the history.
    const previous = req.measurementDraft?.[field];
    const strip = ({ observations: _observations, alternatives: _alternatives, ...record }: FieldValue) => record;
    const history = [...(value.observations ?? [])];
    for (const observation of [...(previous?.observations ?? []), ...(previous ? [strip(previous)] : [])]) {
      if (!history.some(v => JSON.stringify(v) === JSON.stringify(observation))) history.push(structuredClone(observation));
    }
    const working = strip(value);
    if (!history.some(v => JSON.stringify(v) === JSON.stringify(working))) history.push(structuredClone(working));
    candidate[field] = { ...candidate[field], observations: history, ...(previous?.alternatives ? { alternatives: structuredClone(previous.alternatives) } : {}) };
    updateRequest(req.id, { measurementDraft: candidate });
    return ok(`${field} evidence recorded. Other observations are retained.`);
  },

  submitMeasurements(requestId: string): LibraryResult {
    const req = findRequest(requestId);
    if (!req || req.mode !== "human-measurement" || req.status !== "open" || !req.known.physicalItem) return fail("Only an open human measurement record can be submitted.");
    const fields = req.measurementDraft ?? {};
    const problems = validateMeasurementFields(categoryById(req.category)!, fields, { attachments: requestEvidenceAttachments(req) });
    if (problems.some(p => p.severity === "error")) return fail(problems.filter(p => p.severity === "error").map(p => p.message).join(" "));
    const next: ProductRequest = { ...req, status: "submitted", submission: { manufacturer: "", model: "", physicalItem: structuredClone(req.known.physicalItem), fields: structuredClone(fields), at: Date.now(), warnings: problems } };
    updateRequest(req.id, { status: next.status, submission: next.submission, ...prepareReviewRevision(req, next) });
    return ok("Measurements submitted for human field review. Unknowns and disagreements remain visible.");
  },

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
    if (req.mode === "human-measurement") return fail("This is an explicit human measurement record. An agent cannot submit measurements; use the human page controls.");
    if (req.status !== "open") return fail(`Request ${req.id} is ${req.status}; only an open request takes a submission.`);
    const cat = categoryById(req.category)!;
    const problems = validateSubmission(cat, submission, { attachments: requestEvidenceAttachments(req) });
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
    const parent = req.revisionOf ? productStore.getState().products.find(p => p.id === req.revisionOf) : undefined;
    if (req.revisionOf && !parent) return fail("The accepted parent revision is missing; nothing changed.");
    if (parent) {
      const different = revisionVariantProblems(parent, req.submission);
      if (different.length) return fail(`Exact variant changed (${different.join(", ")}). Open a distinct product request instead of revising this product.`);
      const number = revisionOf(parent).number;
      if (productStore.getState().products.some(p => revisionOf(p).seriesId === revisionOf(parent).seriesId && revisionOf(p).number > number)) return fail("A newer accepted revision exists. Start from that revision so evidence history cannot silently branch.");
    }
    const productId = uid("product");
    const product: LibraryProduct = {
      id: productId,
      revision: parent ? { seriesId: revisionOf(parent).seriesId, number: revisionOf(parent).number + 1, parentProductId: parent.id } : { seriesId: productId, number: 1 },
      category: req.category,
      manufacturer: req.submission.manufacturer.trim(),
      model: req.submission.model.trim(),
      ...(req.submission.identity?.code?.state === "known" ? { code: req.submission.identity.code.value!.trim() } : req.submission.code?.trim() ? { code: req.submission.code.trim() } : {}),
      identity: structuredClone(identityOf(req.submission)),
      components: structuredClone(req.submission.components ?? []),
      componentsStatus: req.submission.componentsStatus ?? "unknown",
      ...(req.mode === "human-measurement" ? { recordingMode: req.mode, physicalItem: structuredClone(req.known.physicalItem) } : {}),
      fields: structuredClone(req.submission.fields),
      ...(req.submission.installationGeometry ? { installationGeometry: structuredClone(req.submission.installationGeometry) } : {}),
      roughIn: roughInPoints(categoryById(req.category)!, req.submission.fields, req.mode === "human-measurement"),
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
    const product = productStore.getState().products.find(p => p.id === id)!;
    if (productStore.getState().products.some(p => p.id !== id && revisionOf(p).seriesId === revisionOf(product).seriesId)) return fail("This product has accepted revision history. Its evidence must remain available to pinned fixtures and later revisions.");
    productStore.setState((s) => ({ products: s.products.filter((p) => p.id !== id) }));
    return ok("Product removed from the library.");
  },
};
