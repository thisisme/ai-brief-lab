#!/usr/bin/env node
// What a screen reader gets from each PHP page, with JavaScript on and off.
//   node scripts/aria-snap.mjs            compare with tests/aria/*.yml, lint, exit 1 on a problem
//   node scripts/aria-snap.mjs --update   write the current snapshots as the new baselines
//   node scripts/aria-snap.mjs --print stepper.php   print both snapshots of one page, change nothing
//   --root <dir> and --baselines <dir> point it elsewhere (the test uses them). Port 8093.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const root = resolve(opt('--root', 'hosts/php/public'));
const baseDir = resolve(opt('--baselines', 'tests/aria'));
const update = args.includes('--update');
const only = opt('--print', null);
const port = 8093;

// Roles a user operates. A line like "- button [disabled]" or "- spinbutton: "0"" has no name.
const CONTROLS = 'button|link|textbox|searchbox|spinbutton|checkbox|radio|switch|combobox|listbox|slider|tab|menuitem|option';
const CONTROL_LINE = new RegExp(`^\\s*- '?(${CONTROLS})\\b(?: "((?:[^"\\\\]|\\\\.)*)")?`);

const pages = readdirSync(root).filter((f) => f.endsWith('.php') && (!only || f === only)).sort();
if (!pages.length) {
	console.log(`aria-snap: no .php pages in ${root}${only ? ` named ${only}` : ''}`);
	process.exit(1);
}
if (!existsSync(join(root, 'build/elements.js'))) {
	console.log('FAIL build/elements.js is missing: run npm run elements:build first');
	process.exit(1);
}

const server = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', root], { stdio: 'ignore' });
const stop = () => server.kill();
process.on('exit', stop);
for (let i = 0; i < 50; i++) {
	try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
}

let browser;
try {
	browser = await chromium.launch();
} catch {
	browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}

async function snapshot(page, js) {
	const ctx = await browser.newContext({ javaScriptEnabled: js });
	const tab = await ctx.newPage();
	const errors = [];
	tab.on('pageerror', (e) => errors.push(e.message));
	const res = await tab.goto(`http://127.0.0.1:${port}/${page}`);
	let undefinedTags = [];
	if (js) {
		// Wait until every custom element on the page is defined and has rendered.
		undefinedTags = await tab.evaluate(async () => {
			const tags = [...new Set([...document.querySelectorAll('*')].map((e) => e.localName).filter((n) => n.includes('-')))];
			const timeout = new Promise((r) => setTimeout(r, 5000, 'timeout'));
			const missing = [];
			for (const t of tags) if ((await Promise.race([customElements.whenDefined(t), timeout])) === 'timeout') missing.push(t);
			await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
			return missing;
		});
	}
	const yaml = await tab.locator('body').ariaSnapshot();
	await ctx.close();
	return { yaml: yaml.trimEnd() + '\n', status: res.status(), errors, undefinedTags };
}

function controls(yaml) {
	const out = [];
	for (const line of yaml.split('\n')) {
		const m = line.match(CONTROL_LINE);
		if (m) out.push({ role: m[1], name: m[2] ?? null, line: line.trim() });
	}
	return out;
}

let problems = 0;
const fail = (msg) => { problems++; console.log(`FAIL ${msg}`); };
const ok = (msg) => console.log(`ok   ${msg}`);
if (update) mkdirSync(baseDir, { recursive: true });

for (const page of pages) {
	const snaps = { nojs: await snapshot(page, false), js: await snapshot(page, true) };
	if (only) {
		for (const [mode, s] of Object.entries(snaps)) console.log(`--- ${page} (${mode})\n${s.yaml}`);
		continue;
	}
	for (const [mode, s] of Object.entries(snaps)) {
		const label = `${page} (${mode})`;
		if (s.status >= 400) fail(`${label}: HTTP ${s.status}`);
		for (const e of s.errors) fail(`${label}: script error: ${e}`);
		for (const t of s.undefinedTags) fail(`${label}: <${t}> was never defined`);
		for (const c of controls(s.yaml)) {
			if (c.name === null || c.name.trim() === '') fail(`${label}: ${c.role} with no accessible name: ${c.line}`);
			else if (!/[\p{L}\p{N}]/u.test(c.name)) fail(`${label}: ${c.role} named only by a symbol: ${c.line}`);
		}
		const file = join(baseDir, `${page.replace(/\.php$/, '')}.${mode}.yml`);
		if (update) {
			writeFileSync(file, s.yaml);
			ok(`${label}: baseline written`);
		} else if (!existsSync(file)) {
			fail(`${label}: no baseline; run npm run -s aria:snap -- --update`);
		} else {
			const before = readFileSync(file, 'utf8');
			if (before === s.yaml) ok(`${label}: matches baseline`);
			else {
				const was = new Set(before.split('\n'));
				const now = new Set(s.yaml.split('\n'));
				const diff = [...[...was].filter((l) => l && !now.has(l)).map((l) => `      - ${l}`),
					...[...now].filter((l) => l && !was.has(l)).map((l) => `      + ${l}`)];
				fail(`${label}: changed since the baseline\n${diff.join('\n')}`);
			}
		}
	}
	// Enhancement may add controls, never take one away or rename it.
	const upgraded = new Set(controls(snaps.js.yaml).map((c) => `${c.role} "${c.name}"`));
	const lost = controls(snaps.nojs.yaml).filter((c) => c.name !== null && !upgraded.has(`${c.role} "${c.name}"`));
	for (const c of lost) fail(`${page}: ${c.role} "${c.name}" works without JavaScript but is gone once elements upgrade`);
	if (!lost.length) ok(`${page}: every control from the no-JS page survives the upgrade`);
}

await browser.close();
if (!only) console.log(problems ? `aria-snap: ${problems} problem(s)` : `aria-snap: all passed (${pages.length} page(s))`);
process.exit(problems ? 1 : 0);