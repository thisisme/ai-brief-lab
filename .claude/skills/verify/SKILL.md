---
name: verify
description: Run the project's checks before a commit. Use right before
  committing, or when asked whether a change is ready.
---

Run, in order, and stop at the first failure:

1. npm run check
2. npm run build
3. vendor/bin/phpstan analyse --no-progress (only if vendor/bin/phpstan exists)
   Fix mechanical failures (types, imports, lint) and re-run.
   If something needs a design decision, stop and report file:line instead of committing.
