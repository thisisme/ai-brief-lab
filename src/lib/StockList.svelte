<!-- svelte rule loaded -->
<script>
  let { items = [] } = $props();
</script>

<ul>
  {#each items as item (item.sku)}
    <li>{item.sku}: {item.qty}</li>
  {/each}
</ul>
