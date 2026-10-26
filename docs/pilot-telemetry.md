# AI pilot: what we measure (draft for HR, the union contact and the DPO)

**Status:** draft, not yet agreed. Nothing is collected from anyone but the pilot owner until this page is agreed.

## Why

To decide whether the Claude Code pilot is worth continuing, we need four team-level numbers per week: cost, how much of the work Claude was used for, how often its edits were kept, and whether it shows up in commits and pull requests. IT security also needs to see that the guardrails we configured actually stop things, and where they get in people's way.

## What we collect

Claude Code's built-in OpenTelemetry counters and its safety events, summed per team and per ISO week:

| Number                                                                                                                                       | Source                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| People active (count only)                                                                                                                   | distinct people per day, counted in memory and never stored by name |
| Sessions                                                                                                                                     | `claude_code.session.count`                                         |
| Cost in USD                                                                                                                                  | `claude_code.cost.usage`                                            |
| Lines added / removed                                                                                                                        | `claude_code.lines_of_code.count`                                   |
| Commits / pull requests                                                                                                                      | `claude_code.commit.count`, `claude_code.pull_request.count`        |
| Edits kept (%)                                                                                                                               | `claude_code.code_edit_tool.decision`                               |
| Active hours                                                                                                                                 | `claude_code.active_time.total`                                     |
| Tool calls a guardrail stopped, by kind (permission rule, permission mode, hook, other) and reason code (for example `rule:projectSettings`) | `claude_code.safety_event`                                          |

## What we do not collect

- No names, email addresses, account ids, session ids or prompt ids. Claude Code sends the email address with every metric and event; our receiver deletes it before anything is stored.
- No prompts, replies, code, file contents, commands or tool input. `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES` and `OTEL_LOG_TOOL_DETAILS` stay off, and the receiver drops command details even if someone turns them on.
- No other events. Claude Code sends many events (prompts with the text redacted, API calls, tool results); the receiver keeps only safety events and drops the rest on arrival.
- No per-person view. A week with fewer than 3 people active is not shown, in either report.

## Who sees it, and for how long

- The pilot owner and the team. The weekly tables go in the pilot notes, and the guardrail table also goes to IT security.
- Raw daily files are deleted after 90 days. The weekly tables are kept until the pilot ends.

## What it will not be used for

Performance reviews, ranking people, or any decision about an individual. A guardrail stop is not a breach: it means the guardrail did its job. When one guardrail stops many calls, we fix the rule or explain it to the team, and we record that in `docs/ai-literacy-measures.md`.

## Before we switch it on for the team

- [ ] HR and the union contact have read this page (MBL information/negotiation as HR advises)
- [ ] The DPO has confirmed the legal basis and that this page works as the information notice
- [ ] Everyone in the pilot has been sent this page
- [ ] The receiver's allowlists match this page (`npm run -s telemetry:test` and `npm run -s guardrail:test`)

Contact: the pilot owner.
