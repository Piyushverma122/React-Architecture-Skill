#!/usr/bin/env node
// Dependency-free repository checks. Run: node scripts/validate-repo.mjs
// Checks: manifests parse and agree, SKILL.md frontmatter, reference files exist and are linked,
// and relative Markdown links / image paths resolve. It does NOT replace `claude plugin validate`.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const fail = (msg) => errors.push(msg);
const read = (p) => readFileSync(join(root, p), "utf8");
const json = (p) => {
  try {
    return JSON.parse(read(p));
  } catch (e) {
    fail(`${p}: cannot read or parse JSON (${e.message})`);
    return null;
  }
};

// --- manifests ---
const plugin = json(".claude-plugin/plugin.json");
const market = json(".claude-plugin/marketplace.json");
const semver = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

if (plugin) {
  if (!plugin.name) fail("plugin.json: missing name");
  if (!semver.test(plugin.version ?? "")) fail(`plugin.json: version "${plugin.version}" is not semver`);
  if (plugin.license !== "MIT") fail(`plugin.json: expected license MIT, got "${plugin.license}"`);
}
if (market) {
  if (!market.name) fail("marketplace.json: missing name");
  if (!Array.isArray(market.plugins) || market.plugins.length === 0) fail("marketplace.json: no plugins listed");
  for (const p of market.plugins ?? []) {
    if (typeof p.source === "string") {
      const dir = resolve(root, p.source);
      if (!existsSync(join(dir, ".claude-plugin", "plugin.json"))) {
        fail(`marketplace.json: plugin "${p.name}" source "${p.source}" has no .claude-plugin/plugin.json`);
      }
    }
    if (plugin && p.name !== plugin.name) fail(`marketplace plugin name "${p.name}" != plugin.json name "${plugin.name}"`);
  }
}

// --- skill ---
const skillsDir = join(root, "skills");
const skillNames = existsSync(skillsDir)
  ? readdirSync(skillsDir).filter((n) => statSync(join(skillsDir, n)).isDirectory())
  : [];
if (skillNames.length === 0) fail("skills/: no skill directories found");

for (const name of skillNames) {
  const base = `skills/${name}`;
  if (!existsSync(join(root, base, "SKILL.md"))) {
    fail(`${base}: missing SKILL.md`);
    continue;
  }
  const text = read(`${base}/SKILL.md`);
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) {
    fail(`${base}/SKILL.md: missing YAML frontmatter`);
    continue;
  }
  const fmName = fm[1].match(/^name:\s*(.+)$/m)?.[1].trim();
  const fmDesc = fm[1].match(/^description:\s*(.+)$/m)?.[1].trim();
  if (fmName !== name) fail(`${base}/SKILL.md: frontmatter name "${fmName}" != directory "${name}"`);
  if (!fmDesc) fail(`${base}/SKILL.md: missing description`);

  const refsDir = join(root, base, "references");
  const refFiles = existsSync(refsDir) ? readdirSync(refsDir).filter((f) => f.endsWith(".md")) : [];
  const linked = new Set([...text.matchAll(/`references\/([\w.-]+\.md)`/g)].map((m) => m[1]));
  for (const f of linked) if (!refFiles.includes(f)) fail(`${base}/SKILL.md references missing file references/${f}`);
  for (const f of refFiles) if (!linked.has(f)) fail(`${base}/references/${f} is not mentioned in SKILL.md`);
}

// --- relative links in repository Markdown ---
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === ".git" || n === "node_modules") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n.endsWith(".md")) out.push(p);
  }
  return out;
}
const linkRe = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
for (const file of walk(root)) {
  const rel = relative(root, file).replaceAll("\\", "/");
  // Skip fenced code blocks so sample paths in examples aren't treated as links.
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const m of text.matchAll(linkRe)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const path = decodeURIComponent(target.split("#")[0]);
    if (!path) continue;
    if (!existsSync(resolve(dirname(file), path))) fail(`${rel}: broken relative link "${target}"`);
  }
}

if (errors.length) {
  console.error(`Repository validation FAILED (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Repository validation passed (${skillNames.length} skill(s) checked).`);
