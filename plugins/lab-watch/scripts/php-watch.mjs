#!/usr/bin/env node
// Watches the PHP host and prints one line each time a page breaks or recovers.
// Run by the lab-watch plugin's monitor, so every line it prints reaches Claude
// as a notification. It stays silent while nothing changes.
//
//   node plugins/lab-watch/scripts/php-watch.mjs [php-root] [port]
//   defaults: hosts/php and 8095 (its own private server, not elements:serve)
//
// On every change to a .php file under php-root it:
//   1. runs php -l on that file (syntax errors)
//   2. GETs every page under php-root/public from its own php -S, started with
//      error_reporting=E_ALL, and reads the warnings, notices and fatals the
//      server logs for each request.
// Only GET requests are checked; POST handlers and pages that need a session are not.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, statSync, watch } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const say = (msg) => console.log(`php-watch: ${msg}`);
const arg = resolve(process.argv[2] ?? 'hosts/php');
const port = Number(process.argv[3] ?? 8095);
if (!existsSync(join(arg, 'public'))) {
	say(`no ${join(arg, 'public')} folder, nothing to watch`);
	process.exit(1);
}
// Real paths, so macOS /var -> /private/var symlinks don't change what we print.
const root = realpathSync(arg);
const pub = join(root, 'public');

const phpFiles = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		if (e.isDirectory()) return e.name === 'build' || e.name === 'vendor' ? [] : phpFiles(p);
		return e.name.endsWith('.php') ? [p] : [];
	});
const rel = (p) => relative(process.cwd(), p);

// --- the private server -------------------------------------------------------
let log = '';
const server = spawn(
	'php',
	['-d', 'error_reporting=E_ALL', '-d', 'display_errors=0', '-d', 'log_errors=1',
	 '-S', `127.0.0.1:${port}`, '-t', pub],
	{ stdio: ['ignore', 'ignore', 'pipe'] }
);
server.stderr.setEncoding('utf8');
server.stderr.on('data', (d) => (log += d));
server.on('exit', (code) => {
	say(`private PHP server on port ${port} stopped (exit ${code}); is the port taken?`);
	process.exit(1);
});
const stop = () => { server.removeAllListeners('exit'); server.kill(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('SIGHUP', stop);

// PHP's log lines look like "[Mon Oct 26 ...] PHP Warning:  Undefined variable $x in /…/a.php on line 2".
const ERR = /PHP (Parse error|Fatal error|Warning|Notice|Deprecated|Recoverable fatal error):\s+(.*)$/;
function problems(text) {
	const out = [];
	for (const line of text.split('\n')) {
		const m = line.match(ERR);
		if (m) out.push(`${m[1]}: ${m[2].replace(root + '/', '').trim()}`);
	}
	return [...new Set(out)];
}

async function getPage(file) {
	const path = '/' + relative(pub, file).split('\\').join('/');
	const before = log.length;
	let status = 0;
	try {
		const res = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' });
		status = res.status;
		await res.text();
	} catch (e) {
		return { path, status: 0, errs: [`request failed: ${e.cause?.code ?? e.message}`] };
	}
	await new Promise((r) => setTimeout(r, 50)); // let the log line arrive
	const errs = problems(log.slice(before));
	log = log.slice(-20000);
	if (status >= 500 && errs.length === 0) errs.push(`HTTP ${status} with nothing in the log`);
	return { path, status, errs };
}

// --- state: print only what changed --------------------------------------------
const lintState = new Map(); // file -> error text or ''
const pageState = new Map(); // path -> joined errors or ''

function lint(file, report) {
	const r = spawnSync('php', ['-l', '-d', 'display_errors=1', file], { encoding: 'utf8' });
	const err = r.status === 0 ? '' : (r.stdout + r.stderr).split('\n').find((l) => /error/i.test(l))?.trim() ?? 'php -l failed';
	const was = lintState.get(file) ?? '';
	lintState.set(file, err);
	if (!report) return err;
	if (err && err !== was) say(`BROKEN ${rel(file)}: ${err.replace(root + '/', '')}`);
	if (!err && was) say(`FIXED ${rel(file)} (php -l passes again)`);
	return err;
}

async function checkPages(quiet) {
	for (const file of phpFiles(pub)) {
		if (lintState.get(file)) continue; // a syntax error is already reported
		const { path, status, errs } = await getPage(file);
		const now = errs.join(' | ');
		const was = pageState.get(path);
		pageState.set(path, now);
		if (quiet) continue;
		if (now && now !== was) say(`ERROR GET ${path} → ${status || 'no response'}: ${now}`);
		if (!now && was) say(`OK GET ${path} → ${status}, no warnings`);
	}
	for (const path of pageState.keys()) {
		if (!existsSync(join(pub, path))) pageState.delete(path);
	}
}

// --- start ---------------------------------------------------------------------
for (let i = 0; i < 40; i++) {
	try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
}
for (const f of phpFiles(root)) lint(f, false);
await checkPages(true);
const broken = [...lintState.values()].filter(Boolean).length + [...pageState.values()].filter(Boolean).length;
say(`watching ${lintState.size} PHP files in ${rel(root)}, ${pageState.size} pages; ${broken ? `${broken} already failing: ` +
	[...lintState].filter(([, e]) => e).map(([f]) => rel(f)).concat([...pageState].filter(([, e]) => e).map(([p]) => p)).join(', ') : 'all clean'}`);

let timer = null;
const changed = new Set();
watch(root, { recursive: true }, (_event, name) => {
	if (!name || !name.endsWith('.php')) return;
	changed.add(join(root, name));
	clearTimeout(timer);
	timer = setTimeout(async () => {
		const files = [...changed];
		changed.clear();
		for (const f of files) {
			if (existsSync(f) && statSync(f).isFile()) lint(f, true);
			else lintState.delete(f);
		}
		await checkPages(false);
	}, 300);
});