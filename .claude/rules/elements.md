---
paths:
  - "src/lib/elements/**/*.svelte"
---

# Custom elements

- <svelte:options customElement={{ tag, shadow: 'open', props }}>; kebab-case tag with a hyphen.
- Every prop gets an explicit `type`; camelCase props get a kebab-case `attribute`.
- Events: $host().dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true })).
- No prop names starting with "on". Expose styling via part="…" and CSS custom properties.
- After a change: build with vite.elements.config.js, then run scripts/elements-smoke.mjs.
