#!/usr/bin/env node
// Feeds made-up prompts to .claude/hooks/prompt-guard.mjs and checks block/allow.
// All numbers below are invented test values, not real people.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hook = join(process.cwd(), '.claude/hooks/prompt-guard.mjs');
const project = mkdtempSync(join(tmpdir(), 'guard-'));
mkdirSync(join(project, '.claude'));

const cases = [
	['personnummer with dash', 'Why does user 19811218-9876 fail login?', true],
	['personnummer, 10 digits', 'Look up 8112189876 in the orders table', true],
	['samordningsnummer', 'Customer 701063-2391 has a refund', true],
	['skill call with personnummer', '/verify 811218-9876', true],
	['Anthropic key', 'Use sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345 in .env', true],
	['private key', '-----BEGIN OPENSSH PRIVATE KEY-----\nabc', true],
	['bad checksum', 'Order 19811218-9875 shipped', false],
	['masked', 'Why does user 19811218-XXXX fail login?', false],
	['order id', 'Order 2026-10-14-0042 is late', false],
	['timestamp that passes Luhn (known false positive)', 'Build 202610140630 failed', true],
	['timestamp that fails Luhn', 'Build 202610140631 failed', false],
	['plain prompt', 'Run the verify skill', false],
	['card with spaces', 'Charge 4111 1111 1111 1111 for the order', true],
	['card with dashes', 'Card 5500-0000-0000-0004 was declined', true],
	['card, 15 digits (Amex)', 'Refund 378282246310005 please', true],
	['card, 16 digits, bad Luhn', 'Charge 4111 1111 1111 1112 for the order', false],
	['12-digit number, too short for a card', 'Ticket 411111111111 is open', false],
	['email is noted, not blocked', 'Mail anna.test@example.com about the invoice', false, true],
	['email with card is blocked', 'anna.test@example.com paid with 4111111111111111', true],
	['@ without an address', 'Use the @loopon handle, not a@b', false]
];

let failed = 0;
for (const [name, prompt, shouldBlock, shouldNote = false] of cases) {
	const r = spawnSync('node', [hook], {
		input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt, cwd: project }),
		env: { ...process.env, CLAUDE_PROJECT_DIR: project },
		encoding: 'utf8'
	});
	const blocked = r.stdout.includes('"decision":"block"');
	const noted = r.stdout.includes('"additionalContext"') && !r.stdout.includes('@');
	const ok = r.status === 0 && blocked === shouldBlock && noted === shouldNote;
	if (!ok) failed++;
	const verdict = shouldBlock ? 'block' : shouldNote ? 'note ' : 'allow';
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${verdict}  ${name}`);
}

const log = join(project, '.claude/prompt-guard.log');
const lines = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
const leaked = lines.some((l) => /\d{6}[-+]?\d{4}|sk-ant-|@|(?:\d[ -]?){13}/.test(l));
console.log(`${leaked ? 'FAIL' : 'ok  '} log has ${lines.length} lines and no raw values`);
if (leaked) failed++;

console.log(failed ? `guard-test: ${failed} failed` : 'guard-test: all passed');
process.exit(failed ? 1 : 0);