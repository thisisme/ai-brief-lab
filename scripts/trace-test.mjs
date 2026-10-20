#!/usr/bin/env node
// Proves the SvelteKit -> Claude trace without an API key or network:
// a fake Messages API on 127.0.0.1:8098, the trace sink on :4329, and `vite dev` on :5199.
//   npm run -s trace:test   → "trace-test: all passed" and exit 0, or the failing checks and exit 1
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MARKER = 'HALMSTAD-7731'; // must never show up in a span (contentMode metadata_only)
const REPLY = 'Texten handlar om en provtur.';
const dir = mkdtempSync(join(tmpdir(), 'traces-'));
const children = [];
let failed = 0;
const check = (ok, name, detail = '') => {
	if (!ok) failed++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A streamed answer: Server-Sent Events, one every GAP ms, so the call visibly takes a while.
const GAP = 300;
const sse = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
let streamSentAt = [];
let streamStartedAt = 0;
async function streamReply(res) {
	streamStartedAt = Date.now();
	res.writeHead(200, { 'content-type': 'text/event-stream', 'request-id': 'req_mock_stream' });
	const words = REPLY.split(' ');
	const events = [
		sse('message_start', { message: { id: 'msg_mock', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 42, output_tokens: 1 } } }),
		sse('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
		...words.map((w, i) => sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text: i ? ` ${w}` : w } })),
		sse('content_block_stop', { index: 0 }),
		sse('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } }),
		sse('message_stop', {})
	];
	streamSentAt = [];
	for (const e of events) {
		res.write(e);
		streamSentAt.push(Date.now());
		await sleep(GAP);
	}
	res.end();
}

// Fake Claude: records each request's traceparent; answers 529 once when the prompt says RETRY.
const seen = [];
let failedOnce = false;
const mock = createServer((req, res) => {
	let body = '';
	req.on('data', (c) => (body += c));
	req.on('end', () => {
		seen.push({ traceparent: req.headers.traceparent ?? null, body });
		if (body.includes('RETRY') && !failedOnce) {
			failedOnce = true;
			res.writeHead(529, { 'content-type': 'application/json' });
			res.end('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}');
			return;
		}
		if (JSON.parse(body).stream === true) {
			streamReply(res);
			return;
		}
		res.writeHead(200, { 'content-type': 'application/json', 'request-id': 'req_mock' });
		res.end(JSON.stringify({
			id: 'msg_mock', type: 'message', role: 'assistant', model: 'claude-haiku-5-5',
			content: [{ type: 'text', text: REPLY }], stop_reason: 'end_turn', stop_sequence: null,
			usage: { input_tokens: 42, output_tokens: 9 }
		}));
	});
});
await new Promise((r) => mock.listen(8098, '127.0.0.1', r));

function start(cmd, args, env = {}) {
	const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
	let out = '';
	p.stdout.on('data', (d) => (out += d));
	p.stderr.on('data', (d) => (out += d));
	children.push(p);
	return { p, log: () => out };
}
function stopAll() {
	for (const c of children) {
		try { process.kill(-c.pid, 'SIGTERM'); } catch {}
	}
	children.length = 0;
}
async function waitFor(url, ms = 30_000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		try { await fetch(url); return true; } catch { await sleep(300); }
	}
	return false;
}
const spans = () =>
	readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
		.flatMap((f) => readFileSync(join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const post = (text) =>
	fetch('http://127.0.0.1:5199/api/summary', {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text })
	});

async function runVite(extraEnv) {
	const vite = start('npx', ['vite', 'dev', '--host', '127.0.0.1', '--port', '5199', '--strictPort'], {
		ANTHROPIC_BASE_URL: 'http://127.0.0.1:8098',
		ANTHROPIC_API_KEY: 'sk-ant-test-not-a-real-key',
		TRACE_SINK_URL: 'http://127.0.0.1:4329/v1/traces',
		OTEL_SERVICE_NAME: 'ai-brief-lab',
		...extraEnv
	});
	const up = await waitFor('http://127.0.0.1:5199/');
	if (!up) console.log(vite.log());
	return up;
}

try {
	start('node', ['scripts/trace-sink.mjs'], { TRACE_DIR: dir, TRACE_SINK_PORT: '4329' });
	check(await waitFor('http://127.0.0.1:4329/'), 'trace sink answers on 127.0.0.1:4329');
	check(await runVite({}), 'vite dev answers on 127.0.0.1:5199');

	// 1. One request, one trace.
	const res = await post(`Provtur i ${MARKER}`);
	const json = await res.json().catch(() => ({}));
	check(res.status === 200 && json.summary === REPLY, 'endpoint returns the summary', `status ${res.status}`);
	await sleep(1500);
	let all = spans();
	const sdk = all.find((s) => s.name === 'anthropic.messages.create');
	const ep = all.find((s) => s.name === 'sveltekit.endpoint');
	check(!!ep, 'SvelteKit emitted sveltekit.endpoint');
	check(!!sdk, 'Claude SDK emitted anthropic.messages.create', sdk ? `scope ${sdk.scope}` : '');
	const byId = new Map(all.map((s) => [s.spanId, s]));
	let p = sdk && byId.get(sdk.parentSpanId);
	check(!!(sdk && ep && p && p.spanId === ep.spanId), 'the Claude span is a child of the endpoint span');
	while (p?.parentSpanId) p = byId.get(p.parentSpanId);
	check(p?.name === 'sveltekit.handle.root', 'the trace starts at sveltekit.handle.root');
	check(sdk?.service === 'ai-brief-lab', 'service.name comes from OTEL_SERVICE_NAME', sdk?.service);
	check(sdk?.attrs['gen_ai.usage.input_tokens'] === 42 && sdk?.attrs['gen_ai.usage.output_tokens'] === 9,
		'token usage is on the span', `in ${sdk?.attrs['gen_ai.usage.input_tokens']} out ${sdk?.attrs['gen_ai.usage.output_tokens']}`);
	const tp = seen.at(-1)?.traceparent ?? '';
	check(!!sdk && tp === `00-${sdk.traceId}-${sdk.spanId}-01`, 'the request to Claude carried this traceparent', tp || 'none');
	const raw = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('');
	check(!raw.includes(MARKER) && !raw.includes(REPLY), 'no prompt or reply text in any span');
	check(!raw.includes('sk-ant-test'), 'no API key in any span');

	// 2. A 529 is retried inside the same call span.
	const r2 = await post('RETRY please');
	await sleep(1500);
	all = spans();
	const sdkSpans = all.filter((s) => s.name === 'anthropic.messages.create');
	const retried = sdkSpans.at(-1);
	check(r2.status === 200 && sdkSpans.length === 2, 'a retried call is still one span', `${sdkSpans.length} SDK spans`);
	check(retried?.attrs['http.request.resend_count'] === 1, 'its http.request.resend_count is 1',
		String(retried?.attrs['http.request.resend_count']));

	// 3. A streamed call: the span stays open until the last event has arrived.
	const r3 = await fetch('http://127.0.0.1:5199/api/summary/stream', {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `Ström i ${MARKER}` })
	});
	const streamed = await r3.text();
	check(r3.status === 200 && r3.headers.get('content-type')?.startsWith('text/plain') && streamed === REPLY,
		'stream endpoint returns the text as text/plain', `status ${r3.status}, "${streamed}"`);
	await sleep(1500);
	const streamSpan = spans().filter((s) => s.name === 'anthropic.messages.create').at(-1);
	const lastEventMs = streamSentAt.at(-1) - streamStartedAt;
	check(!!streamSpan && sdkSpans.every((s) => s.spanId !== streamSpan.spanId) && lastEventMs >= GAP * 5,
		'the streamed call is its own SDK span', `last event after ${lastEventMs} ms`);
	check(!!streamSpan && streamSpan.ms >= lastEventMs, 'the streamed span lasts until the last event is sent',
		`span ${streamSpan?.ms} ms, last event ${lastEventMs} ms`);
	check(!readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('').includes(MARKER),
		'no prompt text in any span after the streamed call');

	// 4. Propagation off: spans stay, the header goes.
	stopAll();
	start('node', ['scripts/trace-sink.mjs'], { TRACE_DIR: dir, TRACE_SINK_PORT: '4329' });
	await waitFor('http://127.0.0.1:4329/');
	await runVite({ ANTHROPIC_OPEN_TELEMETRY_PROPAGATION: 'false' });
	const before = spans().filter((s) => s.name === 'anthropic.messages.create').length;
	await post('Utan header');
	await sleep(1500);
	const after = spans().filter((s) => s.name === 'anthropic.messages.create').length;
	check(seen.at(-1)?.traceparent === null && after === before + 1,
		'ANTHROPIC_OPEN_TELEMETRY_PROPAGATION=false: span kept, no traceparent sent');
} catch (e) {
	check(false, 'test crashed', e.message);
} finally {
	stopAll();
	mock.close();
	rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `trace-test: ${failed} failed` : 'trace-test: all passed');
process.exit(failed ? 1 : 0);
