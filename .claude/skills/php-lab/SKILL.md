---
name: php-lab
description: Ask the lab's PHP host what it runs. Lists the pages under hosts/php, lints PHP files with php -l, and reports the PHP version, PHP2Shell fix status and advisory ini settings. Use when a task touches hosts/php or asks which PHP runs here.
allowed-tools: Bash(php tools/php-mcp/bin/php-lab *)
license: Proprietary
compatibility: Claude Code in the ai-brief-lab repo. Needs the PHP 8.2+ CLI; no Composer packages.
metadata:
  owner: mats
  updated: "2026-11-02"
---
Run the CLI from the repo root. It prints JSON on stdout and never writes files,
opens network connections or executes pages.

- `php tools/php-mcp/bin/php-lab pages`
  → `{"root": "hosts/php", "pages": ["public/index.php", ...], "php_files": N}`
- `php tools/php-mcp/bin/php-lab lint public/a.php public/b.php`
  → one `{"path", "ok", "message"}` object per file (a single object for one path).
  Exit 1 means at least one file has a syntax error; `message` is PHP's own text.
- `php tools/php-mcp/bin/php-lab runtime`
  → `php_version`, `php2shell_fixed` (false means the CLI is older than the October
  2026 fix for its branch), the advisory `ini` values and `extensions`.

Paths are relative to hosts/php. Exit 2 with `php-lab: Refused: ...` on stderr means the
path left hosts/php or is not a .php file: fix the path, don't work around the check.

The php-lab MCP server answers the same three questions from the same LabTools class.
If its tools are already loaded in this session, either is fine; don't call both.
Report runtime values as CLI values: PHP-FPM or Apache can load another php.ini.
