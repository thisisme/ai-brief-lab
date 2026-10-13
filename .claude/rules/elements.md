---
paths:
  - "src/lib/elements/**/*.svelte"
---

# Custom elements

- <svelte:options customElement={{ tag, shadow: 'open', props }}>; kebab-case tag with a hyphen.
- Every prop gets an explicit `type`; camelCase props get a kebab-case `attribute`.
- Events: $host().dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true })).
- No prop names starting with "on". Expose styling via part="…" and CSS custom properties.
- Never name a local variable `host`: `$host()` then reads as a store subscription to it.
  Use `const el = $host() as HTMLElement & { internals: ElementInternals }`.

# Form controls (anything a PHP form should receive)

- Make it form-associated in `extend`: `static formAssociated = true;`, `internals!: ElementInternals;`,
  and `this.internals = this.attachInternals()` in the constructor. Forward form, validity,
  validationMessage, checkValidity() and reportValidity() to `this.internals`.
- Give it a `name` prop with `reflect: true`. PHP reads `name="qty[SKU]"` as `$_POST['qty']['SKU']`.
- In one $effect: `setFormValue(String(value))`, then `setValidity({ flag: true }, message, innerInput)`
  or `setValidity({})`. Use the standard flags (rangeOverflow, valueMissing, badInput…).
- Inner buttons are `type="button"`, or they submit the form.
- The PHP page validates every posted value again; element validation is only for the user.
- After a change: npm run elements:build, then npm run elements:smoke and npm run form:smoke
  with npm run elements:serve running.
