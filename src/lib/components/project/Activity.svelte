<script lang="ts">
	import { History } from '@lucide/svelte';
	import { getActivity } from '#lib/remote/projects.remote.js';
	import Card from '#lib/components/ui/Card.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { ago } from '#lib/format.js';

	let { name }: { name: string } = $props();
	const items = $derived(await getActivity(name));

	const colors = {
		info: 'bg-primary',
		success: 'bg-emerald-500',
		warning: 'bg-amber-500',
		error: 'bg-red-500'
	};
</script>

<Card flush>
	{#if items.length === 0}
		<EmptyState icon={History} title="No activity yet" />
	{:else}
		<ol class="divide-y divide-zinc-100 dark:divide-zinc-800/60">
			{#each items as item (item.id)}
				<li class="flex items-start gap-3 px-5 py-3">
					<span class={['mt-1.5 size-2 shrink-0 rounded-full', colors[item.level]]}></span>
					<div class="min-w-0 flex-1">
						<p class="text-sm">{item.message}</p>
						<p class="text-xs text-zinc-500">{item.type.replaceAll('_', ' ')}</p>
					</div>
					<time
						class="text-xs whitespace-nowrap text-zinc-500"
						title={new Date(item.createdAt).toLocaleString()}>{ago(item.createdAt)}</time
					>
				</li>
			{/each}
		</ol>
	{/if}
</Card>
