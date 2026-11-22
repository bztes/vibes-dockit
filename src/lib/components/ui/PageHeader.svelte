<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		description?: string | Snippet;
		actions?: Snippet;
		class?: string;
	}

	let { title, description, actions, class: className }: Props = $props();
</script>

<div class={['flex flex-wrap items-end justify-between gap-4', className]}>
	<div class="min-w-0">
		<h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
		{#if description}
			<p class="mt-1 text-sm text-zinc-500">
				{#if typeof description === 'function'}{@render description()}{:else}{description}{/if}
			</p>
		{/if}
	</div>
	{#if actions}<div class="flex flex-wrap gap-2">{@render actions()}</div>{/if}
</div>
