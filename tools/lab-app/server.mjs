#!/usr/bin/env node
// lab-app: one MCP App for the lab. Tool stock_status + its view ui://lab/stock.
// stdio only. Nothing here writes to stdout: stdout carries JSON-RPC.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	registerAppTool,
	registerAppResource,
	RESOURCE_MIME_TYPE
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';

const VIEW_URI = 'ui://lab/stock';
const require = createRequire(import.meta.url);

// Demo data. Read-only: no files written, no network.
const STOCK = {
	'LOOP-001': { name: 'Guest survey kit', qty: 12, reorderAt: 5 },
	'LOOP-002': { name: 'Review cards (100)', qty: 3, reorderAt: 5 },
	'LOOP-003': { name: 'Table stand', qty: 0, reorderAt: 2 }
};

function statusOf(item) {
	if (item.qty === 0) return 'out';
	return item.qty <= item.reorderAt ? 'low' : 'ok';
}

// The view must load with Claude's default CSP (no external scripts), so the
// ext-apps browser bundle is inlined: its final `export {a as B, ...}` becomes a
// plain object the view reads as globalThis.McpApps.
export function buildViewHtml() {
	const bundlePath = require.resolve('@modelcontextprotocol/ext-apps/app-with-deps');
	const bundle = readFileSync(bundlePath, 'utf8');
	const m = bundle.match(/export\s*\{([^}]*)\};?\s*$/);
	if (!m) throw new Error('lab-app: unexpected ext-apps bundle shape (no trailing export)');
	const pairs = m[1].split(',').map((p) => {
		const [local, exported] = p.trim().split(/\s+as\s+/);
		return `${exported ?? local}:${local}`;
	});
	const inlined = bundle.slice(0, m.index) + `\nglobalThis.McpApps={${pairs.join(',')}};\n`;
	const view = readFileSync(new URL('./view.html', import.meta.url), 'utf8');
	return view.replace('/*__EXT_APPS__*/', () => inlined.replaceAll('</script', '<\\/script'));
}

export function createServer() {
	const server = new McpServer({ name: 'lab-app', version: '0.1.0' });

	registerAppTool(
		server,
		'stock_status',
		{
			title: 'Stock status',
			description:
				'Shows stock for one lab SKU (LOOP-001, LOOP-002 or LOOP-003) as a card the user can refresh.',
			inputSchema: { sku: z.string().describe('SKU, for example LOOP-001') },
			annotations: { readOnlyHint: true },
			_meta: { ui: { resourceUri: VIEW_URI } }
		},
		async ({ sku }) => {
			const key = sku.trim().toUpperCase();
			const item = STOCK[key];
			if (!item) {
				return {
					isError: true,
					content: [{ type: 'text', text: `Unknown SKU ${key}. Known: ${Object.keys(STOCK).join(', ')}` }]
				};
			}
			const status = statusOf(item);
			return {
				content: [{ type: 'text', text: `${key} ${item.name}: ${item.qty} in stock (${status})` }],
				structuredContent: { sku: key, ...item, status, checkedAt: new Date().toISOString() }
			};
		}
	);

	registerAppResource(
		server,
		'Stock card',
		VIEW_URI,
		{ description: 'Card view for stock_status' },
		async () => ({
			contents: [{ uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: buildViewHtml() }]
		})
	);

	return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await createServer().connect(new StdioServerTransport());
	console.error('lab-app: ready on stdio');
}