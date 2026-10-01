import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { emptyModel } from "../src/model/types";
import { checkModel } from "../src/model/issues";
import { clearances, roughIn } from "../src/model/fixtures";
import { roughInPoints, categoryById, validateSubmission, type FieldValue } from "../src/model/products";
import { itemPolygon, polygonsOverlap } from "../src/model/outline";
import { catalogByKind } from "../src/model/catalog";
import type { LibraryProduct } from "../src/model/productLibrary";
import { buildPlan } from "../src/three/build";
import { demoProject, parseImport } from "../src/model/projects";

beforeEach(() => store.setState({ model: emptyModel(), undoStack: [], kinds: [] }));

const model = () => store.getState().model;
const item = (id: string) => model().items.find((i) => i.id === id)!;
const codes = () => checkModel(model()).map((i) => i.code);

/** The surveyed 2110 × 3020 bathroom drawn on its existing surfaces, clockwise, room on every right side. */
function bathroom() {
  const corners = [[0, 0], [2.11, 0], [2.11, 3.02], [0, 3.02]];
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    ids.push(actions.addWall(ax, ay, bx, by, 0.1, 2.4).id as string);
  }
  actions.addRoom(0, 0, 2.11, 3.02, "Bathroom", "tile");
  return ids;
}

const buildUp = (boardMm: number, adhesive: number | null = 0.004) => [
  { kind: "board" as const, name: "Villaboard", thickness: { value: boardMm / 1000, status: "proposed" as const } },
  { kind: "waterproofing" as const, thickness: { value: 0.001, status: "proposed" as const } },
  { kind: "adhesive" as const, thickness: adhesive === null ? null : { value: adhesive, status: "proposed" as const } },
  { kind: "tile" as const, thickness: { value: 0.01, status: "proposed" as const } },
];

function faceBackWall(back: string, boardMm = 6, adhesive: number | null = 0.004) {
  const prev = model().walls.find((w) => w.id === back)!.sides?.right?.layers ?? [];
  const layers = buildUp(boardMm, adhesive).map((l, i) => ({ ...l, ...(prev[i] ? { id: prev[i].id } : {}) }));
  expect(actions.setWallSide(back, "right", {
    existing: { value: 0, status: "measured" },
    frame: { value: -0.045, status: "site-confirmed" },
    layers,
  }).ok).toBe(true);
}

function vanity(back: string): string {
  actions.defineItemKind({ kind: "vanity_recorded", label: "Vanity", w: 0.91, d: 0.465, h: 0.85, category: "bath" });
  const id = actions.placeItem("vanity_recorded", 1, 1).id as string;
  expect(actions.anchorFixture(id, { wallId: back, side: "right", face: "finished", distance: 1.055, status: "proposed" }).ok).toBe(true);
  return id;
}

describe("fixtures set out from wall faces (#5)", () => {
  it("places a fixture against the finished face and reads a service point from every face", () => {
    const [back] = bathroom();
    faceBackWall(back);
    const v = vanity(back);
    // finished face at -45 + 6 + 1 + 4 + 10 = -24 mm; vanity centre 465/2 in front of it
    expect(item(v)).toMatchObject({ x: 1.055, y: 0.2085, rotation: 0 });
    expect(actions.setServicePoint(v, { label: "Wall waste", service: "waste", face: "finished", out: 0, across: 0.1, up: 0.55, status: "proposed" }).ok).toBe(true);
    const [waste] = roughIn(model(), item(v));
    expect(waste.resolved).toBe(true);
    const from = Object.fromEntries(waste.fromFaces.map((f) => [f.face, f.value]));
    expect(from).toEqual({ existing: -0.024, frame: 0.021, board: 0.015, finished: 0 });
    expect(waste).toMatchObject({ alongFromA: 1.155, alongFromB: 0.955, up: 0.55 });
  });

  it("follows the face it is set against when the build-up changes; a frame-set fixture stays", () => {
    const [back] = bathroom();
    faceBackWall(back);
    const v = vanity(back);
    actions.defineItemKind({ kind: "toilet_proxy", label: "Toilet", w: 0.48, d: 0.7, h: 0.8, category: "bath" });
    const t = actions.placeItem("toilet_proxy", 0.5, 1).id as string;
    actions.anchorFixture(t, { wallId: back, side: "right", face: "frame", gap: 0.05, distance: 0.4, status: "proposed" });
    const toiletBefore = { ...item(t) };
    actions.setServicePoint(v, { label: "Wall waste", service: "waste", face: "finished", out: 0, across: 0.1, up: 0.55, status: "proposed" });

    faceBackWall(back, 10); // 10 mm board
    expect(item(v).y).toBe(0.2125); // finished face moved 4 mm into the room
    expect(item(t)).toMatchObject({ x: toiletBefore.x, y: toiletBefore.y }); // frame did not move
    const from = Object.fromEntries(roughIn(model(), item(v))[0].fromFaces.map((f) => [f.face, f.value]));
    expect(from).toEqual({ existing: -0.02, frame: 0.025, board: 0.015, finished: 0 });
    expect(item(v).anchor).toMatchObject({ face: "finished", gap: 0, distance: 1.055 }); // entered reference unchanged
  });

  it("keeps an unknown unknown: unresolved anchor stays put and says why", () => {
    const [back] = bathroom();
    faceBackWall(back);
    const v = vanity(back);
    const before = { ...item(v) };
    actions.setServicePoint(v, { label: "Wall waste", service: "waste", face: "finished", out: 0, across: 0.1, status: "proposed" });
    faceBackWall(back, 6, null); // adhesive thickness unknown
    expect(item(v)).toMatchObject({ x: before.x, y: before.y });
    expect(codes()).toEqual(expect.arrayContaining(["fixture_anchor_unresolved", "service_point_unresolved", "wall_face_unresolved"]));
    const [waste] = roughIn(model(), item(v));
    expect(waste.resolved).toBe(false);
    expect(waste.fromFaces.find((f) => f.face === "frame")).toMatchObject({ resolved: false });
    expect(waste.missing.join(" ")).toMatch(/Tile adhesive thickness/);
  });

  it("refuses to move an anchored fixture by hand and checks clashes against the built wall", () => {
    const [back] = bathroom();
    faceBackWall(back);
    const v = vanity(back);
    expect(actions.moveItem(v, 1, 1).ok).toBe(false);
    // against the finished face: no crossing, although the old centred 100 mm wall would have reached 50 mm in
    expect(codes()).not.toContain("item_through_wall");
    const [left, right, front] = clearances(model(), item(v));
    // side walls are centred 100 mm walls with nothing recorded: their body reaches 50 mm in
    // facing the vanity, its left is toward end A: 1055 - 455 - 50
    expect(left).toMatchObject({ distance: 0.55, surface: "wall body" });
    expect(right).toMatchObject({ distance: 0.55, surface: "wall body" });
    expect(front?.distance).toBeCloseTo(3.02 - 0.05 - (0.2085 + 0.2325), 4);
    actions.anchorFixture(v, null);
    expect(actions.moveItem(v, 1, 1).ok).toBe(true);
  });

  it("marks service points in 3D only where position and height are known", () => {
    const [back] = bathroom();
    faceBackWall(back);
    const v = vanity(back);
    actions.setServicePoint(v, { label: "Wall waste", service: "waste", face: "finished", out: 0, across: 0.1, up: 0.55, status: "proposed" });
    actions.setServicePoint(v, { label: "Water", service: "water", face: "finished", out: 0, across: -0.1, status: "proposed" });
    const names: string[] = [];
    buildPlan(model(), "planning").group.traverse((o) => { if (o.name.includes(":service:")) names.push(o.name); });
    expect(names).toHaveLength(1);
  });

  it("places a library product and copies its published rough-in with datums", () => {
    const [back] = bathroom();
    faceBackWall(back);
    const src = [{ url: "https://example.com/pan.pdf", locator: "p. 2" }];
    const pub = (value: number | string): FieldValue => ({ value, status: "published", sources: src });
    const fields: Record<string, FieldValue> = {
      width: pub(0.381), depth: pub(0.68), height: pub(0.807), panType: pub("back-to-wall"), cistern: pub("close-coupled"),
      inletEntry: pub("bottom"), trap: pub("universal"), sTrapSetoutMin: pub(0.14), sTrapSetoutMax: pub(0.26), pTrapWasteHeight: pub(0.19),
      inletHeight: pub(0.18), inletOffset: pub(-0.18), power: pub("not-required"),
    };
    const product: LibraryProduct = { id: "p1", category: "toilet", manufacturer: "Example Co", model: "Test Pan", fields, roughIn: roughInPoints(categoryById("toilet")!, fields), requestId: "r1", acceptedAt: 0 };
    const placed = actions.placeProduct(product, { wallId: back, side: "right", face: "finished", distance: 0.5, status: "proposed" });
    expect(placed.ok).toBe(true);
    const t = item(placed.id as string);
    expect(t.productId).toBe("p1");
    const readings = Object.fromEntries(roughIn(model(), t).map((r) => [r.pointId, r]));
    expect(readings["waste-s"].fromFaces.find((f) => f.face === "frame")).toMatchObject({ value: 0.161, max: 0.281 });
    expect(readings["waste-s"].fromFaces.find((f) => f.face === "finished")).toMatchObject({ value: 0.14, max: 0.26 });
    expect(readings.inlet).toMatchObject({ resolved: true, up: 0.18, alongFromA: 0.32 });
    expect(readings.inlet.status).toBe("published");

    const noSize = { ...product, id: "p2", fields: { ...fields, depth: { value: null, note: "n/a" } } };
    expect(actions.placeProduct(noSize, { wallId: back, side: "right", face: "finished", distance: 0.5, status: "proposed" }).ok).toBe(false);
  });

  describe("review on #35", () => {
    const product = (): LibraryProduct => {
      const src = [{ url: "https://example.com/pan.pdf", locator: "p. 2" }];
      const pub = (value: number | string): FieldValue => ({ value, status: "published", sources: src });
      const fields: Record<string, FieldValue> = {
        width: pub(0.381), depth: pub(0.68), height: pub(0.807), panType: pub("back-to-wall"), cistern: pub("close-coupled"),
        inletEntry: pub("bottom"), trap: pub("S"), sTrapSetoutMin: pub(0.14), sTrapSetoutMax: pub(0.26),
        inletHeight: pub(0.18), inletOffset: pub(-0.18), power: pub("not-required"),
      };
      return { id: "p1", category: "toilet", manufacturer: "Example Co", model: "Test Pan", fields, roughIn: roughInPoints(categoryById("toilet")!, fields), requestId: "r1", acceptedAt: 0 };
    };

    it("places a product as one undo step, and a refused placement changes nothing", () => {
      const [back] = bathroom();
      faceBackWall(back);
      const before = structuredClone(model());
      const undoDepth = store.getState().undoStack.length;
      expect(actions.placeProduct(product(), { wallId: back, side: "right", face: "no-such-face", distance: 0.5, status: "proposed" }).ok).toBe(false);
      expect(model()).toEqual(before);
      expect(store.getState().undoStack.length).toBe(undoDepth);
      expect(actions.placeProduct(product(), { wallId: back, side: "right", face: "finished", distance: 0.5, status: "proposed" }).ok).toBe(true);
      expect(store.getState().undoStack.length).toBe(undoDepth + 1);
      actions.undo();
      expect(model().items).toEqual(before.items);
    });

    it("keeps a caller's service point id, so a second call replaces it", () => {
      const [back] = bathroom();
      faceBackWall(back);
      const v = vanity(back);
      actions.setServicePoint(v, { id: "inlet", label: "Inlet", service: "water", face: "finished", out: 0, across: 0.1, status: "proposed" });
      actions.setServicePoint(v, { id: "inlet", label: "Inlet", service: "water", face: "finished", out: 0.02, across: 0.1, status: "proposed" });
      expect(item(v).servicePoints!.map((p) => [p.id, p.out])).toEqual([["inlet", 0.02]]);
      expect(actions.removeServicePoint(v, "inlet").ok).toBe(true);
    });

    it("refuses a non-numeric value instead of storing it as unknown", () => {
      const [back] = bathroom();
      faceBackWall(back);
      const v = vanity(back);
      expect(actions.setServicePoint(v, { label: "Waste", service: "waste", face: "finished", out: 0, up: Number.NaN, status: "proposed" }).ok).toBe(false);
      expect(item(v).servicePoints ?? []).toEqual([]);
    });

    it("flags a fixture left beyond the end of a shortened wall and does not move it", () => {
      const [back] = bathroom();
      faceBackWall(back);
      const v = vanity(back);
      const before = { ...item(v) };
      expect(actions.editWall(back, { bx: 1.0 }).ok).toBe(true);
      expect(item(v)).toMatchObject({ x: before.x, y: before.y });
      expect(codes()).toContain("fixture_anchor_off_wall");
    });

    it("reads 0 mm clearance when a fixture is flush with a return wall", () => {
      const [back] = bathroom();
      faceBackWall(back);
      const v = vanity(back);
      // west wall body reaches 50 mm into the room; half the vanity is 455 mm
      actions.anchorFixture(v, { wallId: back, side: "right", face: "finished", distance: 0.505, status: "proposed" });
      expect(clearances(model(), item(v))[0]).toMatchObject({ direction: "left", distance: 0 });
    });

    it("refuses project JSON whose anchor or service point is incomplete", () => {
      const [back] = bathroom();
      faceBackWall(back);
      const v = vanity(back);
      actions.setServicePoint(v, { label: "Waste", service: "waste", face: "finished", out: 0, status: "proposed" });
      const doc = { ...demoProject(), id: "bath", model: model() };
      expect(() => parseImport(JSON.stringify(doc))).not.toThrow();
      const noFrom = structuredClone(doc);
      delete (noFrom.model.items[0].anchor as { from?: string }).from;
      expect(() => parseImport(JSON.stringify(noFrom))).toThrow();
      const gas = structuredClone(doc);
      (gas.model.items[0].servicePoints![0] as { service: string }).service = "gas";
      expect(() => parseImport(JSON.stringify(gas))).toThrow();
    });
  });

  it("places a corner bath with its real outline, mirrored to its corner, and checks clashes by that outline", () => {
    const [back] = bathroom();
    faceBackWall(back);
    // as printed on the Enflair Angie drawing: 1000 along each wall, 1178 across the front, 1090 from the corner
    const src = [{ url: "https://example.com/angie", locator: "drawing" }];
    const pub = (value: number | string): FieldValue => ({ value, status: "published", sources: src });
    const fields: Record<string, FieldValue> = {
      length: pub(1.0), width: pub(1.0), height: pub(0.63), installation: pub("corner"), shape: pub("corner-round"),
      frontWidth: pub(1.178), frontProjection: pub(1.09), wasteFromEnd: pub(0.368), wasteFromSide: pub(0.368),
      surround: { value: null, note: "Not on the drawing." },
    };
    const product: LibraryProduct = { id: "angie", category: "bath", manufacturer: "Enflair", model: "Angie 1000 Corner", fields, roughIn: roughInPoints(categoryById("bath")!, fields), requestId: "r", acceptedAt: 0 };
    // the back wall runs from A (x=0) to B (x=2.11); the bath goes in the A-end corner
    const placed = actions.placeProduct(product, { wallId: back, side: "right", face: "finished", distance: 0.55, status: "proposed" });
    expect(placed.ok).toBe(true);
    const bath = item(placed.id as string);
    const cat = catalogByKind(bath.kind)!;
    expect(bath.kind).toBe("product_angie_left");
    expect(cat.outline!.segments.some((s) => s.via)).toBe(true);
    const poly = itemPolygon(bath)!;
    // the curved front stays inside the box but is not the box: the box's front-right corner is outside it
    const frontRight = { x: bath.x + 0.49, y: bath.y + 0.49 };
    expect(polygonsOverlap(poly, [frontRight, { x: frontRight.x + 0.005, y: frontRight.y }, { x: frontRight.x, y: frontRight.y + 0.005 }])).toBe(false);
    // a small cabinet tucked into that corner of the box clears the curve: no clash
    actions.defineItemKind({ kind: "caddy", label: "Caddy", w: 0.12, d: 0.12, h: 0.5, category: "bath" });
    actions.placeItem("caddy", bath.x + 0.43, bath.y + 0.43);
    expect(codes()).not.toContain("items_overlap");
    const [waste] = roughIn(model(), bath);
    expect(waste.resolved).toBe(true);
    expect(waste.alongFromA).toBe(0.418); // 368 from the corner end of the bath: 0.55 - 0.5 + 0.368
  });

  it("flags a corner bath whose circular front disagrees with its printed lengths", () => {
    const src = [{ url: "https://example.com/angie", locator: "drawing" }];
    const pub = (value: number | string): FieldValue => ({ value, status: "published", sources: src });
    const sub = { manufacturer: "Enflair", model: "Angie", fields: {
      length: pub(1.0), width: pub(1.0), height: pub(0.63), installation: pub("corner"), shape: pub("corner-round"),
      frontWidth: pub(1.178), frontProjection: pub(1.09), wasteFromEnd: pub(0.368), wasteFromSide: pub(0.368),
      surround: { value: null, note: "Not on the drawing." },
    } };
    const problems = validateSubmission(categoryById("bath")!, sub);
    expect(problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(problems.find((p) => p.code === "outline_disagrees")?.message).toMatch(/945(\.\d)? × 945(\.\d)? mm along the walls, but the printed length and width are 1000 × 1000/);
  });
});
