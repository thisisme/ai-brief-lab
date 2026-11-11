# Agent egress policy

What the coding agent in this repo may send out of the machine, and what may
change its own code without a commit. `npm run -s egress:audit` lists every
finding; each one needs a row below. A row's first cell is the finding id
exactly as the audit prints it: the file, `#`, then what was found.

Owner: Mats. Review: when a row changes, and once a quarter.

## Decisions

- **allow**: goes to a service we already trust with this code (our own git
  remote, a local process), or carries no code or personal data.
- **review**: allowed, but a person reads what goes out before it is sent, or
  the source is pinned and bumped by hand in a reviewed commit.
- **block**: never in this repo. Remove it, or deny it in
  `.claude/settings.json` (`permissions.deny`).

Never allowed out, whatever the row says: customer data, personal data
(names, emails, personnummer), secrets, and code from client repos.

## Findings

| Finding | Decision | Why |
| --- | --- | --- |
| `.mcp.json#mcp svelte` | allow | Local stdio server from the `@sveltejs/mcp` devDependency; version moves only with `package-lock.json` |
| `.mcp.json#mcp php-lab` | allow | Local, read-only PHP tools (Oct 28 lab); no network calls |
