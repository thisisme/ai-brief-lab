---
name: php-pin-audit
description: Lists every place a repository pins its PHP version (Dockerfiles, compose files, composer.json, CI workflows, .tool-versions, .php-version) and says whether each pin gets the October 2026 PHP2Shell fixes (CVE-2026-109618, CVE-2026-109619). Use when asked which PHP version a repo runs, whether it is patched, or what to change to pick up a PHP security release.
license: Proprietary
compatibility: Needs Node 18 or newer. Reads files only; makes no network calls.
metadata:
  owner: mats
  updated: "2026-10-23"
---

# PHP pin audit

1. From the repository root, run:
   `node <this skill's folder>/scripts/find-pins.mjs .`
   It prints one line per pin: `file:line`, the pinned value, and a verdict.
2. Read [the fixed versions](references/fixed-versions.md) before you explain a verdict.
3. Report a table with file:line, pin, verdict and the change you would make.
   For "moving", the fix is a rebuild or CI run that pulls the new patch, not a file change.
   For "range", say which installed version the lock file or image actually resolves to,
   if you can find it; otherwise say it is unknown.
4. Change nothing unless the user asks. Never edit composer.lock by hand.

The script exits 1 if any exact pin is below the fixed version, so CI can run it too.
