#!/usr/bin/env node
// Runs scripts/sampling-audit.mjs against a throwaway folder with known calls.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const audit = join(dirname(fileURLToPath(import.meta.url)), 'sampling-audit.mjs');
const dir = mkdtempSync(join(tmpdir(), 'sampling-audit-'));
const put = (rel, text) => {
	mkdirSync(dirname(join(dir, rel)), { recursive: true });
	writeFileSync(join(dir, rel), text);
};

put('src/summary.ts', `const msg = await client.messages.create({
	model: 'claude-sonnet-4-6',
	max_tokens: 512,
	temperature: 0.2,
	messages
});\n`);
put('hosts/php/reply.php', `<?php
$body = [
    'model' => 'claude-sonnet-4-6',
    'top_k' => 40,
    'messages' => $messages,
];\n`);
put('src/chat.ts', `const r = await client.messages.create({ model: 'claude-opus-5-5', temperature: 1, max_tokens: 64, messages });\n`);
put('src/wrapper.js', `export function ask(messages, opts) {\n\treturn post({ ...opts, top_p: opts.topP ?? 0.9, messages });\n}\n`);
put('scripts/old.mjs', `const MODEL = 'claude-haiku-4-5-20251001';\n`);
put('src/legacy.py', `client.messages.create(model="claude-3-5-sonnet-20241022", max_tokens=100, messages=m)\n`);
put('src/node_modules/x/index.js', `({ model: 'claude-sonnet-4-6', temperature: 0 })\n`);
put('clean/ok.ts', `await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 64, messages });\n`);

const run = (...a) => spawnSync(process.execPath, [audit, ...a], { cwd: dir, encoding: 'utf8' });
let failed = 0;
const check = (name, cond) => {
	console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
	if (!cond) failed++;
};

const all = run('src', 'hosts', 'scripts');
const o = all.stdout;
check('temperature next to claude-sonnet-4-6 is a WARN', /^WARN\s+src\/summary\.ts:4 .*temperature = 0\.2/m.test(o));
check("PHP 'top_k' => 40 next to claude-sonnet-4-6 is a WARN", /^WARN\s+hosts\/php\/reply\.php:4 .*top_k = 40/m.test(o));
check('temperature with claude-opus-5-5 is not reported', !o.includes('src/chat.ts'));
check('top_p with no model id nearby is a CHECK', /^CHECK\s+src\/wrapper\.js:2 .*top_p = opts\.topP/m.test(o));
check('claude-haiku-4-5 (dated id) is a NOMARK', /^NOMARK\s+scripts\/old\.mjs:1 .*claude-haiku-4-5 /m.test(o));
check('claude-3-5-sonnet is a NOMARK', /^NOMARK\s+src\/legacy\.py:1 .*claude-3-5-sonnet /m.test(o));
check('node_modules is skipped', !o.includes('node_modules'));
check('summary line counts 6 files, 2 warn, 1 check, 2 nomark', /sampling-audit: 6 file\(s\), 2 warn, 1 check, 2 nomark$/m.test(o));
check('without --strict it exits 0', all.status === 0);
check('--strict exits 1 when there is a WARN or CHECK', run('--strict', 'src').status === 1);
const clean = run('--strict', 'clean');
check('a call without sampling params passes --strict', clean.status === 0 && clean.stdout.includes('0 warn, 0 check, 0 nomark'));

rmSync(dir, { recursive: true, force: true });
console.log(failed ? `sampling-audit-test: ${failed} failed` : 'sampling-audit-test: all passed');
process.exit(failed ? 1 : 0);
