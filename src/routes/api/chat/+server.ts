import Anthropic from '@anthropic-ai/sdk';
import { error, json } from '@sveltejs/kit';
import { capRetryAfter, toHttpFailure } from '#lib/server/claude-errors.ts';
import { createThreadStore } from '#lib/server/claude-threads.ts';
import { shapeRequest, type Effort } from '#lib/server/model-shape.ts';
import type { RequestHandler } from './$types';

// CLAUDE_CHAT_MODEL picks the model (default claude-sonnet-5-5), CLAUDE_CHAT_EFFORT the
// effort for models whose API default is high (Fable 5.2, Mythos 5.2). shapeRequest()
// rewrites what those models reject and returns one line per change, logged once at start.
// Read from the process directly so src/env.ts (Oct 16 lab) stays as it is.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const model = env.CLAUDE_CHAT_MODEL || 'claude-sonnet-5-5';
const system = 'You answer questions about the ai-brief-lab repo. Keep replies short.';
const shaped = shapeRequest(
	{ model, max_tokens: 1024, system },
	{ defaultEffort: (env.CLAUDE_CHAT_EFFORT as Effort | undefined) || 'medium' }
);
for (const c of shaped.changes) console.log(`model-shape ${model}: ${c}`);
const { model: _m, max_tokens: _t, system: _s, ...fields } = shaped.params;

// One store per server process. Works on adapter-node and vite dev; a
// serverless adapter starts fresh processes, so every turn would create a thread.
// new Anthropic() reads ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL, if set) itself.
// maxRetries 1 + capRetryAfter(2): the SDK retries a 429 or 5xx once, and only when
// the API asks for 2 s or less. A longer wait goes back to the browser as Retry-After.
const store = createThreadStore(new Anthropic({ maxRetries: 1, fetch: capRetryAfter(2) }), {
	model,
	system,
	fields
});

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : '';
	const message = typeof body?.message === 'string' ? body.message.trim() : '';
	if (!/^[\w-]{8,64}$/.test(conversationId)) error(400, 'conversationId: 8-64 letters, digits, - or _');
	if (!message || message.length > 8000) error(400, 'message: 1-8000 characters');

	try {
		const turn = await store.send(conversationId, message);
		return json({ id: turn.id, text: turn.text, usage: { input: turn.inputTokens, output: turn.outputTokens } });
	} catch (e) {
		const failure = toHttpFailure(e);
		console.error(failure.log);
		return json(
			{ message: failure.message, retryAfter: failure.retryAfter },
			{
				status: failure.status,
				headers: failure.retryAfter ? { 'retry-after': String(failure.retryAfter) } : {}
			}
		);
	}
};
