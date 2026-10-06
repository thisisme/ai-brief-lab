<script>
  let { count = $bindable(0) } = $props();
</script>

<button onclick={() => (count += 1)}>
  Count: {count} (+1)
</button>
