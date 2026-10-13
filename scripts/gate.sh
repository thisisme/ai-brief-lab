#!/usr/bin/env bash
# The project's definition of done for changed code. Used by both Claude hooks and by you:
#   npm run gate   → exit 0 = pass, exit 1 = fail (the failing output is printed)
# A result is cached in .claude/.gate-cache, keyed on HEAD plus the content of every
# changed file and the build config, so a Stop hook after a turn that changed nothing
# reuses it instead of re-running svelte-check. GATE_NO_CACHE=1 forces a fresh run.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

# Changed vs HEAD: staged, unstaged and untracked files under the checked folders.
changed=$( { git diff --name-only HEAD -- src hosts scripts package.json
             git ls-files --others --exclude-standard -- src hosts scripts package.json; } | sort -u)
if [[ -z "$changed" ]]; then
  echo "gate: no code changes"
  exit 0
fi

cache=.claude/.gate-cache
key=$( { git rev-parse HEAD
         while IFS= read -r f; do echo "$f"; [[ -f "$f" ]] && cat "$f"; done <<<"$changed"
         cat package-lock.json tsconfig.json svelte.config.js vite.config.ts 2>/dev/null
       } | git hash-object --stdin)
if [[ -z "${GATE_NO_CACHE:-}" && -f "$cache" && "$(head -n 1 "$cache")" == "$key" ]]; then
  code=$(sed -n 2p "$cache")
  tail -n +3 "$cache"
  echo "gate: (cached result, exit $code)"
  exit "$code"
fi

out=$(mktemp)
res=$(mktemp)
trap 'rm -f "$out" "$res"' EXIT
finish() { mkdir -p .claude; { echo "$key"; echo "$1"; cat "$res"; } > "$cache"; cat "$res"; exit "$1"; }
fail() { { echo "gate: FAIL $1"; tail -n 30 "$out"; } > "$res"; finish 1; }

npm run -s check >"$out" 2>&1 || fail "npm run check"
while IFS= read -r f; do
  [[ "$f" == *.php && -f "$f" ]] || continue
  php -l "$f" >"$out" 2>&1 || fail "php -l $f"
done <<<"$changed"
if grep -q '^src/lib/elements/' <<<"$changed"; then
  npm run -s elements:build >"$out" 2>&1 || fail "npm run elements:build"
fi
echo "gate: ok ($(wc -l <<<"$changed" | tr -d ' ') changed files)" > "$res"
finish 0