#!/usr/bin/env node
// Proves that customer calls carry a user profile and internal calls don't, with no API key and
// no real profiles: a fake Claude API on 127.0.0.1:8097 records every request, and vite dev
// runs the real /api/summary route on 127.0.0.1:5198 against it.
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { SESSION_COOKIE, signSession } from '../src/lib/server/session.ts';
import { profileFor, UnknownTenantError } from '../src/lib/server/user-profiles.ts';

const API_PORT = 8097;
const DEV_PORT = 5198;
const dir = mkdtempSync(join(tmpdir(), 'profile-test-'));
const SECRET = 'profile-test-secret-0123456789abcdef-not-real';
const env = {
	...process.env,
	LAB_SESSION_SECRET: SECRET,
	ANTHROPIC_API_KEY: 'sk-ant-test-not-a-key',
	ANTHROPIC_BASE_URL: `http://127.0.0.1:${API_PORT}`,
	PROFILE_MAP: join(dir, 'user-profiles.json')
};
process.env.PROFILE_MAP = env.PROFILE_MAP;

let failed = 0;
const check = (name, ok, extra = '') => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? `  (${extra})` : ''}`);
	if (!ok) failed++;
};

// --- fake API ------------------------------------------------------------------------------
const seen = [];
let n = 0;
const api = createServer((req, res) => {
	let body = '';
	req.on('data', (c) => (body += c));
	req.on('end', () => {
		const json = body ? JSON.parse(body) : {};
		seen.push({ path: req.url, profile: req.headers['anthropic-user-profile-id'], body: json });
		res.setHeader('content-type', 'application/json');
		res.setHeader('request-id', `req_test_${seen.length}`);
		if (req.method === 'POST' && req.url === '/v1/user_profiles') {
			const now = new Date().toISOString();
			res.end(JSON.stringify({ type: 'user_profile', id: `uprof_test${++n}`, access_type: json.access_type ?? 'application',
				name: null, metadata: {}, external_user_details: json.external_user_details ?? {}, created_at: now, updated_at: now }));
		} else if (req.method === 'POST' && req.url === '/v1/messages') {
			res.end(JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: json.model, stop_reason: 'end_turn',
				stop_sequence: null, content: [{ type: 'text', text: 'En mening.' }], usage: { input_tokens: 12, output_tokens: 3 } }));
		} else {
			res.statusCode = 404;
			res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: req.url } }));
		}
	});
});
await new Promise((r) => api.listen(API_PORT, '127.0.0.1', r));

// Async, not spawnSync: the fake API runs in this process and must keep answering.
const cli = (...args) =>
	new Promise((resolve) =>
		execFile(process.execPath, ['scripts/user-profile.mjs', ...args], { env }, (err, stdout, stderr) =>
			resolve({ status: err ? (err.code ?? 1) : 0, stdout, stderr })
		)
	);
let dev;
try {
	// --- the CLI ---------------------------------------------------------------------------
	const add = await cli('add', 'hotel-tylosand', '--country', 'SE', '--entity', 'business');
	check('add creates a profile', add.status === 0 && /hotel-tylosand -> uprof_test1/.test(add.stdout), add.stdout.trim() || add.stderr.trim());
	const sent = seen.find((s) => s.path === '/v1/user_profiles')?.body ?? {};
	check('only reference_id, country and entity_type are sent',
		JSON.stringify(sent) === JSON.stringify({ access_type: 'application',
			external_user_details: { reference_id: 'hotel-tylosand', country: 'SE', entity_type: 'business' } }),
		JSON.stringify(sent.external_user_details));
	const again = await cli('add', 'hotel-tylosand');
	check('a second add is refused (create is not idempotent)', again.status === 1 && seen.filter((s) => s.path === '/v1/user_profiles').length === 1);
	check('a bad country is refused before any call', (await cli('add', 'hotel-x', '--country', 'sweden')).status === 1);
	const map = readFileSync(env.PROFILE_MAP, 'utf8');
	check('the map holds ids only', !/name|email|hash/i.test(map) && /uprof_test1/.test(map));

	// --- the module --------------------------------------------------------------------------
	check('a known tenant maps to its profile', profileFor('hotel-tylosand') === 'uprof_test1');
	check('no tenant means internal (no profile)', profileFor(undefined) === undefined);
	let threw = false;
	try { profileFor('constructor'); } catch (e) { threw = e instanceof UnknownTenantError; }
	check('an unknown tenant throws', threw);

	// --- the SDK header --------------------------------------------------------------------
	const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL });
	const base = { model: 'claude-haiku-5-5', max_tokens: 10, messages: [{ role: 'user', content: 'hej' }] };
	await client.messages.create({ ...base, user_profile_id: 'uprof_test1' });
	check('user_profile_id becomes the anthropic-user-profile-id header', seen.at(-1).profile === 'uprof_test1');
	check('and stays out of the request body', !('user_profile_id' in seen.at(-1).body));
	await client.messages.create(base);
	check('no user_profile_id, no header', seen.at(-1).profile === undefined);

	// --- the route, through vite dev ----------------------------------------------------------
	dev = spawn('npx', ['vite', 'dev', '--host', '127.0.0.1', '--port', String(DEV_PORT), '--strictPort'], { env, stdio: 'ignore', detached: true });
	const url = `http://127.0.0.1:${DEV_PORT}/api/summary`;
	let up = false;
	for (let i = 0; i < 60 && !up; i++) {
		up = await fetch(`http://127.0.0.1:${DEV_PORT}/`).then(() => true, () => false);
		if (!up) await new Promise((r) => setTimeout(r, 250));
	}
	check(`vite dev answers on 127.0.0.1:${DEV_PORT}`, up);
	const post = (body, cookie) =>
		fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) }, body: JSON.stringify(body) });

	const before = seen.length;
	let r = await post({ text: 'Frukosten var bra.' }, signSession('hotel-tylosand', SECRET));
	let j = await r.json();
	check('route: signed cookie -> attributed', r.status === 200 && j.attributed === true && seen.at(-1).profile === 'uprof_test1', `status ${r.status}`);
	r = await post({ text: 'Intern test.' });
	j = await r.json();
	check('route: no cookie -> internal call has no profile', r.status === 200 && j.attributed === false && seen.at(-1).profile === undefined);
	r = await post({ text: 'Falsk kund.', tenant: 'hotel-tylosand' });
	j = await r.json();
	check('route: body tenant is ignored -> not attributed', r.status === 200 && j.attributed === false && seen.at(-1).profile === undefined, `status ${r.status}`);
	const calls = seen.length;
	r = await post({ text: 'Forged.' }, signSession('hotel-tylosand', 'x'.repeat(40)));
	check('route: cookie signed with another secret -> 401, Claude not called', r.status === 401 && seen.length === calls, `status ${r.status}`);
	r = await post({ text: 'Forged.' }, 'hotel-tylosand.not-a-mac');
	check('route: malformed signature -> 401', r.status === 401 && seen.length === calls, `status ${r.status}`);
	r = await post({ text: 'Unknown.' }, signSession('hotel-unknown', SECRET));
	check('route: signed but unknown tenant is refused before Claude is called', r.status === 400 && seen.length === calls, `status ${r.status}`);
	check('route: three calls reached the API', seen.length - before === 3);
} finally {
	if (dev) try { process.kill(-dev.pid); } catch {}
	api.close();
	rmSync(dir, { recursive: true, force: true });
}

console.log(failed ? `profile-test: ${failed} failed` : 'profile-test: all passed');
process.exit(failed ? 1 : 0);