#!/usr/bin/env node
// Checks src/lib/server/claude-threads.ts against scripts/thread-mock.mjs:
// what each turn sends, and the replay after the server forgets a thread.
// No API key, no network beyond 127.0.0.1:8090.
import Anthropic from '@anthropic-ai/sdk';
import { startMock } from './thread-mock.mjs';
import { createThreadStore } from '../src/lib/server/claude-threads.ts';

const mock = startMock({ port: 8090 });
await mock.ready;
const client = new Anthropic({ apiKey: 'test-key', baseURL: mock.url, maxRetries: 0 });
const store = createThreadStore(client, { model: 'claude-sonnet-5-5', system: 'S'.repeat(4000), idleMs: 60_000, maxThreads: 2 });

let failed = 0;
const check = (ok, label) => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
	if (!ok) failed++;
};
const pad = 'Tell me about the verify skill, step by step. '.repeat(20);

try {
	for (let i = 1; i <= 3; i++) await store.send('conv-aaaaaaaa', `${i}: ${pad}`);
	const [c1, c2, c3] = mock.log;
	const h = store.history('conv-aaaaaaaa');
	const unthreaded = [3, 5].map((k) => Buffer.byteLength(JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 1024, system: 'S'.repeat(4000), messages: h.slice(0, k) })));
	check(c1.type === 'create' && c1.hasSystem && c1.messages === 1 && c1.beta, 'turn 1 creates a thread with system and the beta header');
	check(c2.type === 'continue' && !c2.hasSystem && c2.messages === 1, 'turn 2 continues and sends 1 message, no system');
	check(c3.type === 'continue' && c3.messages === 1 && c3.history === 5, 'turn 3 continues; the server holds 5 messages');

	mock.forget = true;
	const r4 = await store.send('conv-aaaaaaaa', `4: ${pad}`);
	const [c4, c5] = mock.log.slice(3);
	check(c4.status === 404 && c5.type === 'create' && c5.hasSystem && c5.messages === 7, 'thread_not_found is replayed as a create with all 7 messages');
	check(r4.text === 'reply 4 (history 7)', 'the replayed turn gets the reply for turn 4');
	await store.send('conv-aaaaaaaa', `5: ${pad}`);
	check(mock.log[5].type === 'continue' && mock.log[5].messages === 1, 'turn 5 continues the new thread');
	check(store.history('conv-aaaaaaaa').length === 10, 'our copy holds all 10 messages');

	await store.send('conv-bbbbbbbb', 'hi');
	await store.send('conv-cccccccc', 'hi');
	check(store.size === 2 && store.history('conv-aaaaaaaa').length === 0, 'maxThreads 2 drops the least recently used conversation');

	console.log(`bytes  turn 2: ${c2.bytes} threaded, ${unthreaded[0]} full · turn 3: ${c3.bytes} threaded, ${unthreaded[1]} full`);
} catch (e) {
	check(false, `threw: ${e.message}`);
} finally {
	await mock.close();
}
console.log(failed ? `thread-test: ${failed} failed` : 'thread-test: all passed');
process.exit(failed ? 1 : 0);
