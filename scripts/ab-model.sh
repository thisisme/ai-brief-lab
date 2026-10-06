#!/usr/bin/env bash
# ab-model.sh "<task>" — same task on Sonnet and Opus, each in a throwaway worktree
set -euo pipefail
task="$1"
for m in sonnet opus; do
  wt="../ab-$m"
  git worktree add -q --detach "$wt" HEAD
  start=$(date +%s)
  (cd "$wt" && claude -p "$task" --model "$m" \
      --permission-mode acceptEdits \
      --allowedTools "Bash(npm run *),Bash(npm test *)" \
      --output-format json > "../ab-$m.json")
  secs=$(( $(date +%s) - start ))
  cost=$(jq -r '.total_cost_usd' "../ab-$m.json")
  files=$(git -C "$wt" status --short | wc -l | tr -d ' ')
  printf '%-7s $%-6s %4ss  %s files changed\n' "$m" "$cost" "$secs" "$files"
done
echo "Compare ../ab-sonnet and ../ab-opus, then: git worktree remove --force <path>"