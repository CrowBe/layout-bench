/** Manual catalogue transfer. The archive carries original bytes; extracted text is never a backup.
 * Preview is immutable planning data. This module does not write storage or project instances. */
import { categoryById, roughInPoints, validateSubmission } from "./products";
import { isExactProduct, identityOf } from "./productIdentity";
import {
  isProductSpecification,
  isPhysicalItem,
  validateMeasurementFields,
} from "./productMeasurements";
import { validInstallationGeometry } from "./installation";
import { reviewEvidence } from "./productReview";
import {
  MAX_ATTACHMENT_BYTES,
  type LibraryProduct,
  type ProductRequest,
  type ProductAttachment,
} from "./productLibrary";
import type { PageText } from "./pdfText";

export const MAX_BUNDLE_BYTES = 80 * 1048576;
export interface CatalogueRecords {
  requests: ProductRequest[];
  products: LibraryProduct[];
}
export interface BundleFile {
  id: string;
  mime: string;
  size: number;
  sha256: string;
  base64: string;
}
export interface CatalogueBundle extends CatalogueRecords {
  format: "reno-layouts.catalogue";
  version: 1;
  bundleId: string;
  files: BundleFile[];
}
export interface ImportProvenance {
  bundleId: string;
  sourceId: string;
  sourceHash: string;
  recordHash: string;
  importedAt: number;
  remaps: BundleMaps;
  previous?: ImportProvenance;
}
export interface BundleMaps {
  requests: Record<string, string>;
  products: Record<string, string>;
  attachments: Record<string, string>;
}
export interface BundlePreview {
  bundle: CatalogueBundle;
  base: string;
  rawBase: string | null;
  maps: BundleMaps;
  additions: CatalogueRecords;
  files: { id: string; originalId: string; blob: Blob; sha256: string }[];
  collisions: {
    type: "request" | "product" | "attachment";
    id: string;
    target: string;
  }[];
  warnings: string[];
  reused: boolean;
  canCommit: boolean;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const identifier = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[A-Za-z0-9_:-]{1,160}$/.test(v) &&
  !["__proto__", "constructor", "prototype"].includes(v);
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown) => typeof v === "string";
export function stableBundleValue(v: unknown, depth = 0): string {
  if (depth > 32) throw new Error("Catalogue evidence is nested too deeply.");
  if (Array.isArray(v))
    return `[${v.map((x) => stableBundleValue(x, depth + 1)).join(",")}]`;
  if (object(v))
    return `{${Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([k, x]) => `${JSON.stringify(k)}:${stableBundleValue(x, depth + 1)}`,
      )
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}
export const recordsFingerprint = (records: CatalogueRecords) =>
  stableBundleValue(records);
const withoutImport = (record: ProductRequest | LibraryProduct) => {
  const { bundleImport: _import, ...rest } = record;
  return rest;
};
export async function bundleHash(value: string | Uint8Array): Promise<string> {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
const encode = (bytes: Uint8Array) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};
function decode(value: string): Uint8Array {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new Error("Invalid original-file encoding.");
  const raw = atob(value),
    bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  if (encode(bytes) !== value)
    throw new Error("Noncanonical original-file encoding.");
  return bytes;
}
function attachmentValid(value: unknown): value is ProductAttachment {
  if (
    !object(value) ||
    !identifier(value.id) ||
    !text(value.name) ||
    !value.name ||
    !["pdf", "image"].includes(String(value.kind)) ||
    !text(value.mime) ||
    !finite(value.size) ||
    Number(value.size) <= 0 ||
    Number(value.size) > MAX_ATTACHMENT_BYTES ||
    !finite(value.addedAt)
  )
    return false;
  if (value.kind === "image")
    return (
      /^image\/(png|jpeg|webp|gif)$/.test(String(value.mime)) &&
      value.pages === undefined
    );
  return (
    value.mime === "application/pdf" &&
    Array.isArray(value.pages) &&
    value.pages.length > 0 &&
    value.pages.every((p, i) => object(p) && p.page === i + 1 && text(p.text))
  );
}
function reviewValid(value: unknown): boolean {
  return (
    object(value) &&
    Object.entries(value).every(
      ([key, review]) =>
        text(key) &&
        object(review) &&
        ["accepted", "rejected"].includes(String(review.decision)) &&
        (review.reason === undefined || text(review.reason)) &&
        (review.evidence === undefined || text(review.evidence)) &&
        (review.method === undefined ||
          ["individual", "group", "reused"].includes(String(review.method))),
    )
  );
}
const snapshotValid = (
  category: string,
  fields: unknown,
  at: unknown,
  mode: unknown,
) =>
  isProductSpecification({
    category,
    fields,
    acceptedAt: at,
    recordingMode: mode,
  });
/** Validate records before touching bytes; optional sibling fields remain in the cloned records. */
export function validateBundleRecords(
  value: unknown,
): asserts value is CatalogueRecords {
  if (
    !object(value) ||
    !Array.isArray(value.requests) ||
    !Array.isArray(value.products) ||
    value.requests.length > 500 ||
    value.products.length > 500
  )
    throw new Error("Invalid catalogue records.");
  const requestIds = new Set<string>(),
    productIds = new Set<string>();
  for (const raw of value.requests) {
    if (
      object(raw) &&
      typeof raw.category === "string" &&
      !categoryById(raw.category)
    )
      throw new Error(
        `Unsupported product category ${raw.category}; this browser cannot interpret its evidence schema. Nothing was imported.`,
      );
    if (
      !object(raw) ||
      !identifier(raw.id) ||
      requestIds.has(raw.id) ||
      !text(raw.category) ||
      !categoryById(raw.category) ||
      !object(raw.known) ||
      !finite(raw.createdAt) ||
      !["open", "submitted", "accepted", "withdrawn"].includes(
        String(raw.status),
      ) ||
      !reviewValid(raw.reviews) ||
      !isExactProduct({
        manufacturer: "",
        model: "",
        ...raw.known,
        identity: raw.known.identity,
        physicalItem: raw.known.physicalItem,
      })
    )
      throw new Error("Invalid request or review history.");
    if (raw.mode !== undefined && raw.mode !== "human-measurement")
      throw new Error("Unsupported request recording mode.");
    if (
      raw.mode === "human-measurement" &&
      !isPhysicalItem(raw.known.physicalItem)
    )
      throw new Error(
        "Human measurement request is missing its physical item label.",
      );
    if (raw.measurementDraft !== undefined && raw.mode !== "human-measurement")
      throw new Error(
        "Measurement draft requires the explicit human recording mode.",
      );
    if (
      (raw.evidenceOriginRequestId !== undefined &&
        !identifier(raw.evidenceOriginRequestId)) ||
      (raw.productId !== undefined && !identifier(raw.productId)) ||
      (raw.revisionOf !== undefined && !identifier(raw.revisionOf))
    )
      throw new Error("Invalid request dependency.");
    if (
      raw.attachments !== undefined &&
      (!Array.isArray(raw.attachments) ||
        !raw.attachments.every(attachmentValid))
    )
      throw new Error("Invalid attachment metadata.");
    if (
      (raw.reuseCandidates !== undefined &&
        !reviewValid(raw.reuseCandidates)) ||
      (raw.individualOnly !== undefined &&
        (!Array.isArray(raw.individualOnly) ||
          !raw.individualOnly.every(text))) ||
      (raw.previousRejections !== undefined &&
        (!object(raw.previousRejections) ||
          !Object.values(raw.previousRejections).every(text)))
    )
      throw new Error("Invalid review revision evidence.");
    if (
      raw.measurementDraft !== undefined &&
      !snapshotValid(
        raw.category,
        raw.measurementDraft,
        raw.createdAt,
        raw.mode,
      )
    )
      throw new Error(
        "Unsupported or invalid measurement draft schema, unit or evidence.",
      );
    if (
      object(raw.submission) &&
      raw.submission.installationGeometry !== undefined &&
      !validInstallationGeometry(raw.submission.installationGeometry)
    )
      throw new Error("Unsupported or invalid source installation geometry.");
    if (
      raw.submission !== undefined &&
      (!isExactProduct(raw.submission) ||
        !object(raw.submission) ||
        !finite(raw.submission.at) ||
        !Array.isArray(raw.submission.warnings) ||
        !raw.submission.warnings.every(
          (w) =>
            object(w) &&
            (w.field === null || text(w.field)) &&
            ["error", "warning"].includes(String(w.severity)) &&
            text(w.code) &&
            text(w.message),
        ) ||
        !snapshotValid(
          raw.category,
          raw.submission.fields,
          raw.submission.at,
          raw.mode,
        ))
    )
      throw new Error("Invalid submitted evidence.");
    if (
      ["submitted", "accepted"].includes(String(raw.status)) &&
      raw.submission === undefined
    )
      throw new Error("Submitted request is missing its evidence.");
    requestIds.add(raw.id);
  }
  for (const raw of value.products) {
    if (
      !object(raw) ||
      !identifier(raw.id) ||
      productIds.has(raw.id) ||
      !text(raw.category) ||
      !categoryById(raw.category) ||
      !identifier(raw.requestId) ||
      !isExactProduct(raw) ||
      !snapshotValid(
        raw.category,
        raw.fields,
        raw.acceptedAt,
        raw.recordingMode,
      ) ||
      !Array.isArray(raw.roughIn)
    )
      throw new Error("Invalid accepted product evidence.");
    if (
      raw.installationGeometry !== undefined &&
      !validInstallationGeometry(raw.installationGeometry)
    )
      throw new Error("Unsupported or invalid accepted installation geometry.");
    if (
      raw.revision !== undefined &&
      (!object(raw.revision) ||
        !identifier(raw.revision.seriesId) ||
        !Number.isInteger(raw.revision.number) ||
        Number(raw.revision.number) < 1 ||
        (raw.revision.parentProductId !== undefined &&
          !identifier(raw.revision.parentProductId)))
    )
      throw new Error("Invalid accepted revision history.");
    productIds.add(raw.id);
  }
  const records = value as unknown as CatalogueRecords;
  for (const r of records.requests) {
    const revisionOf = (r as ProductRequest & { revisionOf?: string })
      .revisionOf;
    if (
      (r.evidenceOriginRequestId &&
        !requestIds.has(r.evidenceOriginRequestId)) ||
      (r.productId && !productIds.has(r.productId)) ||
      (revisionOf && !productIds.has(revisionOf))
    )
      throw new Error("Bundle is missing referenced request/product history.");
    const seen = new Set<string>();
    let next: ProductRequest | undefined = r;
    while (next?.evidenceOriginRequestId) {
      if (seen.has(next.id))
        throw new Error("Cyclic original-evidence history.");
      seen.add(next.id);
      next = records.requests.find(
        (x) => x.id === next!.evidenceOriginRequestId,
      );
    }
    if (r.measurementDraft) {
      const problems = validateMeasurementFields(
        categoryById(r.category)!,
        r.measurementDraft,
        { attachments: collectEvidenceAttachments(r, records.requests) },
      );
      if (problems.some((p) => p.severity === "error"))
        throw new Error(
          `Unsupported or invalid measurement draft: ${problems
            .filter((p) => p.severity === "error")
            .map((p) => p.message)
            .join(" ")}`,
        );
    }
    if (r.submission) {
      const cat = categoryById(r.category)!;
      const attachments = collectEvidenceAttachments(r, records.requests);
      const problems = r.mode
        ? validateMeasurementFields(cat, r.submission.fields, { attachments })
        : validateSubmission(cat, r.submission, { attachments });
      if (problems.some((p) => p.severity === "error"))
        throw new Error(
          `Invalid submitted evidence: ${problems
            .filter((p) => p.severity === "error")
            .map((p) => p.message)
            .join(" ")}`,
        );
    }
  }
  for (const p of records.products) {
    const r = records.requests.find((r) => r.id === p.requestId),
      revision = (
        p as LibraryProduct & {
          revision?: { seriesId: string; parentProductId?: string };
        }
      ).revision;
    if (
      !r ||
      r.status !== "accepted" ||
      r.category !== p.category ||
      r.productId !== p.id
    )
      throw new Error(
        "Accepted product lacks its originating accepted request.",
      );
    if (
      revision &&
      (!productIds.has(revision.seriesId) ||
        (revision.parentProductId && !productIds.has(revision.parentProductId)))
    )
      throw new Error("Bundle is missing accepted revision lineage.");
    const problems = p.recordingMode
      ? validateMeasurementFields(categoryById(p.category)!, p.fields, {
          attachments: collectEvidenceAttachments(r, records.requests),
        })
      : validateSubmission(categoryById(p.category)!, p, {
          attachments: collectEvidenceAttachments(r, records.requests),
        });
    if (problems.some((p) => p.severity === "error"))
      throw new Error("Invalid accepted product fields.");
  }
}
function collectEvidenceAttachments(
  request: ProductRequest,
  requests: ProductRequest[],
): ProductAttachment[] {
  const all = new Map<string, ProductAttachment>(),
    seen = new Set<string>();
  let r: ProductRequest | undefined = request;
  while (r && !seen.has(r.id)) {
    seen.add(r.id);
    for (const a of r.attachments ?? []) all.set(a.id, a);
    r = r.evidenceOriginRequestId
      ? requests.find((x) => x.id === r!.evidenceOriginRequestId)
      : undefined;
  }
  return [...all.values()];
}
export function bundleSelection(
  records: CatalogueRecords,
  selection: { requestIds: string[]; productIds: string[] },
): CatalogueRecords {
  const requests = new Set<string>(),
    products = new Set<string>();
  const addRequest = (id: string) => {
    if (requests.has(id)) return;
    const r = records.requests.find((r) => r.id === id);
    if (!r) throw new Error(`Missing request ${id}.`);
    requests.add(id);
    if (r.evidenceOriginRequestId) addRequest(r.evidenceOriginRequestId);
    if (r.productId) addProduct(r.productId);
    const revisionOf = (r as ProductRequest & { revisionOf?: string })
      .revisionOf;
    if (revisionOf) addProduct(revisionOf);
  };
  const addProduct = (id: string) => {
    if (products.has(id)) return;
    const p = records.products.find((p) => p.id === id);
    if (!p) throw new Error(`Missing product ${id}.`);
    products.add(id);
    addRequest(p.requestId);
    const revision = (
      p as LibraryProduct & {
        revision?: { seriesId: string; parentProductId?: string };
      }
    ).revision;
    if (revision) {
      addProduct(revision.seriesId);
      if (revision.parentProductId) addProduct(revision.parentProductId);
    }
  };
  for (const id of selection.requestIds) addRequest(id);
  for (const id of selection.productIds) addProduct(id);
  const selected = {
    requests: records.requests.filter((r) => requests.has(r.id)),
    products: records.products.filter((p) => products.has(p.id)),
  };
  if (!selected.requests.length && !selected.products.length)
    throw new Error("Select a product or pending request.");
  return structuredClone(selected);
}
function attachmentManifest(records: CatalogueRecords): ProductAttachment[] {
  const all = new Map<string, ProductAttachment>();
  for (const r of records.requests)
    for (const a of r.attachments ?? []) {
      const previous = all.get(a.id);
      if (previous && stableBundleValue(previous) !== stableBundleValue(a))
        throw new Error(`Conflicting attachment metadata for ${a.id}.`);
      all.set(a.id, a);
    }
  return [...all.values()];
}
export async function exportCatalogueBundle(
  records: CatalogueRecords,
  selection: { requestIds: string[]; productIds: string[] },
  get: (id: string) => Promise<Blob | null>,
): Promise<CatalogueBundle> {
  const chosen = bundleSelection(records, selection);
  validateBundleRecords(chosen);
  const files: BundleFile[] = [];
  for (const att of attachmentManifest(chosen)) {
    const blob = await get(att.id);
    if (!blob)
      throw new Error(
        `Missing original attachment ${att.name} (${att.id}). Extracted text/metadata are not an original-file backup.`,
      );
    if (blob.size !== att.size || blob.type !== att.mime)
      throw new Error(`Original file ${att.name} disagrees with its metadata.`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    files.push({
      id: att.id,
      mime: att.mime,
      size: bytes.length,
      sha256: await bundleHash(bytes),
      base64: encode(bytes),
    });
  }
  const content = { ...chosen, files };
  const bundle: CatalogueBundle = {
    format: "reno-layouts.catalogue",
    version: 1,
    bundleId: await bundleHash(stableBundleValue(content)),
    ...content,
  };
  if (JSON.stringify(bundle).length > MAX_BUNDLE_BYTES)
    throw new Error(
      "Selected bundle exceeds 80 MB; select fewer products or requests.",
    );
  return bundle;
}
async function validateFile(
  file: BundleFile,
  att: ProductAttachment,
  extract: (data: ArrayBuffer) => Promise<PageText[]>,
): Promise<Blob> {
  if (
    file.mime !== att.mime ||
    file.size !== att.size ||
    file.size > MAX_ATTACHMENT_BYTES ||
    !/^([a-f0-9]{64})$/.test(file.sha256) ||
    typeof file.base64 !== "string"
  )
    throw new Error(`Invalid original file ${att.name}.`);
  const bytes = decode(file.base64);
  if (bytes.length !== file.size || (await bundleHash(bytes)) !== file.sha256)
    throw new Error(`Original file ${att.name} fails its size/SHA-256 check.`);
  const magic = String.fromCharCode(...bytes.subarray(0, 16));
  if (att.kind === "pdf") {
    if (!magic.startsWith("%PDF-"))
      throw new Error(`${att.name} is not a PDF.`);
    const pages = await extract(bytes.slice().buffer);
    if (stableBundleValue(pages) !== stableBundleValue(att.pages))
      throw new Error(
        `Extracted page evidence for ${att.name} disagrees with the original PDF.`,
      );
  } else {
    const valid =
      att.mime === "image/png"
        ? bytes[0] === 137 && magic.slice(1, 4) === "PNG"
        : att.mime === "image/jpeg"
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : att.mime === "image/gif"
            ? magic.startsWith("GIF87a") || magic.startsWith("GIF89a")
            : magic.startsWith("RIFF") && magic.slice(8, 12) === "WEBP";
    if (!valid)
      throw new Error(
        `${att.name} does not contain its declared image format.`,
      );
  }
  return new Blob([bytes.slice().buffer], { type: att.mime });
}
/** Internal references and citation identity change together. Human notes are retained except
 * explicit attachment:<id> tokens, which continue to identify the same hashed original bytes. */
function remap(value: unknown, maps: BundleMaps, key = "", depth = 0): unknown {
  if (depth > 32) throw new Error("Catalogue evidence is nested too deeply.");
  if (typeof value === "string") {
    if (["requestId", "evidenceOriginRequestId"].includes(key))
      return maps.requests[value] ?? value;
    if (
      ["productId", "revisionOf", "parentProductId", "seriesId"].includes(key)
    )
      return maps.products[value] ?? value;
    return value.replace(
      /attachment:([A-Za-z0-9_:-]+)/g,
      (token, id: string) =>
        maps.attachments[id] ? `attachment:${maps.attachments[id]}` : token,
    );
  }
  if (Array.isArray(value))
    return value.map((v) => remap(v, maps, key, depth + 1));
  if (object(value))
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, remap(v, maps, k, depth + 1)]),
    );
  return value;
}
const newId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
export async function previewCatalogueBundle(
  raw: string,
  current: CatalogueRecords,
  rawBase: string | null,
  get: (id: string) => Promise<Blob | null>,
  extract: (data: ArrayBuffer) => Promise<PageText[]>,
): Promise<BundlePreview> {
  if (raw.length > MAX_BUNDLE_BYTES)
    throw new Error("Catalogue bundle exceeds 80 MB.");
  const input: unknown = JSON.parse(raw);
  if (
    !object(input) ||
    input.format !== "reno-layouts.catalogue" ||
    input.version !== 1 ||
    !Array.isArray(input.files) ||
    input.files.length > 500 ||
    typeof input.bundleId !== "string"
  )
    throw new Error("Unsupported or malformed catalogue bundle.");
  validateBundleRecords(input);
  const bundle = input as unknown as CatalogueBundle;
  if (
    (await bundleHash(
      stableBundleValue({
        requests: bundle.requests,
        products: bundle.products,
        files: bundle.files,
      }),
    )) !== bundle.bundleId
  )
    throw new Error("Catalogue bundle content fingerprint does not match.");
  const manifest = attachmentManifest(bundle),
    originals = new Map<string, Blob>(),
    hashes = new Map<string, string>();
  if (
    bundle.files.some(
      (f) => !object(f) || !manifest.some((a) => a.id === f.id),
    ) ||
    new Set(bundle.files.map((f) => f.id)).size !== bundle.files.length
  )
    throw new Error("Invalid or unreferenced original files.");
  for (const att of manifest) {
    const file = bundle.files.find((f) => f.id === att.id);
    if (!file)
      throw new Error(
        `Missing original file ${att.name}; metadata/text alone cannot be imported as evidence.`,
      );
    originals.set(att.id, await validateFile(file, att, extract));
    hashes.set(att.id, file.sha256);
  }
  const maps: BundleMaps = { requests: {}, products: {}, attachments: {} },
    warnings: string[] = [],
    collisions: BundlePreview["collisions"] = [];
  // Reimport is a no-op only while every imported record and original byte remains equivalent.
  let equivalent = true;
  for (const type of ["requests", "products"] as const)
    for (const record of bundle[type]) {
      const hash = await bundleHash(stableBundleValue(withoutImport(record))),
        currentHashes = new Map(
          await Promise.all(
            current[type].map(
              async (r) =>
                [
                  r.id,
                  await bundleHash(stableBundleValue(withoutImport(r))),
                ] as const,
            ),
          ),
        );
      const found =
        current[type].find(
          (r) =>
            r.bundleImport?.bundleId === bundle.bundleId &&
            r.bundleImport.sourceId === record.id &&
            r.bundleImport.sourceHash === hash &&
            r.bundleImport.recordHash === currentHashes.get(r.id),
        ) ??
        current[type].find(
          (r) =>
            r.id === record.id &&
            stableBundleValue(withoutImport(r)) ===
              stableBundleValue(withoutImport(record)),
        );
      if (!found) {
        equivalent = false;
        break;
      }
      maps[type][record.id] = found.id;
    }
  if (equivalent) {
    for (const att of manifest) {
      // Resolve through the matched owner, never an unrelated record/orphan with the old ID.
      const owner = bundle.requests.find((r) =>
        r.attachments?.some((a) => a.id === att.id),
      );
      const localOwner = current.requests.find(
        (r) => r.id === maps.requests[owner!.id],
      );
      const localId =
        localOwner?.bundleImport?.bundleId === bundle.bundleId
          ? localOwner.bundleImport.remaps.attachments[att.id]
          : att.id;
      const found = localOwner?.attachments?.find((a) => a.id === localId);
      if (!found) {
        equivalent = false;
        break;
      }
      const blob = await get(found.id);
      if (
        !blob ||
        (await bundleHash(new Uint8Array(await blob.arrayBuffer()))) !==
          hashes.get(att.id)
      ) {
        equivalent = false;
        break;
      }
      maps.attachments[att.id] = found.id;
    }
  }
  if (equivalent)
    return {
      bundle,
      base: recordsFingerprint(current),
      rawBase,
      maps,
      additions: { requests: [], products: [] },
      files: [],
      collisions: [],
      warnings: [
        "Every record and original file already exists unchanged; nothing will be duplicated.",
      ],
      reused: true,
      canCommit: true,
    };
  const used = {
    requests: new Set(current.requests.map((r) => r.id)),
    products: new Set(current.products.map((p) => p.id)),
    attachments: new Set(
      current.requests.flatMap((r) => (r.attachments ?? []).map((a) => a.id)),
    ),
  };
  let collision = false;
  for (const type of ["requests", "products"] as const)
    for (const r of bundle[type])
      if (used[type].has(r.id)) {
        collision = true;
        collisions.push({
          type: type === "requests" ? "request" : "product",
          id: r.id,
          target: "",
        });
      }
  for (const att of manifest)
    if (used.attachments.has(att.id) || (await get(att.id))) {
      collision = true;
      collisions.push({ type: "attachment", id: att.id, target: "" });
    }
  for (const type of ["requests", "products"] as const)
    for (const r of bundle[type]) {
      let id = collision
        ? newId(type === "requests" ? "preq_import" : "product_import")
        : r.id;
      while (used[type].has(id))
        id = newId(type === "requests" ? "preq_import" : "product_import");
      used[type].add(id);
      maps[type][r.id] = id;
    }
  for (const att of manifest) {
    let id = collision ? newId("att_import") : att.id;
    while (used.attachments.has(id) || (await get(id)))
      id = newId("att_import");
    used.attachments.add(id);
    maps.attachments[att.id] = id;
  }
  for (const item of collisions)
    item.target =
      maps[
        item.type === "request"
          ? "requests"
          : item.type === "product"
            ? "products"
            : "attachments"
      ][item.id];
  if (collision)
    warnings.push(
      "Existing IDs collide or prior imported records changed. The complete selected evidence family will be added with new IDs; existing records are preserved. Cancel to keep only the existing entries.",
    );
  const additions: CatalogueRecords = {
    requests: bundle.requests.map((r) => ({
      ...(remap(withoutImport(r), maps) as ProductRequest),
      id: maps.requests[r.id],
      ...(r.attachments
        ? {
            attachments: r.attachments.map((a) => ({
              ...a,
              id: maps.attachments[a.id],
            })),
          }
        : {}),
    })),
    products: bundle.products.map((p) => ({
      ...(remap(withoutImport(p), maps) as LibraryProduct),
      id: maps.products[p.id],
    })),
  };
  // A review fingerprint may be translated only when it really bound the original evidence.
  for (const [i, r] of additions.requests.entries())
    for (const reviews of ["reviews", "reuseCandidates"] as const)
      for (const [key, review] of Object.entries(r[reviews] ?? {}))
        if (review.evidence) {
          const original = bundle.requests[i];
          if (
            original[reviews]?.[key]?.evidence ===
            reviewEvidence(original, key, bundle.requests)
          ) {
            review.evidence = reviewEvidence(r, key, additions.requests);
          } else {
            delete (r[reviews] ?? {})[key];
            warnings.push(
              `Stale ${reviews} for ${original.id} ${key} stays pending; no approval was rebound.`,
            );
          }
        }
  for (const [i, p] of additions.products.entries())
    p.roughIn = roughInPoints(
      categoryById(p.category)!,
      p.fields,
      p.recordingMode === "human-measurement",
    );
  const importedAt = Date.now();
  for (const type of ["requests", "products"] as const)
    for (const [i, record] of additions[type].entries()) {
      const original = bundle[type][i];
      record.bundleImport = {
        bundleId: bundle.bundleId,
        sourceId: original.id,
        sourceHash: await bundleHash(
          stableBundleValue(withoutImport(original)),
        ),
        recordHash: await bundleHash(stableBundleValue(withoutImport(record))),
        importedAt,
        remaps: structuredClone(maps),
        ...(original.bundleImport
          ? { previous: structuredClone(original.bundleImport) }
          : {}),
      };
    }
  validateBundleRecords(additions);
  return {
    bundle,
    base: recordsFingerprint(current),
    rawBase,
    maps,
    additions,
    files: manifest.map((a) => ({
      id: maps.attachments[a.id],
      originalId: a.id,
      blob: originals.get(a.id)!,
      sha256: hashes.get(a.id)!,
    })),
    collisions,
    warnings,
    reused: false,
    canCommit: true,
  };
}
