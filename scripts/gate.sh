#!/usr/bin/env bash
# The project's definition of done for changed code. Used by both Claude hooks and by you:
#   npm run gate   → exit 0 = pass, exit 1 = fail (the failing output is printed)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

# Changed vs HEAD: staged, unstaged and untracked files under the checked folders.
changed=$( { git diff --name-only HEAD -- src hosts scripts package.json
             git ls-files --others --exclude-standard -- src hosts scripts package.json; } | sort -u)
if [[ -z "$changed" ]]; then
  echo "gate: no code changes"
  exit 0
fi

out=$(mktemp)
trap 'rm -f "$out"' EXIT
fail() { echo "gate: FAIL $1"; tail -n 30 "$out"; exit 1; }

npm run -s check >"$out" 2>&1 || fail "npm run check"
while IFS= read -r f; do
  [[ "$f" == *.php && -f "$f" ]] || continue
  php -l "$f" >"$out" 2>&1 || fail "php -l $f"
done <<<"$changed"
if grep -q '^src/lib/elements/' <<<"$changed"; then
  npm run -s elements:build >"$out" 2>&1 || fail "npm run elements:build"
fi
echo "gate: ok ($(wc -l <<<"$changed" | tr -d ' ') changed files)"