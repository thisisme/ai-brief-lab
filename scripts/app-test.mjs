#!/usr/bin/env node
// app-test: checks the lab-app MCP App without Claude and without an API key.
// Part 1 talks MCP over stdio. Part 2 renders the view in Chromium inside a tiny
// fake host that speaks the MCP Apps postMessage protocol, under the spec's default CSP.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from './pw.mjs';

const MIME = 'text/html;profile=mcp-app';
const CSP =
	"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'";
let failed = 0;
const check = (ok, label) => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
	if (!ok) failed++;
};

const client = new Client({ name: 'app-test', version: '0.1.0' });
await client.connect(
	new StdioClientTransport({ command: process.execPath, args: ['tools/lab-app/server.mjs'], stderr: 'ignore' })
);

const { tools } = await client.listTools();
const tool = tools.find((t) => t.name === 'stock_status');
const uri = tool?._meta?.ui?.resourceUri;
check(uri === 'ui://lab/stock', 'stock_status links its view with _meta.ui.resourceUri');

const { contents } = await client.readResource({ uri });
const html = contents[0]?.text ?? '';
check(contents[0]?.mimeType === MIME, `the view is served as ${MIME}`);
check(!/<script[^>]+\bsrc=/i.test(html) && !/https?:\/\/[^"'\s]+\.js/.test(html), 'the view loads no external script');

const good = await client.callTool({ name: 'stock_status', arguments: { sku: 'loop-002' } });
check(good.structuredContent?.qty === 3 && good.structuredContent?.status === 'low', 'LOOP-002: 3 in stock, status low');
const bad = await client.callTool({ name: 'stock_status', arguments: { sku: 'NOPE' } });
check(bad.isError === true, 'an unknown SKU returns isError');

// Part 2: the fake host.
const browser = await chromium.launch();
const page = await browser.newPage();
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(String(e)));
await page.exposeFunction('callTool', (params) => client.callTool(params));

const srcdoc = html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${CSP}">`);
await page.setContent(`<!doctype html><iframe id="v" sandbox="allow-scripts" style="width:420px;height:260px"></iframe>
<script>
window.seen = [];
window.modelContext = [];
const frame = document.getElementById('v');
const send = (msg) => frame.contentWindow.postMessage({ jsonrpc: '2.0', ...msg }, '*');
window.addEventListener('message', async (e) => {
	if (e.source !== frame.contentWindow) return;
	const m = e.data;
	window.seen.push(m.method ?? 'response');
	if (m.method === 'ui/initialize') {
		send({ id: m.id, result: {
			protocolVersion: m.params.protocolVersion,
			hostInfo: { name: 'fake-host', version: '0.0.0' },
			hostCapabilities: { serverTools: {}, updateModelContext: { text: {} } },
			hostContext: { theme: 'dark', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'], platform: 'web' }
		} });
	} else if (m.method === 'ui/notifications/initialized') {
		send({ method: 'ui/notifications/tool-input', params: { arguments: { sku: 'LOOP-001' } } });
		send({ method: 'ui/notifications/tool-result', params: await window.callTool({ name: 'stock_status', arguments: { sku: 'LOOP-001' } }) });
	} else if (m.method === 'tools/call') {
		send({ id: m.id, result: await window.callTool(m.params) });
	} else if (m.method === 'ui/update-model-context') {
		window.modelContext.push(m.params);
		send({ id: m.id, result: {} });
	} else if (m.method === 'ui/request-display-mode') {
		send({ id: m.id, result: { mode: m.params.mode } });
	} else if (m.id !== undefined && m.method) {
		send({ id: m.id, result: {} });
	}
});
frame.srcdoc = ${JSON.stringify(srcdoc).replaceAll("</", "<\\/")};
</script>`);

const view = page.frameLocator('#v');
const qty = view.locator('stock-card').locator('.qty');
await qty.filter({ hasText: '12' }).waitFor({ timeout: 10000 }).catch(() => {});
check((await qty.textContent()) === '12', 'the card renders LOOP-001 from the pushed tool result: 12');
check(
	(await page.evaluate(() => window.seen.slice(0, 2).join(' '))) === 'ui/initialize ui/notifications/initialized',
	'the view opens with ui/initialize, then initialized'
);
const contextBeforeRefresh = await page.evaluate(() => window.seen.includes('ui/update-model-context'));
await view.locator('#refresh').click();
await view.locator('#log').filter({ hasText: 'Checked' }).waitFor({ timeout: 5000 }).catch(() => {});
check((await page.evaluate(() => window.seen.includes('tools/call'))), 'Refresh calls the server tool through the host');
await page.waitForFunction(() => window.modelContext.length > 0, null, { timeout: 5000 }).catch(() => {});
const ctx = await page.evaluate(() => ({
	order: window.seen.indexOf('ui/update-model-context') > window.seen.indexOf('tools/call'),
	params: window.modelContext
}));
const block = ctx.params[0]?.content;
check(
	!contextBeforeRefresh &&
		ctx.order &&
		ctx.params.length === 1 &&
		block?.length === 1 &&
		block[0].type === 'text' &&
		/^LOOP-001 now shows 12 in stock \(ok\), checked \d{2}:\d{2}$/.test(block[0].text),
	`after Refresh the view sends ui/update-model-context with one text block${block ? ': ' + JSON.stringify(block[0]?.text) : ''}`
);
await view.locator('#full').click();
await view.locator('#log').filter({ hasText: 'fullscreen' }).waitFor({ timeout: 5000 }).catch(() => {});
check((await view.locator('#log').textContent()) === 'Display mode: fullscreen', 'Full screen asks the host with ui/request-display-mode');
const cspHits = problems.filter((p) => /Content Security Policy|EvalError|unsafe-eval/i.test(p));
check(cspHits.length === 0, `no CSP or eval errors under the default CSP${cspHits.length ? ': ' + cspHits[0] : ''}`);

await browser.close();
await client.close();
console.log(failed ? `app-test: ${failed} failed` : 'app-test: all passed');
process.exit(failed ? 1 : 0);