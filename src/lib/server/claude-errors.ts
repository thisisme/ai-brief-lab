// Turn a failed Claude call into an answer the browser can act on:
// a status, a message that is safe to show, and how long to wait.
import {
	AnthropicError,
	APIConnectionError,
	APIConnectionTimeoutError,
	APIError,
	AuthenticationError,
	GatewayTimeoutError,
	OverloadedError,
	PermissionDeniedError,
	RateLimitError,
	RequestTimeoutError,
	ServiceUnavailableError
} from '@anthropic-ai/sdk';

export type Failure = {
	status: number;
	/** Safe to show to the user. Never contains the API's own error text. */
	message: string;
	/** Seconds the browser should wait before trying again, or null for "don't". */
	retryAfter: number | null;
	/** One line for the server log: class name, status, type, code, request id. */
	log: string;
};

/** retry-after-ms or retry-after (seconds or an HTTP date), rounded up to whole seconds. */
export function retryAfterSeconds(headers: Headers | null | undefined): number | null {
	if (!headers) return null;
	const ms = Number.parseFloat(headers.get('retry-after-ms') ?? '');
	if (ms > 0) return Math.ceil(ms / 1000);
	const raw = headers.get('retry-after');
	if (!raw) return null;
	const seconds = Number.parseFloat(raw);
	if (!Number.isNaN(seconds)) return seconds > 0 ? Math.ceil(seconds) : null;
	const at = Date.parse(raw);
	return Number.isNaN(at) ? null : Math.max(1, Math.ceil((at - Date.now()) / 1000));
}

/**
 * A fetch for new Anthropic({ fetch }). The SDK honours retry-after however long it is,
 * so one 429 with retry-after: 30 holds the request open for 30 s per retry. This marks
 * such responses x-should-retry: false: the SDK gives up at once and the browser gets the wait.
 */
export function capRetryAfter(maxWaitSeconds: number, fetchImpl: typeof fetch = fetch): typeof fetch {
	return async (input, init) => {
		const res = await fetchImpl(input, init);
		const wait = retryAfterSeconds(res.headers);
		if (res.ok || wait === null || wait <= maxWaitSeconds) return res;
		const headers = new Headers(res.headers);
		headers.set('x-should-retry', 'false');
		return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
	};
}

export function toHttpFailure(e: unknown): Failure {
	if (e instanceof APIError) {
		const wait = retryAfterSeconds(e.headers);
		const log =
			`claude-error ${e.name} status=${e.status ?? '-'} type=${e.type ?? '-'}` +
			` code=${e.errorCode ?? '-'} request=${e.requestID ?? '-'}`;
		if (e instanceof OverloadedError || e instanceof ServiceUnavailableError) {
			return { status: 503, message: 'Claude is busy right now.', retryAfter: wait ?? 5, log };
		}
		if (e instanceof RateLimitError) {
			return { status: 429, message: 'Too many requests to Claude.', retryAfter: wait ?? 10, log };
		}
		if (
			e instanceof APIConnectionTimeoutError ||
			e instanceof GatewayTimeoutError ||
			e instanceof RequestTimeoutError
		) {
			return { status: 504, message: 'Claude took too long to answer.', retryAfter: 2, log };
		}
		// After the timeout check: APIConnectionTimeoutError extends APIConnectionError.
		if (e instanceof APIConnectionError) {
			return { status: 502, message: 'Could not reach Claude.', retryAfter: 5, log };
		}
		if (e instanceof AuthenticationError || e instanceof PermissionDeniedError) {
			return { status: 500, message: 'The chat is not set up correctly.', retryAfter: null, log };
		}
		return { status: 502, message: 'Claude could not answer this request.', retryAfter: null, log };
	}
	// The thread helper throws a plain AnthropicError when a second send() starts mid-turn.
	if (e instanceof AnthropicError && /already in progress/.test(e.message)) {
		return {
			status: 409,
			message: 'Wait for the previous answer first.',
			retryAfter: 1,
			log: `claude-error ${e.name} overlapping turn`
		};
	}
	const name = e instanceof Error ? e.name : typeof e;
	return { status: 500, message: 'Something went wrong.', retryAfter: null, log: `claude-error ${name} unexpected` };
}
