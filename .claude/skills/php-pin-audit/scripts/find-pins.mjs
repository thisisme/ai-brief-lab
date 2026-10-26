#!/usr/bin/env node
// Finds PHP version pins in a repository and checks them against the PHP2Shell fixes.
// Usage: node find-pins.mjs [repo-root]   Exit 1 if an exact pin is below the fix.
// Files it can't read (a .env that Claude Code's sandbox blocks, a broken symlink) are
// skipped and listed at the end instead of stopping the audit.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

const FIXED = { '8.2': 35, '8.3': 36, '8.4': 27, '8.5': 12 };
const SKIP = new Set(['node_modules', 'vendor', '.git', '.svelte-kit', 'build', 'dist']);
const root = process.argv[2] ?? '.';
const skipped = [];
const skip = (p, e) => skipped.push(`${relative(root, p) || '.'} (${e.code ?? e.message})`);

function* walk(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (e) {
    skip(dir, e);
    return;
  }
  for (const name of names) {
    if (SKIP.has(name) || /^\.env(\.|$)/.test(name)) continue; // never pins PHP; secrets stay unread
    const p = join(dir, name);
    let s;
    try {
      s = statSync(p);
    } catch (e) {
      skip(p, e);
      continue;
    }
    if (s.isDirectory()) yield* walk(p);
    else if (s.size < 1_000_000) yield p;
  }
}

function read(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch (e) {
    skip(p, e);
    return null;
  }
}

function verdict(v) {
  const m = String(v).match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m || /[\^~><|*]/.test(v)) return { text: 'range: check what it resolves to', bad: false };
  const minor = `${m[1]}.${m[2]}`;
  if (minor === '8.6') return { text: '8.6 is pre-release: RC4 or later has the fix', bad: false };
  if (!(minor in FIXED)) {
    const old = Number(m[1]) < 8 || (m[1] === '8' && Number(m[2]) < 2);
    return { text: old ? 'no official fix: upgrade the branch' : 'unknown branch', bad: old && m[3] !== undefined };
  }
  if (m[3] === undefined) return { text: `moving: the next pull or CI run must fetch ${minor}.${FIXED[minor]}+`, bad: false };
  return Number(m[3]) >= FIXED[minor]
    ? { text: 'patched', bad: false }
    : { text: `VULNERABLE: needs ${minor}.${FIXED[minor]} or later`, bad: true };
}

const rules = [
  // [file test, line regex] — the first capture group is the version
  [(f) => /^Dockerfile|\.dockerfile$|^Containerfile/i.test(f), /\bphp:(\d+\.\d+(?:\.\d+)?)/],
  [(f) => /^(docker-)?compose.*\.ya?ml$/.test(f), /image:\s*["']?php:(\d+\.\d+(?:\.\d+)?)/],
  [(f, p) => /\.ya?ml$/.test(f) && /\.github[\\/]workflows/.test(p), /php-version:\s*["']?([\d.]+)/],
  [(f) => f === '.tool-versions', /^php\s+([\d.]+)/],
  [(f) => f === '.php-version', /^\s*([\d.]+)\s*$/]
];

let bad = 0;
const out = (file, line, pin, v) => {
  if (v.bad) bad++;
  console.log(`${file}:${line}\t${pin}\t${v.text}`);
};

for (const p of walk(root)) {
  const f = basename(p);
  const rel = relative(root, p);
  if (f === 'composer.json') {
    const text = read(p);
    if (text === null) continue;
    const lines = text.split('\n');
    let j;
    try { j = JSON.parse(text); } catch { continue; }
    const lineOf = (needle) => lines.findIndex((l) => l.includes(needle)) + 1;
    if (j.require?.php) out(rel, lineOf('"php"'), `require.php ${j.require.php}`, verdict(j.require.php));
    const plat = j.config?.platform?.php;
    if (plat) out(rel, lines.findLastIndex((l) => l.includes('"php"')) + 1, `config.platform.php ${plat}`, verdict(plat));
    continue;
  }
  for (const [test, re] of rules) {
    if (!test(f, p)) continue;
    const text = read(p);
    if (text === null) continue;
    text.split('\n').forEach((l, i) => {
      const m = l.match(re);
      if (m) out(rel, i + 1, m[1], verdict(m[1]));
    });
  }
}
if (skipped.length) console.error(`php-pin-audit: skipped ${skipped.length} unreadable path(s): ${skipped.join(', ')}`);
if (bad) console.error(`php-pin-audit: ${bad} pin(s) below the fixed version`);
process.exit(bad ? 1 : 0);