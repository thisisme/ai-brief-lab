import { readFileSync } from 'node:fs';

// Which Claude user profile each customer (tenant) maps to. scripts/user-profile.mjs writes
// data/user-profiles.json; this module only reads it. Plain TypeScript with no SvelteKit
// imports, so scripts/profile-test.mjs can load it with Node's own type stripping.
//
// No tenant means the call is our own (internal) usage: no profile, by design.
// A tenant without a profile is refused, so customer traffic never goes out unattributed.

export type ProfileEntry = { id: string; created_at: string };
export type ProfileMap = Record<string, ProfileEntry>;

export class UnknownTenantError extends Error {
	tenant: string;
	constructor(tenant: string) {
		super(`no user profile for tenant "${tenant}": run node scripts/user-profile.mjs add ${tenant}`);
		this.name = 'UnknownTenantError';
		this.tenant = tenant;
	}
}

const TENANT = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function mapPath(): string {
	return process.env.PROFILE_MAP ?? 'data/user-profiles.json';
}

export function loadProfiles(path: string = mapPath()): ProfileMap {
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as ProfileMap;
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
		throw e;
	}
}

/** The uprof_ id to send for this tenant, or undefined for internal calls. */
export function profileFor(tenant: unknown, profiles: ProfileMap = loadProfiles()): string | undefined {
	if (tenant === undefined || tenant === null || tenant === '') return undefined;
	if (typeof tenant !== 'string' || !TENANT.test(tenant)) throw new UnknownTenantError(String(tenant));
	const entry = Object.hasOwn(profiles, tenant) ? profiles[tenant] : undefined;
	if (typeof entry?.id !== 'string' || !entry.id.startsWith('uprof_')) throw new UnknownTenantError(tenant);
	return entry.id;
}