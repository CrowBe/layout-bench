import { roughInPoints, categoryById } from "../src/model/products";
import { itemPolygon } from "../src/model/outline";
import { installationReading as installationReadingForTest } from "../src/model/installation";
import { buildFixture as buildFixtureForTest } from "../src/three/build";
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
import { parseImport } from "../src/model/projects";
import { specRows } from "../src/sheets/stageView";
import { buildFurniture } from "../src/three/furniture";
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
  it("preserves only a site-edited axis on a mixed-provenance point, rather than the weakest aggregate status", () => {
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
    const model = store.getState().model,
      item = model.items[0],
      point = item.servicePoints!.find((p) => p.id === "waste")!;
    const edited = {
      ...point,
      across: 0.12,
      status: "published" as const,
      axisEvidence: {
        ...point.axisEvidence,
        across: {
          value: 0.12,
          status: "measured" as const,
          reference: "fixture-centreline" as const,
          measurement: {
            unit: "metres" as const,
            date: "2026-10-03",
            evidence: "Synthetic site axis check",
            recordedBy: "human" as const,
          },
        },
      },
    };
    store.setState({
      model: { ...model, items: [{ ...item, servicePoints: [edited] }] },
    });
    const target = {
      ...structuredClone(first),
      id: "mixed-two",
      revision: { seriesId: first.id, number: 2, parentProductId: first.id },
      roughIn: first.roughIn.map((p) =>
        p.id === "waste"
          ? { ...p, up: { ...p.up!, value: 0.55, evidence: { ...pub(0.55) } } }
          : p,
      ),
    };
    const preview = previewProductUpdate(
      store.getState().model,
      target,
      [id],
      [first, target],
    );
    const after = preview.rows[0].after!.servicePoints![0];
    expect(after.across).toBe(0.12);
    expect(after.up).toBe(0.55);
    expect(after.axisEvidence!.across).toEqual(edited.axisEvidence.across);
    expect(preview.rows[0].preserved.join(" ")).toMatch(
      /site-edited.*measured/,
    );
    const renamed = {
      ...target,
      roughIn: target.roughIn.map((p) => ({ ...p, id: "new-connection" })),
    };
    const removed = previewProductUpdate(
      store.getState().model,
      renamed,
      [id],
      [first, renamed],
    );
    expect(
      removed.rows[0].after!.servicePoints!.some(
        (p) => p.id === "waste" && p.across === 0.12,
      ),
    ).toBe(true);
    expect(removed.rows[0].unresolved.join(" ")).toMatch(
      /new catalogue evidence differs/,
    );
  });
  it("keeps pinned geometry and specification through project import without a live library", () => {
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
    const state = store.getState(),
      originalItem = structuredClone(state.model.items[0]);
    actions.defineItemKind({ ...originalItem.productGeometry!, w: 1.5 });
    expect(catalogForItem(state.model.items[0])!.w).toBe(0.9);
    const transferred = parseImport(
      JSON.stringify({
        version: 2,
        id: "revision-transfer",
        model: state.model,
        kinds: state.kinds,
        notes: [],
        presentation: "planning",
      }),
    );
    productStore.setState({ requests: [], products: [] });
    const item = transferred.model.items[0];
    expect(item.productSnapshot).toEqual(first);
    expect(catalogForItem(item)!.w).toBe(0.9);
    expect(
      specRows(
        transferred.model,
        {
          id: `fixture:${item.id}`,
          type: "fixture",
          layer: "fixtures",
          ref: item.id,
          label: "Pinned",
        },
        [],
      ).some((row) => row.property === "width" && row.value === "900"),
    ).toBe(true);
    expect(buildFurniture(item.kind, item.productGeometry)).not.toBeNull();
    const bad = JSON.parse(JSON.stringify(transferred));
    bad.model.items[0].productSnapshot.fields.width.sources = {};
    expect(() => parseImport(JSON.stringify(bad))).toThrow(
      /invalid model data/,
    );
  });
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

it("keeps mounted revision previews pure, pins vertical geometry and reconciles local site axes", () => {
  const evidence = { status: "published" as const, sources: [source] };
  const geometry = {
    ...evidence,
    datum: {
      across: "fixture-centreline" as const,
      out: "fixture-back" as const,
      up: "fixture-bottom" as const,
    },
    handedness: "reversible" as const,
    services: [
      {
        ...evidence,
        id: "power",
        label: "Power",
        service: "power" as const,
        x: 0.1,
        y: 0,
        z: 0.2,
        axisEvidence: { across: pub(0.1), out: pub(0), up: pub(0.2) },
      },
    ],
  };
  const first = {
    ...original(),
    category: "mirror",
    fields: {
      width: pub(0.6),
      depth: pub(0.03),
      height: pub(0.8),
      mounting: pub("surface"),
    },
    roughIn: [],
    installationGeometry: geometry,
  };
  const second = {
    ...structuredClone(first),
    id: "mirror-r2",
    revision: { seriesId: first.id, number: 2, parentProductId: first.id },
    fields: { ...first.fields, height: pub(1) },
    installationGeometry: {
      ...geometry,
      services: [
        {
          ...geometry.services[0],
          z: 0.3,
          axisEvidence: { ...geometry.services[0].axisEvidence, up: pub(0.3) },
        },
      ],
    },
  };
  const room = actions.addRoom(0, 0, 3, 3, "Synthetic", "tile").id as string;
  const q = (value: number) => ({
    value,
    status: "site-confirmed" as const,
    source: "Synthetic confirmed placement",
  });
  actions.setRoomFloor(room, { substrateTop: q(0), layers: [] });
  const wall = actions.addWall(0, 0, 3, 0, 0.1, 2.4).id as string;
  actions.setWallSide(wall, "right", {
    existing: q(0),
    frame: q(0),
    layers: [],
  });
  const placed = actions.placeProduct(first, {
    wallId: wall,
    side: "right",
    face: "existing",
    distance: 1,
    status: "site-confirmed",
    installation: {
      mounting: "wall",
      roomId: room,
      floorDatum: "finished-floor",
      height: q(0.9),
      mirror: false,
      orientation: 0,
    },
  });
  expect(placed.ok, placed.summary).toBe(true);
  const id = placed.id as string,
    model = structuredClone(store.getState().model),
    item = model.items[0];
  item.installationGeometry!.services![0].x = 0.12;
  item.installationGeometry!.services![0].axisEvidence!.across = {
    value: 0.12,
    status: "measured",
    sources: [{ ...source, locator: "Synthetic site axis" }],
  };
  const before = structuredClone(model),
    kinds = structuredClone(store.getState().kinds);
  const preview = previewProductUpdate(model, second, [id], [first, second]);
  expect(preview.applicable).toBe(true);
  expect(model).toEqual(before);
  expect(store.getState().kinds).toEqual(kinds);
  const next = preview.model.items[0];
  expect(next.installation).toEqual(item.installation);
  expect(next.installationGeometry!.services![0]).toMatchObject({
    x: 0.12,
    z: 0.3,
  });
  expect(preview.rows[0].preserved.join(" ")).toContain("site-edited measured");
  expect(preview.issues.some((i) => i.code === "item_unknown")).toBe(false);
  expect(installationReadingForTest(preview.model, next)).toMatchObject({
    bottom: 0.9,
    top: 1.9,
    topBasis: "published",
  });
  expect(installationReadingForTest(model, item)).toMatchObject({ top: 1.7 });
  const imported = parseImport(
    JSON.stringify({
      version: 2,
      notes: [],
      presentation: "planning",
      id: "mounted-revision",
      name: "Mounted revision",
      createdAt: 0,
      updatedAt: 0,
      model: preview.model,
      kinds: [],
    }),
  );
  expect(
    installationReadingForTest(imported.model, imported.model.items[0]).top,
  ).toBe(1.9);
  expect(
    buildFixtureForTest(imported.model, imported.model.items[0]),
  ).not.toBeNull();
  const unresolved = { ...structuredClone(model), rooms: [] };
  const unknown = previewProductUpdate(
    unresolved,
    second,
    [id],
    [first, second],
  );
  expect(
    installationReadingForTest(unknown.model, unknown.model.items[0]).top,
  ).toBeUndefined();
  expect(
    unknown.issues.some((i) => i.code === "fixture_installation_unresolved"),
  ).toBe(true);
});

it("retains archived stage content through update, undo and project import while refusing malformed archives", () => {
  const model = store.getState().model;
  const archive = {
    label: "Original",
    date: "2026-10-03",
    svg: "<svg>Synthetic immutable output</svg>",
    specHtml: "Synthetic spec",
    elements: [],
    at: 1,
    modelEvidence: planningEvidence(model),
    acknowledged: [],
  };
  actions.recordStageExport(archive);
  actions.addWall(0, 0, 3, 0, 0.1, 2.4);
  expect(planningEvidence(store.getState().model)).not.toBe(
    archive.modelEvidence,
  );
  actions.undo();
  expect(store.getState().model.sheetSet!.stageExports).toEqual([archive]);
  const project = {
    version: 2,
    notes: [],
    presentation: "planning",
    id: "stage-archive",
    name: "Stage archive",
    createdAt: 0,
    updatedAt: 0,
    model: store.getState().model,
    kinds: [],
  };
  expect(
    parseImport(JSON.stringify(project)).model.sheetSet!.stageExports,
  ).toEqual([archive]);
  expect(() =>
    parseImport(
      JSON.stringify({
        ...project,
        model: {
          ...project.model,
          sheetSet: {
            ...project.model.sheetSet,
            stageExports: [{ ...archive, elements: [null] }],
          },
        },
      }),
    ),
  ).toThrow();
});

it("keeps a reversible corner's pinned shape portable and isolated when its anchor changes hand", () => {
  const fields = {
    length: pub(1.4),
    width: pub(1.4),
    height: pub(0.5),
    shape: pub("corner-round"),
    frontWidth: pub(1.75),
    frontProjection: pub(1.29),
  };
  const product = {
    ...original(),
    id: "reversible-pinned-bath",
    category: "bath",
    fields,
    roughIn: roughInPoints(categoryById("bath")!, fields),
    identity: {
      ...unknownIdentity(),
      handedness: {
        state: "known" as const,
        value: "reversible",
        sources: [source],
      },
    },
  };
  const wall = actions.addWall(0, 0, 4, 0, 0.1, 2.4).id as string;
  actions.setWallSide(wall, "right", {
    existing: { value: 0, status: "measured" },
    layers: [],
  });
  const anchor = {
    wallId: wall,
    side: "right" as const,
    face: "existing",
    distance: 0.8,
    status: "proposed" as const,
  };
  const placement = actions.placeProduct(product, anchor);
  expect(placement.ok).toBe(true);
  const left = structuredClone(store.getState().model.items[0]);
  expect(
    actions.anchorFixture(placement.id as string, { ...anchor, distance: 3.2 })
      .ok,
  ).toBe(true);
  const right = structuredClone(store.getState().model.items[0]);
  expect(right.kind).toBe(right.productGeometry!.kind);
  expect(right.productSnapshot).toEqual(left.productSnapshot);
  expect(right.productGeometry!.outline!.start.x).toBe(
    -left.productGeometry!.outline!.start.x,
  );
  const footprint = itemPolygon(right);
  actions.defineItemKind({ ...right.productGeometry!, w: 2 });
  expect(catalogForItem(store.getState().model.items[0])!.w).toBe(1.4);
  expect(itemPolygon(store.getState().model.items[0])).toEqual(footprint);
  const project = {
    version: 2,
    id: "reanchored",
    model: store.getState().model,
    kinds: [],
    notes: [],
    presentation: "planning",
  };
  const imported = parseImport(JSON.stringify(project));
  expect(imported.model.items[0]).toEqual(right);
  expect(itemPolygon(imported.model.items[0])).toEqual(footprint);
  expect(
    buildFixtureForTest(imported.model, imported.model.items[0]),
  ).not.toBeNull();
  expect(actions.anchorFixture(placement.id as string, anchor).ok).toBe(true);
  expect(store.getState().model.items[0].productGeometry).toEqual(
    left.productGeometry,
  );
});

it("retains both range endpoints and evidence when one confirmed axis uses a different wall datum", () => {
  for (const maximum of [0.11, undefined]) {
    const first = {
      ...original(),
      roughIn: [
        {
          id: "water",
          label: "Water",
          service: "water" as const,
          resolved: true,
          missing: [],
          across: {
            from: "fixture-centreline" as const,
            value: 0.1,
            evidence: pub(0.1),
          },
          out: {
            from: "finished-wall" as const,
            min: 0.05,
            max: 0.1,
            evidence: pub(0.05),
            maxEvidence: pub(0.1),
          },
          up: {
            from: "finished-floor" as const,
            value: 0.5,
            evidence: pub(0.5),
          },
        },
      ],
    };
    const wall = actions.addWall(0, 0, 5, 0, 0.1, 2.4).id as string;
    actions.setWallSide(wall, "right", {
      existing: { value: 0, status: "measured" },
      frame: { value: 0, status: "measured" },
      layers: [
        { kind: "tile", thickness: { value: 0.01, status: "measured" } },
      ],
    });
    const id = actions.placeProduct(first, {
      wallId: wall,
      side: "right",
      face: "existing",
      distance: 1,
      status: "proposed",
    }).id as string;
    const model = structuredClone(store.getState().model),
      point = model.items.find((i) => i.id === id)!.servicePoints![0];
    point.face = "frame";
    point.out = 0.07;
    point.outMax = maximum;
    point.axisEvidence!.out = {
      value: 0.07,
      status: "site-confirmed",
      reference: "frame",
      measurement: {
        unit: "metres",
        date: "2026-10-03",
        evidence: "Synthetic frame datum confirmation",
        recordedBy: "human",
      },
    };
    point.axisEvidence!.outMax =
      maximum === undefined
        ? {
            value: null,
            note: "Synthetic max not confirmed",
          }
        : { ...pub(maximum), reference: "frame" };
    const target = {
      ...structuredClone(first),
      id: `range-r2-${maximum}`,
      revision: { seriesId: first.id, number: 2, parentProductId: first.id },
      roughIn: [
        {
          ...first.roughIn[0],
          out: {
            ...first.roughIn[0].out,
            min: 0.08,
            max: 0.15,
            evidence: pub(0.08),
            maxEvidence: pub(0.15),
          },
          up: { ...first.roughIn[0].up, value: 0.55, evidence: pub(0.55) },
        },
      ],
    };
    const next = previewProductUpdate(model, target, [id], [first, target])
      .rows[0].after!.servicePoints![0];
    expect(next.face).toBe("frame");
    expect(next.out).toBe(0.07);
    expect(next.outMax).toBe(maximum);
    expect(next.axisEvidence!.out).toEqual(point.axisEvidence!.out);
    expect(next.axisEvidence!.outMax).toEqual(point.axisEvidence!.outMax);
    expect(next.up).toBe(0.55);
    expect(model.items.find((i) => i.id === id)!.servicePoints![0]).toEqual(
      point,
    );
  }
});
