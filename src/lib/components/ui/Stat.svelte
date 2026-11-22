<script module lang="ts">
	import { tv } from 'tailwind-variants';

	/** bordered tile, e.g. a stat */
	export const panel = tv({
		base: 'rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800/80 dark:bg-zinc-900/60'
	});
</script>

<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	interface Props {
		label: string;
		icon?: Component;
		title?: string;
		value?: string | number | Snippet;
		valueClass?: string;
		sub?: string;
		/** extra content below the value */
		children?: Snippet;
	}

	let { label, icon: Icon, title, value, valueClass, sub, children }: Props = $props();
</script>

<div class={panel()}>
	<p class="flex items-center gap-1.5 text-xs font-medium text-zinc-500" {title}>
		{#if Icon}<Icon class="size-3.5" />{/if}
		{label}
	</p>
	{#if value !== undefined}
		<p class={['mt-1 text-2xl font-semibold tabular-nums', valueClass]}>
			{#if typeof value === 'function'}{@render value()}{:else}{value}{/if}
		</p>
	{/if}
	{#if sub}<p class="text-xs text-zinc-500">{sub}</p>{/if}
	{@render children?.()}
</div>
