#!/usr/bin/env node
// scripts/models.mjs — what each Claude model supports, from the Models API
//   node scripts/models.mjs          table: id, line, effort levels, thinking off
//   node scripts/models.mjs --lint   check `effort` in .claude/agents/*.md and .claude/skills/*/SKILL.md
// Needs ANTHROPIC_API_KEY (a Console API key). MODELS_FIXTURE=<file> reads a saved response instead.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const DEFAULT_MODEL = process.env.LINT_DEFAULT_MODEL ?? 'sonnet'; // used when a file sets no model

async function loadModels() {
  if (process.env.MODELS_FIXTURE) {
    return JSON.parse(readFileSync(process.env.MODELS_FIXTURE, 'utf8')).data;
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const base = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';
  const models = [];
  let after = '';
  do {
    const url = `${base}/v1/models?limit=100${after ? `&after_id=${after}` : ''}`;
    const res = await fetch(url, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
    if (!res.ok) throw new Error(`GET /v1/models → ${res.status} ${await res.text()}`);
    const page = await res.json();
    models.push(...page.data);
    after = page.has_more ? page.last_id : '';
  } while (after);
  return models;
}

const effortLevels = (m) =>
  m.capabilities?.effort?.supported ? LEVELS.filter((l) => m.capabilities.effort[l]?.supported) : [];
const thinkingOff = (m) => m.capabilities?.thinking?.types?.disabled?.supported === true;

// "sonnet" → newest model whose line is "sonnet"; a full id → that model
function resolveModel(models, name) {
  return (
    models.find((m) => m.id === name) ??
    models.filter((m) => m.line === name).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  );
}

function frontmatter(file) {
  const fm = readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const get = (k) => fm?.[1].match(new RegExp(`^${k}:\\s*["']?([\\w.-]+)`, 'm'))?.[1];
  return { model: get('model'), effort: get('effort') };
}

function instructionFiles(root = '.claude') {
  const files = [];
  const agents = join(root, 'agents');
  if (existsSync(agents)) {
    for (const f of readdirSync(agents).sort()) if (f.endsWith('.md')) files.push(join(agents, f));
  }
  const skills = join(root, 'skills');
  if (existsSync(skills)) {
    for (const d of readdirSync(skills).sort()) {
      const f = join(skills, d, 'SKILL.md');
      if (existsSync(f)) files.push(f);
    }
  }
  return files;
}

function lint(models) {
  let failed = false;
  for (const file of instructionFiles()) {
    const { model, effort } = frontmatter(file);
    if (!effort) {
      console.log(`ok    ${file}  (no effort: uses the session level)`);
      continue;
    }
    const name = !model || model === 'inherit' ? DEFAULT_MODEL : model;
    const m = resolveModel(models, name);
    const levels = m ? effortLevels(m) : [];
    let problem = '';
    if (!LEVELS.includes(effort)) problem = `"${effort}" is not an effort level (${LEVELS.join(', ')})`;
    else if (!m) problem = `model "${name}" not found in the Models API`;
    else if (!levels.includes(effort)) {
      const fallback = levels.filter((l) => LEVELS.indexOf(l) <= LEVELS.indexOf(effort)).pop();
      problem = fallback
        ? `${m.id} doesn't support effort ${effort}; Claude Code would run it at ${fallback}`
        : `${m.id} has no effort levels; remove the effort line or change the model`;
    }
    if (problem) {
      failed = true;
      console.log(`FAIL  ${file}  ${problem}`);
    } else {
      console.log(`ok    ${file}  effort ${effort} on ${m.id}`);
    }
  }
  return failed ? 1 : 0;
}

const models = await loadModels();
if (!models) {
  console.log('skipped: set ANTHROPIC_API_KEY (or MODELS_FIXTURE) to query the Models API');
  process.exit(0);
}
if (process.argv.includes('--lint')) process.exit(lint(models));

for (const m of models) {
  const levels = effortLevels(m);
  console.log(
    `${m.id.padEnd(28)} ${String(m.line ?? '-').padEnd(7)} effort: ${(levels.join(',') || 'none').padEnd(27)} thinking off: ${thinkingOff(m) ? 'yes' : 'no'}`
  );
}