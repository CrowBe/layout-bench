/**
 * One way for every browser suite to find its browser. Playwright's bundled Chromium is used
 * when it is installed; otherwise point CHROMIUM_PATH at any Chromium build:
 *
 *   CHROMIUM_PATH=/path/to/chrome ALZA_BASE_URL=http://127.0.0.1:5250/ node tests/products.e2e.mjs
 *
 * `npm run test:e2e` runs every suite and prints a summary.
 *
 * WebGL runs on ANGLE's SwiftShader backend: on a machine without a GPU, Chromium's default
 * software GL takes about a second per shader program, so the first 3D render blocks the page
 * for 12 s or more and a parallel run times out on "Build 3D". SwiftShader compiles the same
 * scene in about 1 s.
 *
 * Suites save screenshots through `shot(name)`: into test-results/ (untracked), or over the
 * tracked copy in shots/ when UPDATE_SHOTS=1 is set.
 */
import { chromium } from "playwright";

export const launch = (options = {}) =>
  chromium.launch({
    headless: true,
    ...options,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", ...(options.args ?? [])],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });

export const shot = (name) => `${process.env.UPDATE_SHOTS === "1" ? "shots" : "test-results"}/${name}`;
