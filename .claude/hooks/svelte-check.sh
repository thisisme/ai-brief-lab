#!/usr/bin/env bash
# PostToolUse: run svelte-autofixer on edited .svelte files; exit 2 sends issues back to Claude
f=$(jq -r '.tool_input.file_path // empty')
[[ "$f" == *.svelte ]] || exit 0
out=$(npx --no-install @sveltejs/mcp svelte-autofixer "$f" 2>/dev/null)
if grep -q 'require_another_tool_call_after_fixing: true' <<<"$out"; then
  echo "$(date -Iseconds) $f" >> "${CLAUDE_PROJECT_DIR:-.}/.claude/autofixer.log"
  { echo "svelte-autofixer flagged $f:"; echo "$out"; } >&2
  exit 2
fi
exit 0