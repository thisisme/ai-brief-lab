import Anthropic from '@anthropic-ai/sdk';
import { error } from '@sveltejs/kit';
import { ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, CLAUDE_MODEL } from '$app/env/private';
import { profileFor, UnknownTenantError } from '#lib/server/user-profiles.js';
import type { RequestHandler } from './$types';

// The values come from src/env.ts (SvelteKit 3.1): read from .env, .env.local and the process
// environment, and checked when the app starts. On its own the SDK only reads process.env,
// which in `vite dev` does not include .env.local.
// No openTelemetry option: the SDK uses the provider registered in instrumentation.server.ts,
// in its default content mode, metadata_only (no prompts or replies on the spans).
const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, baseURL: ANTHROPIC_BASE_URL });

export const POST: RequestHandler = async ({ request, locals }) => {
	if (locals.badSession) error(401, 'Invalid session');
	// Only "text" is read from the body: a "tenant" in it is ignored.
	const { text } = (await request.json().catch(() => ({}))) as { text?: unknown };
	if (typeof text !== 'string' || text.trim() === '') error(400, 'Send {"text": "..."}');

	// A call made for a customer carries that customer's user profile (anthropic-user-profile-id),
	// so an enforcement action hits that customer, not the whole organization. No tenant = our
	// own usage. The tenant comes from the signed session cookie (hooks.server.ts), never from
	// the request body.
	let userProfileId: string | undefined;
	try {
		userProfileId = profileFor(locals.tenant);
	} catch (e) {
		if (e instanceof UnknownTenantError) error(400, 'Unknown tenant');
		throw e;
	}

	let msg: Anthropic.Message;
	try {
		msg = await client.messages.create({
			model: CLAUDE_MODEL,
			max_tokens: 200,
			system: 'Summarize the text in one sentence of plain Swedish.',
			messages: [{ role: 'user', content: text.slice(0, 4000) }],
			...(userProfileId ? { user_profile_id: userProfileId } : {})
		});
	} catch (e) {
		if (!(e instanceof Anthropic.APIError)) throw e;
		// Claude failed, not the caller: answer 502 (503 when overloaded or rate limited, so the
		// caller may retry) and pass on what the API said. Never the key or the prompt.
		const busy = e.status === 429 || e.status === 529;
		const detail = {
			upstream_status: e.status ?? null,
			type: e.type ?? (e.status === undefined ? 'connection_error' : 'api_error'),
			request_id: e.requestID ?? null
		};
		console.error('claude call failed', detail);
		return Response.json({ error: detail }, { status: busy ? 503 : 502 });
	}

	const summary = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
	// SvelteKit 3 deprecates its json() helper; the platform's Response.json does the same job.
	return Response.json({ summary, usage: msg.usage, attributed: Boolean(userProfileId) });
};