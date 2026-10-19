---
name: verify
description: Run the project's checks before a commit. Use right before
  committing, or when asked whether a change is ready.
---

Run, in order, and stop at the first failure:

1. GATE_NO_CACHE=1 npm run gate (must print "gate: ok" or "gate: no code changes";
   the commit hook runs the same script, with its cache, and blocks commits while it fails)
2. npm run build
3. vendor/bin/phpstan analyse --no-progress (only if vendor/bin/phpstan exists)
4. If src/lib/elements/ or hosts/php/ changed: start npm run elements:serve in the background,
   run npm run elements:smoke and npm run form:smoke (every line must start with "ok"),
   then stop the server.
5. If anything under .claude/agents/ or .claude/skills/ changed: npm run agents:effort
6. If anything under .claude/hooks/ changed: npm run -s guard:test
   (must end with "guard-test: all passed")
7. If .claude/settings.json changed:
   claude -p "Reply with exactly: ok" 2>&1 >/dev/null | grep "did not load"
   must print nothing. A settings file that fails validation is skipped whole,
   hooks included, and claude -p still exits 0.
8. If anything under .claude/ changed: npm run doctor (must end with
   "warnings 0, hook failures 0, slow hooks 0"; it starts one short headless session)
   Fix mechanical failures (types, imports, lint) and re-run.
   If something needs a design decision, stop and report file:line instead of committing.
