#!/usr/bin/env node
// Checks src/lib/server/claude-errors.ts against scripts/error-mock.mjs on port 8089.
// Needs Node 22.18+ (it imports .ts files directly) and no API key.
import Anthropic from '@anthropic-ai/sdk';
import { capRetryAfter, toHttpFailure } from '../src/lib/server/claude-errors.ts';
import { createThreadStore } from '../src/lib/server/claude-threads.ts';
import { startErrorMock } from './error-mock.mjs';

const PORT = 8089;
const BASE = `http://127.0.0.1:${PORT}`;
const server = await startErrorMock(PORT);
let failed = 0;

function check(name, ok, detail = '') {
	if (!ok) failed += 1;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `  (${detail})`}`);
}
async function script(steps) {
	await fetch(`${BASE}/__script`, { method: 'POST', body: JSON.stringify(steps) });
}
async function hits() {
	return (await (await fetch(`${BASE}/__count`)).json()).count;
}
// The route's client: one retry, and never a wait longer than 2 s inside the request.
const routeClient = () =>
	new Anthropic({ apiKey: 'test', baseURL: BASE, maxRetries: 1, fetch: capRetryAfter(2) });
const store = (client = routeClient()) =>
	createThreadStore(client, { model: 'claude-sonnet-5-5', system: 'test' });
async function attempt(fn) {
	const t0 = Date.now();
	try {
		return { value: await fn(), seconds: (Date.now() - t0) / 1000 };
	} catch (e) {
		return { error: e, failure: toHttpFailure(e), seconds: (Date.now() - t0) / 1000 };
	}
}

try {
	await script([{ status: 529 }, { status: 529 }]);
	let r = await attempt(() => store().send('conv-0001', 'hi'));
	check(
		'529 twice: one retry, then 503 with retry-after 5',
		r.failure?.status === 503 && r.failure.retryAfter === 5 && (await hits()) === 2,
		JSON.stringify(r.failure)
	);
	check('the error is named OverloadedError', r.error?.name === 'OverloadedError', r.error?.name);

	await script([{ status: 529 }]);
	r = await attempt(() => store().send('conv-0002', 'hi'));
	check('529 once: the SDK retries and the turn succeeds', r.value?.text === 'reply 2', JSON.stringify(r.value));

	await script([{ status: 429, retryAfter: 30 }]);
	r = await attempt(() => store().send('conv-0003', 'hi'));
	check(
		'429 with retry-after 30: no retry, 429 with retry-after 30 in under 1 s',
		r.failure?.status === 429 && r.failure.retryAfter === 30 && (await hits()) === 1 && r.seconds < 1,
		`${JSON.stringify(r.failure)} ${r.seconds}s`
	);
	check('the log line names RateLimitError and the request id', /^claude-error RateLimitError status=429 type=rate_limit_error code=- request=req_mock_1$/.test(r.failure?.log ?? ''), r.failure?.log);

	await script([{ status: 429, retryAfter: 1 }]);
	r = await attempt(() => store().send('conv-0004', 'hi'));
	check('429 with retry-after 1: waits about 1 s inside the request, then succeeds', r.value?.text === 'reply 2' && r.seconds >= 0.9 && r.seconds < 3, `${r.seconds}s`);

	await script([{ status: 429, retryAfter: 2 }, { status: 429, retryAfter: 2 }, { status: 429, retryAfter: 2 }]);
	r = await attempt(() => store(new Anthropic({ apiKey: 'test', baseURL: BASE })).send('conv-0005', 'hi'));
	check(`a default client waits ${r.seconds.toFixed(1)} s inside the request before giving up`, r.failure?.status === 429 && r.seconds >= 3.9, `${r.seconds}s`);

	await script([{ status: 401 }]);
	r = await attempt(() => store().send('conv-0006', 'hi'));
	check(
		'401: 500 for the browser, without the API text',
		r.failure?.status === 500 && r.failure.retryAfter === null && !/mock|authentication/.test(r.failure.message),
		JSON.stringify(r.failure)
	);

	const s = store();
	await script([{ status: 529 }, { status: 529 }]);
	await attempt(() => s.send('conv-0007', 'first try'));
	const afterFail = s.history('conv-0007').length;
	await attempt(() => s.send('conv-0007', 'second try'));
	check('a failed turn leaves no message behind', afterFail === 0 && s.history('conv-0007').length === 2, `${afterFail} then ${s.history('conv-0007').length}`);

	await script([{ status: 200, delayMs: 300 }]);
	const busy = store();
	const first = busy.send('conv-0008', 'one');
	r = await attempt(() => busy.send('conv-0008', 'two'));
	await first;
	check('a second turn while one is running: 409', r.failure?.status === 409, JSON.stringify(r.failure));

	r = await attempt(() =>
		createThreadStore(new Anthropic({ apiKey: 'test', baseURL: 'http://127.0.0.1:9', maxRetries: 0 }), {
			model: 'claude-sonnet-5-5',
			system: 'test'
		}).send('conv-0009', 'hi')
	);
	check('nothing listening: 502 Could not reach Claude', r.failure?.status === 502 && r.error?.name === 'APIConnectionError', `${r.error?.name} ${JSON.stringify(r.failure)}`);
} finally {
	server.close();
}

console.log(failed ? `error-test: ${failed} failed` : 'error-test: all passed');
process.exit(failed ? 1 : 0);
