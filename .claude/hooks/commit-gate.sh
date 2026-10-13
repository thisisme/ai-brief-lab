#!/usr/bin/env bash
# PreToolUse(Bash): run scripts/gate.sh before any `git commit`. exit 2 blocks the commit.
# With "onFailure": "block", a crash, a timeout or a missing script blocks it too.
set -uo pipefail
cmd=$(jq -r '.tool_input.command // ""')
grep -Eq '(^|[;&|( ])git( -C [^ ]+)? commit( |$)' <<<"$cmd" || exit 0

if ! res=$("${CLAUDE_PROJECT_DIR:-.}/scripts/gate.sh" 2>&1); then
  echo "$(date -Iseconds) commit blocked" >> "${CLAUDE_PROJECT_DIR:-.}/.claude/gate.log"
  { echo "Commit blocked by scripts/gate.sh. Fix this first:"; echo "$res"; } >&2
  exit 2
fi
exit 0