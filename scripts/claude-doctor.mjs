#!/usr/bin/env node
// Setup health check for Claude Code 2.1.296+, which logs every command hook's
// outcome and duration and warns about unknown frontmatter keys in --debug output.
//   npm run doctor               run one short headless session and report on it
//   npm run doctor -- <file>     report on an existing log from `claude --debug-file <file>`
// Exit 1 on a config warning, a failed hook, or a hook slower than DOCTOR_SLOW_MS (default 5000).
import { readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';

const SLOW_MS = Number(process.env.DOCTOR_SLOW_MS ?? 5000);
let file = process.argv[2];

if (!file) {
  file = '.claude/doctor.log';
  rmSync(file, { force: true });
  const run = spawnSync(
    'scripts/claude-p.sh',
    ['Run `git status --short` with Bash, then reply with the single word ok.',
     '--allowedTools', 'Bash(git status:*)', '--debug-file', file],
    { stdio: ['ignore', 'ignore', 'inherit'], timeout: 300_000 }
  );
  if (run.error || run.status !== 0) {
    console.log(`doctor: FAIL claude -p did not finish (${run.error?.message ?? `exit ${run.status}`})`);
    process.exit(1);
  }
}

const lines = readFileSync(file, 'utf8').split('\n');
const hooks = new Map(); // "Event:Matcher  script" -> { codes: Map, ms: [] }
const warnings = [];
const HOOK = /Hooks: (\S+) \[(.*)\] finished with status (-?\w+) \((\d+)ms\)/;
const FRONT = /\[WARN\] Agent file (\S+) has a frontmatter key .*?: ("[^"]+".*)$/;

for (const line of lines) {
  let m = line.match(HOOK);
  if (m) {
    const [, event, command, status, ms] = m;
    const key = `${event}  ${basename(command.replaceAll('"', ''))}`;
    const h = hooks.get(key) ?? { codes: new Map(), ms: [] };
    h.codes.set(status, (h.codes.get(status) ?? 0) + 1);
    h.ms.push(Number(ms));
    hooks.set(key, h);
    continue;
  }
  if ((m = line.match(FRONT))) warnings.push(`${basename(m[1])}: frontmatter key ${m[2]}`);
  else if (/\[WARN\] Hooks: /.test(line)) warnings.push(line.replace(/^.*?\[WARN\] /, ''));
}

let failed = 0;
let slow = 0;
console.log(`doctor: ${file}`);
console.log('hook'.padEnd(36) + 'runs'.padStart(5) + '  exit codes'.padEnd(14) + 'avg ms'.padStart(8) + 'max ms'.padStart(8));
for (const [key, h] of hooks) {
  const avg = Math.round(h.ms.reduce((a, b) => a + b, 0) / h.ms.length);
  const max = Math.max(...h.ms);
  const codes = [...h.codes].map(([c, n]) => `${c}×${n}`).join(' ');
  // exit 2 is a deliberate block; any other non-zero code means the hook itself broke
  failed += [...h.codes].filter(([c]) => c !== '0' && c !== '2').reduce((a, [, n]) => a + n, 0);
  if (max > SLOW_MS) slow++;
  console.log(key.padEnd(36) + String(h.ms.length).padStart(5) + `  ${codes}`.padEnd(14) +
    String(avg).padStart(8) + String(max).padStart(8) + (max > SLOW_MS ? '  SLOW' : ''));
}
if (hooks.size === 0) console.log('(no command hooks ran — is Claude Code 2.1.296 or later?)');
for (const w of warnings) console.log(`WARN ${w}`);
console.log(`doctor: warnings ${warnings.length}, hook failures ${failed}, slow hooks ${slow} (> ${SLOW_MS} ms)`);
process.exit(warnings.length || failed || slow ? 1 : 0);