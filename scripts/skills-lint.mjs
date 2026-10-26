#!/usr/bin/env node
// Checks every skill in .claude/skills/ against the Agent Skills spec (agentskills.io),
// the format Anthropic donated to the Agentic AI Foundation on Oct 22, 2026.
//
//   node scripts/skills-lint.mjs              # all skills in .claude/skills/
//   node scripts/skills-lint.mjs --portable   # Claude Code-only fields become errors
//   node scripts/skills-lint.mjs path/to/skill [more/skills]
//
// Errors: anything the spec forbids (and claude.ai uploads and the Skills API reject).
// Warnings: Claude Code-only fields, which other tools reject. --portable makes them errors.
// Exit 1 on any error.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { parse } from 'yaml';

const SPEC_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
// From the SKILL.md frontmatter reference at code.claude.com/docs/en/skills (Oct 23, 2026).
const CLAUDE_CODE_ONLY = new Set([
  'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation', 'user-invocable',
  'disallowed-tools', 'model', 'effort', 'context', 'agent', 'background', 'hooks', 'paths', 'shell'
]);
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // a-z, 0-9, single hyphens, none at the ends
const MAX_BODY_LINES = 500;

const args = process.argv.slice(2);
const portable = args.includes('--portable');
const paths = args.filter((a) => !a.startsWith('--'));

function skillDirs() {
  if (paths.length) return paths.map((p) => resolve(p));
  const root = '.claude/skills';
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((d) => resolve(root, d))
    .filter((d) => statSync(d).isDirectory());
}

function lint(dir) {
  const errors = [];
  const warnings = [];
  const file = join(dir, 'SKILL.md');
  if (!existsSync(file)) return { errors: ['missing SKILL.md'], warnings };

  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!m) return { errors: ['SKILL.md must start with --- frontmatter --- '], warnings };

  let fm;
  try {
    fm = parse(m[1]);
  } catch (e) {
    return { errors: [`frontmatter is not valid YAML: ${e.message.split('\n')[0]}`], warnings };
  }
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) {
    return { errors: ['frontmatter must be a YAML mapping'], warnings };
  }

  for (const key of Object.keys(fm)) {
    if (SPEC_FIELDS.has(key)) continue;
    if (CLAUDE_CODE_ONLY.has(key)) {
      (portable ? errors : warnings).push(`"${key}" works only in Claude Code; other tools reject it`);
    } else {
      errors.push(`unknown field "${key}" (not in the spec, and Claude Code ignores it)`);
    }
  }

  const { name, description, compatibility, metadata, license } = fm;
  if (typeof name !== 'string' || name.length === 0) {
    errors.push('name is required and must be a string');
  } else {
    if (name.length > 64) errors.push(`name is ${name.length} characters (max 64)`);
    if (!NAME_RE.test(name)) errors.push(`name "${name}" must be lowercase a-z, 0-9 and single hyphens, not at the ends`);
    if (name !== basename(dir)) errors.push(`name "${name}" must match its folder "${basename(dir)}"`);
  }
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('description is required and must be a non-empty string');
  } else if (description.length > 1024) {
    errors.push(`description is ${description.length} characters (max 1024)`);
  }
  if (compatibility !== undefined) {
    if (typeof compatibility !== 'string' || compatibility.length === 0 || compatibility.length > 500) {
      errors.push('compatibility must be a string of 1 to 500 characters');
    }
  }
  if (license !== undefined && typeof license !== 'string') errors.push('license must be a string');
  if (fm['allowed-tools'] !== undefined && typeof fm['allowed-tools'] !== 'string') {
    errors.push('allowed-tools must be one space-separated string, not a list');
  }
  if (metadata !== undefined) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      errors.push('metadata must be a map');
    } else {
      for (const [k, v] of Object.entries(metadata)) {
        if (typeof v !== 'string') errors.push(`metadata.${k} must be a string (quote it: "${v}")`);
      }
    }
  }

  const body = m[2];
  const lines = body.split('\n').length;
  if (lines > MAX_BODY_LINES) warnings.push(`body is ${lines} lines; the spec suggests under ${MAX_BODY_LINES}, with details in references/`);

  // Relative Markdown links must point at files inside the skill folder.
  for (const [, target] of body.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
    if (/^[a-z]+:/i.test(target) || target.startsWith('/')) continue;
    const full = resolve(dir, target);
    if (!full.startsWith(dir + '/')) errors.push(`link "${target}" leaves the skill folder`);
    else if (!existsSync(full)) errors.push(`link "${target}" points at a missing file`);
  }
  return { errors, warnings };
}

const dirs = skillDirs();
let nErr = 0;
let nWarn = 0;
for (const dir of dirs) {
  const label = basename(dir);
  const { errors, warnings } = lint(dir);
  nErr += errors.length;
  nWarn += warnings.length;
  if (errors.length === 0) console.log(`ok   ${label}`);
  for (const e of errors) console.log(`FAIL ${label}: ${e}`);
  for (const w of warnings) console.log(`warn ${label}: ${w}`);
}
console.log(
  `skills-lint: ${dirs.length} skill(s), ${nErr} error(s), ${nWarn} warning(s)${portable ? ' (portable)' : ''}`
);
process.exit(nErr ? 1 : 0);