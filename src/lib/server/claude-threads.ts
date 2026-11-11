// One server-held Claude conversation per chat, kept in this Node process.
// The SDK's thread helper sends only the new messages on each turn and
// replays the full history by itself when the server has dropped the thread.
import type Anthropic from '@anthropic-ai/sdk';

type BetaMessageThread = ReturnType<Anthropic['beta']['messages']['thread']>;

export type ThreadStoreOptions = {
	model: string;
	system: string;
	maxTokens?: number;
	/** Drop our copy this long after the last turn. The API keeps a thread 5 minutes. */
	idleMs?: number;
	/** Most conversations held at once; the oldest goes first. */
	maxThreads?: number;
};

export type Turn = { id: string; text: string; inputTokens: number; outputTokens: number };

export function createThreadStore(client: Anthropic, opts: ThreadStoreOptions) {
	const idleMs = opts.idleMs ?? 30 * 60_000;
	const maxThreads = opts.maxThreads ?? 200;
	const threads = new Map<string, { thread: BetaMessageThread; lastUsed: number }>();

	function sweep(now: number) {
		for (const [key, entry] of threads) {
			if (now - entry.lastUsed > idleMs) threads.delete(key);
		}
		while (threads.size > maxThreads) {
			const oldest = threads.keys().next().value;
			if (oldest === undefined) break;
			threads.delete(oldest);
		}
	}

	return {
		get size() {
			return threads.size;
		},
		history(conversationId: string) {
			return threads.get(conversationId)?.thread.messages ?? [];
		},
		async send(conversationId: string, text: string): Promise<Turn> {
			const now = Date.now();
			let entry = threads.get(conversationId);
			if (!entry) {
				entry = {
					thread: client.beta.messages.thread({
						model: opts.model,
						max_tokens: opts.maxTokens ?? 1024,
						system: opts.system,
						// Top-level cache_control is a fixed field: same value on every turn.
						cache_control: { type: 'ephemeral' }
					}),
					lastUsed: now
				};
			}
			// Re-insert so Map order stays least recently used first.
			threads.delete(conversationId);
			threads.set(conversationId, entry);
			entry.lastUsed = now;
			sweep(now);

			const reply = await entry.thread.send({ role: 'user', content: text });
			let out = '';
			for (const block of reply.content) if (block.type === 'text') out += block.text;
			return {
				id: reply.id,
				text: out,
				inputTokens: reply.usage.input_tokens,
				outputTokens: reply.usage.output_tokens
			};
		}
	};
}
