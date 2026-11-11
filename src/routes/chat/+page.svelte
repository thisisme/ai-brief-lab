<script lang="ts">
	type Line = { who: 'you' | 'claude' | 'note'; text: string };

	const conversationId = crypto.randomUUID();
	let lines = $state<Line[]>([]);
	let draft = $state('');
	let busy = $state(false);
	/** Seconds left before the automatic retry; 0 when not waiting. */
	let waitFor = $state(0);

	const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	async function ask(message: string, triesLeft = 2): Promise<void> {
		const res = await fetch('/api/chat', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ conversationId, message })
		});
		const data = await res.json().catch(() => ({}));
		if (res.ok) {
			lines.push({ who: 'claude', text: data.text });
			return;
		}
		// 503, 429, 504, 502 and 409 come with Retry-After; 500 and 400 don't.
		const wait = Number(res.headers.get('retry-after') ?? data.retryAfter ?? 0);
		if (wait > 0 && wait <= 30 && triesLeft > 0) {
			for (waitFor = wait; waitFor > 0; waitFor--) await sleep(1000);
			return ask(message, triesLeft - 1);
		}
		lines.push({ who: 'note', text: data.message ?? `Error ${res.status}` });
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const message = draft.trim();
		if (!message || busy) return;
		draft = '';
		lines.push({ who: 'you', text: message });
		busy = true;
		try {
			await ask(message);
		} finally {
			busy = false;
			waitFor = 0;
		}
	}
</script>

<h1>Lab chat</h1>

<ol aria-live="polite">
	{#each lines as line, i (i)}
		<li class={line.who}><b>{line.who}:</b> {line.text}</li>
	{/each}
</ol>

<p role="status">
	{#if waitFor > 0}Claude is busy. Trying again in {waitFor} s.{:else if busy}Waiting for Claude…{/if}
</p>

<form onsubmit={submit}>
	<label for="message">Message</label>
	<input id="message" bind:value={draft} maxlength="8000" autocomplete="off" />
	<button disabled={busy}>Send</button>
</form>

<style>
	.note {
		color: #a33;
	}
	[role='status'] {
		min-height: 1.5em;
	}
</style>
