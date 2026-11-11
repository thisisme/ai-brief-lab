#!/usr/bin/env node
// What does php-lab cost Claude's context: as the php-lab MCP server, or as the
// php-lab skill + CLI? Counts characters (≈ tokens = chars / 4, a rough guide).
//   every turn: what sits in context whether or not Claude uses it
//   when used:  what loads the first time Claude reaches for it
// MCP: with tool search (Claude Code's default) only the tool names sit in context;
// the schemas load through ToolSearch. Without tool search, the schemas load every turn.
// Usage: node scripts/tool-cost.mjs [--server "php tools/php-mcp/server.php"]
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SKILL = '.claude/skills/php-lab/SKILL.md';
const i = process.argv.indexOf('--server');
const serverCmd = i > 0 ? process.argv[i + 1] : 'php tools/php-mcp/server.php';
const tok = (n) => `${n} ≈${Math.round(n / 4)}`;

function listTools(cmd, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const [bin, ...args] = cmd.split(' ');
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`no tools/list answer in ${timeoutMs} ms`)); }, timeoutMs);
    const send = (msg) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}) ${err.trim().split('\n').pop() ?? ''}`)); });
    child.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          send({ method: 'notifications/initialized' });
          send({ id: 2, method: 'tools/list', params: {} });
        } else if (msg.id === 2) {
          clearTimeout(timer);
          child.removeAllListeners('exit');
          child.kill();
          if (msg.error) reject(new Error(msg.error.message));
          else resolve({ tools: msg.result?.tools ?? [] });
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'tool-cost', version: '1.0.0' } } });
  });
}

const rows = [];

const skill = readFileSync(SKILL, 'utf8');
const [, fm = '', body = ''] = skill.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? [];
const desc = [fm.match(/^description: (.*)$/m)?.[1], fm.match(/^when_to_use: (.*)$/m)?.[1]].filter(Boolean).join(' ');
rows.push(['skill + cli', `- php-lab: ${desc}`.length, body.length]);

let mcpNote = '';
try {
  const { tools } = await listTools(serverCmd);
  const names = tools.map((t) => `mcp__php-lab__${t.name}`).join('\n');
  rows.push([`mcp (${tools.length} tools)`, names.length, JSON.stringify(tools).length]);
  mcpNote = `  without tool search the mcp schemas (${tok(JSON.stringify(tools).length)}) load every turn`;
} catch (e) {
  mcpNote = `  skip mcp: ${e.message} (run npm run mcp:php:install first?)`;
}

console.log('tool-cost: php-lab, two ways (chars ≈tokens)');
console.log(`  ${'front door'.padEnd(18)}${'every turn'.padEnd(14)}when used`);
for (const [name, every, used] of rows) console.log(`  ${name.padEnd(18)}${tok(every).padEnd(14)}${tok(used)}`);
console.log(mcpNote);
console.log('tool-cost: done');
