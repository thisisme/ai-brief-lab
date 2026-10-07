<svelte:options
  customElement={{
    tag: "stock-badge",
    shadow: "open",
    props: {
      sku: { type: "String" },
      qty: { type: "Number", reflect: true },
      low: { type: "Number", attribute: "low-at" },
    },
  }}
/>

<script>
  let { sku = "", qty = 0, low = 5 } = $props();
  const level = $derived(qty === 0 ? "out" : qty <= low ? "low" : "ok");

  function restock() {
    $host().dispatchEvent(
      new CustomEvent("restock", {
        detail: { sku, qty },
        bubbles: true,
        composed: true,
      }),
    );
  }
</script>

<span class="badge {level}" part="badge">
  {sku}: {level === "out" ? "out of stock" : `${qty} left`}
</span>
{#if level !== "ok"}
  <button type="button" onclick={restock}>Restock</button>
{/if}

<style>
  .badge {
    font: 600 0.8rem/1 system-ui;
    padding: 0.3em 0.6em;
    border-radius: 999px;
  }
  .low {
    background: #fff4e0;
    color: #7a4b00;
  }
  .out {
    background: #fde8e8;
    color: #8a1c1c;
  }
</style>
