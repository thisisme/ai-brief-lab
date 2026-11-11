#!/usr/bin/env node
// Opens /chat in Chromium against scripts/error-mock.mjs and checks what a person sees
// when Claude is busy or the key is wrong. Uses ports 8089 and 5197, no API key.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { startErrorMock } from './error-mock.mjs';

const MOCK = 'http://127.0.0.1:8089';
const APP = 'http://127.0.0.1:5197';
const mock = await startErrorMock(8089);
const vite = spawn('node_modules/.bin/vite', ['dev', '--host', '127.0.0.1', '--port', '5197', '--strictPort'], {
	env: { ...process.env, ANTHROPIC_BASE_URL: MOCK, ANTHROPIC_API_KEY: 'test' },
	stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
vite.stdout.on('data', (d) => (serverLog += d));
vite.stderr.on('data', (d) => (serverLog += d));

let failed = 0;
const check = (name, ok, detail = '') => {
	if (!ok) failed += 1;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `  (${detail})`}`);
};
const script = (steps) => fetch(`${MOCK}/__script`, { method: 'POST', body: JSON.stringify(steps) });
const hits = async () => (await (await fetch(`${MOCK}/__count`)).json()).count;

const browser = await chromium.launch();
try {
	for (let i = 0; i < 60; i++) {
		if ((await fetch(`${APP}/chat`).catch(() => null))?.ok) break;
		await new Promise((r) => setTimeout(r, 500));
	}
	const page = await browser.newPage();
	await page.goto(`${APP}/chat`);
	await page.waitForLoadState('networkidle');

	await script([{ status: 529, retryAfter: 3 }]);
	await page.getByLabel('Message').fill('What does verify run?');
	await page.getByRole('button', { name: 'Send' }).click();
	const status = page.getByRole('status');
	await status.filter({ hasText: 'Trying again in' }).waitFor({ timeout: 5000 }).catch(() => {});
	check('529 with retry-after 3: the page counts down', /Claude is busy\. Trying again in [1-3] s\./.test(await status.innerText()), await status.innerText());
	await page.locator('li.claude').first().waitFor({ timeout: 10_000 }).catch(() => {});
	check(
		'then retries on its own and shows the reply',
		(await page.locator('li.claude').first().innerText().catch(() => '')) === 'claude: reply 2' && (await hits()) === 2,
		`hits=${await hits()}`
	);
	check('the server logged OverloadedError with the request id', serverLog.includes('claude-error OverloadedError status=529 type=overloaded_error code=- request=req_mock_1'));

	await script([{ status: 401 }]);
	await page.getByLabel('Message').fill('And now?');
	await page.getByRole('button', { name: 'Send' }).click();
	await page.locator('li.note').first().waitFor({ timeout: 5000 }).catch(() => {});
	check(
		'401: one request, a plain note, no API text',
		(await page.locator('li.note').first().innerText().catch(() => '')) === 'note: The chat is not set up correctly.' && (await hits()) === 1
	);
} finally {
	await browser.close();
	vite.kill();
	mock.close();
}

console.log(failed ? `chat-smoke: ${failed} failed` : 'chat-smoke: all passed');
process.exit(failed ? 1 : 0);
