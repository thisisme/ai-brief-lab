#!/usr/bin/env node
// UserPromptSubmit hook: stop a prompt before it leaves the machine when it
// contains a Swedish personal identity number or a secret.
// Since Claude Code 2.1.299 this runs before a skill or slash command expands,
// so a blocked "/verify <something>" never runs the skill's !`shell` lines either.
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const prompt = String(input.prompt ?? '');

// Luhn over the 10-digit form YYMMDDNNNC.
function luhnOk(ten) {
	let sum = 0;
	for (let i = 0; i < 10; i++) {
		let d = Number(ten[i]) * (i % 2 === 0 ? 2 : 1);
		if (d > 9) d -= 9;
		sum += d;
	}
	return sum % 10 === 0;
}

function personnummer(text) {
	const re = /(?<![\d-])(?:19|20)?(\d{2})(\d{2})(\d{2})[-+]?(\d{4})(?![\d-])/g;
	for (const m of text.matchAll(re)) {
		const [, yy, mm, dd, last4] = m;
		const month = Number(mm);
		const day = Number(dd);
		// Day 61–91 is a samordningsnummer (coordination number).
		const dayOk = (day >= 1 && day <= 31) || (day >= 61 && day <= 91);
		if (month >= 1 && month <= 12 && dayOk && luhnOk(yy + mm + dd + last4)) return true;
	}
	return false;
}

// 13–19 digits, single spaces or dashes between them, Luhn-valid.
function cardNumber(text) {
	const re = /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g;
	for (const m of text.matchAll(re)) {
		const digits = m[0].replace(/\D/g, '');
		let sum = 0;
		for (let i = 0; i < digits.length; i++) {
			let d = Number(digits[digits.length - 1 - i]);
			if (i % 2 === 1) {
				d *= 2;
				if (d > 9) d -= 9;
			}
			sum += d;
		}
		if (sum % 10 === 0) return true;
	}
	return false;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

const SECRETS = [
	['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
	['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
	['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
	['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/]
];

const found = [];
if (personnummer(prompt)) found.push('Swedish personal identity number');
if (cardNumber(prompt)) found.push('payment card number');
for (const [name, re] of SECRETS) if (re.test(prompt)) found.push(name);

const hasEmail = EMAIL.test(prompt);

if (found.length === 0 && !hasEmail) process.exit(0);

// Log what kind of thing was caught, never the value itself.
const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
try {
	const kind = prompt.startsWith('/') ? 'command' : 'prompt';
	const what = found.length ? found.join(', ') : 'email address (note only)';
	appendFileSync(
		join(dir, '.claude', 'prompt-guard.log'),
		`${new Date().toISOString()}\t${kind}\t${what}\n`
	);
} catch {
	// Logging is best effort; the block or note below still happens.
}

if (found.length === 0) {
	// Not blocked: just tell Claude not to spread the address around.
	process.stdout.write(
		JSON.stringify({
			hookSpecificOutput: {
				hookEventName: 'UserPromptSubmit',
				additionalContext:
					'prompt-guard: the prompt contains an email address. Do not copy it into code, logs or commits.'
			}
		})
	);
	process.exit(0);
}

process.stdout.write(
	JSON.stringify({
		decision: 'block',
		reason: `prompt-guard: this prompt contains a ${found.join(' and a ')}. Nothing was sent. Remove or mask it (e.g. 19811218-XXXX) and try again.`
	})
);