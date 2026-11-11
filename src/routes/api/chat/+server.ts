import Anthropic from '@anthropic-ai/sdk';
import { error, json } from '@sveltejs/kit';
import { createThreadStore } from '#lib/server/claude-threads.ts';
import type { RequestHandler } from './$types';

// One store per server process. Works on adapter-node and vite dev; a
// serverless adapter starts fresh processes, so every turn would create a thread.
// new Anthropic() reads ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL, if set) itself.
const store = createThreadStore(new Anthropic(), {
	model: 'claude-sonnet-5-5',
	system: 'You answer questions about the ai-brief-lab repo. Keep replies short.'
});

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : '';
	const message = typeof body?.message === 'string' ? body.message.trim() : '';
	if (!/^[\w-]{8,64}$/.test(conversationId)) error(400, 'conversationId: 8-64 letters, digits, - or _');
	if (!message || message.length > 8000) error(400, 'message: 1-8000 characters');

	const turn = await store.send(conversationId, message);
	return json({ id: turn.id, text: turn.text, usage: { input: turn.inputTokens, output: turn.outputTokens } });
};
