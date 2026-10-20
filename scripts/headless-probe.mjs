#!/usr/bin/env node
// What can a headless Claude Code run spawn? Starts four one-line `claude -p`
// runs and reads the Agent tool each one was given from the run's own
// transcript (Claude Code 2.1.300+ records every request's tools there).
// It checks the tool definition, not what the model chose, so the answer
// doesn't depend on the model. Costs about 2 cents per run on Sonnet 5.5.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROMPT = 'Reply with exactly: ok';
const projects = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');

function cleanEnv(extra) {
	const env = { ...process.env, ...extra };
	if (!('CLAUDE_CODE_FORK_SUBAGENT' in extra)) delete env.CLAUDE_CODE_FORK_SUBAGENT;
	delete env.CLAUDE_P_FORKS;
	return env;
}

function findTranscript(sessionId) {
	if (!existsSync(projects)) return null;
	for (const dir of readdirSync(projects)) {
		const file = join(projects, dir, `${sessionId}.jsonl`);
		if (existsSync(file)) return file;
	}
	return null;
}

function agentTool(file) {
	let found = null;
	const walk = (o) => {
		if (found || !o || typeof o !== 'object') return;
		if (o.name === 'Agent' && o.input_schema) {
			found = o;
			return;
		}
		for (const v of Object.values(o)) walk(v);
	};
	for (const line of readFileSync(file, 'utf8').split('\n')) {
		if (!line) continue;
		try {
			walk(JSON.parse(line));
		} catch {
			// a partial line; skip it
		}
		if (found) break;
	}
	return found;
}

function probe(label, cmd, args, env) {
	const r = spawnSync(cmd, args, {
		env: cleanEnv(env),
		stdio: ['ignore', 'pipe', 'pipe'],
		encoding: 'utf8',
		timeout: 120_000
	});
	let out;
	try {
		out = JSON.parse(r.stdout);
	} catch {
		const why = (r.stderr || r.stdout || 'no output').trim().split('\n')[0];
		return { label, error: why };
	}
	const file = findTranscript(out.session_id);
	if (!file) return { label, error: 'no transcript (needs 2.1.300+ and session persistence)' };
	const agent = agentTool(file);
	if (!agent) return { label, error: 'no Agent tool in the transcript' };
	return {
		label,
		forks: String(agent.description ?? '').includes('"fork"') ? 'offered' : 'off',
		background: 'run_in_background' in (agent.input_schema.properties ?? {}) ? 'Claude chooses' : 'always',
		cost: Number(out.total_cost_usd ?? 0)
	};
}

const version = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim();
console.log(`claude ${version.split(' ')[0]}`);

const json = ['-p', PROMPT, '--output-format', 'json'];
const rows = [
	probe('claude -p (no override)', 'claude', json, {}),
	probe('CLAUDE_CODE_FORK_SUBAGENT=0', 'claude', json, { CLAUDE_CODE_FORK_SUBAGENT: '0' }),
	probe('CLAUDE_CODE_FORK_SUBAGENT=1', 'claude', json, { CLAUDE_CODE_FORK_SUBAGENT: '1' }),
	probe('scripts/claude-p.sh', 'bash', ['scripts/claude-p.sh', PROMPT, '--output-format', 'json'], {})
];

console.log(`${'run'.padEnd(30)}${'forks'.padEnd(10)}subagents in background`);
for (const r of rows) {
	if (r.error) console.log(`${r.label.padEnd(30)}ERROR  ${r.error}`);
	else console.log(`${r.label.padEnd(30)}${r.forks.padEnd(10)}${r.background}`);
}
const cost = rows.reduce((s, r) => s + (r.cost ?? 0), 0);
console.log(`${rows.length} runs, $${cost.toFixed(2)}`);

const wrapper = rows[3];
if (wrapper.error || wrapper.forks !== 'off') {
	console.log('headless-probe: FAIL scripts/claude-p.sh does not keep forks off');
	process.exit(1);
}
if (rows.some((r) => r.error)) {
	console.log('headless-probe: FAIL a run did not finish');
	process.exit(1);
}
console.log('headless-probe: ok (scripts/claude-p.sh keeps forks off)');