#!/usr/bin/env node
// A local OTLP/HTTP (JSON) receiver for Claude Code metrics that keeps team-level
// numbers only. Claude Code attaches user.email, account ids and session ids to every
// metric by default; this sink drops them before anything is written to disk.
//   npm run telemetry:sink            listens on 127.0.0.1:4318
//   TELEMETRY_DIR=... PORT=...        change where it writes / listens
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 4318);
const DIR = process.env.TELEMETRY_DIR ?? '.claude/telemetry';

// The only datapoint attributes that may reach disk. Everything else is dropped,
// including user.email, user.id, user.account_uuid, user.account_id,
// organization.id, session.id, ccr.session.id and terminal.type.
const KEEP = new Set([
	'type', 'model', 'query_source', 'effort', 'speed', 'start_type',
	'tool_name', 'decision', 'source', 'language', 'team.id'
]);
// Identity attributes used only in memory: to tell series apart and to count people.
const WHO = ['user.email', 'user.account_uuid', 'user.id'];

const last = new Map(); // series hash -> last cumulative value (memory only)
const people = new Map(); // day -> Set of hashed people (memory only)

const value = (dp) => Number(dp.asDouble ?? dp.asInt ?? 0);
const hash = (s) => createHash('sha256').update(s).digest('hex');
const day = (nanos) => new Date(Number(BigInt(nanos) / 1000000n)).toISOString().slice(0, 10);

function flatten(list = []) {
	const out = {};
	for (const { key, value: v } of list) {
		out[key] = v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue ?? '';
	}
	return out;
}

function handle(body) {
	const rows = [];
	const touched = new Set();
	for (const rm of body.resourceMetrics ?? []) {
		const resource = flatten(rm.resource?.attributes);
		for (const sm of rm.scopeMetrics ?? []) {
			for (const m of sm.metrics ?? []) {
				const sum = m.sum;
				if (!sum) continue;
				const cumulative = sum.aggregationTemporality === 2;
				for (const dp of sum.dataPoints ?? []) {
					const all = { ...resource, ...flatten(dp.attributes) };
					const d = day(dp.timeUnixNano);
					touched.add(d);
					const who = WHO.map((k) => all[k]).find(Boolean);
					if (who) {
						if (!people.has(d)) people.set(d, new Set());
						people.get(d).add(hash(String(who)));
					}
					let v = value(dp);
					if (cumulative) {
						const key = hash(m.name + JSON.stringify(all) + dp.startTimeUnixNano);
						const prev = last.get(key) ?? 0;
						last.set(key, v);
						v -= prev;
					}
					if (v === 0) continue;
					const attrs = Object.fromEntries(Object.entries(all).filter(([k]) => KEEP.has(k)));
					rows.push({ day: d, metric: m.name, value: v, attrs });
				}
			}
		}
	}
	// Only the number of distinct people per day is written, never who they are.
	for (const d of touched) rows.push({ day: d, metric: 'pilot.people', value: people.get(d)?.size ?? 0, attrs: {} });
	return rows;
}

mkdirSync(DIR, { recursive: true });
createServer((req, res) => {
	let raw = '';
	req.on('data', (c) => (raw += c));
	req.on('end', () => {
		if (req.method === 'POST' && req.url === '/v1/metrics') {
			try {
				const rows = handle(JSON.parse(raw || '{}'));
				for (const r of rows) {
					appendFileSync(join(DIR, `${r.day}.jsonl`), JSON.stringify(r) + '\n');
				}
			} catch (e) {
				console.error(`otel-sink: bad payload (${e.message})`);
				res.writeHead(400).end('{}');
				return;
			}
		}
		// Logs and traces are accepted and thrown away: this sink stores metrics only.
		res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
	});
}).listen(PORT, '127.0.0.1', () => console.log(`otel-sink: listening on 127.0.0.1:${PORT}, writing ${DIR}`));