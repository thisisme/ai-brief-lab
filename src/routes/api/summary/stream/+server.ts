import Anthropic from '@anthropic-ai/sdk';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Same client setup as ../+server.ts: the SDK uses the provider registered in
// instrumentation.server.ts, in its default content mode, metadata_only.
const client = new Anthropic();

export const POST: RequestHandler = async ({ request }) => {
	const { text } = (await request.json().catch(() => ({}))) as { text?: unknown };
	if (typeof text !== 'string' || text.trim() === '') error(400, 'Send {"text": "..."}');

	const stream = client.messages.stream({
		model: process.env.CLAUDE_MODEL ?? 'claude-haiku-5-5',
		max_tokens: 200,
		system: 'Summarize the text in one sentence of plain Swedish.',
		messages: [{ role: 'user', content: text.slice(0, 4000) }]
	});

	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			stream.on('text', (delta) => controller.enqueue(encoder.encode(delta)));
			stream.on('end', () => controller.close());
			stream.on('error', (err) => controller.error(err));
		},
		cancel() {
			stream.abort();
		}
	});

	return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
