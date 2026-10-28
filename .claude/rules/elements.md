---
paths:
  - "src/lib/elements/**/*.svelte"
---

# Custom elements

- <svelte:options customElement={{ tag, shadow, props }}>; kebab-case tag with a hyphen.
  shadow: 'open' for self-contained widgets, 'none' for enhancers (see below).
- Every prop gets an explicit `type`; camelCase props get a kebab-case `attribute`.
- Every component declares $props() with at least one prop. With $host() and no $props(),
  Svelte 5.57 compiles without a warning and throws "$$props is not defined" at runtime.
- Events: $host().dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true })).
- No prop names starting with "on". Expose styling via part="…" and CSS custom properties.
- Never name a local variable `host`: `$host()` then reads as a store subscription to it.
  Use `const el = $host() as HTMLElement & { internals: ElementInternals }`.

# Enhancers (prefer these when a native control exists)

- PHP renders the working control inside the tag, e.g. <qty-stepper><input type="number" …></qty-stepper>.
  The page must work with JavaScript off and when the bundle fails to load.
- shadow: 'none'. Svelte appends its markup after the existing children, so move it into place
  with before()/after() in an $effect. Never replace, rename or re-create the server's control.
- Use the control's own attributes (min, max, step, required) and its <label>; don't copy them into props.
- After changing the value from code, dispatch 'input' and 'change' with { bubbles: true }.
- Styling belongs to the page's stylesheet, not the component.

# Form controls (only when there is no native control to wrap)

- Make it form-associated in `extend`: `static formAssociated = true;`, `internals!: ElementInternals;`,
  and `this.internals = this.attachInternals()` in the constructor. Forward form, validity,
  validationMessage, checkValidity() and reportValidity() to `this.internals`.
- Give it a `name` prop with `reflect: true`. PHP reads `name="qty[SKU]"` as `$_POST['qty']['SKU']`.
- In one $effect: `setFormValue(String(value))`, then `setValidity({ flag: true }, message, innerInput)`
  or `setValidity({})`. Use the standard flags (rangeOverflow, valueMissing, badInput…).
- Inner buttons are `type="button"`, or they submit the form.
- A <label for> on the host does not name an input inside its shadow root. Copy
  `this.internals.labels[0]?.textContent.trim()` onto the inner input as aria-label.

# Accessible names

- Every button, input and link the element renders has a name with a letter or digit in it:
  "More: Halmstad mug", never just "+" or an icon.
- Answer "what will a screen reader say?" from npm run -s aria:snap -- --print <page>.php,
  not from the component source.

# Always

- The PHP page validates every posted value again; element validation is only for the user.
- After a change: npm run elements:build, then npm run elements:smoke, npm run form:smoke and
  npm run stepper:smoke with npm run elements:serve running, then npm run -s aria:snap.
  If its only failures are "changed since the baseline" and the new lines are what you meant,
  rerun it with -- --update and commit tests/aria/ with the change.
