import { chromium } from 'playwright';

const [url, ...tags] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH // optional; omit to use Playwright's own browser
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(url);
let failed = errors.length > 0;
for (const tag of tags) {
  const defined = await page
    .waitForFunction((t) => customElements.get(t), tag, { timeout: 5000 })
    .then(() => true, () => false);
  if (!defined) { console.log(`FAIL <${tag}> never registered`); failed = true; continue; }
  await page.waitForTimeout(50); // Svelte creates the component a tick after connectedCallback
  const rendered = await page.$$eval(tag, (els) =>
    els.map((el) => [...(el.shadowRoot ?? el).children].some((c) => c.tagName !== 'STYLE'))
  );
  const ok = rendered.length > 0 && rendered.every(Boolean);
  console.log(`${ok ? 'ok  ' : 'FAIL'} <${tag}> ×${rendered.length}`);
  failed ||= !ok;
}
for (const e of errors) console.log(`FAIL page error: ${e}`);
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
