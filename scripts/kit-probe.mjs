#!/usr/bin/env node
// kit-probe: build a throwaway SvelteKit app for one or more @sveltejs/kit versions,
// follow a crafted same-origin link with server-side route resolution, and count
// requests that leave the origin. Usage: node scripts/kit-probe.mjs [version ...] [--expect-clean]
// With no version it probes the @sveltejs/kit installed in this repo.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const versions = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (versions.length === 0) {
	versions.push(JSON.parse(readFileSync('node_modules/@sveltejs/kit/package.json', 'utf8')).version);
}
const PORT = 8091;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PROBE_HREF = '/.//evil.invalid/x'; // the URL parser turns this into pathname //evil.invalid/x

function scaffold(version) {
	const dir = join(tmpdir(), `kit-probe-${version}`);
	mkdirSync(join(dir, 'src/routes/[...rest]'), { recursive: true });
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify(
			{
				name: `kit-probe-${version.replace(/[^a-z0-9.-]/gi, '')}`,
				private: true,
				type: 'module',
				devDependencies: {
					'@sveltejs/kit': version,
					'@sveltejs/vite-plugin-svelte': '^7.2.0',
					svelte: '^5.57.1',
					vite: '^8.3.0'
				}
			},
			null,
			'\t'
		)
	);
	writeFileSync(
		join(dir, 'vite.config.js'),
		`import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
export default defineConfig({
	logLevel: 'error',
	plugins: [sveltekit({ router: { resolution: 'server' } })]
});
`
	);
	writeFileSync(
		join(dir, 'src/app.html'),
		`<!doctype html>
<html lang="en">
	<head><meta charset="utf-8" />%sveltekit.head%</head>
	<body data-sveltekit-preload-data="off"><div style="display: contents">%sveltekit.body%</div></body>
</html>
`
	);
	writeFileSync(
		join(dir, 'src/routes/+page.svelte'),
		`<h1>kit-probe</h1>\n<a id="probe" href="${PROBE_HREF}">probe</a>\n`
	);
	writeFileSync(join(dir, 'src/routes/[...rest]/+page.svelte'), `<p id="rest">catch-all</p>\n`);
	if (!existsSync(join(dir, 'node_modules/@sveltejs/kit'))) {
		execFileSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
			cwd: dir,
			stdio: 'inherit'
		});
	}
	const installed = JSON.parse(
		execFileSync('node', ['-p', "JSON.stringify(require('@sveltejs/kit/package.json').version)"], {
			cwd: dir
		}).toString()
	);
	return { dir, installed };
}

async function waitFor(url, ms = 30000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		try {
			const r = await fetch(url);
			if (r.ok) return;
		} catch {}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`dev server did not answer at ${url}`);
}

async function probe(version) {
	const { dir, installed } = scaffold(version);
	const server = spawn(
		'npx',
		['vite', 'dev', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
		{ cwd: dir, stdio: 'ignore', detached: true }
	);
	const browser = await chromium.launch(
		process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}
	);
	try {
		await waitFor(ORIGIN + '/');
		const page = await browser.newPage();
		const off = [];
		await page.route('**/*', (route) => {
			const u = new URL(route.request().url());
			if (u.origin !== ORIGIN) {
				off.push(u.href);
				return route.abort();
			}
			return route.continue();
		});
		await page.goto(ORIGIN + '/', { waitUntil: 'networkidle' });
		await page.click('#probe');
		await page.waitForTimeout(2000);
		const verdict = off.length === 0 ? 'OK  ' : 'LEAK';
		console.log(
			`${verdict} kit ${installed}: ${off.length} off-origin request(s)${off.length ? ' -> ' + off.join(', ') : ''}`
		);
		return off.length;
	} finally {
		await browser.close();
		try {
			process.kill(-server.pid);
		} catch {}
	}
}

let leaks = 0;
for (const v of versions) leaks += (await probe(v)) > 0 ? 1 : 0;
console.log(`kit-probe: ${versions.length} version(s), ${leaks} leaking`);
process.exit(leaks && process.argv.includes('--expect-clean') ? 1 : 0);
