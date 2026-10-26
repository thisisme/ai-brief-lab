# lab-watch

A personal Claude Code plugin for the ai-brief-lab repo. Its one monitor runs
`scripts/php-watch.mjs` for the whole session: it lints each PHP file you or
Claude save under `hosts/php`, requests every page in `hosts/php/public` from its
own PHP server on port 8095, and prints one line when a page breaks or recovers.
Claude Code passes each line to Claude as a notification.

Load it per session with `claude --plugin-dir ./plugins/lab-watch`. Monitors from
project-scope plugins (enabled in `.claude/settings.json` or saved under
`.claude/skills/`) do not start, and monitors never start with `-p`.
