#!/usr/bin/env node
// Browser check that <qty-input> works inside a plain PHP form.
//   npm run form:smoke            (needs `npm run elements:serve` running)
//   node scripts/form-smoke.mjs http://127.0.0.1:8099/order.php
// Exit 0 when every check prints "ok", 1 on the first "FAIL".
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:8099/order.php';
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);
const page = await browser.newPage();
let failed = false;
const check = (ok, what, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed = true;
};

try {
  await page.goto(url);
  await page.waitForFunction(() => customElements.get('qty-input'));
  const mug = page.locator('qty-input[name="qty[HLM-001]"]');
  const towel = page.locator('qty-input[name="qty[HLM-002]"]');

  // 1. The element joined the form and its <label for> points at it.
  const joined = await mug.evaluate((el) => ({
    form: el.form?.id ?? null,
    label: document.querySelector('label[for="q-HLM-001"]')?.control === el
  }));
  check(joined.form === 'order' && joined.label, 'form-associated, label works', JSON.stringify(joined));

  // 2. Typing and the + button both reach FormData.
  await mug.locator('input').fill('2');
  await towel.getByRole('button', { name: 'More' }).click();
  const fd = await page.evaluate(() => Object.fromEntries(new FormData(document.forms.order)));
  check(fd['qty[HLM-001]'] === '2' && fd['qty[HLM-002]'] === '1', 'FormData has both values', JSON.stringify(fd));

  // 3. Out of range: the element is :invalid and the browser blocks the submit.
  await towel.locator('input').fill('5');
  const bad = await towel.evaluate((el) => ({
    valid: el.checkValidity(),
    msg: el.validationMessage,
    invalid: el.matches(':invalid'),
    formValid: el.form.checkValidity()
  }));
  check(!bad.valid && bad.invalid && !bad.formValid && bad.msg === 'At most 3', 'max=3 blocks the form', JSON.stringify(bad));
  await page.getByRole('button', { name: 'Order' }).click();
  await page.waitForTimeout(300);
  check((await page.locator('#result').count()) === 0, 'invalid form was not posted');

  // 4. A valid submit is a normal POST that PHP reads as $_POST['qty'][sku].
  await towel.locator('input').fill('3');
  await page.locator('input[name="note"]').fill('Leverans Halmstad');
  await Promise.all([page.waitForURL(url), page.getByRole('button', { name: 'Order' }).click()]);
  const posted = JSON.parse(await page.locator('#result').innerText());
  check(posted.ok && posted.qty['HLM-001'] === 2 && posted.qty['HLM-002'] === 3, 'PHP received the order', JSON.stringify(posted));

  // 5. PHP still rejects what the browser would have blocked.
  const res = await page.request.post(url, { form: { 'qty[HLM-001]': '1', 'qty[HLM-002]': '9' } });
  const html = await res.text();
  check(html.includes('&quot;ok&quot;:false') && html.includes('HLM-002'), 'PHP rejects qty 9 on its own');
} catch (e) {
  check(false, 'smoke test crashed', e.message.split('\n')[0]);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);