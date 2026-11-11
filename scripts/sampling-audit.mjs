#!/usr/bin/env node
// Finds Claude calls whose text may not carry Anthropic's text watermark.
// WARN   temperature/top_p/top_k set near claude-sonnet-4-6 (the docs say the mark may be missing)
// CHECK  temperature/top_p/top_k set with no Claude model id within 25 lines
// NOMARK a model id that had no text watermark as of 2026-11-03
// Usage: node scripts/sampling-audit.mjs [--strict] [path ...]   (default: src hosts tools scripts)
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const roots = args.filter((a) => !a.startsWith('--'));
const paths = roots.length ? roots : ['src', 'hosts', 'tools', 'scripts'].filter((p) => existsSync(p));

const EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.svelte', '.php', '.py']);
const SKIP = new Set(['node_modules', 'vendor', '.svelte-kit', 'build', 'dist', '.git', 'fixtures']);
const WINDOW = 25;

// Text watermark per the support article and the Nov 3 release note.
const MARKED = new Set([
	'fable-5-1', 'fable-5', 'mythos-5-1', 'mythos-5', 'opus-5-5', 'opus-5', 'opus-4-8',
	'opus-4-7', 'sonnet-5-5', 'sonnet-5', 'sonnet-4-6', 'haiku-5-5'
]);
const SAMPLING_SENSITIVE = new Set(['sonnet-4-6']);

const MODEL_RE = /claude-((?:opus|sonnet|haiku|mythos|fable)-\d+(?:[-.]\d{1,2}(?!\d))?|3(?:-[57])?-(?:opus|sonnet|haiku))(?:-\d{8})?/g;
const PARAM_RE = /["']?\b(temperature|top_p|top_k|topP|topK)\b["']?\s*(?::|=>|=)\s*(-?[\d.]+|[A-Za-z_$][\w.$]*)/g;

function* walk(p) {
	const st = statSync(p);
	if (st.isFile()) {
		if (EXT.has(extname(p))) yield p;
		return;
	}
	for (const name of readdirSync(p)) {
		if (SKIP.has(name)) continue;
		yield* walk(join(p, name));
	}
}

const out = [];
let files = 0;
for (const root of paths) {
	for (const file of walk(root)) {
		if (basename(file).startsWith('sampling-audit')) continue; // this script and its test
		files++;
		const lines = readFileSync(file, 'utf8').split('\n');
		const models = [];
		lines.forEach((line, i) => {
			for (const m of line.matchAll(MODEL_RE)) models.push({ line: i, id: m[1].replace('.', '-') });
		});
		const rel = relative(process.cwd(), file) || file;
		for (const m of models) {
			if (!MARKED.has(m.id)) {
				out.push({ kind: 'NOMARK', at: `${rel}:${m.line + 1}`, text: `claude-${m.id} has no text watermark yet (as of Nov 3)` });
			}
		}
		lines.forEach((line, i) => {
			for (const p of line.matchAll(PARAM_RE)) {
				const near = models
					.filter((m) => Math.abs(m.line - i) <= WINDOW)
					.sort((a, b) => Math.abs(a.line - i) - Math.abs(b.line - i))[0];
				const what = `${p[1]} = ${p[2]}`;
				if (!near) {
					out.push({ kind: 'CHECK', at: `${rel}:${i + 1}`, text: `${what}, no Claude model id within ${WINDOW} lines` });
				} else if (SAMPLING_SENSITIVE.has(near.id)) {
					out.push({ kind: 'WARN', at: `${rel}:${i + 1}`, text: `${what} with claude-${near.id}: the watermark may be missing` });
				}
			}
		});
	}
}

const order = { WARN: 0, CHECK: 1, NOMARK: 2 };
out.sort((a, b) => order[a.kind] - order[b.kind] || a.at.localeCompare(b.at, 'en', { numeric: true }));
for (const o of out) console.log(`${o.kind.padEnd(6)} ${o.at}  ${o.text}`);
const n = (k) => out.filter((o) => o.kind === k).length;
console.log(`sampling-audit: ${files} file(s), ${n('WARN')} warn, ${n('CHECK')} check, ${n('NOMARK')} nomark`);
process.exit(strict && n('WARN') + n('CHECK') > 0 ? 1 : 0);
