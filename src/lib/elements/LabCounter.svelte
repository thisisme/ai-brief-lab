<!-- svelte rule loaded -->
<svelte:options
  customElement={{
    tag: "lab-counter",
    shadow: "open",
    props: {
      count: { type: "Number" },
    },
  }}
/>

<script>
  let { count = $bindable(0) } = $props();

  let first = true;
  $effect(() => {
    const current = count;
    if (first) {
      first = false;
      return;
    }
    $host().dispatchEvent(
      new CustomEvent("change", {
        detail: { count: current },
        bubbles: true,
        composed: true,
      }),
    );
  });
</script>

<button onclick={() => (count = count === 0 ? 1 : count * 2)}>
  Count: {count} (×2)
</button>
