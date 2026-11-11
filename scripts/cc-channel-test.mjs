#!/usr/bin/env node
// Offline test for scripts/cc-channel.mjs: no network, no claude binary needed.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'cc-channel.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'cc-channel-'));
const npmJson = join(tmp, 'npm.json');
// The npm tags and times as of Nov 9 2026 (2.1.313 was never published)
writeFileSync(npmJson, JSON.stringify({
  'dist-tags': { stable: '2.1.311', latest: '2.1.319', next: '2.1.319' },
  time: {
    created: '2025-02-24T00:00:00.000Z', modified: '2026-11-06T17:03:11.950Z',
    '2.1.310': '2026-10-23T21:20:46.540Z', '2.1.311': '2026-10-26T19:47:57.395Z',
    '2.1.312': '2026-10-27T18:36:10.160Z', '2.1.314': '2026-10-30T00:12:56.911Z',
    '2.1.315': '2026-10-30T21:05:24.080Z', '2.1.316': '2026-10-31T00:42:05.743Z',
    '2.1.317': '2026-11-02T23:57:53.069Z', '2.1.318': '2026-11-03T21:55:17.247Z',
    '2.1.319': '2026-11-06T00:58:56.366Z',
  },
}));

let n = 0;
function run(name, { user, project, local, installed = '2.1.319', strict = false }) {
  const dir = join(tmp, `case${++n}`);
  const home = join(dir, 'home'), root = join(dir, 'repo');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(root, '.claude'), { recursive: true });
  const put = (base, file, v) => v !== undefined && writeFileSync(join(base, '.claude', file), typeof v === 'string' ? v : JSON.stringify(v));
  put(home, 'settings.json', user); put(root, 'settings.json', project); put(root, 'settings.local.json', local);
  const a = [script, '--root', root, '--home', home, '--installed', installed, '--npm-json', npmJson];
  if (strict) a.push('--strict');
  const r = spawnSync(process.execPath, a, { encoding: 'utf8' });
  return { name, out: r.stdout + r.stderr, code: r.status };
}

const cases = [
  [run('no channel set: warns, exit 0', {}), (r) => /WARN   no autoUpdatesChannel/.test(r.out) && /channel    not set, so latest/.test(r.out) && r.code === 0],
  [run('no channel set with --strict: exit 1', { strict: true }), (r) => r.code === 1],
  [run('stable ahead of the tag with no floor: warns', { project: { autoUpdatesChannel: 'stable' } }), (r) => /ahead of stable 2\.1\.311 and no minimumVersion/.test(r.out)],
  [run('stable with minimumVersion 2.1.319: ok', { project: { autoUpdatesChannel: 'stable', minimumVersion: '2.1.319' }, strict: true }), (r) => /cc-channel: ok/.test(r.out) && r.code === 0],
  [run('gap counts 7 releases, skipping 2.1.313', { project: { autoUpdatesChannel: 'stable', minimumVersion: '2.1.319' } }), (r) => /gap        7 release\(s\) on latest since stable: 2\.1\.312 … 2\.1\.319/.test(r.out)],
  [run('local settings beat project settings', { project: { autoUpdatesChannel: 'stable' }, local: { autoUpdatesChannel: 'latest' } }), (r) => /channel    latest \(from local settings\)/.test(r.out)],
  [run('project settings beat user settings', { user: { autoUpdatesChannel: 'latest' }, project: { autoUpdatesChannel: 'stable', minimumVersion: '2.1.319' } }), (r) => /channel    stable \(from project settings\)/.test(r.out)],
  [run('latest channel, installed 2.1.317: behind', { user: { autoUpdatesChannel: 'latest' }, installed: '2.1.317' }), (r) => /behind the latest tag \(2\.1\.319\)/.test(r.out)],
  [run('installed below minimumVersion: warns', { project: { autoUpdatesChannel: 'stable', minimumVersion: '2.1.318' }, installed: '2.1.311' }), (r) => /below minimumVersion 2\.1\.318/.test(r.out)],
  [run('unknown channel name: warns', { project: { autoUpdatesChannel: 'beta' } }), (r) => /"beta" is not "stable" or "latest"/.test(r.out)],
  [run('broken settings JSON: warns, keeps going', { project: '{ "autoUpdatesChannel": ', user: { autoUpdatesChannel: 'stable', minimumVersion: '2.1.319' } }), (r) => /not valid JSON/.test(r.out) && /from user settings/.test(r.out)],
];

let failed = 0;
for (const [r, ok] of cases) {
  const pass = ok(r);
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${r.name}`);
  if (!pass) console.log(r.out.replace(/^/gm, '     '));
}
rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `cc-channel-test: ${failed} failed` : 'cc-channel-test: all passed');
process.exit(failed ? 1 : 0);
