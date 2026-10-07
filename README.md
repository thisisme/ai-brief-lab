# ai-brief-lab

A sandbox for trying out AI-assisted development workflows with Claude Code, on top of a small SvelteKit 3 / Svelte 5 codebase. The app code is deliberately small; the point is the tooling around it and what the experiments show. Results are logged in [`LABS.md`](LABS.md).

## What's in here

### SvelteKit app (`src/`)

- `/products` loads a product list server-side from the endpoint in `PRODUCTS_API_URL` and validates its shape (`src/lib/products.ts`). A bad response becomes a 502 error page.
- `StockList.svelte` and `Counter.svelte` are the plain Svelte components behind it.
- Import shared code from `#lib` (not `$lib`).

### Svelte custom elements for a PHP host (`src/lib/elements/`, `hosts/php/`)

Svelte components compiled as web components, so they can be dropped into a non-Svelte page:

- `<stock-badge sku qty low-at>` shows stock status (ok, low or out) and fires a `restock` event.
- `<lab-counter count>` is a doubling counter that fires `change`.

`src/elements.js` is the entry point. `npm run elements:build` bundles it to `hosts/php/public/build/elements.js`. The demo host in `hosts/php/public/` is a plain PHP page that renders the elements. `npm run elements:smoke` loads that page in Playwright and checks that the tags register.

### Claude Code experiments (`.claude/`, `scripts/`)

- `.claude/CLAUDE.md`, `rules/` (Svelte, PHP and custom-element conventions), `agents/check-runner.md`, `skills/verify` and `hooks/` (svelte-check on edit, instruction logging) make up the project's Claude setup.
- `scripts/ab-model.sh "<task>"` runs the same task on Sonnet and Opus in throwaway git worktrees and compares cost, time and files changed.
- `scripts/models.mjs` lists the models, effort levels and thinking support reported by the Anthropic Models API. With `--lint`, it checks that the `effort` set in agent and skill frontmatter is valid for the model in use. It needs `ANTHROPIC_API_KEY`, or `MODELS_FIXTURE` pointing at a saved response (see `scripts/fixtures/models.json`).
- `pr-baseline.sh FROM TO` reports merged-PR count, median and p75 hours to merge, and reverts for a date range (needs `gh` and `jq`).
- `LABS.md` is the running log of experiment results.

## Setup

```sh
npm install
cp .env.example .env   # set PRODUCTS_API_URL
```

## Commands

| Command                   | What it does                                                |
| ------------------------- | ----------------------------------------------------------- |
| `npm run dev`             | Start the SvelteKit dev server                              |
| `npm run build`           | Production build of the app                                 |
| `npm run preview`         | Preview the production build                                |
| `npm run check`           | `svelte-check` type and component checks                    |
| `npm run elements:build`  | Build the custom elements into the PHP host                 |
| `npm run elements:serve`  | Serve the PHP demo at http://127.0.0.1:8099 (needs PHP)     |
| `npm run elements:smoke`  | Playwright smoke test against the served demo               |
| `npm run models`          | Table of Claude models and their capabilities               |
| `npm run agents:effort`   | Lint `effort` settings in `.claude/agents` and skills       |

Typical custom-element loop: `npm run elements:build`, `npm run elements:serve`, then `npm run elements:smoke` in another terminal.
