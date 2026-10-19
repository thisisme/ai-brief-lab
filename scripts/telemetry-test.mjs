#!/usr/bin/env node
// Proves the sink drops identity and turns cumulative counters into deltas.
// Starts scripts/otel-sink.mjs on a spare port with a temporary data folder, posts two
// made-up OTLP payloads for two invented people, then checks what reached disk.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'telemetry-test-'));
const port = 43180 + Math.floor(Math.random() * 500);
const env = { ...process.env, TELEMETRY_DIR: dir, PORT: String(port) };
const sink = spawn('node', ['scripts/otel-sink.mjs'], { env, stdio: 'ignore' });

let failed = 0;
const check = (name, ok, detail = '') => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
	if (!ok) failed++;
};

const NOW = 1792040000000n * 1000000n; // fixed time: 2026-10-15
const attr = (key, v) => ({ key, value: typeof v === 'number' ? { doubleValue: v } : { stringValue: v } });
function payload(email, cost, lines, commits = 0) {
	const who = [attr('user.email', email), attr('user.account_uuid', `uuid-${email}`), attr('session.id', `s-${email}`), attr('organization.id', 'org-1')];
	const sum = (name, dps) => ({ name, sum: { aggregationTemporality: 2, isMonotonic: true, dataPoints: dps } });
	const dp = (v, extra = []) => ({ attributes: [...who, ...extra], startTimeUnixNano: String(NOW), timeUnixNano: String(NOW + 1000n), asDouble: v });
	return {
		resourceMetrics: [{
			resource: { attributes: [attr('service.name', 'claude-code'), attr('team.id', 'web')] },
			scopeMetrics: [{ metrics: [
				sum('claude_code.session.count', [dp(1, [attr('start_type', 'fresh')])]),
				sum('claude_code.cost.usage', [dp(cost, [attr('model', 'claude-sonnet-5-5')])]),
				sum('claude_code.lines_of_code.count', [dp(lines, [attr('type', 'added')])]),
					sum('claude_code.commit.count', [dp(commits)])
			] }]
		}]
	};
}

async function post(body) {
	const r = await fetch(`http://127.0.0.1:${port}/v1/metrics`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	return r.status;
}

try {
	let up = false;
	for (let i = 0; i < 50 && !up; i++) {
		await new Promise((r) => setTimeout(r, 100));
		up = await post({}).then((s) => s === 200, () => false);
	}
	check('sink answers on its port', up);
	// Cumulative counters: the second export repeats the first value plus what happened since.
	await post(payload('anna@example.se', 0.4, 10, 1));
	await post(payload('anna@example.se', 0.5, 25, 2));
	await post(payload('erik@example.se', 0.2, 5));

	const text = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('');
	const rows = text.trim().split('\n').map((l) => JSON.parse(l));
	check('no email, account id, session id or org id on disk', !/@|uuid-|s-anna|org-1/.test(text));
	const total = (m) => rows.filter((r) => r.metric === m).reduce((a, r) => a + r.value, 0);
	check('cumulative cost became deltas', Math.abs(total('claude_code.cost.usage') - 0.7) < 1e-9, `total ${total('claude_code.cost.usage').toFixed(2)}`);
	check('lines added counted once', total('claude_code.lines_of_code.count') === 30, `total ${total('claude_code.lines_of_code.count')}`);
	const people = Math.max(...rows.filter((r) => r.metric === 'pilot.people').map((r) => r.value));
	check('people counted, not named', people === 2, `people ${people}`);
	check('team kept', rows.some((r) => r.attrs['team.id'] === 'web'));

	const rep = (min) => spawnSync('node', ['scripts/pilot-report.mjs'], { env: { ...env, PILOT_MIN_PEOPLE: String(min) }, encoding: 'utf8' }).stdout;
	check('report suppresses a 2-person week at minimum 3', /suppressed/.test(rep(3)));
	check('report shows it at minimum 2', /2026-W42\s+2\s+2\s+0\.70\s+30\/0/.test(rep(2)));
	check('report shows cost per commit', /2026-W42\s+2\s+2\s+0\.70\s+30\/0\s+2\s+0\.35\s/.test(rep(2)), '0.70 / 2 commits');
} finally {
	sink.kill();
	rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `telemetry-test: ${failed} failed` : 'telemetry-test: all passed');
process.exit(failed ? 1 : 0);