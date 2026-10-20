#!/usr/bin/env node
// A tiny local trace receiver: accepts OTLP/HTTP JSON on 127.0.0.1:4319/v1/traces and
// appends one line per span to .claude/traces/<day>.jsonl. Nothing leaves the machine.
//   node scripts/trace-sink.mjs            run the receiver
//   node scripts/trace-sink.mjs --tree     print the newest trace as a tree and exit
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.TRACE_DIR ?? '.claude/traces';
const PORT = Number(process.env.TRACE_SINK_PORT ?? 4319);

const val = (v = {}) =>
	v.stringValue ?? v.boolValue ?? (v.intValue !== undefined ? Number(v.intValue) : undefined) ??
	v.doubleValue ?? (v.arrayValue ? (v.arrayValue.values ?? []).map(val) : undefined);
const attrs = (list = []) => Object.fromEntries(list.map((a) => [a.key, val(a.value)]));

if (process.argv.includes('--tree')) {
	const files = readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).sort();
	if (!files.length) {
		console.log('trace-sink: no spans yet');
		process.exit(1);
	}
	const spans = readFileSync(join(DIR, files.at(-1)), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
	const traceId = process.argv[3] ?? spans.at(-1).traceId;
	const mine = spans.filter((s) => s.traceId === traceId);
	const ids = new Set(mine.map((s) => s.spanId));
	const print = (parent, depth) => {
		for (const s of mine.filter((x) => (x.parentSpanId || null) === parent)) {
			const extra = ['http.route', 'gen_ai.request.model', 'gen_ai.usage.input_tokens', 'gen_ai.usage.output_tokens']
				.filter((k) => s.attrs[k] !== undefined).map((k) => `${k}=${s.attrs[k]}`).join(' ');
			console.log(`${'  '.repeat(depth)}${s.name}  ${s.ms} ms${extra ? '  ' + extra : ''}`);
			print(s.spanId, depth + 1);
		}
	};
	console.log(`trace ${traceId}`);
	// Roots: no parent, or a parent this receiver never saw (e.g. from another service).
	for (const r of mine.filter((s) => !s.parentSpanId || !ids.has(s.parentSpanId))) {
		mine.splice(mine.indexOf(r), 1, { ...r, parentSpanId: null });
	}
	print(null, 0);
	process.exit(0);
}

mkdirSync(DIR, { recursive: true });
createServer((req, res) => {
	if (req.method !== 'POST' || req.url !== '/v1/traces') {
		res.writeHead(404).end();
		return;
	}
	let body = '';
	req.on('data', (c) => (body += c));
	req.on('end', () => {
		try {
			const day = new Date().toISOString().slice(0, 10);
			for (const rs of JSON.parse(body).resourceSpans ?? []) {
				const service = attrs(rs.resource?.attributes)['service.name'];
				for (const ss of rs.scopeSpans ?? []) {
					for (const s of ss.spans ?? []) {
						const line = {
							traceId: s.traceId,
							spanId: s.spanId,
							parentSpanId: s.parentSpanId || null,
							name: s.name,
							kind: s.kind,
							ms: Math.round((Number(s.endTimeUnixNano) - Number(s.startTimeUnixNano)) / 1e6),
							status: s.status?.code ?? 0,
							service,
							scope: ss.scope?.name,
							attrs: attrs(s.attributes)
						};
						appendFileSync(join(DIR, `${day}.jsonl`), JSON.stringify(line) + '\n');
					}
				}
			}
			res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
		} catch (e) {
			res.writeHead(400).end(String(e));
		}
	});
}).listen(PORT, '127.0.0.1', () => console.log(`trace-sink: listening on 127.0.0.1:${PORT}, writing ${DIR}/`));
