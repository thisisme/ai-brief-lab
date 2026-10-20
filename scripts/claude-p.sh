#!/usr/bin/env bash
# Headless Claude Code for scripts and gates, with the subagent setup pinned.
# Claude Code 2.1.302 started offering fork subagents in `claude -p`. A fork
# inherits the whole conversation, so scripted runs here keep forks off unless
# a caller asks for them: CLAUDE_P_FORKS=1 scripts/claude-p.sh "prompt" ...
# stdin is closed so claude never waits 3 s for piped input.
set -euo pipefail
export CLAUDE_CODE_FORK_SUBAGENT="${CLAUDE_P_FORKS:-0}"
exec claude -p "$@" < /dev/null
