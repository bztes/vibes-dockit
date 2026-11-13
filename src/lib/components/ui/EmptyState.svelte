<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	interface Props {
		icon?: Component;
		title: string;
		description?: string;
		children?: Snippet;
	}
	let { icon: Icon, title, description, children }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
	{#if Icon}
		<div
			class="grid size-12 place-items-center rounded-2xl border border-zinc-200 bg-zinc-50 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
		>
			<Icon class="size-5" />
		</div>
	{/if}
	<div>
		<p class="font-medium text-zinc-900 dark:text-zinc-100">{title}</p>
		{#if description}<p class="mt-1 max-w-sm text-sm text-zinc-500">{description}</p>{/if}
	</div>
	{#if children}<div class="mt-2 flex gap-2">{@render children()}</div>{/if}
</div>
