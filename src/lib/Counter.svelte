<script>
  let { count = $bindable(0) } = $props();
</script>

<button onclick={() => (count = count === 0 ? 1 : count * 2)}>
  Count: {count} (×2)
</button>
