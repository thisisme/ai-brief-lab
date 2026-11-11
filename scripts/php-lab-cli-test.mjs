#!/usr/bin/env node
// Checks tools/php-mcp/bin/php-lab against a throwaway hosts/php in the OS temp folder,
// plus the php-lab skill that points Claude at it. No API key, no Composer packages.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = 'tools/php-mcp/bin/php-lab';
const SKILL = '.claude/skills/php-lab/SKILL.md';
const base = mkdtempSync(join(tmpdir(), 'php-lab-cli-'));
const root = join(base, 'hosts', 'php');
mkdirSync(join(root, 'public'), { recursive: true });
mkdirSync(join(root, 'lib'));
writeFileSync(join(root, 'public', 'good.php'), '<?php echo "ok";\n');
writeFileSync(join(root, 'public', 'broken.php'), '<?php echo "no semicolon"\n$x = 1;\n');
writeFileSync(join(root, 'public', 'readme.txt'), 'not php\n');
writeFileSync(join(root, 'lib', 'util.php'), '<?php function util(): int { return 1; }\n');
writeFileSync(join(base, 'secret.php'), '<?php // outside hosts/php\n');

const run = (...args) => {
  const r = spawnSync('php', [CLI, ...args], { encoding: 'utf8', env: { ...process.env, PHP_LAB_ROOT: root } });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { code: r.status, out: r.stdout, err: r.stderr, json };
};

let failed = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${!cond && detail ? `\n     ${detail}` : ''}`);
  if (!cond) failed++;
};

try {
  let r = run('pages');
  check('pages lists the two public pages and counts 3 PHP files',
    r.code === 0 && JSON.stringify(r.json?.pages) === '["public/broken.php","public/good.php"]' && r.json?.php_files === 3,
    r.out + r.err);

  r = run('lint', 'public/good.php');
  check('lint of a clean file exits 0 with ok: true', r.code === 0 && r.json?.ok === true, r.out + r.err);

  r = run('lint', 'public/broken.php');
  check('lint of a broken file exits 1 with PHP\'s parse error',
    r.code === 1 && r.json?.ok === false && /Parse error/.test(r.json?.message ?? ''), r.out + r.err);
  check('lint messages use paths relative to hosts/php', !r.out.includes(base), r.out);

  r = run('lint', 'public/good.php', 'lib/util.php');
  check('lint of two files returns two results', r.code === 0 && Array.isArray(r.json) && r.json.length === 2, r.out + r.err);

  r = run('lint', '../secret.php');
  check('refuses a path outside hosts/php (exit 2, nothing on stdout)',
    r.code === 2 && /Refused/.test(r.err) && r.out === '', r.out + r.err);

  r = run('lint', join(base, 'secret.php'));
  check('refuses an absolute path', r.code === 2 && r.out === '', r.out + r.err);

  r = run('lint', 'public/readme.txt');
  check('refuses a file that is not .php', r.code === 2 && /not a \.php file/.test(r.err), r.out + r.err);

  r = run('runtime');
  const version = spawnSync('php', ['-r', 'echo PHP_VERSION;'], { encoding: 'utf8' }).stdout;
  check('runtime reports this PHP and the advisory ini keys',
    r.code === 0 && r.json?.php_version === version && 'session.upload_progress.enabled' in (r.json?.ini ?? {}),
    r.out + r.err);

  const skill = readFileSync(SKILL, 'utf8');
  const fm = skill.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
  const desc = fm.match(/^description: (.*)$/m)?.[1] ?? '';
  const allowed = fm.match(/^allowed-tools: (.*)$/m)?.[1] ?? '';
  check('skill pre-approves exactly this CLI and keeps its description under 1,536 chars',
    allowed === `Bash(php ${CLI} *)` && desc.length > 0 && desc.length <= 1536, `allowed-tools: ${allowed}`);
} finally {
  rmSync(base, { recursive: true, force: true });
}

console.log(failed ? `php-lab-cli-test: ${failed} failed` : 'php-lab-cli-test: all passed');
process.exit(failed ? 1 : 0);
