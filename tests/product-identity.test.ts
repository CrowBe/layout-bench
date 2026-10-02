import { beforeEach, describe, expect, it } from "vitest";
import { identityOf, identityReviewKeys, unknownIdentity } from "../src/model/productIdentity";
import { categoryById, validateSubmission, type SpecSubmission } from "../src/model/products";
import { configureProductStorage, initializeProductLibrary, productStore, products, PRODUCTS_KEY } from "../src/model/productLibrary";
import { actions, store } from "../src/model/store";
import { parseImport } from "../src/model/projects";
import { emptyModel } from "../src/model/types";
import { specRows } from "../src/sheets/stageView";

// Synthetic fixture evidence: example.com is deliberately not a real manufacturer source.
const source = { url: "https://example.com/synthetic-vanity.pdf", locator: "variant table, p. 2" };
const pub = (value: number | string) => ({ value, status: "published" as const, sources: [source] });
const known = (value: string) => ({ state: "known" as const, value, sources: [source] });
const spec = (finish = "Chrome"): SpecSubmission => ({ manufacturer: "Synthetic Co", model: "Variant 900", identity: { code: known(`V900-${finish}`), finish: known(finish), configuration: known("900 mm cabinet"), handedness: { state: "not-applicable", value: null, sources: [source] } }, componentsStatus: "documented", components: [{ name: "Waste", code: known("WASTE-32"), quantity: 1, provision: "separately-required", sources: [source] }], fields: { width: pub(.9), depth: pub(.45), height: pub(.6), mounting: pub("wall-hung"), benchHeight: pub(.85), wasteHeight: pub(.5), tapHoles: pub(1) } });
const accept = (submission: SpecSubmission) => {
  const id = products.request("vanity", { brand: "Synthetic Co", model: "Variant 900" }).requestId as string;
  expect(products.submit(id, submission).ok).toBe(true);
  for (const key of [...Object.keys(submission.fields), ...identityReviewKeys(submission)]) products.review(id, key, "accepted");
  expect(products.accept(id).ok).toBe(true);
  return productStore.getState().products.at(-1)!;
};
beforeEach(() => { productStore.setState({ requests: [], products: [], loadError: null }); store.setState({ model: emptyModel(), kinds: [], undoStack: [] }); });

describe("exact product variants (#47)", () => {
  it("requires located sources and refuses guessed handedness and malformed component quantities", () => {
    const s = spec();
    s.code = "unverified-code";
    s.identity!.code = { state: "unknown", value: null };
    s.identity!.finish = { state: "known", value: "Chrome" };
    s.identity!.handedness = known("probably left");
    s.components![0].quantity = -1;
    expect(validateSubmission(categoryById("vanity")!, s).filter(p => p.severity === "error").map(p => p.code)).toEqual(expect.arrayContaining(["identity_source_invalid", "identity_invalid", "components_invalid"]));
  });
  it("flags alternative and request/research conflicts for explicit human review", () => {
    const s = spec();
    s.identity!.finish.alternatives = [{ value: "Brass", source }];
    const id = products.request("vanity", { brand: "Synthetic Co", identity: { ...unknownIdentity(), finish: known("Brass") } }).requestId as string;
    expect(products.submit(id, s).ok).toBe(true);
    expect(productStore.getState().requests[0].submission!.warnings.filter(w => w.code === "identity_conflict")).toHaveLength(2);
    for (const key of Object.keys(s.fields)) products.review(id, key, "accepted");
    expect(products.accept(id)).toMatchObject({ ok: false });
    expect(products.accept(id).summary).toMatch(/identity.finish.*components/);
    products.review(id, "identity.finish", "rejected", "The quote specifies Brass");
    expect(products.returnToAgent(id, "").ok).toBe(true);
    expect(productStore.getState().requests[0].feedback).toContain("The quote specifies Brass");
  });
  it("keeps two variants distinct through placement and project import without a browser catalogue", () => {
    const a = accept(spec("Chrome")), b = accept(spec("Brass"));
    expect(a.id).not.toBe(b.id);
    const wallId = actions.addWall(0, 0, 3, 0, .1, 2.4).id as string;
    actions.setWallSide(wallId, "right", { existing: { value: 0, status: "measured" }, layers: [] });
    for (const [i, p] of [a, b].entries()) expect(actions.placeProduct(p, { wallId, side: "right", face: "existing", distance: .7 + i * 1.5, status: "proposed" }).ok).toBe(true);
    const items = store.getState().model.items;
    expect(items.map(i => i.selectionStatus)).toEqual(["unknown", "unknown"]);
    expect(actions.setFixtureSelection(items[0].id, "purchased").ok).toBe(true);
    expect(actions.setFixtureSelection(items[1].id, "invalid" as never).ok).toBe(false);
    const imported = parseImport(JSON.stringify({ version: 2, id: "test", model: store.getState().model, kinds: store.getState().kinds, notes: [], presentation: "planning" }));
    expect(imported.model.items.map(i => i.productIdentity!.identity!.finish.value)).toEqual(["Chrome", "Brass"]);
    expect(imported.model.items.map(i => i.selectionStatus)).toEqual(["purchased", "unknown"]);
    const rows = specRows(imported.model, { id: `fixture:${items[0].id}`, layer: "fixtures", type: "fixture", ref: items[0].id, label: "Synthetic vanity" }, []);
    expect(rows.find(r => r.property === "Finish")!.value).toBe("Chrome");
    expect(rows.find(r => r.property === "component 1")!.value).toContain("WASTE-32 · quantity 1 · separately-required");
    expect(rows.find(r => r.property === "project selection")!.value).toBe("purchased");
    const corrupt = structuredClone(imported);
    corrupt.model.items[0].productIdentity!.components![0].code = { state: "known", value: null };
    expect(() => parseImport(JSON.stringify(corrupt))).toThrow(/invalid model data/);
  });
  it("loads legacy products and requests with explicit unknown identity and leaves selection uninferred", () => {
    const legacy = accept({ ...spec(), identity: undefined, components: undefined, componentsStatus: undefined });
    delete legacy.identity; delete legacy.components; delete legacy.componentsStatus;
    const requests = productStore.getState().requests.map(r => ({ ...r, known: { brand: "Synthetic Co" } }));
    const data = new Map([[PRODUCTS_KEY, JSON.stringify({ version: 1, requests, products: [legacy] })]]);
    const prev = configureProductStorage({ local: () => ({ getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } }) });
    try { initializeProductLibrary(true); expect(productStore.getState().products[0].identity).toEqual(unknownIdentity()); expect(productStore.getState().requests[0].known.identity).toEqual(unknownIdentity()); expect(productStore.getState().products[0].componentsStatus).toBe("unknown"); } finally { configureProductStorage(prev); }
    expect(identityOf({})).toEqual(unknownIdentity());
  });
  it("rejects a sourced exact left-hand bath in a right corner without changing the model", () => {
    const p = accept(spec());
    const wallId = actions.addWall(0, 0, 4, 0, .1, 2.4).id as string;
    actions.setWallSide(wallId, "right", { existing: { value: 0, status: "measured" }, layers: [] });
    p.category = "bath";
    p.fields = { length: pub(1.4), width: pub(1.4), height: pub(.5), shape: pub("corner-round"), frontWidth: pub(1.75), frontProjection: pub(1.29) };
    p.identity!.handedness = known("left");
    const before = structuredClone(store.getState().model);
    expect(actions.placeProduct(p, { wallId, side: "right", face: "existing", distance: 3.2, status: "proposed" })).toMatchObject({ ok: false });
    expect(store.getState().model).toEqual(before);
    const placed = actions.placeProduct(p, { wallId, side: "right", face: "existing", distance: .8, status: "proposed" });
    expect(placed.ok).toBe(true);
    const placedBefore = structuredClone(store.getState().model);
    expect(actions.anchorFixture(placed.id as string, { wallId, side: "right", face: "existing", distance: 3.2, status: "proposed" })).toMatchObject({ ok: false });
    expect(store.getState().model).toEqual(placedBefore);
  });
});
