/**
 * Issue #3 end-to-end check: millimetre-accurate geometry across WebMCP, UI, 2D and 3D.
 *
 * Drives the real WebMCP runtime through navigator.modelContextTesting, so it needs a
 * Chromium launched with --enable-features=WebMCP,WebMCPTesting (Playwright's bundled
 * Chromium works; stable Google Chrome does not expose the testing API).
 *
 * The contract this test holds the app to:
 *  - Values entered through tools are stored and read back exactly (no hidden 50 mm snap).
 *    Storage precision is 0.1 mm, so derived set-out values such as a centred 1755 mm
 *    window's 177.5 mm jamb offset survive; finer input is rounded and the result says so.
 *  - A window added without a height gets a default that fits under the wall, marked
 *    heightDefaulted; the tool result asks the agent to get the measured height, and
 *    get_issues keeps warning until it is entered.
 *  - Selecting a window in the 2D editor exposes its centre distance from wall end A in mm,
 *    and typing a new value moves it by exactly that amount.
 *  - 2D elements carry `data-id` and 3D meshes are named `<entity id>` or `<entity id>:<part>`,
 *    so both renderings can be checked against the model they were drawn from. An opening's
 *    `:frame` part spans exactly its clear opening.
 *
 * Survey decisions (see issue #1): walls run along the surveyed existing surfaces until #4 adds
 * real faces; the door's jamb reference waits for on-site orientation, so its position here is a
 * placeholder; bath geometry is unknown and must not appear.
 *
 * Run with the studio dev server up:  ALZA_BASE_URL=http://127.0.0.1:5199/ node tests/mm-geometry.e2e.mjs
 */
import { chromium } from "playwright";

const baseUrl = process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5199/";
const EPS = 1e-9; // metres; far below 1 mm, so any rounding to a coarser grid fails
const MM = 1e-3;

const results = [];
const check = (name, cond, extra = "") => {
  results.push([name, !!cond]);
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
};
const near = (a, b, eps = EPS) => typeof a === "number" && Math.abs(a - b) <= eps;
const fmt = (v) => (typeof v === "number" ? `${+(v / MM).toFixed(4)} mm` : String(v));

// Surveyed rectangle, existing internal surfaces. Plan origin at the back-left corner.
const W = 2.11;
const D = 3.02;
const WINDOW = { width: 1.755, sill: 1.52, centreFromA: W / 2 };
const DOOR_WIDTH = 0.8;
const VANITY = { w: 0.91, d: 0.465, x: 1.055, y: 1.51 };
const EDITED_CENTRE = 1.06; // window moved 5 mm from the UI

const browser = await chromium.launch({
  args: ["--enable-features=WebMCP,WebMCPTesting", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

/** Call a page tool the way an agent does: through the WebMCP runtime, JSON in, JSON out. */
const tool = async (name, args = {}) =>
  JSON.parse(
    await page.evaluate(([n, a]) => navigator.modelContextTesting.executeTool(n, JSON.stringify(a)), [name, args]),
  );
const model = async () => (await tool("get_model")).model;
const centreFromA = (m, openingId) => {
  const o = m.openings.find((x) => x.id === openingId);
  const w = m.walls.find((x) => x.id === o.wallId);
  return o.t * Math.hypot(w.bx - w.ax, w.by - w.ay);
};

/** Export OBJ from the 3D view and return world-space bounds per entity id and per full mesh name. */
async function exportedBounds() {
  await page.getByRole("button", { name: /Build 3D/ }).click();
  await page.waitForSelector(".scene3d canvas", { timeout: 15000 });
  const download = page.waitForEvent("download", { timeout: 20000 });
  await page.getByRole("button", { name: "Export OBJ" }).click();
  const obj = await (await download).createReadStream().then(async (s) => {
    let text = "";
    for await (const chunk of s) text += chunk;
    return text;
  });
  await page.getByRole("button", { name: "Back to 2D" }).click();
  const bounds = new Map();
  let current = "";
  for (const line of obj.split("\n")) {
    if (line.startsWith("o ")) current = line.slice(2).trim();
    else if (line.startsWith("v ") && current) {
      const [x, y, z] = line.slice(2).trim().split(/\s+/).map(Number);
      for (const key of new Set([current, current.split(":")[0]])) {
        const b = bounds.get(key) ?? { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
        b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
        b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y);
        b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z);
        bounds.set(key, b);
      }
    }
  }
  return bounds;
}

/** Plan-space centre of an SVG element, using the room rect as the scale reference. */
async function svgCentre(id, roomId) {
  return page.evaluate(([i, r]) => {
    const el = document.querySelector(`.editor-svg [data-id="${i}"]`);
    const room = document.querySelector(`.editor-svg [data-id="${r}"] rect`) ?? document.querySelector(`.editor-svg rect[data-id="${r}"]`);
    if (!el || !room) return null;
    const rb = room.getBBox();
    const eb = el.getBBox();
    const m = el.getCTM();
    const rm = room.getCTM();
    // map both centres into the SVG's user space, then into plan metres via the room's size
    const pt = (b, ctm) => new DOMPoint(b.x + b.width / 2, b.y + b.height / 2).matrixTransform(ctm);
    const c = pt(eb, m);
    const o = new DOMPoint(rb.x, rb.y).matrixTransform(rm);
    const far = new DOMPoint(rb.x + rb.width, rb.y + rb.height).matrixTransform(rm);
    return { x: c.x - o.x, y: c.y - o.y, roomW: far.x - o.x, roomH: far.y - o.y };
  }, [id, roomId]);
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("New project name").fill("Bathroom Survey");
  await page.getByRole("button", { name: "Create blank" }).click();
  check("runtime: navigator.modelContextTesting is available", await page.evaluate(() => !!navigator.modelContextTesting));

  // ---------- 1. store the survey through WebMCP ----------
  const corners = [[0, 0], [W, 0], [W, D], [0, D]];
  const wallIds = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    const r = await tool("add_wall", { ax, ay, bx, by });
    wallIds.push(r.id);
  }
  const [backWall, , frontWall] = wallIds;
  const room = await tool("add_room", { x: 0, y: 0, w: W, h: D, label: "Bathroom", floor: "tile" });
  const win = await tool("add_window", { wallId: backWall, t: 0.5, width: WINDOW.width, sill: WINDOW.sill });
  const door = await tool("add_door", { wallId: frontWall, t: 0.5, width: DOOR_WIDTH });
  await tool("define_item_kind", { kind: "vanity_910", label: "Vanity 910", w: VANITY.w, d: VANITY.d, h: 0.85, category: "bath" });
  const vanity = await tool("place_item", { kind: "vanity_910", x: VANITY.x, y: VANITY.y });
  check("setup: every tool call succeeded", [room, win, door, vanity].every((r) => r.ok),
    [room, win, door, vanity].filter((r) => !r.ok).map((r) => r.summary).join(" ;; "));

  // ---------- 2. read back exact values via WebMCP ----------
  let m = await model();
  const back = m.walls.find((w) => w.id === backWall);
  check("readback: back wall runs 0 → 2110 mm", near(back?.ax, 0) && near(back?.bx, W), `${fmt(back?.ax)} → ${fmt(back?.bx)}`);
  const side = m.walls.find((w) => w.id === wallIds[1]);
  check("readback: side wall runs 0 → 3020 mm", near(side?.ay, 0) && near(side?.by, D), `${fmt(side?.ay)} → ${fmt(side?.by)}`);
  const r0 = m.rooms.find((r) => r.id === room.id);
  check("readback: room is 2110 × 3020 mm", near(r0?.w, W) && near(r0?.h, D), `${fmt(r0?.w)} × ${fmt(r0?.h)}`);
  const w0 = m.openings.find((o) => o.id === win.id);
  check("readback: window width 1755 mm", near(w0?.width, WINDOW.width), fmt(w0?.width));
  check("readback: window sill 1520 mm", near(w0?.sill, WINDOW.sill), fmt(w0?.sill));
  check("readback: window centred 1055 mm from end A", w0 && near(centreFromA(m, win.id), WINDOW.centreFromA), w0 && fmt(centreFromA(m, win.id)));
  check("readback: window jamb 177.5 mm from end A (0.1 mm precision)", near(w0?.position?.nearJambFromA, 0.1775), fmt(w0?.position?.nearJambFromA));
  check("height: missing window height is a default that fits under the wall",
    w0?.heightDefaulted === true && near(w0?.height, 2.7 - WINDOW.sill), `height ${fmt(w0?.height)}, heightDefaulted ${w0?.heightDefaulted}`);
  check("height: add_window asks for the actual height", /ask for the actual height/i.test(win.summary ?? "") && /edit_opening/.test(win.summary ?? ""), win.summary);
  const d0 = m.openings.find((o) => o.id === door.id);
  check("readback: door width 800 mm", near(d0?.width, DOOR_WIDTH), fmt(d0?.width));
  const v0 = m.items.find((i) => i.id === vanity.id);
  check("readback: vanity centre at (1055, 1510) mm", near(v0?.x, VANITY.x) && near(v0?.y, VANITY.y), `(${fmt(v0?.x)}, ${fmt(v0?.y)})`);
  const kind = (await tool("get_item_catalog")).catalog.find((c) => c.kind === "vanity_910");
  check("readback: vanity envelope 910 × 465 mm", near(kind?.w, VANITY.w) && near(kind?.d, VANITY.d), `${fmt(kind?.w)} × ${fmt(kind?.d)}`);
  const measured = await tool("measure", { wallId: backWall });
  check("readback: measure reports the back wall as 2110 mm", near(measured.meters, W) && /2110|2\.110/.test(measured.summary), measured.summary);
  check("readback: no bath was inferred", !m.items.some((i) => /bath/i.test(i.kind)));
  const issues = (await tool("get_issues")).issues ?? [];
  check("issues: no errors in the surveyed plan",
    !!w0 && !issues.some((i) => i.severity === "error"), issues.filter((i) => i.severity === "error").map((i) => i.message).join(" ;; "));
  check("issues: get_issues keeps warning about the default window height",
    issues.some((i) => i.code === "opening_height_default" && i.refs.includes(win.id)));
  const rounded = await tool("edit_opening", { id: door.id, width: 0.80004 });
  const d1 = (await model()).openings.find((o) => o.id === door.id);
  check("rounding: finer-than-0.1 mm input is rounded and reported", near(d1?.width, DOOR_WIDTH) && /Rounded/.test(rounded.summary), rounded.summary);

  // ---------- 3. 2D and 3D agree with the stored model ----------
  const wallLabels = await page.locator(".editor-svg text").allTextContents();
  check("2D: back wall dimension is labelled in millimetres", wallLabels.some((t) => /^\s*2\s?110(\s?mm)?\s*$/.test(t)), wallLabels.slice(0, 6).join(" | "));
  const winSvg = await svgCentre(win.id, room.id);
  check("2D: window drawn centred 1055 mm from end A",
    winSvg && near((winSvg.x / winSvg.roomW) * W, WINDOW.centreFromA, 1e-6), winSvg ? fmt((winSvg.x / winSvg.roomW) * W) : "no [data-id] element");

  let bounds = await exportedBounds();
  const floor = bounds.get(room.id);
  check("3D: room floor spans 2110 × 3020 mm",
    floor && near(floor.maxX - floor.minX, W, 1e-6) && near(floor.maxZ - floor.minZ, D, 1e-6),
    floor ? `${fmt(floor.maxX - floor.minX)} × ${fmt(floor.maxZ - floor.minZ)}` : "no mesh named after the room");
  let win3d = bounds.get(`${win.id}:frame`);
  check("3D: window opening is 1755 mm wide, centred 1055 mm from end A",
    win3d && near(win3d.maxX - win3d.minX, WINDOW.width, 1e-6) && near((win3d.minX + win3d.maxX) / 2, WINDOW.centreFromA, 1e-6),
    win3d ? `${fmt(win3d.maxX - win3d.minX)} at ${fmt((win3d.minX + win3d.maxX) / 2)}` : "no mesh named <window id>:frame");
  check("3D: window starts at the 1520 mm sill", win3d && near(win3d.minY, WINDOW.sill, 1e-6), win3d ? fmt(win3d.minY) : "no mesh");
  const van3d = bounds.get(vanity.id);
  check("3D: vanity footprint 910 × 465 mm",
    van3d && near(van3d.maxX - van3d.minX, VANITY.w, 1e-6) && near(van3d.maxZ - van3d.minZ, VANITY.d, 1e-6),
    van3d ? `${fmt(van3d.maxX - van3d.minX)} × ${fmt(van3d.maxZ - van3d.minZ)}` : "no mesh named after the vanity");

  // ---------- 4. edit one value from the UI ----------
  let edited = false;
  try {
    await page.locator(`.editor-svg [data-id="${win.id}"]`).click({ timeout: 5000 });
    const field = page.getByLabel("Centre from wall end A (mm)");
    check("UI: selected window shows its centre from end A in mm", (await field.inputValue({ timeout: 5000 })) === "1055");
    await field.fill("1060");
    await field.press("Enter");
    edited = true;
  } catch (e) {
    check("UI: window can be selected and its centre edited in mm", false, String(e).split("\n")[0]);
  }

  if (edited) {
    m = await model();
    const w1 = m.openings.find((o) => o.id === win.id);
    check("after edit: WebMCP reads the window 1060 mm from end A", near(centreFromA(m, win.id), EDITED_CENTRE), fmt(centreFromA(m, win.id)));
    check("after edit: width, sill and default height unchanged",
      near(w1.width, WINDOW.width) && near(w1.sill, WINDOW.sill) && w1.heightDefaulted === true);
    const winSvg1 = await svgCentre(win.id, room.id);
    check("after edit: 2D window drawn 1060 mm from end A",
      winSvg1 && near((winSvg1.x / winSvg1.roomW) * W, EDITED_CENTRE, 1e-6), winSvg1 ? fmt((winSvg1.x / winSvg1.roomW) * W) : "missing");
    bounds = await exportedBounds();
    win3d = bounds.get(`${win.id}:frame`);
    check("after edit: 3D window centred 1060 mm from end A",
      win3d && near((win3d.minX + win3d.maxX) / 2, EDITED_CENTRE, 1e-6), win3d ? fmt((win3d.minX + win3d.maxX) / 2) : "missing");
    const undo = await page.getByRole("button", { name: "Undo" }).click().then(() => model());
    check("after edit: undo restores 1055 mm", near(centreFromA(undo, win.id), WINDOW.centreFromA), fmt(centreFromA(undo, win.id)));
  }

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" ;; "));
} finally {
  await browser.close();
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} PASSED =====`);
process.exit(failed.length ? 1 : 0);
