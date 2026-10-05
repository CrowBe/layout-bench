/**
 * The sample bathroom in 3D, once as the finished room and once per build stage, each stage a
 * set_diagram_view that the 3D view follows. The door wall and the right wall are left out of
 * every stage so the camera looks into the room. Writes PNGs only; the project is not changed.
 *
 *   npm run dev   # then, in another shell:
 *   ALZA_BASE_URL=http://127.0.0.1:5199/ OUT=shots/renovation-3d node stage-shots.mjs
 */
import { mkdirSync } from "node:fs";
import { launch } from "./tests/browser.mjs";

const OUT = process.env.OUT ?? "shots/renovation-3d";
mkdirSync(OUT, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(process.env.ALZA_BASE_URL ?? "http://127.0.0.1:5199/");
await page.getByRole("button", { name: "Open" }).first().click();
const run = (name, args = {}) => page.evaluate(([t, a]) => window.__alza.runTool(t, a), [name, args]);
const content = await run("list_diagram_content");
await run("build_3d");
await page.waitForTimeout(1500);
const box = await page.locator("canvas").first().boundingBox();
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, clip: box });
const camera = async (mode) => { await page.evaluate((m) => window.__alza.actions.setCamera(m), mode); await page.waitForTimeout(1000); };

await camera("top");
await shot("finished-top");
await camera("walk");
await shot("finished-walk");
await camera("orbit");
// tip the orbit down a little so the floor reads
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 40, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(800);

const layer = (...ids) => content.layers.filter((l) => ids.includes(l.id)).flatMap((l) => l.elements.map((e) => e.id));
const cutaway = (ids) => ids.filter((id) => !/^wall:wall_(s|e)\b/.test(id) && id !== "opening:door_s");
const demolition = layer("walls", "floor-substrate", "doors");
const roughIn = [...demolition, ...layer("drainage-wastes")];
const board = [...roughIn, ...layer("wall-board", "windows")];
const waterproofing = [...board, ...layer("floor-waterproofing", "wall-waterproofing")];
const tiles = [...waterproofing, ...layer("floor-screed", "floor-adhesive", "floor-tile", "wall-adhesive", "wall-tile")];
const fitOut = [...tiles, ...layer("fixtures")];
const stages = [
  ["1-post-demolition", "1. Post-demolition: frame and slab", demolition],
  ["2-rough-in", "2. Rough-in: drains", roughIn],
  ["3-board-and-window", "3. Villaboard and new window", board],
  ["4-waterproofing", "4. Waterproofing", waterproofing],
  ["5-screed-and-tiles", "5. Screed and tiles", tiles],
  ["6-fit-out", "6. Fit-out", fitOut],
];
for (const [file, label, ids] of stages) {
  const r = await run("set_diagram_view", { label, visible: cutaway(ids) });
  if (!r.ok) throw new Error(`${label}: ${r.summary}`);
  await page.waitForTimeout(700);
  await shot(`stage-${file}`);
}
await page.getByRole("button", { name: "Show all" }).click();
await page.waitForTimeout(700);
await shot("stage-show-all");
await browser.close();
if (errors.length) throw new Error(errors.join("\n"));
console.log(`wrote ${OUT}`);
