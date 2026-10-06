/**
 * Stage pack: a view that changes the model fails the run before any committed phase folder is
 * replaced. composeView is wrapped so composing a view also edits the model, the way a buggy view
 * would; everything else is the real generator.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../src/sheets/viewState", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/sheets/viewState")>();
  const { store } = await import("../src/model/store");
  return {
    ...real,
    composeView: (...args: Parameters<typeof real.composeView>) => {
      const s = store.getState();
      store.setState({ model: { ...s.model, name: `${s.model.name} (edited by a view)` } });
      return real.composeView(...args);
    },
  };
});

const { PHASES, generatePack } = await import("../scripts/stage-pack");

let outDir: string;
afterEach(() => { if (outDir) rmSync(outDir, { recursive: true, force: true }); });

it("fails before replacing any phase folder when a view changes the model", async () => {
  outDir = mkdtempSync(join(tmpdir(), "stage-pack-mutation-"));
  const dest = join(outDir, PHASES[0].slug);
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "plan.svg"), "<svg>committed</svg>");
  writeFileSync(join(outDir, "README.md"), "committed index");

  await expect(generatePack({ outDir, previews: false, date: "2026-10-05" })).rejects.toThrow(/Views must only change visibility/);
  expect(readFileSync(join(dest, "plan.svg"), "utf8")).toBe("<svg>committed</svg>");
  expect(readdirSync(dest)).toEqual(["plan.svg"]);
  expect(readFileSync(join(outDir, "README.md"), "utf8")).toBe("committed index");
  expect(readdirSync(outDir).filter((n) => n.endsWith(".tmp") || n.endsWith(".bak"))).toEqual([]);
  expect(existsSync(`${dest}.bak`)).toBe(false);
});
