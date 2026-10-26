#!/usr/bin/env node
// A local OTLP/HTTP (JSON) receiver for Claude Code telemetry that keeps team-level
// numbers only. Claude Code attaches user.email, account ids and session ids to every
// metric and event by default; this sink drops them before anything is written to disk.
//   npm run telemetry:sink            listens on 127.0.0.1:4318
//   TELEMETRY_DIR=... PORT=...        change where it writes / listens
// Metrics go to <dir>/<day>.jsonl. Of the log events, only claude_code.safety_event is
// kept (Claude Code 2.1.307+), in <dir>/safety/<day>.jsonl. Every other event is dropped.
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 4318);
const DIR = process.env.TELEMETRY_DIR ?? '.claude/telemetry';
const SAFETY_DIR = join(DIR, 'safety');

// The only metric datapoint attributes that may reach disk. Everything else is dropped,
// including user.email, user.id, user.account_uuid, user.account_id,
// organization.id, session.id, ccr.session.id and terminal.type.
const KEEP = new Set([
	'type', 'model', 'query_source', 'effort', 'speed', 'start_type',
	'tool_name', 'decision', 'source', 'language', 'team.id'
]);
// The only safety_event attributes that may reach disk. tool_parameters (the command or
// file path, sent when OTEL_LOG_TOOL_DETAILS=1), prompt.id and tool_use_id are dropped too.
const KEEP_SAFETY = new Set([
	'category', 'decision', 'decision_source', 'reason_type', 'reason_code', 'rule_source',
	'hook_event', 'classifier_verdict', 'tool_class', 'tool_name', 'tool_source',
	'permission_mode', 'sandbox_enabled', 'sandbox_violation_count', 'team.id', 'service.version'
]);
// Identity attributes used only in memory: to tell series apart and to count people.
const WHO = ['user.email', 'user.account_uuid', 'user.id'];

const last = new Map(); // series hash -> last cumulative value (memory only)
const people = new Map(); // day -> Set of hashed people (memory only)
const safetyPeople = new Map(); // day -> Set of hashed people with a safety event (memory only)

const value = (dp) => Number(dp.asDouble ?? dp.asInt ?? 0);
const hash = (s) => createHash('sha256').update(s).digest('hex');
const day = (nanos) => new Date(Number(BigInt(nanos) / 1000000n)).toISOString().slice(0, 10);
const pick = (all, keep) => Object.fromEntries(Object.entries(all).filter(([k]) => keep.has(k)));

function flatten(list = []) {
	const out = {};
	for (const { key, value: v } of list) {
		out[key] = v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue ?? '';
	}
	return out;
}

function count(map, d, all) {
	const who = WHO.map((k) => all[k]).find(Boolean);
	if (!who) return;
	if (!map.has(d)) map.set(d, new Set());
	map.get(d).add(hash(String(who)));
}

function handleMetrics(body) {
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
					count(people, d, all);
					let v = value(dp);
					if (cumulative) {
						const key = hash(m.name + JSON.stringify(all) + dp.startTimeUnixNano);
						const prev = last.get(key) ?? 0;
						last.set(key, v);
						v -= prev;
					}
					if (v === 0) continue;
					rows.push({ day: d, metric: m.name, value: v, attrs: pick(all, KEEP) });
				}
			}
		}
	}
	// Only the number of distinct people per day is written, never who they are.
	for (const d of touched) rows.push({ day: d, metric: 'pilot.people', value: people.get(d)?.size ?? 0, attrs: {} });
	return rows;
}

function handleLogs(body) {
	const rows = [];
	const touched = new Set();
	for (const rl of body.resourceLogs ?? []) {
		const resource = flatten(rl.resource?.attributes);
		for (const sl of rl.scopeLogs ?? []) {
			for (const lr of sl.logRecords ?? []) {
				const all = { ...resource, ...flatten(lr.attributes) };
				const name = lr.body?.stringValue ?? `claude_code.${all['event.name']}`;
				if (name !== 'claude_code.safety_event') continue;
				const d = day(lr.timeUnixNano ?? lr.observedTimeUnixNano ?? String(BigInt(Date.now()) * 1000000n));
				touched.add(d);
				count(safetyPeople, d, all);
				rows.push({ day: d, event: 'safety', attrs: pick(all, KEEP_SAFETY) });
			}
		}
	}
	for (const d of touched) rows.push({ day: d, event: 'safety.people', value: safetyPeople.get(d)?.size ?? 0 });
	return rows;
}

mkdirSync(DIR, { recursive: true });
createServer((req, res) => {
	let raw = '';
	req.on('data', (c) => (raw += c));
	req.on('end', () => {
		// The Oct 15 sink answers {} here; this one names itself, so you can tell which is on the port.
		if (req.method === 'GET' && req.url === '/health') {
			res.writeHead(200, { 'content-type': 'application/json' }).end('{"sink":"otel-sink","safety":true}');
			return;
		}
		const routes = { '/v1/metrics': [handleMetrics, DIR], '/v1/logs': [handleLogs, SAFETY_DIR] };
		const route = req.method === 'POST' ? routes[req.url] : undefined;
		if (route) {
			try {
				const [handle, dir] = route;
				const rows = handle(JSON.parse(raw || '{}'));
				if (rows.length) mkdirSync(dir, { recursive: true }); // safety/ appears with the first event
				for (const r of rows) {
					appendFileSync(join(dir, `${r.day}.jsonl`), JSON.stringify(r) + '\n');
				}
			} catch (e) {
				console.error(`otel-sink: bad payload (${e.message})`);
				res.writeHead(400).end('{}');
				return;
			}
		}
		// Traces are accepted and thrown away.
		res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
	});
})
	.on('error', (e) => {
		// Usually the Oct 15 sink is still running: it would answer every export and drop the safety events.
		console.error(`otel-sink: can't listen on 127.0.0.1:${PORT} (${e.code}). Stop the process on that port and start this one again.`);
		process.exit(1);
	})
	.listen(PORT, '127.0.0.1', () => console.log(`otel-sink: listening on 127.0.0.1:${PORT}, writing ${DIR} (metrics and safety events)`));