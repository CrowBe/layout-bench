/**
 * Runs every browser suite (tests/*.e2e.mjs) and prints one line each plus a summary.
 *
 *   npm run test:e2e                      start a dev server, run all suites, 3 at a time
 *   npm run test:e2e -- products fixtures only suites whose name contains an argument
 *   ALZA_BASE_URL=http://127.0.0.1:5250/ npm run test:e2e   use a server that is already running
 *   E2E_JOBS=1 npm run test:e2e           one suite at a time
 *   CHROMIUM_PATH=/path/to/chrome ...     a browser other than Playwright's own
 *   UPDATE_SHOTS=1 npm run test:e2e       save screenshots over the tracked ones in shots/
 *
 * A suite that prints a line starting "SKIP:" and exits 0 is reported as skipped with that
 * reason; any other non-zero exit is a failure and its output tail is shown.
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const filters = process.argv.slice(2);
const suites = readdirSync(here).filter((f) => f.endsWith(".e2e.mjs") && (!filters.length || filters.some((x) => f.includes(x)))).sort();
const jobs = Math.max(1, Number(process.env.E2E_JOBS ?? 3));
const timeoutMs = Number(process.env.E2E_TIMEOUT_MS ?? 600_000);

async function waitFor(url, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not come up within ${ms / 1000}s`);
}

let server;
let base = process.env.ALZA_BASE_URL;
if (!base) {
  const port = process.env.E2E_PORT ?? "5250";
  base = `http://127.0.0.1:${port}/`;
  server = spawn("npx", ["vite", "--port", port, "--strictPort"], { cwd: join(here, ".."), stdio: "ignore" });
  await waitFor(base);
}

const run = (suite) => new Promise((resolve) => {
  const started = Date.now();
  const child = spawn(process.execPath, [join(here, suite)], { env: { ...process.env, ALZA_BASE_URL: base }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  child.on("close", (code, signal) => {
    clearTimeout(timer);
    const seconds = Math.round((Date.now() - started) / 1000);
    const skip = /^SKIP: (.*)$/m.exec(out);
    const status = signal ? "FAIL" : code === 0 ? (skip ? "SKIP" : "PASS") : "FAIL";
    resolve({ suite, status, seconds, out, reason: skip?.[1], signal });
  });
});

const results = [];
const queue = [...suites];
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
  while (queue.length) {
    const r = await run(queue.shift());
    results.push(r);
    console.log(`${r.status.padEnd(4)} ${r.suite.replace(".e2e.mjs", "")} (${r.seconds}s)${r.reason ? ` - ${r.reason}` : ""}`);
  }
}));
server?.kill();

const failed = results.filter((r) => r.status === "FAIL");
for (const r of failed) console.log(`\n--- ${r.suite}${r.signal ? ` (killed: ${r.signal}, timeout ${timeoutMs / 1000}s)` : ""} ---\n${r.out.split("\n").slice(-12).join("\n")}`);
const count = (s) => results.filter((r) => r.status === s).length;
console.log(`\n${count("PASS")} passed, ${count("SKIP")} skipped, ${failed.length} failed of ${results.length}`);
process.exit(failed.length ? 1 : 0);
