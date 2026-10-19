<svelte:options
  customElement={{
    tag: "qty-input",
    shadow: "open",
    props: {
      name: { type: "String", reflect: true },
      value: { type: "Number", reflect: true },
      min: { type: "Number" },
      max: { type: "Number" },
      label: { type: "String" },
    },
    extend: (ce) =>
      class extends (ce as unknown as new () => HTMLElement & {
        connectedCallback(): void;
      }) {
        // Makes <qty-input name="…"> take part in <form>: FormData, validation, :invalid, <label>.
        static formAssociated = true;
        internals!: ElementInternals;
        initialValue: number | null = null;
        constructor() {
          super();
          this.internals = this.attachInternals();
        }
        connectedCallback() {
          // Remember the markup's value so form reset can restore it.
          this.initialValue ??= Number(this.getAttribute("value") ?? 0);
          super.connectedCallback();
        }
        formResetCallback() {
          (this as unknown as { value: number }).value = this.initialValue ?? 0;
        }
        get form() {
          return this.internals.form;
        }
        get validity() {
          return this.internals.validity;
        }
        get validationMessage() {
          return this.internals.validationMessage;
        }
        checkValidity() {
          return this.internals.checkValidity();
        }
        reportValidity() {
          return this.internals.reportValidity();
        }
      },
  }}
/>

<script lang="ts">
  type Host = HTMLElement & { internals: ElementInternals };

  let {
    name = "",
    value = $bindable(0),
    min = 0,
    max = 99,
    label = "Quantity",
  }: {
    name?: string;
    value?: number;
    min?: number;
    max?: number;
    label?: string;
  } = $props();

  const el = $host() as Host;
  let input: HTMLInputElement;

  // Keep the form value and the validity in step with `value`.
  $effect(() => {
    const n = Number(value);
    el.internals.setFormValue(Number.isFinite(n) ? String(n) : "");
    if (!Number.isInteger(n)) {
      el.internals.setValidity(
        { badInput: true },
        "Enter a whole number",
        input,
      );
    } else if (n < min) {
      el.internals.setValidity(
        { rangeUnderflow: true },
        `At least ${min}`,
        input,
      );
    } else if (n > max) {
      el.internals.setValidity(
        { rangeOverflow: true },
        `At most ${max}`,
        input,
      );
    } else {
      el.internals.setValidity({});
    }
  });

  function step(by: number) {
    value = Math.min(max, Math.max(min, (Number(value) || 0) + by));
  }
</script>

<span part="wrap">
  <button
    type="button"
    part="button"
    aria-label="Fewer"
    onclick={() => step(-1)}>−</button
  >
  <input
    bind:this={input}
    type="number"
    part="input"
    aria-label={label}
    {min}
    {max}
    bind:value
  />
  <button type="button" part="button" aria-label="More" onclick={() => step(1)}
    >+</button
  >
</span>

<style>
  span {
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }
  input {
    width: 4em;
    font: inherit;
  }
  :host(:invalid) input {
    outline: 2px solid var(--qty-invalid, #c6613f);
  }
</style>
