| Date     | Lab                  | Worked? | Note                                                                    |
| -------- | -------------------- | ------- | ----------------------------------------------------------------------- |
| 20261005 | -                    | Yes     | sonnet $0.08513680000000001 12s 1 files changed                         |
| 20261005 | -                    | Yes     | opus $0.1526578 13s 1 files changed                                     |
| 20261007 | per-call efforter    | Yes     | 2 "perTurnEffort":"high"                                                |
| 20261007 | per-call efforter    | Yes     | 2 "perTurnEffort":"medium"                                              |
| 20261013 | gate check           | Yes     | hook exit=2                                                             |
| 20261013 | gate check in claude | Yes     | The commit was blocked by the PreToolUse hook                           |
| 20261013 | doctor               | Yes     | SessionStart:startup herdr-agent-state.sh' session 1 0×1 45 45          |
| 20261013 | doctor               | Yes     | WARN check-runner.md: frontmatter key "efort" (did you mean "effort"?)  |
| 20261013 | doctor               | Yes     | npm run -s gate 0.07s user 0.04s system 85% cpu 0.125 total             |
| 20261015 | telemetry            | Yes     | week people sessions cost USD lines +/- commits PRs edits kept active h |

2026-W43 <3 suppressed: fewer than 3 people
pilot-report: 1 week(s), 0 shown, minimum 3 people per week |
| 20261013 | custom elements | Yes | ok form-associated, label works ({"form":"order","label":true}); ok FormData has both values ({"qty[HLM-001]":"2","qty[HLM-002]":"1","note":""}); ok max=3 blocks the form ({"valid":false,"msg":"At most 3","invalid":true,"formValid":false}); ok invalid form was not posted; ok PHP received the order ({"ok":true,"qty":{"HLM-001":2,"HLM-002":3},"errors":[],"note":"Leverans Halmstad"}); ok PHP rejects qty 9 on its own; exit=0 |
| 20261020 | endpoint | Yes | The endpoint needs SvelteKit 3.1.0 or later |
| 20261020 | tracing | Yes | POST /api/summary returned a summary (56 in / 32 out tokens, claude-haiku-5-5); trace:tree shows one trace, sveltekit.handle.root 1430 ms > sveltekit.resolve > sveltekit.endpoint > anthropic.messages.create 1426 ms |
| 20261020 | tracing | Yes | POST /api/summary/stream returns text/plain via messages.stream(); trace-test: all passed (19 checks); streamed SDK span 3017 ms >= last SSE event 2711 ms; no prompt text in spans |
| 20261020 | headless forks | Yes | scripts/claude-p.sh: default {"spawned":0,"by_type":{}}; with CLAUDE_P_FORKS=1 {"spawned":1,"by_type":{"fork":1}} |
| 20261020 | headless wrapper | Yes | claude --version 2.1.304 (Claude Code); ab-model.sh and claude-doctor.mjs now call scripts/claude-p.sh; doctor: warnings 0, hook failures 0, slow hooks 0 |
| 20261020 | qty-stepper live region | Yes | stepper-smoke: 10/10 ok incl. both JS-off checks; status span after + clicks reads {"text":"Tylösand towel: 3","live":"polite"} |
