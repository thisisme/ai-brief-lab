#!/usr/bin/env node
// Builds a throwaway repo in the OS temp folder and checks egress-audit.mjs against it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'egress-audit.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'egress-'));
const put = (p, s) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), s); };

put('.claude/skills/feedback/SKILL.md', '---\nname: feedback\n---\nSearch first.\n\n    gh issue create --repo acme/tools --body-file x.md\n\nOr open https://github.com/acme/tools/issues/new\nThen gh issue create again.\n');
put('.claude/agents/runner.md', '---\nname: runner\n---\nRun the tests. Never curl anything.\nWhen green: curl -s http://localhost:8099/ to check the host.\n');
put('.claude/CLAUDE.md', 'Commit, then git push to origin.\n');
put('.claude/settings.json', JSON.stringify({
  extraKnownMarketplaces: { svelte: { source: { source: 'github', repo: 'sveltejs/ai-tools' } },
    tools: { source: { source: 'github', repo: 'acme/tools', ref: 'v1.2.0' }, autoUpdate: true } },
  enabledPlugins: { 'svelte@svelte': true, 'old@tools': false },
}, null, 2));
put('.mcp.json', JSON.stringify({ mcpServers: {
  svelte: { command: 'npx', args: ['-y', 'svelte-mcp-fork'] },
  pinned: { command: 'npx', args: ['-y', '@sveltejs/mcp@0.1.30'] },
  latest: { command: 'npx', args: ['-y', 'some-mcp@latest'] },
  local: { command: 'npx', args: ['@sveltejs/mcp'] },
  docs: { type: 'http', url: 'https://mcp.svelte.dev/mcp' },
  'php-lab': { command: 'php', args: ['tools/php-mcp/server.php'] },
} }, null, 2));
put('node_modules/@sveltejs/mcp/package.json', '{"name":"@sveltejs/mcp","version":"0.1.30"}');
put('node_modules/x/SKILL.md', 'gh issue create\n');
put('docs/agent-egress.md', [
  '| Finding | Decision | Why |', '| --- | --- | --- |',
  '| `.claude/CLAUDE.md#git push` | allow | our own remote |',
  '| `.mcp.json#mcp php-lab` | allow | local, read-only |',
  '| `.claude/skills/feedback/SKILL.md#gh issue create` | block | posts code to a public repo |',
  '| `.mcp.json#mcp gone` | allow | removed last week |', ''].join('\n'));

const run = (...a) => spawnSync(process.execPath, [SCRIPT, '--root', dir, ...a], { encoding: 'utf8' });
const r = run();
const out = r.stdout;
const has = (re) => re.test(out);
const checks = [
  ['gh issue create in a skill is found once and blocked', () => (out.match(/gh issue create/g) || []).length === 1 && has(/^BLOCK +\.claude\/skills\/feedback\/SKILL\.md:6 +gh issue create/m)],
  ['the github.com link is a new finding', () => has(/^NEW +\.claude\/skills\/feedback\/SKILL\.md:8 +url github\.com/m)],
  ['curl in an agent is found, localhost is not a host', () => has(/^NEW +\.claude\/agents\/runner\.md:4 +curl/m) && !has(/url localhost/)],
  ['git push in CLAUDE.md is allowed by the policy', () => has(/^ALLOW +\.claude\/CLAUDE\.md:1 +git push/m)],
  ['an unpinned marketplace is reported', () => has(/marketplace svelte: github:sveltejs\/ai-tools, unpinned$/m)],
  ['a pinned marketplace with auto-update is reported as such', () => has(/marketplace tools: github:acme\/tools, pinned, auto-update on$/m)],
  ['only enabled plugins count', () => has(/plugin svelte@svelte/) && !has(/old@tools/)],
  ['npx: no version or @latest is unpinned, a version is pinned', () => has(/mcp svelte: npx svelte-mcp-fork: unpinned/) && has(/mcp latest: npx some-mcp@latest: unpinned/) && has(/mcp pinned: npx @sveltejs\/mcp@0\.1\.30: pinned to 0\.1\.30/)],
  ['npx with no version uses an installed devDependency', () => has(/mcp local: npx @sveltejs\/mcp: no version, npx uses node_modules \(0\.1\.30\)/)],
  ['a remote MCP server names its host', () => has(/mcp docs: remote server at mcp\.svelte\.dev/)],
  ['node_modules is skipped', () => !has(/node_modules\//)],
  ['a policy row with nothing behind it is stale', () => has(/^STALE  \.mcp\.json#mcp gone/m)],
  ['the summary adds up, and exit is 0 without --strict', () => has(/^egress-audit: 13 finding\(s\), 2 allow, 0 review, 1 block, 10 new$/m) && r.status === 0],
  ['--strict exits 1 on a block or a new finding', () => run('--strict').status === 1],
];

let failed = 0;
for (const [name, fn] of checks) {
  let ok = false;
  try { ok = fn(); } catch {}
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
}
fs.rmSync(dir, { recursive: true, force: true });
if (failed) { console.log(out); console.log(`egress-audit-test: ${failed} failed`); process.exit(1); }
console.log('egress-audit-test: all passed');
