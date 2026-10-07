import { beforeEach, describe, expect, it } from "vitest";
import { actions, store } from "../src/model/store";
import { emptyModel, type Room } from "../src/model/types";
import { productStore, type LibraryProduct } from "../src/model/productLibrary";
import type { FieldValue } from "../src/model/products";
import { drainageProblems } from "../src/model/drainage";
import { floorTileLayout } from "../src/model/floorTiling";
import { grateOutline, outletPosition, wasteProduct } from "../src/model/wasteProduct";
import { kano316Insert, lauxesNextGen35 } from "../src/model/sampleWasteBodies";
import { seedBathroom } from "../src/model/seed-bathroom";

const pub = (value: number | string): FieldValue => ({ value, status: "published", sources: [{ url: "https://example.test/drain.pdf", locator: "table 1" }] });
const drain = (id: string, fields: Record<string, FieldValue>, revision?: LibraryProduct["revision"]): LibraryProduct => ({
  id, category: "drain", manufacturer: "Synthetic Drains", model: "Channel 1000", fields, roughIn: [], requestId: "req", acceptedAt: 1, ...(revision ? { revision } : {}),
});
const channel = { grateLength: pub(1), grateWidth: pub(0.1), outletDiameter: pub(0.05), outletOffset: pub(0), installationDepth: pub(0.04) };

const room = (): Room => store.getState().model.rooms[0];
const waste = (id = "ch") => room().drainage!.wastes.find((w) => w.id === id)!;

beforeEach(() => {
  productStore.setState({ requests: [], products: [drain("ch-1000", channel), drain("unsized", { outletDiameter: pub(0.05) }), { ...drain("cable", {}), category: "heating-cable" }] });
  store.setState({ model: { ...emptyModel(), rooms: [{ id: "r", x: 0, y: 0, w: 2, h: 3, label: "Bath", floor: "tile" }] }, undoStack: [] });
});

describe("floor waste linked to its drain product (#82)", () => {
  it("draws a linked channel's grate at the brief's 1000 × 100 mm and reads its depths with sources", () => {
    expect(actions.setRoomDrainage("r", { wastes: [{ id: "ch", kind: "linear", x: 0.1, y: 0.1, x2: 0.1, y2: 1.1, product: "ch-1000" }] }).ok).toBe(true);
    const info = wasteProduct(waste())!;
    expect(info.name).toBe("Synthetic Drains Channel 1000");
    expect(info.grateLength).toMatchObject({ value: 1, status: "published" });
    expect(info.installationDepth?.source).toContain("example.test/drain.pdf");
    const g = grateOutline(waste(), info)!;
    const xs = g.map((p) => p.x), ys = g.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.1, 6); // across the channel
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1, 6); // along it
    expect(drainageProblems(room()).map((p) => p.code)).not.toContain("waste_grate_length_mismatch");
  });

  it("stops reporting the aperture as unrecorded once the grate size is known", () => {
    actions.setRoomDrainage("r", { wastes: [{ id: "ch", kind: "linear", x: 0.1, y: 0.1, x2: 0.1, y2: 1.1 }] });
    actions.setFloorTiling("r", { tileLength: { value: 0.6, status: "proposed" }, tileWidth: { value: 0.3, status: "proposed" }, joint: { value: 0.003, status: "proposed" } });
    const before = floorTileLayout(store.getState().model, room());
    expect(before.missing.some((m) => /aperture size not recorded/.test(m))).toBe(true);
    actions.setRoomDrainage("r", { wastes: [{ id: "ch", kind: "linear", x: 0.1, y: 0.1, x2: 0.1, y2: 1.1, product: "ch-1000" }] });
    const after = floorTileLayout(store.getState().model, room());
    expect(after.missing.some((m) => /aperture/.test(m))).toBe(false);
    expect(after.wastes[0].grate).toHaveLength(4);
  });

  it("keeps a waste whose brief has no grate size as a centre line with the aperture unresolved", () => {
    actions.setRoomDrainage("r", { wastes: [{ id: "ch", kind: "linear", x: 0.1, y: 0.1, x2: 0.1, y2: 1.1, product: "unsized" }] });
    const info = wasteProduct(waste())!;
    expect(grateOutline(waste(), info)).toBeUndefined();
    expect(info.unresolved).toEqual(expect.arrayContaining(["grate length", "grate width"]));
    const layout = floorTileLayout(store.getState().model, room());
    expect(layout.missing).toContain("Linear waste 1: drain aperture size not recorded in the Synthetic Drains Channel 1000 brief; waste cut unresolved");
  });

  it("warns with both figures when the drawn channel differs from its grate length", () => {
    actions.setRoomDrainage("r", { wastes: [{ id: "ch", label: "Shower channel", kind: "linear", x: 0.1, y: 0.1, x2: 0.1, y2: 1.2, product: "ch-1000" }] });
    const p = drainageProblems(room()).find((x) => x.code === "waste_grate_length_mismatch")!;
    expect(p.message).toBe('Waste "Shower channel" is drawn 1100 mm long but its product grate (Synthetic Drains Channel 1000) is 1000 mm.');
  });

  it("keeps the link when the waste is re-sent by id, unlinks on null, and refuses non-drain or unknown ids", () => {
    actions.setRoomDrainage("r", { wastes: [{ id: "ch", kind: "linear", x: 0.1, y: 0.1, x2: 0.1, y2: 1.1, product: "ch-1000" }] });
    expect(actions.setRoomDrainage("r", { wastes: [{ id: "ch", kind: "linear", x: 0.2, y: 0.1, x2: 0.2, y2: 1.1 }] }).ok).toBe(true);
    expect(waste().product?.productId).toBe("ch-1000");
    expect(actions.setRoomDrainage("r", { wastes: [{ id: "ch", kind: "linear", x: 0.2, y: 0.1, x2: 0.2, y2: 1.1, product: "cable" }] }).summary).toMatch(/heating-cable brief, not a drain/);
    expect(actions.setRoomDrainage("r", { wastes: [{ id: "ch", kind: "linear", x: 0.2, y: 0.1, x2: 0.2, y2: 1.1, product: "nope" }] }).ok).toBe(false);
    expect(waste().product?.productId).toBe("ch-1000");
    actions.setRoomDrainage("r", { wastes: [{ id: "ch", kind: "linear", x: 0.2, y: 0.1, x2: 0.2, y2: 1.1, product: null }] });
    expect(waste().product).toBeUndefined();
  });

  it("places a channel outlet from the entered position along it, and refuses outletAt on a point waste", () => {
    actions.setRoomDrainage("r", { wastes: [{ id: "ch", kind: "linear", x: 0.1, y: 0.1, x2: 0.1, y2: 1.1, product: "ch-1000", outletAt: { value: 0.25, status: "proposed" } }] });
    expect(outletPosition(waste(), wasteProduct(waste()))).toMatchObject({ x: 0.1, y: 0.35, diameter: 0.05 });
    actions.setRoomDrainage("r", { wastes: [{ id: "ch", kind: "linear", x: 0.1, y: 0.1, x2: 0.1, y2: 1.1, outletAt: { value: 1.3, status: "proposed" } }] });
    expect(drainageProblems(room()).map((p) => p.code)).toContain("waste_outlet_off_channel");
    expect(actions.setRoomDrainage("r", { wastes: [{ kind: "point", x: 1, y: 1, outletAt: { value: 0.1, status: "proposed" } }] }).ok).toBe(false);
  });

  it("offers a later accepted revision without applying it, then re-pins on an explicit update", () => {
    actions.setRoomDrainage("r", { wastes: [{ id: "ch", kind: "linear", x: 0.1, y: 0.1, x2: 0.1, y2: 1.1, product: "ch-1000" }] });
    expect(actions.updateWasteProduct("r", "ch").ok).toBe(false);
    productStore.setState({ products: [...productStore.getState().products, drain("ch-1000-r2", { ...channel, installationDepth: pub(0.035) }, { seriesId: "ch-1000", number: 2, parentProductId: "ch-1000" })] });
    expect(wasteProduct(waste())!.update).toEqual({ productId: "ch-1000-r2", revision: 2 });
    expect(drainageProblems(room()).map((p) => p.code)).toContain("waste_product_update_available");
    expect(wasteProduct(waste())!.installationDepth?.value).toBe(0.04); // pinned until updated
    expect(actions.updateWasteProduct("r", "ch").ok).toBe(true);
    expect(waste().product?.productId).toBe("ch-1000-r2");
    expect(wasteProduct(waste())!.installationDepth?.value).toBe(0.035);
    expect(drainageProblems(room()).map((p) => p.code)).not.toContain("waste_product_update_available");
  });
});

describe("sample bathroom drains carry their packing-slip briefs (#82)", () => {
  it("links the Lauxes channel and the Kano tile insert, sized from the slip and with unknowns unresolved", () => {
    const wastes = seedBathroom().rooms.find((r) => r.drainage)!.drainage!.wastes;
    const lauxes = wasteProduct(wastes.find((w) => w.id === "linear_drain")!, [])!;
    expect([lauxes.grateLength?.value, lauxes.grateWidth?.value, lauxes.installationDepth?.value, lauxes.outletDiameter?.value]).toEqual([1, 0.1, 0.035, 0.05]);
    expect(lauxes.grateLength?.status).toBe("measured");
    const kano = wasteProduct(wastes.find((w) => w.id === "square_waste")!, [])!;
    expect(kano.grateType).toBe("tile-insert");
    expect(kano.installationDepth).toBeUndefined();
    expect(kano.unresolved).toContain("installation depth below the grate");
    expect(lauxesNextGen35().specification.fields.grateWidth.value).toBe(0.1);
    expect(kano316Insert().specification.fields.grateLength.value).toBe(0.12);
  });
});
