#!/usr/bin/env node
// A stand-in for POST /v1/messages that follows the message-threads rules
// closely enough to test a client: create, continue, create-only fields,
// one continue per id, and a thread the server has forgotten.
// It never calls Anthropic and needs no API key.
import http from 'node:http';

const BETA = 'message-threads-2026-08-12';

export function startMock({ port = 8090 } = {}) {
	const threads = new Map(); // message id -> { history, fixed }
	const log = [];
	let n = 0;

	function fail(res, status, type, message, code) {
		res.writeHead(status, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ type: 'error', error: { type, message, ...(code ? { details: { error_code: code } } : {}) } }));
	}

	const server = http.createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) return fail(res, 404, 'not_found_error', 'no route');
			const betas = String(req.headers['anthropic-beta'] ?? '').split(',').map((s) => s.trim());
			const body = JSON.parse(raw);
			const t = body.thread;
			const entry = { bytes: Buffer.byteLength(raw), type: t?.type ?? 'none', messages: body.messages.length, hasSystem: 'system' in body, beta: betas.includes(BETA) };
			log.push(entry);
			if (t && !entry.beta) return fail(res, 400, 'invalid_request_error', 'thread needs the beta header');
			const fixed = JSON.stringify([body.model, body.cache_control ?? null]);
			let history;
			if (t?.type === 'continue') {
				if ('system' in body || 'tools' in body) return fail(res, 400, 'invalid_request_error', 'system and tools are create-only');
				const prev = threads.get(t.previous_message_id);
				if (!prev || mock.forget) {
					mock.forget = false;
					threads.clear();
					entry.status = 404;
					return fail(res, 404, 'not_found_error', 'thread not found', 'thread_not_found');
				}
				if (prev.used) return fail(res, 400, 'invalid_request_error', 'already continued', 'thread_already_continued');
				if (prev.fixed !== fixed) return fail(res, 400, 'invalid_request_error', 'fixed field changed', 'thread_fingerprint_mismatch');
				prev.used = true;
				history = [...prev.history, ...body.messages];
			} else {
				history = [...body.messages];
			}
			const userTurns = history.filter((m) => m.role === 'user').length;
			const id = `msg_mock_${++n}`;
			const reply = { role: 'assistant', content: [{ type: 'text', text: `reply ${userTurns} (history ${history.length})` }] };
			if (t) threads.set(id, { history: [...history, reply], fixed, used: false });
			entry.status = 200;
			entry.history = history.length;
			res.writeHead(200, { 'content-type': 'application/json', 'request-id': `req_mock_${n}` });
			res.end(JSON.stringify({
				id, type: 'message', role: 'assistant', model: body.model, content: reply.content,
				stop_reason: 'end_turn', stop_sequence: null,
				usage: { input_tokens: Math.ceil(raw.length / 4), output_tokens: 6 }
			}));
		});
	});

	const mock = {
		log,
		forget: false,
		url: `http://127.0.0.1:${port}`,
		ready: new Promise((r) => server.listen(port, '127.0.0.1', r)),
		close: () => new Promise((r) => server.close(r))
	};
	return mock;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const m = startMock({ port: Number(process.env.PORT ?? 8090) });
	await m.ready;
	console.log(`thread-mock: listening on ${m.url}`);
}
