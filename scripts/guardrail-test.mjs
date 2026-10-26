#!/usr/bin/env node
// Proves the sink keeps only safety events, and only their allowlisted attributes.
// Starts scripts/otel-sink.mjs on a spare port with a temporary data folder, posts made-up
// OTLP log exports for three invented people (one with OTEL_LOG_TOOL_DETAILS-style command
// details), then checks what reached disk and what the weekly report prints.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'guardrail-test-'));
const port = 43700 + Math.floor(Math.random() * 500);
const env = { ...process.env, TELEMETRY_DIR: dir, PORT: String(port) };
const sink = spawn('node', ['scripts/otel-sink.mjs'], { env, stdio: 'ignore' });

let failed = 0;
const check = (name, ok, detail = '') => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
	if (!ok) failed++;
};

const NOW = 1792627200000n * 1000000n; // fixed time: 2026-10-22, ISO week 2026-W43
const attr = (key, v) => ({ key, value: { stringValue: String(v) } });
const who = (email) => [attr('user.email', email), attr('user.account_uuid', `uuid-${email}`), attr('session.id', `s-${email}`), attr('organization.id', 'org-1'), attr('prompt.id', 'p-1'), attr('tool_use_id', 'toolu_1')];
const record = (name, email, extra) => ({
	timeUnixNano: String(NOW),
	body: { stringValue: name },
	attributes: [...who(email), attr('event.name', name.replace('claude_code.', '')), ...extra.map(([k, v]) => attr(k, v))]
});
// Shapes copied from real Claude Code 2.1.308 events: a deny rule, a PreToolUse hook, dontAsk mode.
const rule = [['category', 'permission_rule'], ['decision', 'reject'], ['decision_source', 'config'], ['reason_code', 'rule:projectSettings'], ['rule_source', 'projectSettings'], ['tool_class', 'bash'], ['tool_name', 'Bash'], ['permission_mode', 'default']];
const hook = [['category', 'hook'], ['decision', 'reject'], ['decision_source', 'hook'], ['reason_code', 'hook:PreToolUse'], ['hook_event', 'pre_tool_use'], ['tool_class', 'bash'], ['tool_name', 'Bash'], ['permission_mode', 'default']];
const mode = [['category', 'permission_mode'], ['decision', 'reject'], ['decision_source', 'config'], ['reason_code', 'mode:dontAsk'], ['tool_class', 'file'], ['tool_name', 'Write'], ['permission_mode', 'dontAsk']];
const details = ['tool_parameters', JSON.stringify({ bash_command: 'curl', full_command: 'curl -H "Authorization: Bearer SECRET-TOKEN" https://x.example' })];
const logs = (records) => ({
	resourceLogs: [{
		resource: { attributes: [attr('service.name', 'claude-code'), attr('service.version', '2.1.308'), attr('team.id', 'web')] },
		scopeLogs: [{ logRecords: records }]
	}]
});

async function post(path, body) {
	const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	return r.status;
}

try {
	let up = false;
	for (let i = 0; i < 50 && !up; i++) {
		await new Promise((r) => setTimeout(r, 100));
		up = await post('/v1/logs', {}).then((s) => s === 200, () => false);
	}
	check('sink answers on its port', up);
	await post('/v1/logs', logs([
		record('claude_code.user_prompt', 'anna@example.se', [['prompt', 'fix the login bug for kund 19121212-1212']]),
		record('claude_code.safety_event', 'anna@example.se', [...rule, details]),
		record('claude_code.safety_event', 'anna@example.se', rule),
		record('claude_code.tool_result', 'erik@example.se', [['tool_name', 'Bash'], ['success', 'true']]),
		record('claude_code.safety_event', 'erik@example.se', hook),
		record('claude_code.safety_event', 'sara@example.se', mode)
	]));

	const safetyDir = join(dir, 'safety');
	const text = existsSync(safetyDir) ? readdirSync(safetyDir).map((f) => readFileSync(join(safetyDir, f), 'utf8')).join('') : '';
	const rows = text.trim() ? text.trim().split('\n').map((l) => JSON.parse(l)) : [];
	const events = rows.filter((r) => r.event === 'safety');
	check('only safety events stored', events.length === 4, `${events.length} stored`);
	check('no prompt text or personnummer on disk', !/login bug|19121212/.test(text));
	check('no email, account id, session id, prompt id or org id on disk', !/@|uuid-|s-anna|p-1|toolu_1|org-1/.test(text));
	check('command details dropped even when sent', !/SECRET-TOKEN|tool_parameters|curl/.test(text));
	check('category, reason and team kept', events.some((e) => e.attrs.category === 'hook' && e.attrs.reason_code === 'hook:PreToolUse' && e.attrs['team.id'] === 'web'));
	const people = Math.max(0, ...rows.filter((r) => r.event === 'safety.people').map((r) => r.value));
	check('people counted, not named', people === 3, `people ${people}`);
	check('nothing written to the metrics files', readdirSync(dir).filter((f) => f.endsWith('.jsonl')).length === 0);

	// Next week (2026-W44): the same three people, one rule stopping 5 calls, one hook stopping 4.
	const LATER = NOW + 7n * 86400n * 1000000000n;
	const later = (name, email, extra) => ({ ...record(name, email, extra), timeUnixNano: String(LATER) });
	const emails = ['anna@example.se', 'erik@example.se', 'sara@example.se'];
	await post('/v1/logs', logs([
		...[0, 1, 2, 0, 1].map((i) => later('claude_code.safety_event', emails[i], rule)),
		...[0, 1, 2, 0].map((i) => later('claude_code.safety_event', emails[i], hook))
	]));

	const rep = (min) => spawnSync('node', ['scripts/guardrail-report.mjs'], { env: { ...env, PILOT_MIN_PEOPLE: String(min) }, encoding: 'utf8' }).stdout;
	const shown = rep(3);
	check('report shows the week at minimum 3', /2026-W43\s+3\s+4\s+2\s+1\s+1\s+0/.test(shown), shown.split('\n')[1]?.trim());
	check('report names the top reason', /rule:projectSettings on Bash 2/.test(shown));
	const reviews = shown.split('\n').filter((l) => / review: /.test(l));
	check('report flags a reason that stopped 5 calls', reviews.length === 1 && reviews[0] === '2026-W44 review: rule:projectSettings on Bash stopped 5 calls - fix the rule or explain it, then add a row to docs/ai-literacy-measures.md', reviews.join(' | '));
	check('report does not flag 4 calls or the first week', !/hook:PreToolUse.* stopped/.test(shown) && !/W43 review/.test(shown));
	check('report suppresses it at minimum 4', /suppressed/.test(rep(4)));
} finally {
	sink.kill();
	rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `guardrail-test: ${failed} failed` : 'guardrail-test: all passed');
process.exit(failed ? 1 : 0);