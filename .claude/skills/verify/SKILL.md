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
4. If src/lib/elements/ or hosts/php/ changed: npm run elements:build, start
   npm run elements:serve in the background from this repo, run npm run elements:smoke,
   npm run form:smoke and npm run stepper:smoke (every line must start with "ok"; the
   stepper's first two checks run with JavaScript off and with the bundle blocked),
   then stop the server.
5. If anything under .claude/agents/ or .claude/skills/ changed: npm run agents:effort
6. If anything under .claude/hooks/ changed: npm run -s guard:test
   (must end with "guard-test: all passed")
7. If .claude/settings.json changed:
   scripts/claude-p.sh "Reply with exactly: ok" 2>&1 >/dev/null | grep "did not load"
   must print nothing. A settings file that fails validation is skipped whole,
   hooks included, and claude -p still exits 0.
8. If anything under .claude/ changed: npm run doctor (must end with
   "warnings 0, hook failures 0, slow hooks 0"; it starts one short headless session)
9. If scripts/otel-sink.mjs, scripts/pilot-report.mjs, scripts/claude-telemetry.sh or
   docs/pilot-telemetry.md changed: npm run -s telemetry:test (must end with
   "telemetry-test: all passed"). If the sink's KEEP list changed, update the
   "What we collect" table in docs/pilot-telemetry.md in the same commit.
10. If src/instrumentation.server.ts, anything under src/routes/api/, scripts/trace-sink.mjs,
    scripts/trace-test.mjs, vite.config.ts, or the @anthropic-ai/sdk or @opentelemetry/\*
    versions in package.json changed: npm run -s trace:test (must end with
    "trace-test: all passed"; it uses ports 8098, 4329 and 5199). Never set the SDK's
    contentMode to "content" without asking first.
11. If .claude/settings.json or scripts/claude-p.sh changed, or claude --version differs
    from the version in the newest LABS.md row: npm run -s headless:probe (must end with
    "headless-probe: ok"; it starts four one-line headless sessions, a few cents in all).
    New scripts and gates call scripts/claude-p.sh, not bare claude -p.
    Fix mechanical failures (types, imports, lint) and re-run.
    If something needs a design decision, stop and report file:line instead of committing.
