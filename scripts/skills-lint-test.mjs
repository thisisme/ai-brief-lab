#!/usr/bin/env node
// Proves scripts/skills-lint.mjs catches what the Agent Skills spec forbids.
// Writes made-up skills to a temporary folder, lints each one and checks the verdict.
// If the reference validator is installed (.venv-skills/bin/agentskills, from
// pip install skills-ref), it also checks that both agree on every spec verdict.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const tmp = mkdtempSync(join(tmpdir(), 'skills-lint-'));
const fixtures = [
  // [folder, frontmatter, body, expect default, expect --portable, output must include]
  ['good-skill', 'name: good-skill\ndescription: Does one thing. Use when asked for it.', '# Steps\n', 0, 0, 'ok   good-skill'],
  ['Bad-Name', 'name: Bad-Name\ndescription: Uppercase name.', '', 1, 1, 'must be lowercase'],
  ['double--hyphen', 'name: double--hyphen\ndescription: Two hyphens in a row.', '', 1, 1, 'single hyphens'],
  ['folder-a', 'name: folder-b\ndescription: Name differs from the folder.', '', 1, 1, 'must match its folder'],
  ['no-desc', 'name: no-desc', '', 1, 1, 'description is required'],
  ['long-desc', `name: long-desc\ndescription: ${'x'.repeat(1025)}`, '', 1, 1, 'max 1024'],
  ['claude-only', 'name: claude-only\ndescription: Uses a Claude Code field.\ndisable-model-invocation: true', '', 0, 1, 'works only in Claude Code'],
  ['typo-field', 'name: typo-field\ndescription: Misspelled field.\nalowed-tools: Read', '', 1, 1, 'unknown field "alowed-tools"'],
  ['meta-number', 'name: meta-number\ndescription: Unquoted version.\nmetadata:\n  version: 1.0', '', 1, 1, 'metadata.version must be a string'],
  ['tools-list', 'name: tools-list\ndescription: allowed-tools as a list.\nallowed-tools:\n  - Read', '', 1, 1, 'one space-separated string'],
  ['dead-link', 'name: dead-link\ndescription: Links a missing file.', 'See [the checks](references/checks.md).\n', 1, 1, 'missing file'],
  ['good-link', 'name: good-link\ndescription: Links a file that exists.', 'See [the checks](references/checks.md).\n', 0, 0, 'ok   good-link']
];

for (const [dir, fm, body] of fixtures) {
  mkdirSync(join(tmp, dir, 'references'), { recursive: true });
  writeFileSync(join(tmp, dir, 'SKILL.md'), `---\n${fm}\n---\n${body}`);
}
writeFileSync(join(tmp, 'good-link', 'references', 'checks.md'), '# Checks\n');

const lint = (dir, portable) =>
  spawnSync(process.execPath, ['scripts/skills-lint.mjs', ...(portable ? ['--portable'] : []), join(tmp, dir)], {
    encoding: 'utf8'
  });

const ref = ['.venv-skills/bin/agentskills', 'agentskills'].find(
  (p) => spawnSync(p, ['--version'], { encoding: 'utf8' }).status === 0
);
// Fixtures where skills-ref 0.1.1 is known to be more lenient than the spec text.
const REF_LENIENT = new Set(['meta-number', 'tools-list', 'dead-link']);

let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};

for (const [dir, , , expDefault, expPortable, needle] of fixtures) {
  const a = lint(dir, false);
  const b = lint(dir, true);
  const out = a.stdout + b.stdout;
  check(
    a.status === expDefault && b.status === expPortable && out.includes(needle),
    `${dir}: exit ${a.status}, --portable exit ${b.status}`,
    out.includes(needle) ? '' : `missing "${needle}"`
  );
  if (ref && !REF_LENIENT.has(dir)) {
    const r = spawnSync(ref, ['validate', join(tmp, dir)], { encoding: 'utf8' });
    check(r.status === b.status, `${dir}: agrees with ${ref} validate`, `reference exit ${r.status}`);
  }
}
if (!ref) console.log('skip reference validator not installed (see the lab doc, step 3)');

const repo = spawnSync(process.execPath, ['scripts/skills-lint.mjs'], { encoding: 'utf8' });
check(repo.status === 0, "this repo's skills pass", repo.stdout.trim().split('\n').at(-1));

rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `skills-lint-test: ${failed} failed` : 'skills-lint-test: all passed');
process.exit(failed ? 1 : 0);