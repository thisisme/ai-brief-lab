<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<footer>
	<p>&copy; {new Date().getFullYear()} ai-brief-lab</p>
</footer>

<style>
	footer {
		padding: 1rem;
		text-align: center;
		font-size: 0.875rem;
		opacity: 0.7;
	}
</style>
