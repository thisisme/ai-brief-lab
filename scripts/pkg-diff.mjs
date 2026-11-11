#!/usr/bin/env node
// pkg-diff: compare what npm actually ships between two versions of a package.
// Usage: node scripts/pkg-diff.mjs <package> [from] [to] [--full]
//   from defaults to the version installed in node_modules, to defaults to npm's latest.
// Writes the unified diff to node_modules/.cache/pkg-diff/ (already git-ignored) and prints a summary.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const full = process.argv.includes('--full');
const [pkg, fromArg, toArg] = args;
if (!pkg) {
	console.error('usage: node scripts/pkg-diff.mjs <package> [from] [to] [--full]');
	process.exit(2);
}

const npm = (...a) => execFileSync('npm', a, { encoding: 'utf8' }).trim();
const installedPath = join('node_modules', pkg, 'package.json');
const from =
	fromArg ?? (existsSync(installedPath) ? JSON.parse(readFileSync(installedPath, 'utf8')).version : null);
const to = toArg ?? npm('view', pkg, 'version');
if (!from) {
	console.error(`pkg-diff: ${pkg} is not installed here; pass a from version`);
	process.exit(2);
}
if (from === to) {
	console.log(`pkg-diff: ${pkg} ${from} is already the latest`);
	process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), 'pkg-diff-'));
function unpack(version) {
	const dir = join(work, version);
	mkdirSync(dir);
	const file = npm('pack', `${pkg}@${version}`, '--pack-destination', dir, '--silent').split('\n').pop();
	execFileSync('tar', ['xzf', join(dir, file), '-C', dir]);
	return join(dir, 'package');
}
const a = unpack(from);
const b = unpack(to);
// compare src/ when the package ships its source, otherwise the whole package
const sub = existsSync(join(a, 'src')) && existsSync(join(b, 'src')) && !full ? 'src' : '.';
const diff = spawnSync('diff', ['-ruN', join(a, sub), join(b, sub)], { encoding: 'utf8' }).stdout
	.split(a).join(`${from}`)
	.split(b).join(`${to}`);

const files = diff.split('\n').filter((l) => l.startsWith('diff -ruN')).length;
const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
const removed = diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
const WATCH =
	/secur|dos\b|o\(n|evil|origin|protocol-relative|sanitiz|escap|prototype|redirect|xss|untrusted|server-only|inject|traversal|cve|ghsa/i;
const watch = diff
	.split('\n')
	.filter((l) => l.startsWith('+') && !l.startsWith('+++') && WATCH.test(l))
	.map((l) => l.slice(1).trim())
	.filter((l, i, all) => l && all.indexOf(l) === i);

const cache = join('node_modules', '.cache', 'pkg-diff');
mkdirSync(cache, { recursive: true });
const out = join(cache, `${pkg.replace('/', '__').replace('@', '')}-${from}-${to}.diff`);
writeFileSync(out, diff);

console.log(`pkg-diff: ${pkg} ${from} -> ${to} (${sub === 'src' ? 'src/' : 'whole package'})`);
console.log(`  ${files} file(s) changed, +${added} -${removed} lines, diff saved to ${out}`);
console.log(`  ${watch.length} watch line(s):`);
for (const l of watch.slice(0, 15)) console.log(`    ${l.length > 110 ? l.slice(0, 107) + '...' : l}`);
if (watch.length > 15) console.log(`    ... ${watch.length - 15} more in ${out}`);
