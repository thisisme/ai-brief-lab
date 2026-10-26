---
name: verify
description: Run the project's checks before a commit. Use right before
  committing, or when asked whether a change is ready.
license: Proprietary
compatibility: Claude Code in the ai-brief-lab repo. Needs Node 22, npm, PHP 8 CLI and git.
metadata:
  owner: mats
  updated: "2026-10-26"
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
9. If scripts/otel-sink.mjs, scripts/pilot-report.mjs, scripts/guardrail-report.mjs,
   scripts/claude-telemetry.sh, docs/pilot-telemetry.md or docs/ai-literacy-measures.md
   changed: npm run -s telemetry:test and npm run -s guardrail:test (must end with
   "telemetry-test: all passed" and "guardrail-test: all passed"). If the sink's KEEP or
   KEEP_SAFETY list changed, update the "What we collect" table in docs/pilot-telemetry.md
   in the same commit. scripts/claude-telemetry.sh never sets OTEL_LOG_TOOL_DETAILS,
   OTEL_LOG_USER_PROMPTS or OTEL_LOG_ASSISTANT_RESPONSES.
10. If src/instrumentation.server.ts, anything under src/routes/api/, scripts/trace-sink.mjs,
    scripts/trace-test.mjs, vite.config.ts, or the @anthropic-ai/sdk or @opentelemetry/\*
    versions in package.json changed: npm run -s trace:test (must end with
    "trace-test: all passed"; it uses ports 8098, 4329 and 5199). Never set the SDK's
    contentMode to "content" without asking first.
11. If .claude/settings.json or scripts/claude-p.sh changed, or claude --version differs
    from the version in the newest LABS.md row: npm run -s headless:probe (must end with
    "headless-probe: ok"; it starts four one-line headless sessions, a few cents in all).
    New scripts and gates call scripts/claude-p.sh, not bare claude -p.
12. If src/lib/server/user-profiles.ts, scripts/user-profile.mjs, scripts/profile-test.mjs,
    data/user-profiles.json, anything under src/routes/api/, or the @anthropic-ai/sdk
    version in package.json changed: npm run -s profile:test (must end with
    "profile-test: all passed"; it uses ports 8097 and 5198). Every Claude call made for a
    customer passes user_profile_id from profileFor(). Never run npm run profile -- add
    without asking first: each add creates a real profile at Anthropic.
13. If anything under .claude/skills/ changed: npm run -s skills:lint (its last line must say
    "0 error(s)"; warnings are Claude Code-only fields). A skill meant for colleagues on
    other tools, claude.ai or the Skills API must also pass npm run -s skills:lint -- --portable.
    If scripts/skills-lint.mjs changed: npm run -s skills:test (must end with
    "skills-lint-test: all passed").
14. If anything under plugins/lab-watch/ or scripts/php-watch-test.mjs changed:
    claude plugin validate plugins/lab-watch (must end with "Validation passed"; the icon
    and README notes are directory checks, not failures) and npm run -s watch:test (must end
    with "watch-test: all passed"; it uses port 8094). Never enable lab-watch in
    .claude/settings.json or move it under .claude/skills/: monitors don't start from
    project-scope plugins. It loads with claude --plugin-dir ./plugins/lab-watch.
    Fix mechanical failures (types, imports, lint) and re-run.
    If something needs a design decision, stop and report file:line instead of committing.
