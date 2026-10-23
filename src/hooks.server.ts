import { LAB_SESSION_SECRET } from '$app/env/private';
import { SESSION_COOKIE, verifySession } from '#lib/server/session.js';
import type { Handle } from '@sveltejs/kit/hooks';

// locals.tenant comes only from a correctly signed session cookie. No cookie means internal
// usage (tenant undefined). A cookie that fails verification is flagged, and the routes that
// need a tenant answer 401: a stale cookie must not break the pages, a forged one must not
// quietly become "internal".
export const handle: Handle = async ({ event, resolve }) => {
	const cookie = event.cookies.get(SESSION_COOKIE);
	event.locals.tenant = cookie === undefined ? undefined : verifySession(cookie, LAB_SESSION_SECRET);
	event.locals.badSession = cookie !== undefined && event.locals.tenant === undefined;
	return resolve(event);
};
