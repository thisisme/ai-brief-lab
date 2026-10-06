<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
</script>

<svelte:head>
	<title>Products</title>
</svelte:head>

<h1>Products</h1>

{#if data.products.length === 0}
	<p>No products yet.</p>
{:else}
	<ul>
		{#each data.products as product (product.id)}
			<li>
				<strong>{product.name}</strong> — {money.format(product.price)}
				{#if product.description}
					<p>{product.description}</p>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
