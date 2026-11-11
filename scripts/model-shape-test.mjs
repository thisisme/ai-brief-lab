#!/usr/bin/env node
// Offline test for src/lib/server/model-shape.ts. A local mock answers like the Messages
// API and returns 400 for what the Fable 5.2 docs say is rejected. No API key needed.
// Needs Node 22.18+ (runs the .ts file directly). Uses port 8088.
import { createServer } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { shapeRequest } from '../src/lib/server/model-shape.ts';

const PORT = 8088;
const seen = [];
const strictModel = (m) => /^claude-(fable|mythos)-5-2/.test(m);

function reject(body) {
	if (!strictModel(body.model)) return null;
	if (body.thinking?.type === 'enabled' || body.thinking?.type === 'disabled')
		return 'thinking: use {"type": "adaptive"} or omit it';
	if (body.tool_choice?.type === 'any' || body.tool_choice?.type === 'tool')
		return 'tool_choice: forced tool use is not supported';
	for (const k of ['temperature', 'top_p', 'top_k']) if (k in body) return `${k}: not supported`;
	return null;
}

const server = createServer((req, res) => {
	let raw = '';
	req.on('data', (c) => (raw += c));
	req.on('end', () => {
		const body = JSON.parse(raw || '{}');
		seen.push(body);
		const why = reject(body);
		res.setHeader('content-type', 'application/json');
		res.setHeader('request-id', `req_mock${seen.length}`);
		if (why) {
			res.statusCode = 400;
			res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: why } }));
			return;
		}
		res.end(JSON.stringify({
			id: `msg_mock${seen.length}`, type: 'message', role: 'assistant', model: body.model,
			content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null,
			usage: { input_tokens: 10, output_tokens: 1 }
		}));
	});
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const client = new Anthropic({ apiKey: 'test', baseURL: `http://127.0.0.1:${PORT}`, maxRetries: 0 });

const base = {
	model: 'claude-fable-5-2', max_tokens: 256,
	messages: [{ role: 'user', content: 'hi' }],
	tools: [{ name: 'lookup', description: 'Look up a page', input_schema: { type: 'object', properties: { q: { type: 'string' } } } },
		{ name: 'other', description: 'Other', input_schema: { type: 'object', properties: {} } }]
};
const legacy = { ...base, temperature: 0.2, thinking: { type: 'enabled', budget_tokens: 2048 }, tool_choice: { type: 'tool', name: 'lookup' } };

const results = [];
async function check(name, fn) {
	try { results.push([name, (await fn()) === true]); }
	catch (e) { results.push([name, false, e.message]); }
}

await check('raw legacy request to claude-fable-5-2: 400 invalid_request_error', async () => {
	try { await client.messages.create(legacy); return false; }
	catch (e) { return e.status === 400 && e.type === 'invalid_request_error'; }
});
await check('shaped legacy request: 200', async () => {
	const { params } = shapeRequest(legacy, { defaultEffort: 'medium' });
	return (await client.messages.create(params)).content[0].text === 'ok';
});
await check('shaped: temperature removed, thinking adaptive', () => {
	const { params } = shapeRequest(legacy);
	return !('temperature' in params) && params.thinking.type === 'adaptive' && !('budget_tokens' in params.thinking);
});
await check('shaped: tool_choice auto, only the named tool strict', () => {
	const { params } = shapeRequest(legacy);
	return params.tool_choice.type === 'auto' && params.tools[0].strict === true && params.tools[1].strict === undefined;
});
await check('tool_choice any: every tool strict', () => {
	const { params } = shapeRequest({ ...base, tool_choice: { type: 'any' } });
	return params.tools.every((t) => t.strict === true);
});
await check('thinking disabled: omitted, effort low', () => {
	const { params } = shapeRequest({ ...base, thinking: { type: 'disabled' } }, { defaultEffort: 'medium' });
	return !('thinking' in params) && params.output_config.effort === 'low';
});
await check('defaultEffort fills output_config.effort, keeps format', () => {
	const { params } = shapeRequest({ ...base, output_config: { format: { type: 'json_schema', schema: {} } } }, { defaultEffort: 'medium' });
	return params.output_config.effort === 'medium' && params.output_config.format.type === 'json_schema';
});
await check('an explicit effort wins over defaultEffort', () => {
	const { params, changes } = shapeRequest({ ...base, output_config: { effort: 'xhigh' } }, { defaultEffort: 'medium' });
	return params.output_config.effort === 'xhigh' && changes.length === 0;
});
await check('claude-fable-5-1: sampling removed, thinking untouched', () => {
	const { params } = shapeRequest({ ...legacy, model: 'claude-fable-5-1' });
	return !('temperature' in params) && params.thinking.type === 'enabled' && params.tool_choice.type === 'tool';
});
await check('claude-sonnet-5-5: unchanged, no changes listed', () => {
	const input = { ...legacy, model: 'claude-sonnet-5-5' };
	const { params, changes } = shapeRequest(input, { defaultEffort: 'medium' });
	return JSON.stringify(params) === JSON.stringify(input) && changes.length === 0;
});
await check('the input object is not modified', () => {
	const copy = JSON.stringify(legacy);
	shapeRequest(legacy);
	return JSON.stringify(legacy) === copy;
});
await check('strict: throws on the first rewrite', () => {
	try { shapeRequest(legacy, { strict: true }); return false; }
	catch (e) { return /model-shape: claude-fable-5-2: removed temperature/.test(e.message); }
});
await check('thread helper sends output_config.effort on its first turn', async () => {
	const { params } = shapeRequest({ model: 'claude-fable-5-2', max_tokens: 256 }, { defaultEffort: 'medium' });
	const thread = client.beta.messages.thread({ ...params, system: 'test' });
	await thread.send({ role: 'user', content: 'hi' });
	return seen.at(-1).output_config?.effort === 'medium';
});

server.close();
let failed = 0;
for (const [name, ok, msg] of results) {
	if (!ok) failed++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${msg ? `: ${msg}` : ''}`);
}
const one = shapeRequest(legacy, { defaultEffort: 'medium' }).changes;
console.log(`changes  ${one.length} for the legacy request: ${one.join('; ')}`);
console.log(failed ? `model-shape-test: ${failed} failed` : 'model-shape-test: all passed');
process.exit(failed ? 1 : 0);
