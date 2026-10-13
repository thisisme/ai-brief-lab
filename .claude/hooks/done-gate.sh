#!/usr/bin/env bash
# Stop: don't let Claude end its turn while scripts/gate.sh fails. exit 2 = keep working.
# Stop hooks always fail open: onFailure is ignored here, so the commit gate is the hard stop.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
sid=$(jq -r '.session_id // "none"')
tries=".claude/.done-gate-$sid"

if res=$(scripts/gate.sh 2>&1); then
  rm -f "$tries"
  exit 0
fi

n=$(( $(cat "$tries" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$tries"
echo "$(date -Iseconds) stop blocked #$n" >> .claude/gate.log
if (( n > 3 )); then
  # Loop guard: after 3 blocks, let Claude stop and tell the user.
  rm -f "$tries"
  jq -n --arg m "done-gate: checks still fail after 3 tries. $(head -n 1 <<<"$res")" '{systemMessage: $m}'
  exit 0
fi
{ echo "Not done yet: scripts/gate.sh fails. Fix it, then finish:"; echo "$res"; } >&2
exit 2