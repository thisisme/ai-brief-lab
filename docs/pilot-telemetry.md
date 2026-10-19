# AI pilot: what we measure (draft for HR, the union contact and the DPO)

**Status:** draft, not yet agreed. Nothing is collected from anyone but the pilot owner until this page is agreed.

## Why

To decide whether the Claude Code pilot is worth continuing, we need four team-level numbers per week: cost, how much of the work Claude was used for, how often its edits were kept, and whether it shows up in commits and pull requests.

## What we collect

Claude Code's built-in OpenTelemetry counters, summed per team and per ISO week:

| Number                     | Source metric                                                       |
| -------------------------- | ------------------------------------------------------------------- |
| People active (count only) | distinct people per day, counted in memory and never stored by name |
| Sessions                   | `claude_code.session.count`                                         |
| Cost in USD                | `claude_code.cost.usage`                                            |
| Lines added / removed      | `claude_code.lines_of_code.count`                                   |
| Commits / pull requests    | `claude_code.commit.count`, `claude_code.pull_request.count`        |
| Edits kept (%)             | `claude_code.code_edit_tool.decision`                               |
| Active hours               | `claude_code.active_time.total`                                     |

## What we do not collect

- No names, email addresses, account ids or session ids. Claude Code sends the email address with every metric; our receiver deletes it before anything is stored.
- No prompts, replies, code, file contents, commands or tool input. `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS` and the logs exporter stay off.
- No per-person view. A week with fewer than 3 people active is not shown.

## Who sees it, and for how long

- The pilot owner and the team. The weekly table goes in the pilot notes.
- Raw daily files are deleted after 90 days. The weekly table is kept until the pilot ends.

## What it will not be used for

Performance reviews, ranking people, or any decision about an individual.

## Before we switch it on for the team

- [ ] HR and the union contact have read this page (MBL information/negotiation as HR advises)
- [ ] The DPO has confirmed the legal basis and that this page works as the information notice
- [ ] Everyone in the pilot has been sent this page
- [ ] The receiver's allowlist matches this page (`npm run -s telemetry:test`)

Contact: the pilot owner.
