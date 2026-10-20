<svelte:options
  customElement={{
    tag: "qty-stepper",
    shadow: "none",
    props: { label: { type: "String" } },
  }}
/>

<script lang="ts">
  // Enhances the <input type="number"> the server rendered inside <qty-stepper>.
  // Without JavaScript, or before this file loads, that input already works:
  // it posts, validates min/max, autofills, resets and has its <label>.
  // This element only adds − and + buttons around it.
  let { label = "" }: { label?: string } = $props();

  const el = $host();
  let input = $state<HTMLInputElement | null>(null);
  let value = $state(NaN);
  // Announced politely after a − or + click; typing never touches it.
  let status = $state("");
  let minus: HTMLButtonElement;
  let plus: HTMLButtonElement;

  const name = $derived(
    label || input?.labels?.[0]?.textContent?.trim() || "quantity",
  );
  const atMin = $derived(
    !!input && input.min !== "" && value <= Number(input.min),
  );
  const atMax = $derived(
    !!input && input.max !== "" && value >= Number(input.max),
  );

  $effect(() => {
    const found = el.querySelector<HTMLInputElement>('input[type="number"]');
    if (!found) {
      console.warn('<qty-stepper> needs an <input type="number"> inside it');
      return;
    }
    // Svelte appended the buttons after the server's input; put them around it.
    found.before(minus);
    found.after(plus);
    input = found;

    const sync = () => (value = found.valueAsNumber);
    // A form reset fires "reset" before the values change, so read them a tick later.
    const onReset = () => setTimeout(sync);
    sync();
    found.addEventListener("input", sync);
    found.form?.addEventListener("reset", onReset);
    return () => {
      found.removeEventListener("input", sync);
      found.form?.removeEventListener("reset", onReset);
    };
  });

  function step(dir: 1 | -1) {
    if (!input) return;
    // stepUp/stepDown use the input's own min, max and step.
    if (dir > 0) input.stepUp();
    else input.stepDown();
    // Tell the page, as if the user had typed it.
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    status = `${name}: ${input.value}`;
  }
</script>

<button
  bind:this={minus}
  type="button"
  aria-label="Fewer: {name}"
  aria-controls={input?.id}
  disabled={atMin}
  onclick={() => step(-1)}>−</button
>
<button
  bind:this={plus}
  type="button"
  aria-label="More: {name}"
  aria-controls={input?.id}
  disabled={atMax}
  onclick={() => step(1)}>+</button
>
<span
  role="status"
  aria-live="polite"
  aria-atomic="true"
  style="position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0"
  >{status}</span
>
