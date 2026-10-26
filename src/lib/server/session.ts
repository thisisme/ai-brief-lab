import { createHmac, timingSafeEqual } from 'node:crypto';

// The session cookie says which customer (tenant) a request belongs to: `<tenant>.<hmac>`, the
// HMAC-SHA256 of the tenant under LAB_SESSION_SECRET. Whoever sets the cookie must hold the secret,
// so the tenant can't be chosen by the caller. Plain TypeScript with no SvelteKit imports, so
// scripts/profile-test.mjs can load it with Node's own type stripping.
//
// This only proves who the tenant is. Whether it has a user profile is profileFor()'s job.

export const SESSION_COOKIE = 'lab_session';

const mac = (tenant: string, secret: string) => createHmac('sha256', secret).update(tenant).digest('base64url');

export function signSession(tenant: string, secret: string): string {
	return `${tenant}.${mac(tenant, secret)}`;
}

/** The tenant in a correctly signed cookie value, or undefined if it is malformed or forged. */
export function verifySession(value: string, secret: string): string | undefined {
	// A tenant has no dots (see TENANT in user-profiles.ts), a base64url MAC has none either.
	const dot = value.lastIndexOf('.');
	if (dot < 1) return undefined;
	const tenant = value.slice(0, dot);
	const given = Buffer.from(value.slice(dot + 1));
	const expected = Buffer.from(mac(tenant, secret));
	return given.length === expected.length && timingSafeEqual(given, expected) ? tenant : undefined;
}
