#!/usr/bin/env node
// Weekly team-level report from the files scripts/otel-sink.mjs writes.
//   npm run -s telemetry:report                 all weeks
//   PILOT_MIN_PEOPLE=1 npm run -s telemetry:report
// A week with fewer than PILOT_MIN_PEOPLE people (default 3) is shown as "suppressed",
// so a small team's numbers can't be read as one person's.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.TELEMETRY_DIR ?? '.claude/telemetry';
const MIN = Number(process.env.PILOT_MIN_PEOPLE ?? 3);

function isoWeek(dateStr) {
	const d = new Date(`${dateStr}T00:00:00Z`);
	const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
	d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of this week
	const year = d.getUTCFullYear();
	const jan4 = new Date(Date.UTC(year, 0, 4));
	const week = 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
	return `${year}-W${String(week).padStart(2, '0')}`;
}

if (!existsSync(DIR)) {
	console.log(`pilot-report: no data in ${DIR} (is npm run telemetry:sink running?)`);
	process.exit(1);
}

const weeks = new Map();
const peopleByDay = new Map();
const blank = () => ({ sessions: 0, cost: 0, added: 0, removed: 0, commits: 0, prs: 0, accept: 0, reject: 0, active: 0, days: new Set() });

for (const f of readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).sort()) {
	for (const line of readFileSync(join(DIR, f), 'utf8').split('\n')) {
		if (!line) continue;
		const r = JSON.parse(line);
		if (r.metric === 'pilot.people') {
			peopleByDay.set(r.day, Math.max(peopleByDay.get(r.day) ?? 0, r.value));
			continue;
		}
		const w = isoWeek(r.day);
		if (!weeks.has(w)) weeks.set(w, blank());
		const s = weeks.get(w);
		s.days.add(r.day);
		switch (r.metric) {
			case 'claude_code.session.count': s.sessions += r.value; break;
			case 'claude_code.cost.usage': s.cost += r.value; break;
			case 'claude_code.lines_of_code.count':
				if (r.attrs.type === 'added') s.added += r.value;
				if (r.attrs.type === 'removed') s.removed += r.value;
				break;
			case 'claude_code.commit.count': s.commits += r.value; break;
			case 'claude_code.pull_request.count': s.prs += r.value; break;
			case 'claude_code.code_edit_tool.decision':
				if (r.attrs.decision === 'accept') s.accept += r.value;
				if (r.attrs.decision === 'reject') s.reject += r.value;
				break;
			case 'claude_code.active_time.total': s.active += r.value; break;
		}
	}
}

const cols = ['week', 'people', 'sessions', 'cost USD', 'lines +/-', 'commits', '$/commit', 'PRs', 'edits kept', 'active h'];
const widths = [10, 7, 9, 9, 12, 8, 10, 5, 11, 9];
const row = (cells) => cells.map((c, i) => String(c).padStart(widths[i])).join('');
console.log(row(cols));
let shown = 0;
for (const [w, s] of [...weeks].sort()) {
	const people = Math.max(0, ...[...s.days].map((d) => peopleByDay.get(d) ?? 0));
	if (people < MIN) {
		console.log(`${row([w, `<${MIN}`])}  suppressed: fewer than ${MIN} people`);
		continue;
	}
	shown++;
	const kept = s.accept + s.reject ? `${Math.round((100 * s.accept) / (s.accept + s.reject))}%` : '-';
	const perCommit = s.commits ? (s.cost / s.commits).toFixed(2) : '-';
	console.log(row([w, people, s.sessions, s.cost.toFixed(2), `${s.added}/${s.removed}`, s.commits, perCommit, s.prs, kept, (s.active / 3600).toFixed(1)]));
}
console.log(`pilot-report: ${weeks.size} week(s), ${shown} shown, minimum ${MIN} people per week`);