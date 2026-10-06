#!/usr/bin/env bash
# pr-baseline.sh FROM TO — merged PRs in a date range: count, median/p75 hours to merge, reverts
set -euo pipefail
from="$1"; to="$2"
gh pr list --state merged --limit 500 \
  --search "merged:${from}..${to}" \
  --json number,title,createdAt,mergedAt |
jq -r --arg range "$from..$to" '
  map(. + {h: (((.mergedAt|fromdateiso8601) - (.createdAt|fromdateiso8601)) / 3600)})
  | (map(.h) | sort) as $s
  | ($s|length) as $n
  | if $n == 0 then "\($range)  no merged PRs" else
    "\($range)  PRs: \($n)  median h: \($s[($n/2|floor)]*10|round/10)  p75 h: \($s[($n*0.75|floor)]*10|round/10)  reverts: \(map(select(.title|test("^Revert";"i")))|length)"
    end'