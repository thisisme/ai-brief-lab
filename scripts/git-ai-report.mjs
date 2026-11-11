#!/usr/bin/env node
// Weekly share of commits that carry Claude Code's commit trailer, and how many
// of them were reverted soon after. Reads only git history and settings files.
// Authors are counted in memory and never printed; a week with fewer than
// --min-people authors is shown as suppressed.
//
// usage: node scripts/git-ai-report.mjs [--repo DIR] [--ref REF] [--weeks N]
//          [--min-people N] [--revert-days N] [--trailer REGEX]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? fallback : args[i + 1];
};
const repo = resolve(opt('repo', '.'));
const ref = opt('ref', 'HEAD');
const weeks = Number(opt('weeks', '8'));
const minPeople = Number(opt('min-people', '3'));
const revertDays = Number(opt('revert-days', '14'));
// Claude Code's default trailer is "Co-Authored-By: <model name> <noreply@anthropic.com>".
// GitHub squash merges write "Co-authored-by:", so the match ignores case.
const trailer = new RegExp(
	opt('trailer', '^co-authored-by:\\s*claude\\b[^\\n]*<noreply@anthropic\\.com>\\s*$'),
	'im'
);

// 1. Settings that hide or change the trailer make the numbers wrong, so say so first.
const settingsFiles = [
	join(repo, '.claude', 'settings.json'),
	join(repo, '.claude', 'settings.local.json'),
	join(homedir(), '.claude', 'settings.json')
];
let warnings = 0;
for (const file of settingsFiles) {
	if (!existsSync(file)) continue;
	let s;
	try {
		s = JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		console.log(`warning: ${file} is not valid JSON; Claude Code skips it`);
		warnings++;
		continue;
	}
	const a = s.attribution;
	let why = '';
	if (a === false) why = 'attribution is false';
	else if (a && typeof a === 'object' && a.commit === '') why = 'attribution.commit is ""';
	else if (a && typeof a === 'object' && typeof a.commit === 'string' && !trailer.test(a.commit))
		why = 'attribution.commit is custom text this report does not match (pass --trailer)';
	else if (a === undefined && s.includeCoAuthoredBy === false) why = 'includeCoAuthoredBy is false';
	if (why) {
		console.log(`warning: ${file}: ${why}, so this report can't count Claude's commits made with it`);
		warnings++;
	}
}

// 2. Read history: one record per non-merge commit reachable from REF.
const SEP = '\x1e';
const FS = '\x1f';
let raw;
try {
	raw = execFileSync(
		'git',
		['-C', repo, 'log', ref, '--no-merges', `--format=%H${FS}%cI${FS}%ae${FS}%B${SEP}`],
		{ encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
	);
} catch {
	console.log(`git-ai-report: cannot read git history of ${repo} at ${ref}`);
	process.exit(2);
}
const commits = raw
	.split(SEP)
	.map((r) => r.replace(/^\n/, ''))
	.filter(Boolean)
	.map((r) => {
		const [sha, date, email, body] = r.split(FS);
		return { sha, when: new Date(date), person: hash(email.toLowerCase()), body };
	});

// A revert made with `git revert` says "This reverts commit <sha>." in its body.
const revertedAt = new Map();
for (const c of commits) {
	for (const m of c.body.matchAll(/This reverts commit ([0-9a-f]{7,40})/g)) {
		const prev = revertedAt.get(m[1]);
		if (!prev || c.when < prev) revertedAt.set(m[1], c.when);
	}
}
const revertedSoon = (c) => {
	for (const [sha, when] of revertedAt) {
		if (c.sha.startsWith(sha) && (when - c.when) / 86400000 <= revertDays) return true;
	}
	return false;
};

// 3. Group by ISO week of the commit date (UTC).
const byWeek = new Map();
for (const c of commits) {
	const wk = isoWeek(c.when);
	if (!byWeek.has(wk)) byWeek.set(wk, { people: new Set(), all: 0, claude: 0, revClaude: 0, revOther: 0 });
	const w = byWeek.get(wk);
	const isClaude = trailer.test(c.body);
	const isRevert = /This reverts commit [0-9a-f]{7,40}/.test(c.body);
	w.people.add(c.person);
	if (isRevert) continue; // reverts themselves are not counted as work
	w.all++;
	if (isClaude) w.claude++;
	if (revertedSoon(c)) isClaude ? w.revClaude++ : w.revOther++;
}

const keys = [...byWeek.keys()].sort().slice(-weeks);
const pad = (v, n) => String(v).padStart(n);
console.log(
	`${pad('week', 10)} ${pad('people', 6)} ${pad('commits', 7)} ${pad('claude', 6)} ${pad('share', 6)} ${pad('rev-cl', 6)} ${pad('rev-oth', 7)}`
);
let shown = 0;
const tot = { all: 0, claude: 0, revClaude: 0, revOther: 0 };
for (const k of keys) {
	const w = byWeek.get(k);
	if (w.people.size < minPeople) {
		console.log(`${pad(k, 10)} ${pad('<' + minPeople, 6)}  suppressed`);
		continue;
	}
	shown++;
	for (const f of Object.keys(tot)) tot[f] += w[f];
	console.log(
		`${pad(k, 10)} ${pad(w.people.size, 6)} ${pad(w.all, 7)} ${pad(w.claude, 6)} ${pad(pct(w.claude, w.all), 6)} ${pad(w.revClaude, 6)} ${pad(w.revOther, 7)}`
	);
}
if (shown) {
	console.log(
		`shown weeks: ${tot.claude} of ${tot.all} commits carry the trailer (${pct(tot.claude, tot.all)}); ` +
			`reverted within ${revertDays} days: ${pct(tot.revClaude, tot.claude)} of trailer commits, ` +
			`${pct(tot.revOther, tot.all - tot.claude)} of the rest`
	);
}
console.log(
	`git-ai-report: ${keys.length} week(s), ${shown} shown, minimum ${minPeople} people per week, ${warnings} warning(s)`
);

function hash(s) {
	return createHash('sha256').update(s).digest('hex').slice(0, 16);
}
function pct(a, b) {
	return b ? `${Math.round((100 * a) / b)}%` : '-';
}
function isoWeek(d) {
	const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
	const day = t.getUTCDay() || 7;
	t.setUTCDate(t.getUTCDate() + 4 - day);
	const y = t.getUTCFullYear();
	const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
	return `${y}-W${String(w).padStart(2, '0')}`;
}
