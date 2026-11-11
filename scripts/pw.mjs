// pw: the one way scripts here get Playwright's Chromium.
// The browser lives in node_modules/playwright-core/.local-browsers, not in the
// user-wide cache, so every script uses the same copy and a Claude Code sandbox
// (which can read the project, not ~/Library/Caches) can find it.
// It installs headless Chromium on first use; when it's already there the
// installer is a no-op that needs no network.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';

const cli = fileURLToPath(new URL('../node_modules/playwright/cli.js', import.meta.url));
const r = spawnSync(process.execPath, [cli, 'install', 'chromium-headless-shell'], {
	stdio: ['ignore', 2, 2] // progress to stderr: stdout may carry test output
});
if (r.status !== 0) {
	console.error('pw: could not install Chromium (try: npm run playwright:install)');
	process.exit(1);
}

// Imported after the env var is set, so Playwright reads the project path.
const { chromium } = await import('playwright');
export { chromium };
