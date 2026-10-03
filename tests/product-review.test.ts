import { beforeEach, describe, expect, it } from "vitest";
import {
  configureProductStorage,
  initializeProductLibrary,
  productStore,
  products,
  PRODUCTS_KEY,
} from "../src/model/productLibrary";
import {
  currentReview,
  productReviewSummary,
  requiredReviewKeys,
  REVIEW_GROUPS,
} from "../src/model/productReview";
import { type SpecSubmission } from "../src/model/products";

const source = {
  url: "https://example.com/synthetic-pan.pdf",
  locator: "p. 2, dimensions",
};
const pub = (value: number | string) => ({
  value,
  status: "published" as const,
  sources: [source],
});
const spec = (): SpecSubmission => ({
  manufacturer: "Synthetic Co",
  model: "Test pan",
  fields: {
    width: pub(0.38),
    depth: pub(0.64),
    height: pub(0.8),
    panType: pub("back-to-wall"),
    cistern: pub("close-coupled"),
    inletEntry: pub("bottom"),
    power: pub("not-required"),
    trap: pub("S"),
    sTrapSetoutMin: pub(0.14),
    sTrapSetoutMax: pub(0.2),
    inletHeight: pub(0.3),
  },
});
const request = () => productStore.getState().requests[0];
function submit(s = spec()) {
  const id = products.request("toilet", {
    brand: "Synthetic Co",
    model: "Test pan",
  }).requestId as string;
  expect(products.submit(id, s).ok).toBe(true);
  return id;
}
function groups(id: string) {
  for (const group of REVIEW_GROUPS) products.reviewGroup(id, group);
}
beforeEach(() =>
  productStore.setState({ requests: [], products: [], loadError: null }),
);

describe("explicit human product review groups (#52)", () => {
  it("records per-field decisions in three groups and keeps final acceptance separate", () => {
    const id = submit();
    expect(productReviewSummary(request()).unknownRequired).toEqual([]);
    expect(
      productReviewSummary(request()).groups.map((g) => g.eligible.length),
    ).toEqual([3, 6, 2]);
    groups(id);
    expect(request().status).toBe("submitted");
    expect(productStore.getState().products).toEqual([]);
    expect(
      Object.values(request().reviews).every(
        (r) =>
          r.decision === "accepted" && r.method === "group" && !!r.evidence,
      ),
    ).toBe(true);
    expect(products.accept(id).ok).toBe(true);
  });
  it("groups only clean known applicable pending values, even when warning caches are empty", () => {
    const s = spec();
    s.fields.height = {
      value: null,
      note: "Not published after checking the guide.",
    };
    s.fields.depth.reference = "frame";
    s.fields.sTrapSetoutMin.alternatives = [{ value: 0.15, source }];
    s.fields.pTrapWasteHeight = pub(0.18); // known but not applicable to S trap
    const id = submit(s);
    productStore.setState({
      requests: [
        {
          ...request(),
          submission: { ...request().submission!, warnings: [] },
        },
      ],
    });
    const summary = productReviewSummary(request());
    expect(summary.unknownRequired).toEqual(["height"]);
    expect(summary.datumMismatches.map((w) => w.field)).toContain("depth");
    expect(summary.conflicts.map((w) => w.field)).toContain("sTrapSetoutMin");
    expect(products.reviewGroup(id, "envelope").reviewed).toEqual(["width"]);
    groups(id);
    for (const key of ["height", "depth", "sTrapSetoutMin", "pTrapWasteHeight"])
      expect(currentReview(request(), key)).toBeUndefined();
    expect(products.accept(id).ok).toBe(false);
    for (const key of ["height", "depth", "sTrapSetoutMin", "pTrapWasteHeight"])
      products.review(id, key, "accepted");
    expect(request().submission!.fields.height.value).toBeNull();
    expect(products.accept(id).ok).toBe(true);
  });
  it("preserves rejection reasons and makes even corrected rejected fields individual", () => {
    const id = submit();
    expect(
      products.review(id, "width", "rejected", "Check widest point").ok,
    ).toBe(true);
    groups(id);
    expect(currentReview(request(), "width")?.reason).toBe(
      "Check widest point",
    );
    expect(products.returnToAgent(id, "").ok).toBe(true);
    const s = spec();
    s.fields.width = pub(0.39);
    expect(products.submit(id, s).ok).toBe(true);
    expect(currentReview(request(), "width")).toBeUndefined();
    expect(request().previousRejections?.width).toBe("Check widest point");
    expect(productReviewSummary(request()).groups[0].eligible).not.toContain(
      "width",
    );
    expect(
      products.review(id, "width", "accepted", "Confirmed corrected guide").ok,
    ).toBe(true);
    products.reuseReviews(id);
    expect(products.accept(id).ok).toBe(true);
  });
  it("retains rejection history after individual reconsideration and a later changed revision", () => {
    const id = submit();
    products.review(id, "width", "rejected", "Check widest point");
    products.review(id, "width", "accepted");
    expect(currentReview(request(), "width")?.decision).toBe("accepted");
    expect(request().previousRejections?.width).toBe("Check widest point");
    expect(request().individualOnly).toContain("width");
    products.returnToAgent(id, "Correct width after reconsideration");
    const changed = spec();
    changed.fields.width = pub(0.39);
    expect(products.submit(id, changed).ok).toBe(true);
    expect(currentReview(request(), "width")).toBeUndefined();
    expect(request().previousRejections?.width).toBe("Check widest point");
    expect(productReviewSummary(request()).groups[0].eligible).not.toContain(
      "width",
    );
    products.reviewGroup(id, "envelope");
    expect(currentReview(request(), "width")).toBeUndefined();
    expect(products.review(id, "width", "accepted").ok).toBe(true);
  });

  it("offers unchanged approvals for explicit reuse and invalidates value, source, datum and applicability changes", () => {
    const id = submit();
    groups(id);
    products.returnToAgent(id, "Update guide and check inlet");
    const s = spec();
    s.fields.width = pub(0.39);
    s.fields.depth.sources = [{ ...source, locator: "p. 3" }];
    s.fields.height = { ...pub(0.8), reference: "frame" };
    s.fields.trap = pub("universal");
    s.fields.pTrapWasteHeight = pub(0.18);
    expect(products.submit(id, s).ok).toBe(true);
    for (const key of [
      "width",
      "depth",
      "height",
      "trap",
      "sTrapSetoutMin",
      "sTrapSetoutMax",
    ]) {
      expect(currentReview(request(), key)).toBeUndefined();
      expect(productReviewSummary(request()).reuse).not.toContain(key);
    }
    expect(productReviewSummary(request()).reuse).toEqual(
      expect.arrayContaining(["panType", "cistern", "inletHeight"]),
    );
    expect(request().reviews).toEqual({});
    expect(products.accept(id).ok).toBe(false);
    expect(products.reuseReviews(id).ok).toBe(true);
    expect(currentReview(request(), "inletHeight")?.method).toBe("reused");
    expect(currentReview(request(), "width")).toBeUndefined();
    groups(id);
    products.review(id, "height", "accepted");
    expect(products.accept(id).ok).toBe(true);
  });
  it("keeps unchanged rejection individual on resubmission and permits explicit reconsideration", () => {
    const id = submit();
    products.review(id, "width", "rejected", "Needs confirmation");
    products.returnToAgent(id, "");
    products.submit(id, spec());
    expect(currentReview(request(), "width")?.reason).toBe(
      "Needs confirmation",
    );
    expect(productReviewSummary(request()).groups[0].eligible).not.toContain(
      "width",
    );
    expect(
      products.review(id, "width", "accepted", "Human confirmed source").ok,
    ).toBe(true);
  });
  it("binds live reviews to evidence after reload and leaves legacy accepted history intact", () => {
    const id = submit();
    groups(id);
    const doc = JSON.stringify({
      version: 1,
      requests: productStore.getState().requests,
      products: [],
    });
    let raw = doc;
    const previous = configureProductStorage({
      local: () => ({
        getItem: () => raw,
        setItem: (_, value) => {
          raw = value;
        },
      }),
    });
    try {
      initializeProductLibrary(true);
      expect(productReviewSummary(request()).pending).toEqual([]);
      const changed = structuredClone(request());
      changed.submission!.fields.width.value = 0.4;
      raw = JSON.stringify({ version: 1, requests: [changed], products: [] });
      initializeProductLibrary(true);
      expect(currentReview(request(), "width")).toBeUndefined();
      expect(products.accept(id).ok).toBe(false);
      const legacy = structuredClone(request());
      legacy.status = "accepted";
      legacy.reviews.width = {
        decision: "rejected",
        reason: "Historic decision retained",
      };
      raw = JSON.stringify({ version: 1, requests: [legacy], products: [] });
      initializeProductLibrary(true);
      expect(currentReview(request(), "width")).toEqual({
        decision: "rejected",
        reason: "Historic decision retained",
      });
      expect(raw).toContain("Historic decision retained");
    } finally {
      configureProductStorage(previous);
    }
    expect(PRODUCTS_KEY).toBe("alza.products.v1");
  });
  it("captures legacy evidence before explicit reuse and excludes unknown status values", () => {
    const id = submit();
    const legacy = {
      ...request(),
      reviews: Object.fromEntries(
        Object.keys(spec().fields).map((key) => [
          key,
          { decision: "accepted" as const },
        ]),
      ),
    };
    productStore.setState({ requests: [legacy] });
    products.returnToAgent(id, "Correct published width");
    const changed = spec();
    changed.fields.width = pub(0.4);
    expect(products.submit(id, changed).ok).toBe(true);
    expect(request().reviews).toEqual({});
    expect(productReviewSummary(request()).reuse).not.toContain("width");
    expect(productReviewSummary(request()).reuse).toContain("depth");
    expect(products.reuseReviews(id).ok).toBe(true);
    expect(currentReview(request(), "depth")?.evidence).toBeTruthy();
    const stale = structuredClone(request());
    Object.assign(stale.submission!.fields.width, { status: "unknown" }); // malformed persisted evidence
    stale.submission!.warnings = [];
    productStore.setState({ requests: [stale] });
    expect(productReviewSummary(request()).groups[0].eligible).not.toContain(
      "width",
    );
    expect(products.accept(id).ok).toBe(false);
  });

  it("rechecks required identity omissions before final acceptance", () => {
    const id = products.request("toilet", {
      brand: "Synthetic Co",
      identity: {
        code: { state: "unknown", value: null },
        finish: { state: "unknown", value: null },
        configuration: { state: "unknown", value: null },
        handedness: { state: "known", value: "left", sources: [source] },
      },
    }).requestId as string;
    products.submit(id, spec());
    request().submission!.warnings = [];
    groups(id);
    expect(requiredReviewKeys(request())).toContain("identity.handedness");
    expect(products.accept(id).ok).toBe(false);
    expect(productReviewSummary(request()).pending).toContain(
      "identity.handedness",
    );
  });
});
