#!/usr/bin/env node
// Tests plugins/lab-watch/scripts/php-watch.mjs against a throwaway copy of a PHP host.
//   npm run -s watch:test      (uses port 8094; needs php on PATH; no API key)
// Exit 0 when every check prints "ok", 1 if any prints "FAIL".
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const watcher = resolve('plugins/lab-watch/scripts/php-watch.mjs');
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'php-watch-')));
const root = join(dir, 'php');
mkdirSync(join(root, 'public'), { recursive: true });
mkdirSync(join(root, 'lib'));
writeFileSync(join(root, 'lib', 'greet.php'), "<?php\nfunction greet(string $w): string { return \"Hej $w\"; }\n");
writeFileSync(join(root, 'public', 'index.php'), "<?php\nrequire __DIR__ . '/../lib/greet.php';\necho greet('Halmstad');\n");
writeFileSync(join(root, 'public', 'about.php'), "<?php\necho 'about';\n");

let failed = false;
const check = (ok, what, detail = '') => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  (${detail})` : ''}`);
	if (!ok) failed = true;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// claude plugin validate (2.1.310) accepts unknown keys in monitors.json, but Claude Code
// refuses to load such an entry, so check the keys here.
const ALLOWED = new Set(['name', 'command', 'description', 'when']);
const monitors = JSON.parse(readFileSync('plugins/lab-watch/monitors/monitors.json', 'utf8'));
const bad = monitors.flatMap((m) => Object.keys(m).filter((k) => !ALLOWED.has(k)));
check(Array.isArray(monitors) && monitors.every((m) => m.name && m.command && m.description) && bad.length === 0,
	'monitors.json has only name, command, description and when', bad.length ? `unknown: ${bad.join(', ')}` : `${monitors.length} monitor(s)`);

const lines = [];
const child = spawn('node', [watcher, root, '8094'], { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] });
child.stdout.setEncoding('utf8');
child.stdout.on('data', (d) => lines.push(...d.split('\n').filter(Boolean)));
// Wait until `count` new lines have arrived since `from`, or `ms` pass.
async function next(from, count = 1, ms = 4000) {
	for (let t = 0; t < ms && lines.length < from + count; t += 50) await sleep(50);
	return lines.slice(from);
}

try {
	let got = await next(0);
	check(got.length === 1 && /watching 3 PHP files in php, 2 pages; all clean/.test(got[0]), 'one start line, all clean', got[0]);

	let n = lines.length;
	writeFileSync(join(root, 'public', 'about.php'), "<?php\necho 'about'\necho 'x';\n");
	got = await next(n);
	check(got.length === 1 && /^php-watch: BROKEN php\/public\/about\.php: (PHP )?Parse error: .*line 3/.test(got[0]), 'syntax error: one BROKEN line with the line number', got[0]);

	n = lines.length;
	writeFileSync(join(root, 'public', 'about.php'), "<?php\necho 'about';\n");
	got = await next(n);
	check(got.length === 1 && /FIXED php\/public\/about\.php/.test(got[0]), 'fixed: one FIXED line', got[0]);

	n = lines.length;
	writeFileSync(join(root, 'lib', 'greet.php'), "<?php\nfunction greet(string $w): string { return \"Hej $w$suffix\"; }\n");
	got = await next(n);
	check(got.length === 1 && /ERROR GET \/index\.php → 200: Warning: Undefined variable \$suffix in lib\/greet\.php on line 2/.test(got[0]),
		'a warning from an included file is reported on the page that hit it', got[0]);

	n = lines.length;
	writeFileSync(join(root, 'lib', 'greet.php'), "<?php\nfunction greet(string $w): string { return \"Hej $w\"; }\n");
	writeFileSync(join(root, 'public', 'about.php'), "<?php\nnope();\n");
	got = await next(n, 2);
	check(got.length === 2 && got.some((l) => /OK GET \/index\.php → 200/.test(l)) &&
		got.some((l) => /ERROR GET \/about\.php → 500: Fatal error: Uncaught Error: Call to undefined function nope\(\)/.test(l)),
		'two changes in one save: index recovers, about fails with a 500', got.join(' / '));

	n = lines.length;
	writeFileSync(join(root, 'public', 'about.php'), "<?php\nnope();\n// same error, new comment\n");
	got = await next(n, 1, 1500);
	check(got.length === 0, 'the same error again prints nothing', got.join(' / '));

	n = lines.length;
	unlinkSync(join(root, 'public', 'about.php'));
	writeFileSync(join(root, 'notes.txt'), 'not php');
	got = await next(n, 1, 1500);
	check(got.length === 0, 'deleting a page or saving a non-PHP file prints nothing', got.join(' / '));
} catch (e) {
	check(false, 'test crashed', e.message);
} finally {
	child.kill('SIGTERM');
	await sleep(300);
	rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? 'watch-test: FAILED' : 'watch-test: all passed');
process.exit(failed ? 1 : 0);