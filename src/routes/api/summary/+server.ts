import Anthropic from '@anthropic-ai/sdk';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Reads ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL from the environment.
// No openTelemetry option: the SDK uses the provider registered in instrumentation.server.ts,
// in its default content mode, metadata_only (no prompts or replies on the spans).
const client = new Anthropic();

export const POST: RequestHandler = async ({ request }) => {
	const { text } = (await request.json().catch(() => ({}))) as { text?: unknown };
	if (typeof text !== 'string' || text.trim() === '') error(400, 'Send {"text": "..."}');

	const msg = await client.messages.create({
		model: process.env.CLAUDE_MODEL ?? 'claude-haiku-5-5',
		max_tokens: 200,
		system: 'Summarize the text in one sentence of plain Swedish.',
		messages: [{ role: 'user', content: text.slice(0, 4000) }]
	});

	const summary = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
	// SvelteKit 3 deprecates its json() helper; the platform's Response.json does the same job.
	return Response.json({ summary, usage: msg.usage });
};