/**
 * Docs staleness checks. README.md, AGENTS.md, docs/TOOLS.md and the plugin skills must agree
 * with the code: every declared tool is listed once with its annotations, tool names the docs
 * mention exist, relative links and backticked repo paths resolve, and `npm run` commands exist.
 * Tools are read from the source of src/mcp/tools.ts, since importing it needs a browser.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const skillDocs = readdirSync(join(root, "plugins/reno-layouts/skills")).map((d) => `plugins/reno-layouts/skills/${d}/SKILL.md`);
const docs = ["README.md", "AGENTS.md", "docs/TOOLS.md", ...skillDocs];

interface Declared { name: string; readOnly: boolean; destructive: boolean; dynamic: boolean }

/** Every `{ name, title, … }` tool literal in tools.ts; the dynamic tool is indented one level less. */
function declaredTools(): Declared[] {
  const lines = read("src/mcp/tools.ts").split("\n");
  const tools: Declared[] = [];
  lines.forEach((line, i) => {
    const m = /^( +)name: "([a-z0-9_]+)",$/.exec(line);
    if (!m || !/^ +title: "/.test(lines[i + 1] ?? "")) return;
    let annotations = "";
    for (let j = i + 1; j < lines.length && !/^ +name: "/.test(lines[j]); j++) {
      const a = /annotations: \{([^}]*)\}/.exec(lines[j]);
      if (a) { annotations = a[1]; break; }
    }
    tools.push({
      name: m[2],
      readOnly: annotations.includes("readOnlyHint: true"),
      destructive: annotations.includes("destructiveHint: true"),
      dynamic: m[1].length === 2,
    });
  });
  return tools;
}

/** `| \`name\` | title | tags |` rows of docs/TOOLS.md. */
function listedTools(): { name: string; tags: string }[] {
  return [...read("docs/TOOLS.md").matchAll(/^\| `([a-z0-9_]+)` \|[^|]*\|([^|]*)\|$/gm)].map((m) => ({ name: m[1], tags: m[2] }));
}

const declared = declaredTools();
const names = new Set(declared.map((t) => t.name));

describe("docs/TOOLS.md matches the declared tools", () => {
  it("finds the tool declarations", () => {
    expect(declared.length).toBeGreaterThan(50);
    expect(declared.filter((t) => t.dynamic).map((t) => t.name)).toEqual(["extend_selected_wall"]);
  });

  it("lists every declared tool exactly once and nothing else", () => {
    const listed = listedTools().map((t) => t.name);
    expect([...listed].sort()).toEqual([...names].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("tags read-only and destructive tools as the code annotates them", () => {
    const tags = new Map(listedTools().map((t) => [t.name, t.tags]));
    for (const t of declared) {
      expect(tags.get(t.name)?.includes("read-only"), `${t.name} read-only`).toBe(t.readOnly);
      expect(tags.get(t.name)?.includes("destructive"), `${t.name} destructive`).toBe(t.destructive);
    }
  });

  it("states the current tool count", () => {
    const fixed = declared.filter((t) => !t.dynamic).length;
    expect(read("docs/TOOLS.md")).toContain(`registers ${fixed} tools, plus one dynamic tool`);
  });
});

describe.each(docs)("%s", (doc) => {
  const text = read(doc);
  const dir = dirname(doc);

  it("mentions only declared tools", () => {
    // snake_case words with a verb prefix the tool names use; plugin and partner tools aside
    const mentioned = [...text.matchAll(/`((?:get|set|add|edit|remove|list|export|check|place|move|define|clear|build|leave|request|submit|preview|update|measure|calibrate|anchor|fit|extend)_[a-z0-9_]+)`/g)].map((m) => m[1]);
    expect(mentioned.filter((n) => !names.has(n))).toEqual([]);
  });

  it("links only to files that exist", () => {
    const links = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1].split("#")[0]).filter((l) => l && !/^[a-z]+:/i.test(l));
    expect(links.filter((l) => !existsSync(resolve(root, dir, l)))).toEqual([]);
  });

  it("names repo paths that exist", () => {
    const paths = [...text.matchAll(/`((?:src|tests|scripts|shots|plugins|partner|docs)\/[^`\s*<]+)`/g)].map((m) => m[1]);
    expect(paths.filter((p) => !existsSync(join(root, p)))).toEqual([]);
  });

  it("runs only npm scripts that exist", () => {
    const scripts = Object.keys(JSON.parse(read("package.json")).scripts);
    const used = [...text.matchAll(/npm run ([a-z0-9:-]+)/g)].map((m) => m[1]);
    expect(used.filter((s) => !scripts.includes(s))).toEqual([]);
  });
});
