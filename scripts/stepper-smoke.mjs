#!/usr/bin/env node
// Browser check that <qty-stepper> only enhances inputs that already work.
//   npm run stepper:smoke         (needs `npm run elements:serve` running)
//   node scripts/stepper-smoke.mjs http://127.0.0.1:8099/stepper.php
// Exit 0 when every check prints "ok", 1 if any prints "FAIL".
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:8099/stepper.php';
const browser = await chromium.launch(
	process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);
let failed = false;
const check = (ok, what, detail = '') => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  (${detail})` : ''}`);
	if (!ok) failed = true;
};
const result = async (page) =>
	(await page.locator('#result').count()) ? JSON.parse(await page.locator('#result').innerText()) : null;

// Fill both fields, submit, and return what PHP answered (null if the browser blocked it).
async function order(page, mug, towel) {
	await page.locator('#q-HLM-001').fill(String(mug));
	await page.locator('#q-HLM-002').fill(String(towel));
	await page.getByRole('button', { name: 'Order' }).click();
	await page.waitForLoadState('load');
	await page.waitForTimeout(200);
	return result(page);
}

try {
	// 1. No JavaScript at all: the server's inputs post and validate on their own.
	{
		const ctx = await browser.newContext({ javaScriptEnabled: false });
		const page = await ctx.newPage();
		await page.goto(url);
		const blocked = await order(page, 1, 5);
		await page.goto(url);
		const r = await order(page, 2, 3);
		check(blocked === null && r?.ok && r.qty['HLM-002'] === 3, 'works with JavaScript off', JSON.stringify(r));
		await ctx.close();
	}

	// 2. The bundle fails to load: same result, no buttons.
	{
		const ctx = await browser.newContext();
		await ctx.route('**/build/elements.js', (route) => route.abort());
		const page = await ctx.newPage();
		await page.goto(url);
		const buttons = await page.locator('qty-stepper button').count();
		const r = await order(page, 4, 1);
		check(buttons === 0 && r?.ok && r.qty['HLM-001'] === 4, 'works when the bundle fails to load', `buttons ${buttons}`);
		await ctx.close();
	}

	// 3–7. Upgraded.
	const page = await browser.newPage();
	await page.goto(url);
	await page.waitForFunction(() => customElements.get('qty-stepper'));
	const towel = page.locator('qty-stepper').nth(1);

	const shape = await page.evaluate(() => {
		const s = document.querySelector('qty-stepper');
		return {
			order: [...s.children].map((c) => c.tagName.toLowerCase()).join(','),
			label: document.querySelector('label[for="q-HLM-001"]').control?.id,
			names: new FormData(document.forms.order).getAll('qty[HLM-001]').length,
			shadow: s.shadowRoot === null
		};
	});
	check(
		shape.order === 'button,input,button,span' && shape.label === 'q-HLM-001' && shape.names === 1 && shape.shadow,
		'buttons wrap the native input, label and name untouched',
		JSON.stringify(shape)
	);

	const minusAtZero = await page.getByRole('button', { name: 'Fewer: Halmstad mug' }).isDisabled();
	await page.evaluate(() => {
		window.__events = 0;
		document.forms.order.addEventListener('input', () => window.__events++);
	});
	const more = towel.getByRole('button', { name: 'More: Tylösand towel' });
	for (let i = 0; i < 3; i++) await more.click();
	const after = await page.evaluate(() => ({
		value: document.querySelector('#q-HLM-002').value,
		events: window.__events
	}));
	check(
		minusAtZero && after.value === '3' && (await more.isDisabled()) && after.events === 3,
		'− off at min, + steps to max then turns off, page sees input events',
		JSON.stringify(after)
	);

	const live = towel.locator('span[role="status"]');
	const announced = {
		text: (await live.textContent())?.trim(),
		live: await live.getAttribute('aria-live')
	};
	check(
		announced.text === 'Tylösand towel: 3' && announced.live === 'polite',
		'polite status announces the new value after + clicks',
		JSON.stringify(announced)
	);

	await page.locator('#q-HLM-002').fill('5');
	const bad = await page.evaluate(() => {
		const i = document.querySelector('#q-HLM-002');
		return { valid: i.checkValidity(), msg: i.validationMessage !== '', formValid: document.forms.order.checkValidity() };
	});
	await page.getByRole('button', { name: 'Order' }).click();
	await page.waitForTimeout(300);
	check(!bad.valid && bad.msg && !bad.formValid && (await result(page)) === null, 'native max=3 blocks the submit', JSON.stringify(bad));

	await page.getByRole('button', { name: 'Reset' }).click();
	await page.waitForTimeout(50);
	const reset = await page.evaluate(() => document.querySelector('#q-HLM-002').value);
	check(reset === '0' && (await towel.getByRole('button', { name: 'Fewer: Tylösand towel' }).isDisabled()), 'Reset restores 0 and the buttons follow', `value ${reset}`);

	const width = await page.locator('#q-HLM-001').evaluate((i) => getComputedStyle(i).width);
	check(width === '64px', 'the page stylesheet styles the input (no ::part)', width);

	await towel.getByRole('button', { name: 'More: Tylösand towel' }).click();
	await Promise.all([page.waitForURL(url), page.getByRole('button', { name: 'Order' }).click()]);
	const posted = await result(page);
	check(posted?.ok && posted.qty['HLM-002'] === 1 && posted.qty['HLM-001'] === 0, 'PHP received the order', JSON.stringify(posted));

	const res = await page.request.post(url, { form: { 'qty[HLM-001]': '1', 'qty[HLM-002]': '9' } });
	const html = await res.text();
	check(html.includes('&quot;ok&quot;:false') && html.includes('HLM-002'), 'PHP rejects qty 9 on its own');
} catch (e) {
	check(false, 'smoke test crashed', e.message.split('\n')[0]);
} finally {
	await browser.close();
}
process.exit(failed ? 1 : 0);
