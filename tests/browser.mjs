/**
 * One way for every browser suite to find its browser. Playwright's bundled Chromium is used
 * when it is installed; otherwise point CHROMIUM_PATH at any Chromium build:
 *
 *   CHROMIUM_PATH=/path/to/chrome ALZA_BASE_URL=http://127.0.0.1:5250/ node tests/products.e2e.mjs
 *
 * `npm run test:e2e` runs every suite and prints a summary.
 */
import { chromium } from "playwright";

export const launch = (options = {}) =>
  chromium.launch({
    headless: true,
    ...options,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
