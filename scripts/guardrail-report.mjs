#!/usr/bin/env node
// Weekly guardrail report: how often Claude Code's permission rules, permission modes,
// hooks and sandbox stopped a tool call, per team and ISO week. Reads the files
// scripts/otel-sink.mjs writes to <dir>/safety/.
//   npm run -s guardrail:report
//   PILOT_MIN_PEOPLE=1 npm run -s guardrail:report
// A week with fewer than PILOT_MIN_PEOPLE people (default 3) is shown as "suppressed",
// so a small team's numbers can't be read as one person's.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.env.TELEMETRY_DIR ?? '.claude/telemetry', 'safety');
const MIN = Number(process.env.PILOT_MIN_PEOPLE ?? 3);
// The three categories seen on Claude Code 2.1.308. Anything else (auto mode, sandbox, ...)
// is counted under "other" and still named in the top reasons.
const CATEGORIES = ['permission_rule', 'permission_mode', 'hook'];

function isoWeek(dateStr) {
	const d = new Date(`${dateStr}T00:00:00Z`);
	const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
	d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of this week
	const year = d.getUTCFullYear();
	const jan4 = new Date(Date.UTC(year, 0, 4));
	const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
	return `${year}-W${String(week).padStart(2, '0')}`;
}

const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).sort() : [];
if (!files.length) {
	console.log(`guardrail-report: no safety events in ${DIR}`);
	console.log('  curl -s http://127.0.0.1:4318/health must print {"sink":"otel-sink","safety":true}.');
	console.log('  {} means the Oct 15 sink is still on the port; nothing means no sink is running.');
	console.log('  Also check claude --version (2.1.307 or later) and that a tool call was actually refused.');
	process.exit(1);
}

const weeks = new Map();
const peopleByDay = new Map();
for (const f of files) {
	for (const line of readFileSync(join(DIR, f), 'utf8').split('\n')) {
		if (!line) continue;
		const r = JSON.parse(line);
		if (r.event === 'safety.people') {
			peopleByDay.set(r.day, Math.max(peopleByDay.get(r.day) ?? 0, r.value));
			continue;
		}
		const w = isoWeek(r.day);
		if (!weeks.has(w)) weeks.set(w, { days: new Set(), total: 0, byCat: new Map(), reasons: new Map() });
		const s = weeks.get(w);
		s.days.add(r.day);
		s.total++;
		const cat = CATEGORIES.includes(r.attrs.category) ? r.attrs.category : 'other';
		s.byCat.set(cat, (s.byCat.get(cat) ?? 0) + 1);
		const reason = `${r.attrs.reason_code ?? r.attrs.category ?? 'unknown'} on ${r.attrs.tool_name ?? '?'}`; // e.g. rule:projectSettings on Bash
		s.reasons.set(reason, (s.reasons.get(reason) ?? 0) + 1);
	}
}

const cols = ['week', 'people', 'stopped', 'rule', 'mode', 'hook', 'other'];
const widths = [10, 7, 8, 6, 6, 6, 6];
const row = (cells) => cells.map((c, i) => String(c).padStart(widths[i])).join('');
console.log(row(cols));
let shown = 0;
const REVIEW_AT = 5; // one reason stopping this many calls in a week means the rule needs a look
const notes = [];
const reviews = [];
for (const [w, s] of [...weeks].sort()) {
	const people = Math.max(0, ...[...s.days].map((d) => peopleByDay.get(d) ?? 0));
	if (people < MIN) {
		console.log(`${row([w, `<${MIN}`])}  suppressed: fewer than ${MIN} people`);
		continue;
	}
	shown++;
	console.log(row([w, people, s.total, ...[...CATEGORIES, 'other'].map((c) => s.byCat.get(c) ?? 0)]));
	const top = [...s.reasons].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`);
	notes.push(`${w} top: ${top.join(', ')}`);
	for (const [k, v] of [...s.reasons].sort((a, b) => b[1] - a[1])) {
		if (v >= REVIEW_AT) reviews.push(`${w} review: ${k} stopped ${v} calls - fix the rule or explain it, then add a row to docs/ai-literacy-measures.md`);
	}
}
for (const n of notes) console.log(n);
for (const r of reviews) console.log(r);
console.log(`guardrail-report: ${weeks.size} week(s), ${shown} shown, minimum ${MIN} people per week`);