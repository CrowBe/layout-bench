/**
 * Issue #16: room labels and wall dimensions stay readable and don't overlap.
 *
 * Builds the surveyed 2110 × 3020 mm bathroom the same way tests/mm-geometry.e2e.mjs does,
 * reloads so auto-fit runs on that plan, then checks SVG text boxes. Also checks Sunset Loft
 * at its auto-fit zoom, and that a wheel zoom-out leaves labels at a readable size.
 *
 * Run with the studio dev server: ALZA_BASE_URL=http://127.0.0.1:5316/ node tests/plan-labels.e2e.mjs
 */
import { chromium } from "playwright";
import { strict as assert } from "node:assert";

const baseUrl = process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5316/";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

function inside(label, room, tol = 2) {
  return (
    label.x >= room.x - tol &&
    label.y >= room.y - tol &&
    label.x + label.width <= room.x + room.width + tol &&
    label.y + label.height <= room.y + room.height + tol
  );
}

function overlaps(a, b, tol = 1) {
  return (
    a.x + a.width > b.x + tol &&
    b.x + b.width > a.x + tol &&
    a.y + a.height > b.y + tol &&
    b.y + b.height > a.y + tol
  );
}

async function readLayout(page) {
  return page.evaluate(() => {
    const box = (el) => {
      const b = el.getBBox();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    };
    const font = (el) => parseFloat(getComputedStyle(el).fontSize);
    const rooms = [...document.querySelectorAll("[data-role='room-label']")].map((label) => {
      const rect = label.parentElement?.querySelector("rect");
      return {
        text: (label.textContent ?? "").replace(/\s+/g, " ").trim(),
        fontSize: font(label),
        label: box(label),
        rect: rect ? box(rect) : null,
      };
    });
    const dims = [...document.querySelectorAll("[data-role='wall-dimension']")].map((el) => ({
      text: (el.textContent ?? "").trim(),
      fontSize: font(el),
      box: box(el),
    }));
    const svg = document.querySelector(".editor-svg");
    return { rooms, dims, svg: { w: svg?.clientWidth ?? 0, h: svg?.clientHeight ?? 0 } };
  });
}

async function readScale(page) {
  return page.evaluate(() => {
    const model = window.__alza.store.getState().model;
    const wall = model.walls.find((w) => Math.hypot(w.bx - w.ax, w.by - w.ay) > 0.2);
    const line = document.querySelector(`.editor-svg [data-id="${wall.id}"] line`);
    const len = Math.hypot(wall.bx - wall.ax, wall.by - wall.ay);
    const drawn = Math.hypot(line.x2.baseVal.value - line.x1.baseVal.value, line.y2.baseVal.value - line.y1.baseVal.value);
    return drawn / len;
  });
}

async function waitForAutoFit(page) {
  await page.waitForSelector(".editor-svg [data-role='room-label']");
  await page.waitForFunction(() => {
    const model = window.__alza.store.getState().model;
    const wall = model.walls.find((w) => Math.hypot(w.bx - w.ax, w.by - w.ay) > 0.2);
    const line = wall && document.querySelector(`.editor-svg [data-id="${wall.id}"] line`);
    const svg = document.querySelector(".editor-svg");
    if (!wall || !line || !svg || svg.clientWidth < 80 || svg.clientHeight < 80) return false;
    const len = Math.hypot(wall.bx - wall.ax, wall.by - wall.ay);
    const drawn = Math.hypot(line.x2.baseVal.value - line.x1.baseVal.value, line.y2.baseVal.value - line.y1.baseVal.value);
    const xs = model.walls.flatMap((w) => [w.ax, w.bx]);
    const ys = model.walls.flatMap((w) => [w.ay, w.by]);
    const planW = Math.max(...xs) - Math.min(...xs) + 1.6;
    const planH = Math.max(...ys) - Math.min(...ys) + 1.6;
    const expected = Math.max(15, Math.min(svg.clientWidth / planW, svg.clientHeight / planH));
    return Math.abs(drawn / len - expected) < 2;
  });
}

function assertReadablePlan(name, report, { minRoom = 12, minDim = 11, maxRoom = 24, maxDim = 18 } = {}) {
  const problems = [];
  assert.ok(report.rooms.length > 0, `${name}: no room labels`);
  assert.ok(report.dims.length > 0, `${name}: no wall dimensions`);
  for (const room of report.rooms) {
    if (!room.rect) problems.push(`${room.text}: missing room rect`);
    else if (!inside(room.label, room.rect)) problems.push(`${room.text} extends outside its room ${JSON.stringify({ label: room.label, rect: room.rect })}`);
    if (!(room.fontSize >= minRoom && room.fontSize <= maxRoom)) {
      problems.push(`${room.text} font ${room.fontSize}px is outside ${minRoom}–${maxRoom}px`);
    }
    for (const dim of report.dims) {
      if (overlaps(room.label, dim.box)) problems.push(`${room.text} overlaps dimension "${dim.text}" ${JSON.stringify({ label: room.label, dim: dim.box })}`);
    }
  }
  for (const dim of report.dims) {
    if (!(dim.fontSize >= minDim && dim.fontSize <= maxDim)) {
      problems.push(`dimension "${dim.text}" font ${dim.fontSize}px is outside ${minDim}–${maxDim}px`);
    }
  }
  assert.deepEqual(problems, [], `${name} on a ${report.svg.w}×${report.svg.h} canvas:\n${problems.join("\n")}`);
}

async function zoomOut(page) {
  const before = await readScale(page);
  const svg = page.locator(".editor-svg");
  const box = await svg.boundingBox();
  assert.ok(box, "editor svg has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Enough notches to reach the editor's minimum scale (15 px/m) from a large auto-fit.
  for (let i = 0; i < 24; i++) await page.mouse.wheel(0, 240);
  let after = await readScale(page);
  if (!(after < before * 0.75)) {
    for (let i = 0; i < 28; i++) {
      await page.evaluate(() => {
        const el = document.querySelector(".editor-svg");
        const rect = el.getBoundingClientRect();
        el.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: 160,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    }
    after = await readScale(page);
  }
  assert.ok(after < before * 0.75, `zoom out did not shrink the plan (${before.toFixed(1)} → ${after.toFixed(1)} px/m)`);
  return { before, after };
}

async function buildBathroom(page) {
  await page.evaluate(async () => {
    const run = window.__alza.runTool;
    const W = 2.11;
    const D = 3.02;
    const corners = [
      [0, 0],
      [W, 0],
      [W, D],
      [0, D],
    ];
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i];
      const [bx, by] = corners[(i + 1) % 4];
      const result = await run("add_wall", { ax, ay, bx, by });
      if (!result.ok) throw new Error(result.summary);
    }
    const room = await run("add_room", { x: 0, y: 0, w: W, h: D, label: "Bathroom", floor: "tile" });
    if (!room.ok) throw new Error(room.summary);
  });
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel("New project name").fill("Bathroom Survey");
  await page.getByRole("button", { name: "Create blank" }).click();
  await page.waitForSelector(".editor-svg");
  await buildBathroom(page);

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Choose a plan" }).waitFor();
  const survey = page.locator(".project-card").filter({ has: page.getByText("Bathroom Survey", { exact: true }) });
  await survey.getByRole("button", { name: "Open" }).click();
  await waitForAutoFit(page);

  const bathroom = await readLayout(page);
  const bathScale = await readScale(page);
  assert.equal(bathroom.rooms.length, 1, "bathroom has one room label");
  assert.equal(bathroom.dims.length, 4, "bathroom has four wall dimensions");
  assert.ok(bathroom.rooms[0].text.includes("Bathroom") && bathroom.rooms[0].text.includes("6.4"), bathroom.rooms[0].text);
  assert.ok(bathroom.dims.some((dim) => dim.text === "2110"), bathroom.dims.map((dim) => dim.text).join(", "));
  assert.ok(bathroom.dims.some((dim) => dim.text === "3020"), bathroom.dims.map((dim) => dim.text).join(", "));
  assertReadablePlan("bathroom auto-fit", bathroom);
  console.log(
    `bathroom auto-fit scale ${bathScale.toFixed(1)} px/m, canvas ${bathroom.svg.w}×${bathroom.svg.h}, room ${bathroom.rooms[0].fontSize}px, dims ${bathroom.dims.map((dim) => dim.fontSize).join("/")}px`,
  );

  const zoomed = await zoomOut(page);
  const bathroomZoomed = await readLayout(page);
  for (const room of bathroomZoomed.rooms) {
    assert.ok(room.fontSize >= 8, `zoomed-out room label is ${room.fontSize}px`);
  }
  for (const dim of bathroomZoomed.dims) {
    assert.ok(dim.fontSize >= 8, `zoomed-out dimension "${dim.text}" is ${dim.fontSize}px`);
  }
  console.log(`bathroom zoomed ${zoomed.before.toFixed(1)} → ${zoomed.after.toFixed(1)} px/m, room font ${bathroomZoomed.rooms[0].fontSize}px`);

  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("heading", { name: "Choose a plan" }).waitFor();
  const loft = page.locator(".project-card").filter({ has: page.getByText("Sunset Loft", { exact: true }) });
  await loft.getByRole("button", { name: "Open" }).click();
  await waitForAutoFit(page);

  const sunset = await readLayout(page);
  const loftScale = await readScale(page);
  assert.equal(sunset.rooms.length, 3, "Sunset Loft has three room labels");
  assert.equal(sunset.dims.length, 7, "Sunset Loft has seven wall dimensions");
  assertReadablePlan("Sunset Loft auto-fit", sunset);
  console.log(
    `Sunset Loft auto-fit scale ${loftScale.toFixed(1)} px/m, canvas ${sunset.svg.w}×${sunset.svg.h}, rooms ${sunset.rooms.map((room) => `${room.text} ${room.fontSize}px`).join(" | ")}`,
  );

  const loftZoom = await zoomOut(page);
  const loftZoomed = await readLayout(page);
  for (const room of loftZoomed.rooms) assert.ok(room.fontSize >= 8, `zoomed-out loft label is ${room.fontSize}px`);
  for (const dim of loftZoomed.dims) assert.ok(dim.fontSize >= 8, `zoomed-out loft dimension is ${dim.fontSize}px`);
  console.log(`Sunset Loft zoomed ${loftZoom.before.toFixed(1)} → ${loftZoom.after.toFixed(1)} px/m`);

  assert.deepEqual(errors, []);
  console.log("PASS: room labels stay inside their rooms, clear of wall dimensions, and readable when zoomed out");
} finally {
  await browser.close();
}
