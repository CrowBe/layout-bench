import { beforeEach, describe, expect, it } from "vitest";
import {
  configureProductStorage,
  initializeProductLibrary,
  productStore,
  products,
  requestEvidenceAttachments,
} from "../src/model/productLibrary";
import { revisionDifferences, revisionOf } from "../src/model/productRevision";
import type { SpecSubmission } from "../src/model/products";
import { unknownIdentity } from "../src/model/productIdentity";
import { actions, store } from "../src/model/store";
import { emptyModel } from "../src/model/types";
import { catalogForItem, CATALOG } from "../src/model/catalog";
import { previewProductUpdate } from "../src/model/productUpdates";
import { checkSheet } from "../src/sheets/check";
import { planningEvidence } from "../src/model/productRevision";
const source = {
  url: "https://example.com/synthetic-vanity.pdf",
  locator: "p. 2",
};
const pub = (value: number | string) => ({
  value,
  status: "published" as const,
  sources: [source],
});
const spec = (): SpecSubmission => ({
  manufacturer: "Synthetic Co",
  model: "Same vanity",
  code: "V900",
  identity: {
    ...unknownIdentity(),
    code: { state: "known", value: "V900", sources: [source] },
  },
  fields: {
    width: pub(0.9),
    depth: pub(0.45),
    height: pub(0.6),
    mounting: pub("wall-hung"),
    benchHeight: pub(0.85),
    wasteHeight: pub(0.5),
    tapHoles: pub(1),
  },
});
function accept(requestId: string) {
  for (const group of ["envelope", "rough-in", "installation"] as const)
    products.reviewGroup(requestId, group);
  const req = productStore.getState().requests.find((r) => r.id === requestId)!;
  if (req.submission?.identity)
    for (const key of Object.keys(req.submission.identity))
      products.review(requestId, `identity.${key}`, "accepted");
  expect(products.accept(requestId).ok).toBe(true);
  return productStore.getState().products.at(-1)!;
}
function original() {
  const id = products.request("vanity", {
    brand: "Synthetic Co",
    model: "Same vanity",
  }).requestId as string;
  expect(products.submit(id, spec()).ok).toBe(true);
  return accept(id);
}
beforeEach(() => {
  productStore.setState({ requests: [], products: [], loadError: null });
  store.setState({ model: emptyModel(), kinds: [], undoStack: [] });
});
describe("accepted catalogue revision history (#53)", () => {
  it("previews without changing any instance or runtime kind; updates only the human selection and supports undo", () => {
    const first = original();
    const wallId = actions.addWall(0, 0, 5, 0, 0.1, 2.4).id as string;
    actions.setWallSide(wallId, "right", {
      existing: { value: 0, status: "measured" },
      frame: { value: 0, status: "measured" },
      layers: [],
    });
    const anchor = {
      wallId,
      side: "right" as const,
      face: "existing",
      distance: 1,
      status: "proposed" as const,
    };
    const id = actions.placeProduct(first, anchor).id as string;
    actions.placeProduct(first, { ...anchor, distance: 3 });
    const before = structuredClone(store.getState().model);
    const request = products.reviseProduct(first.id).requestId as string;
    const changed = spec();
    changed.fields.width = pub(1);
    changed.fields.wasteHeight = pub(0.52);
    products.submit(request, changed);
    products.reuseReviews(request);
    const revised = accept(request);
    expect(store.getState().model).toEqual(before);
    const kinds = structuredClone(CATALOG),
      state = structuredClone({
        model: store.getState().model,
        kinds: store.getState().kinds,
        undo: store.getState().undoStack,
      });
    const preview = actions.previewProductRevision(revised.id, [id])!;
    expect(preview.applicable).toBe(true);
    expect(preview.rows[0].geometryAfter?.w).toBe(1);
    expect(CATALOG).toEqual(kinds);
    expect({
      model: store.getState().model,
      kinds: store.getState().kinds,
      undo: store.getState().undoStack,
    }).toEqual(state);
    expect(actions.applyProductRevision(preview).ok).toBe(true);
    const updated = store.getState().model;
    expect(updated.items[0].anchor).toEqual(before.items[0].anchor);
    expect(updated.items[0].productId).toBe(revised.id);
    expect(catalogForItem(updated.items[0])?.w).toBe(1);
    expect(updated.items[1]).toEqual(before.items[1]);
    expect(catalogForItem(updated.items[1])?.w).toBe(0.9);
    expect(updated.items[0].productUpdates?.[0]).toMatchObject({
      from: first.id,
      to: revised.id,
    });
    actions.undo();
    expect(store.getState().model).toEqual(before);
  });
  it("keeps project confirmations when a revision changes or removes their connection, and rejects stale previews", () => {
    const first = original();
    const wallId = actions.addWall(0, 0, 3, 0, 0.1, 2.4).id as string;
    actions.setWallSide(wallId, "right", {
      existing: { value: 0, status: "measured" },
      layers: [],
    });
    const id = actions.placeProduct(first, {
      wallId,
      side: "right",
      face: "existing",
      distance: 1,
      status: "proposed",
    }).id as string;
    actions.setServicePoint(id, {
      id: "waste",
      label: "Verified waste",
      service: "waste",
      face: "finished",
      across: 0.12,
      out: 0.06,
      up: 0.51,
      status: "measured",
      source: "Synthetic ruler survey",
    });
    const current = store.getState().model.items[0];
    const target = {
      ...structuredClone(first),
      id: "revision-two",
      revision: { seriesId: first.id, number: 2, parentProductId: first.id },
      roughIn: [],
    };
    productStore.setState({ products: [first, target] });
    const preview = actions.previewProductRevision(target.id, [id])!;
    expect(preview.rows[0].after!.servicePoints).toContainEqual(
      current.servicePoints![0],
    );
    expect(preview.rows[0].unresolved.join(" ")).toContain(
      "retained the project confirmation",
    );
    actions.setPlanName("Changed after preview");
    const before = structuredClone(store.getState().model);
    expect(actions.applyProductRevision(preview).ok).toBe(false);
    expect(store.getState().model).toEqual(before);
  });
  it("retains immutable issued content as planning evidence changes and undo does not erase issued history", () => {
    const first = original();
    const wallId = actions.addWall(0, 0, 3, 0, 0.1, 2.4).id as string;
    actions.setWallSide(wallId, "right", {
      existing: { value: 0, status: "measured" },
      layers: [],
    });
    actions.placeProduct(first, {
      wallId,
      side: "right",
      face: "existing",
      distance: 1,
      status: "proposed",
    });
    const findings = checkSheet(store.getState().model, "floor-plan");
    const issued = actions.exportSheet("floor-plan", {
      acknowledge: findings
        .filter((f) => f.severity === "blocking")
        .map((f) => ({
          code: f.code,
          ref: f.ref,
          reason: "Synthetic review fixture",
        })),
      by: "human",
    });
    expect(issued.ok, issued.summary).toBe(true);
    const history = structuredClone(
      store.getState().model.sheetSet!.revisions[0],
    );
    expect(history.content!.svg).toBe(issued.svg);
    actions.setPlanName("New planning evidence");
    expect(history.content!.modelEvidence).not.toBe(
      planningEvidence(store.getState().model),
    );
    actions.undo();
    expect(store.getState().model.sheetSet!.revisions[0]).toEqual(history);
  });
  it("opens a separate draft, preserves accepted evidence and appends a reviewed revision", () => {
    const product = original();
    const history = structuredClone(productStore.getState().requests[0]);
    const draftId = products.reviseProduct(product.id).requestId as string;
    expect(productStore.getState().requests[0]).toEqual(history);
    const changed = spec();
    changed.fields.width = pub(1);
    changed.fields.wasteHeight = pub(0.52);
    expect(revisionDifferences(product, changed).map((d) => d.key)).toEqual([
      "fields.width",
      "fields.wasteHeight",
    ]);
    expect(products.submit(draftId, changed).ok).toBe(true);
    expect(productStore.getState().requests[1].reviews).toEqual({});
    products.reuseReviews(draftId);
    const revision = accept(draftId);
    expect(revision.id).not.toBe(product.id);
    expect(revisionOf(revision)).toEqual({
      seriesId: product.id,
      number: 2,
      parentProductId: product.id,
    });
    expect(productStore.getState().products[0]).toEqual(product);
    expect(productStore.getState().requests[0]).toEqual(history);
    expect(products.removeProduct(product.id).ok).toBe(false);
  });
  it("refuses a different exact variant as a correction and cancellation leaves history intact", () => {
    const product = original();
    const before = structuredClone(productStore.getState().products);
    const id = products.reviseProduct(product.id).requestId as string;
    const changed = spec();
    changed.code = "V1000";
    changed.identity!.code.value = "V1000";
    expect(products.submit(id, changed).ok).toBe(true);
    for (const key of Object.keys(changed.fields))
      products.review(id, key, "accepted");
    expect(products.accept(id).ok).toBe(false);
    expect(productStore.getState().products).toEqual(before);
    products.withdraw(id);
    expect(productStore.getState().products).toEqual(before);
  });
  it("resolves inherited attachment citations after reload without sharing detach ownership", () => {
    const product = original();
    const origin = productStore.getState().requests[0];
    const attachment = {
      id: "sourcePDF",
      name: "synthetic.pdf",
      kind: "pdf" as const,
      mime: "application/pdf",
      size: 10,
      addedAt: 1,
      pages: [{ page: 1, text: "Synthetic specification" }],
    };
    productStore.setState({
      requests: [{ ...origin, attachments: [attachment] }],
    });
    const id = products.reviseProduct(product.id).requestId as string;
    const draft = productStore.getState().requests[1];
    expect(draft.attachments).toEqual([]);
    expect(requestEvidenceAttachments(draft)).toEqual([attachment]);
    const changed = spec();
    changed.fields.width = {
      ...pub(1),
      sources: [{ url: "attachment:sourcePDF", locator: "p. 1" }],
    };
    expect(products.submit(id, changed).ok).toBe(true);
    let raw = JSON.stringify({
      version: 1,
      requests: productStore.getState().requests,
      products: productStore.getState().products,
    });
    const old = configureProductStorage({
      local: () => ({
        getItem: () => raw,
        setItem: (_, value) => {
          raw = value;
        },
      }),
    });
    try {
      productStore.setState({ requests: [], products: [] }); // fresh browser state
      initializeProductLibrary(true);
      expect(productStore.getState().loadError).toBeNull();
      expect(
        productStore
          .getState()
          .requests[1].submission!.warnings.some(
            (w) => w.code === "source_invalid",
          ),
      ).toBe(false);
      expect(
        requestEvidenceAttachments(productStore.getState().requests[1]),
      ).toEqual([attachment]);
    } finally {
      configureProductStorage(old);
    }
  });
});
