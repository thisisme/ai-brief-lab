#!/usr/bin/env node
// Create and list Claude user profiles for this app's customers (tenants).
//
//   node --env-file-if-exists=.env.local scripts/user-profile.mjs add <tenant> [--country SE] [--entity business]
//   node scripts/user-profile.mjs list
//
// Creating a profile is free but NOT idempotent: every create makes a new uprof_ id, even for the
// same reference_id. So "add" refuses a tenant that is already in the map, and the map
// (data/user-profiles.json, or $PROFILE_MAP) is committed like any other config.
// Sent to Anthropic: reference_id (the tenant slug), and country / entity_type if given.
// No name, no email, no hashes: add those only after your DPO has agreed what to share.
import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

const MAP = process.env.PROFILE_MAP ?? 'data/user-profiles.json';
const TENANT = /^[a-z0-9][a-z0-9-]{1,62}$/;
const ENTITIES = ['individual', 'business', 'non_profit', 'government'];

function load() {
	try {
		return JSON.parse(readFileSync(MAP, 'utf8'));
	} catch (e) {
		if (e.code === 'ENOENT') return {};
		throw e;
	}
}

function save(map) {
	mkdirSync(dirname(MAP), { recursive: true });
	const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
	writeFileSync(MAP + '.tmp', JSON.stringify(sorted, null, '\t') + '\n');
	renameSync(MAP + '.tmp', MAP);
}

function fail(msg) {
	console.error(`user-profile: ${msg}`);
	process.exit(1);
}

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: { country: { type: 'string' }, entity: { type: 'string' } }
});
const [cmd, tenant] = positionals;

if (cmd === 'list') {
	const map = load();
	for (const [t, p] of Object.entries(map)) console.log(`${t.padEnd(24)} ${p.id}  ${p.created_at}`);
	console.log(`${Object.keys(map).length} profile(s) in ${MAP}`);
} else if (cmd === 'add') {
	if (!tenant || !TENANT.test(tenant)) fail('add needs a tenant slug: a-z, 0-9 and -, 2 to 63 characters');
	if (values.country && !/^[A-Z]{2}$/.test(values.country)) fail('--country takes an ISO 3166-1 alpha-2 code, e.g. SE');
	if (values.entity && !ENTITIES.includes(values.entity)) fail(`--entity is one of ${ENTITIES.join(', ')}`);
	const map = load();
	if (Object.hasOwn(map, tenant)) fail(`${tenant} already has ${map[tenant].id}; creating again would make a second profile`);

	const external_user_details = { reference_id: tenant };
	if (values.country) external_user_details.country = values.country;
	if (values.entity) external_user_details.entity_type = values.entity;

	const client = new Anthropic(); // ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL) from the environment
	let profile;
	try {
		profile = await client.userProfiles.create({ access_type: 'application', external_user_details });
	} catch (e) {
		if (e instanceof Anthropic.APIError) fail(`API answered ${e.status ?? 'no status'} ${e.type ?? ''} (request ${e.requestID ?? 'n/a'})`);
		throw e;
	}
	map[tenant] = { id: profile.id, created_at: profile.created_at };
	save(map);
	console.log(`${tenant} -> ${profile.id}`);
} else {
	fail('usage: user-profile.mjs add <tenant> [--country SE] [--entity business] | list');
}