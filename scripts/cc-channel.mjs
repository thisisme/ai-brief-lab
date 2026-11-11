#!/usr/bin/env node
// Which Claude Code release channel this repo follows, and how far the installed
// version is from npm's stable and latest tags.
// Usage: node scripts/cc-channel.mjs [--strict] [--root DIR] [--home DIR]
//        [--installed X.Y.Z] [--npm-json FILE]   (the last two are for tests)
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const strict = args.includes('--strict');
const root = opt('--root', process.cwd());
const home = opt('--home', homedir());
const PKG = '@anthropic-ai/claude-code';

const parse = (v) => (v ?? '').match(/^(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number) ?? null;
const cmp = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const day = (iso) => (iso ? iso.slice(0, 10) : '?');

function readJson(file) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { console.log(`WARN   ${file}: not valid JSON (${e.message})`); return null; }
}

// 1. Installed version: "2.1.319 (Claude Code)"
let installed = opt('--installed');
if (!installed) {
  try { installed = execFileSync('claude', ['--version'], { encoding: 'utf8' }).match(/\d+\.\d+\.\d+/)?.[0]; }
  catch { installed = null; }
}

// 2. npm tags and publish times
const npmFile = opt('--npm-json');
const npm = npmFile
  ? JSON.parse(readFileSync(npmFile, 'utf8'))
  : JSON.parse(execFileSync('npm', ['view', PKG, 'dist-tags', 'time', '--json'], { encoding: 'utf8' }));
const tags = npm['dist-tags'] ?? {};
const time = npm.time ?? {};

// 3. Settings, lowest precedence first (managed settings are not read here)
const files = [
  ['user', join(home, '.claude', 'settings.json')],
  ['project', join(root, '.claude', 'settings.json')],
  ['local', join(root, '.claude', 'settings.local.json')],
];
let channel = null, channelFrom = null, floor = null, floorFrom = null;
for (const [scope, file] of files) {
  const s = readJson(file);
  if (!s) continue;
  if (s.autoUpdatesChannel !== undefined) { channel = s.autoUpdatesChannel; channelFrom = scope; }
  if (s.minimumVersion !== undefined) { floor = s.minimumVersion; floorFrom = scope; }
}

const warns = [];
const line = (k, v) => console.log(`${k.padEnd(10)} ${v}`);
line('installed', installed ?? 'not found (is claude on PATH?)');
line('stable', `${tags.stable ?? '?'}  (${day(time[tags.stable])})`);
line('latest', `${tags.latest ?? '?'}  (${day(time[tags.latest])})`);
line('channel', channel ? `${channel} (from ${channelFrom} settings)` : 'not set, so latest');
line('floor', floor ? `minimumVersion ${floor} (from ${floorFrom} settings)` : 'none');

if (!installed) warns.push('claude --version gave no version');
if (channel && !['stable', 'latest'].includes(channel)) warns.push(`autoUpdatesChannel "${channel}" is not "stable" or "latest"`);
if (floor && !parse(floor)) warns.push(`minimumVersion "${floor}" is not X.Y.Z`);
if (!channel) warns.push('no autoUpdatesChannel in user, project or local settings');

if (installed && parse(tags.stable) && parse(tags.latest)) {
  const between = Object.keys(time)
    .filter((v) => parse(v) && cmp(v, tags.stable) > 0 && cmp(v, tags.latest) <= 0)
    .sort(cmp);
  line('gap', `${between.length} release(s) on latest since stable${between.length ? `: ${between[0]} … ${between.at(-1)}` : ''}`);
  const want = (channel ?? 'latest') === 'stable' ? tags.stable : tags.latest;
  const d = cmp(installed, want);
  if (d < 0) warns.push(`installed ${installed} is behind the ${channel ?? 'latest'} tag (${want}): run claude update`);
  if (d > 0 && channel === 'stable') {
    if (floor && parse(floor) && cmp(floor, installed) <= 0) line('note', `ahead of stable; minimumVersion ${floor} keeps updates from going back below it`);
    else warns.push(`installed ${installed} is ahead of stable ${tags.stable} and no minimumVersion ≤ ${installed} is set`);
  }
  if (floor && parse(floor) && cmp(installed, floor) < 0) warns.push(`installed ${installed} is below minimumVersion ${floor}`);
}

for (const w of warns) console.log(`WARN   ${w}`);
console.log(`cc-channel: ${warns.length ? `${warns.length} warning(s)` : 'ok'}`);
process.exit(strict && warns.length ? 1 : 0);
