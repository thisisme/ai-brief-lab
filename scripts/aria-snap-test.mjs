#!/usr/bin/env node
// Proves scripts/aria-snap.mjs catches what it claims to, on throwaway pages. No API key, port 8093.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'aria-snap-'));
const pub = join(dir, 'public');
const base = join(dir, 'baselines');
mkdirSync(join(pub, 'build'), { recursive: true });

// Two tiny hand-written elements instead of the Svelte build, so the test checks the script, not your components.
writeFileSync(join(pub, 'build/elements.js'), `
customElements.define('good-stepper', class extends HTMLElement {
	connectedCallback() {
		const input = this.querySelector('input');
		const b = document.createElement('button');
		b.type = 'button'; b.textContent = '+'; b.setAttribute('aria-label', 'More: ' + input.labels[0].textContent);
		input.after(b);
	}
});
customElements.define('bad-stepper', class extends HTMLElement {
	connectedCallback() {
		// Replaces the server's input with a new one: the <label for> no longer points at anything.
		const fresh = document.createElement('input');
		fresh.type = 'number';
		this.querySelector('input').replaceWith(fresh);
	}
});
`);
const page = (body) => `<!doctype html><html lang="en"><meta charset="utf-8"><title>t</title>
<script type="module" src="/build/elements.js"></script>${body}</html>`;
const good = page(`<form><label for="q">Mug</label><good-stepper><input id="q" type="number" name="q" value="1"></good-stepper><button>Order</button></form>`);

function run(...extra) {
	const r = spawnSync('node', ['scripts/aria-snap.mjs', '--root', pub, '--baselines', base, ...extra], { encoding: 'utf8' });
	return { out: r.stdout + r.stderr, code: r.status };
}
let failed = 0;
function check(label, cond, out) {
	if (cond) console.log(`ok   ${label}`);
	else { failed++; console.log(`FAIL ${label}\n${out.replace(/^/gm, '     | ')}`); }
}
function setPages(pages) {
	for (const f of ['a.php', 'b.php']) rmSync(join(pub, f), { force: true });
	for (const [name, html] of Object.entries(pages)) writeFileSync(join(pub, name), html);
}

setPages({ 'a.php': good });
let r = run();
check('no baseline yet: fails and says how to write one', r.code === 1 && r.out.includes('no baseline; run'), r.out);

r = run('--update');
check('--update writes both baselines and passes', r.code === 0 && r.out.includes('a.php (js): baseline written') && r.out.includes('all passed (1 page(s))'), r.out);

r = run();
check('unchanged page matches its baselines', r.code === 0 && r.out.includes('a.php (js): matches baseline'), r.out);

setPages({ 'a.php': good.replace('>Order<', '>Buy<') });
r = run();
check('a renamed button shows as a - / + diff', r.code === 1 && r.out.includes('- - button "Order"') && r.out.includes('+ - button "Buy"'), r.out);

setPages({ 'b.php': page(`<button type="button"><svg aria-hidden="true" width="9" height="9"></svg></button>`) });
r = run();
check('icon-only button: no accessible name', r.code === 1 && r.out.includes('b.php (nojs): button with no accessible name'), r.out);

setPages({ 'b.php': page(`<button type="button">−</button>`) });
r = run();
check('button labelled only "−": named only by a symbol', r.code === 1 && r.out.includes('button named only by a symbol'), r.out);

setPages({ 'b.php': page(`<label for="q">Mug</label><bad-stepper><input id="q" type="number" name="q"></bad-stepper>`) });
r = run();
check('enhancer that replaces the server input: control lost on upgrade',
	r.code === 1 && r.out.includes('spinbutton "Mug" works without JavaScript but is gone once elements upgrade') && r.out.includes('(js): spinbutton with no accessible name'), r.out);

setPages({ 'b.php': page(`<never-defined>Loading</never-defined>`) });
r = run();
check('a tag the bundle never defines is reported', r.code === 1 && r.out.includes('<never-defined> was never defined'), r.out);

rmSync(dir, { recursive: true, force: true });
console.log(failed ? `aria-snap-test: ${failed} failed` : 'aria-snap-test: all passed');
process.exit(failed ? 1 : 0);