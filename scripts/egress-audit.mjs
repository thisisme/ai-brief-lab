#!/usr/bin/env node
// Lists every place in the repo's agent setup that can send code, prompts or
// data out of the machine, or pull in code that changes without a commit.
// Usage: node scripts/egress-audit.mjs [--root dir] [--policy docs/agent-egress.md] [--strict]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const ROOT = path.resolve(opt('--root', '.'));
const POLICY = opt('--policy', 'docs/agent-egress.md');
const STRICT = args.includes('--strict');

// Text the agent reads as instructions. A command named here is one it may run.
const TEXT_PLACES = ['AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md', '.claude/skills', '.claude/agents',
  '.claude/commands', '.claude/rules', 'plugins', '.agents/skills'];
const RULES = [
  [/\bgh\s+(issue|pr|gist|release)\s+create\b/, (m) => `gh ${m[1]} create`, 'posts to GitHub'],
  [/\bgh\s+api\b/, () => 'gh api', 'calls the GitHub API'],
  [/\b(curl|wget)\s/, (m) => m[1], 'sends an HTTP request'],
  [/\bgit\s+push\b/, () => 'git push', 'pushes commits to a remote'],
  [/\b(npm|pnpm|yarn)\s+publish\b/, (m) => `${m[1]} publish`, 'publishes a package'],
  [/\bnpx\s+(?:-y\s+)?skills\s+add\b/, () => 'skills add', 'installs a third-party skill'],
  [/\b(scp|rsync|sftp)\s/, (m) => m[1], 'copies files to another host'],
  [/https?:\/\/(?!localhost|127\.0\.0\.1|example\.)([a-z0-9.-]+\.[a-z]{2,})/i, (m) => `url ${m[1].toLowerCase()}`, 'names an outside host'],
];

const findings = [];
const add = (file, line, what, why) => findings.push({ id: `${file}#${what}`, file, line, what, why });
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const lineOf = (text, needle) => Math.max(1, text.split('\n').findIndex((l) => l.includes(needle)) + 1);

function walk(p, out = []) {
  if (!fs.existsSync(p)) return out;
  const st = fs.statSync(p);
  if (st.isFile()) { if (/\.(md|mdc|txt|json|ya?ml|sh|mjs|js)$/.test(p)) out.push(p); return out; }
  for (const e of fs.readdirSync(p)) if (e !== 'node_modules' && e !== '.git') walk(path.join(p, e), out);
  return out;
}

for (const place of TEXT_PLACES) {
  for (const file of walk(path.join(ROOT, place))) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const seen = new Set();
    lines.forEach((l, i) => {
      for (const [re, name, why] of RULES) {
        const m = l.match(re);
        if (!m) continue;
        const what = name(m);
        if (seen.has(what)) continue; // one finding per thing per file
        seen.add(what);
        add(rel(file), i + 1, what, why);
      }
    });
  }
}

const readJson = (p) => { try { return [fs.readFileSync(p, 'utf8'), JSON.parse(fs.readFileSync(p, 'utf8'))]; } catch { return [null, null]; } };

for (const name of ['.claude/settings.json', '.claude/settings.local.json']) {
  const [text, s] = readJson(path.join(ROOT, name));
  if (!s) continue;
  for (const [mk, entry] of Object.entries(s.extraKnownMarketplaces ?? {})) {
    const src = entry.source ?? {};
    const where = src.repo ?? src.url ?? src.path ?? '?';
    const pinned = src.ref || src.sha ? 'pinned' : 'unpinned';
    const upd = entry.autoUpdate === true ? ', auto-update on' : '';
    add(name, lineOf(text, `"${mk}"`), `marketplace ${mk}`, `${src.source ?? '?'}:${where}, ${pinned}${upd}`);
  }
  for (const [pid, on] of Object.entries(s.enabledPlugins ?? {})) {
    if (on) add(name, lineOf(text, `"${pid}"`), `plugin ${pid}`, 'runs code from a marketplace');
  }
}

const [mcpText, mcp] = readJson(path.join(ROOT, '.mcp.json'));
for (const [sid, srv] of Object.entries(mcp?.mcpServers ?? {})) {
  const line = lineOf(mcpText, `"${sid}"`);
  if (srv.url) { add('.mcp.json', line, `mcp ${sid}`, `remote server at ${new URL(srv.url).host}`); continue; }
  const argv = [srv.command, ...(srv.args ?? [])].join(' ');
  const pkg = (srv.args ?? []).find((a) => !a.startsWith('-'));
  if (/^(npx|bunx|pnpx|uvx)$/.test(srv.command ?? '') && pkg) {
    const ver = pkg.slice(1).split('@')[1];
    const name = ver ? pkg.slice(0, pkg.length - ver.length - 1) : pkg;
    const [, local] = readJson(path.join(ROOT, 'node_modules', name, 'package.json'));
    const state = ver && ver !== 'latest' ? `pinned to ${ver}`
      : local && !ver ? `no version, npx uses node_modules (${local.version})`
      : 'unpinned, npx fetches the newest at start';
    add('.mcp.json', line, `mcp ${sid}`, `${srv.command} ${pkg}: ${state}`);
  } else add('.mcp.json', line, `mcp ${sid}`, `local process: ${argv}`);
}

// Policy: rows like | `id` | allow | why |
const policy = new Map();
const policyPath = path.join(ROOT, POLICY);
if (fs.existsSync(policyPath)) {
  for (const l of fs.readFileSync(policyPath, 'utf8').split('\n')) {
    const m = l.match(/^\|\s*`([^`]+)`\s*\|\s*(allow|review|block)\s*\|/);
    if (m) policy.set(m[1], m[2]);
  }
}

const count = { allow: 0, review: 0, block: 0, new: 0 };
findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
for (const f of findings) {
  const d = policy.get(f.id) ?? 'new';
  count[d]++;
  console.log(`${d.toUpperCase().padEnd(6)} ${f.file}:${f.line}  ${f.what}: ${f.why}`);
}
const stale = [...policy.keys()].filter((id) => !findings.some((f) => f.id === id));
for (const id of stale) console.log(`STALE  ${id} is in ${POLICY} but no longer found`);
console.log(`egress-audit: ${findings.length} finding(s), ${count.allow} allow, ${count.review} review, ${count.block} block, ${count.new} new`);
if (STRICT && (count.block > 0 || count.new > 0)) process.exit(1);
