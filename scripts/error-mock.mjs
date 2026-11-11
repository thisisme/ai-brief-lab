#!/usr/bin/env node
// A stand-in for POST /v1/messages that fails on cue. No API key, no network.
//   POST /__script  [{"status":529},{"status":429,"retryAfter":30},{"status":200,"delayMs":300}]
//                   queues the next answers and resets the hit counter
//   GET  /__count   {"count": n}  requests to /v1/messages since the last script
// Anything not queued gets a normal reply. Port: PORT or 8089.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const ERROR_TYPES = {
	400: 'invalid_request_error',
	401: 'authentication_error',
	403: 'permission_error',
	429: 'rate_limit_error',
	500: 'api_error',
	503: 'api_error',
	529: 'overloaded_error'
};

export function startErrorMock(port = 8089) {
	let queue = [];
	let count = 0;
	const server = createServer(async (req, res) => {
		let raw = '';
		for await (const chunk of req) raw += chunk;
		const send = (status, body, headers = {}) => {
			res.writeHead(status, { 'content-type': 'application/json', ...headers });
			res.end(JSON.stringify(body));
		};
		if (req.method === 'POST' && req.url === '/__script') {
			queue = JSON.parse(raw || '[]');
			count = 0;
			return send(200, { queued: queue.length });
		}
		if (req.method === 'GET' && req.url === '/__count') return send(200, { count });
		if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
			return send(404, { type: 'error', error: { type: 'not_found_error', message: 'mock: unknown path' } });
		}
		count += 1;
		const step = queue.shift() ?? { status: 200 };
		if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs));
		const requestId = `req_mock_${count}`;
		if (step.status !== 200) {
			const headers = { 'request-id': requestId };
			if (step.retryAfter !== undefined) headers['retry-after'] = String(step.retryAfter);
			const type = ERROR_TYPES[step.status] ?? 'api_error';
			return send(step.status, { type: 'error', error: { type, message: `mock ${type}` } }, headers);
		}
		const params = JSON.parse(raw || '{}');
		send(
			200,
			{
				id: `msg_mock_${count}`,
				type: 'message',
				role: 'assistant',
				model: params.model ?? 'mock',
				content: [{ type: 'text', text: `reply ${count}` }],
				stop_reason: 'end_turn',
				stop_sequence: null,
				usage: { input_tokens: 10, output_tokens: 3 }
			},
			{ 'request-id': requestId }
		);
	});
	return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const port = Number(process.env.PORT ?? 8089);
	await startErrorMock(port);
	console.log(`error-mock: listening on http://127.0.0.1:${port}`);
}
