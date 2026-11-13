<script lang="ts">
	import { ScrollText } from '@lucide/svelte';
	import { watchLogs } from '#lib/remote/projects.remote.js';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Select from '#lib/components/ui/Select.svelte';
	import Terminal from '#lib/components/ui/Terminal.svelte';

	interface Props {
		containers: { id: string; name: string; service: string; state: string }[];
		selected: string | null;
	}
	let { containers, selected = $bindable() }: Props = $props();

	let tail = $state(300);
	let timestamps = $state(false);

	$effect.pre(() => {
		if (!selected || !containers.some((c) => c.id === selected))
			selected = containers[0]?.id ?? null;
	});

	const logs = $derived(selected ? watchLogs({ id: selected, tail }) : null);
	const text = $derived.by(() => {
		const t = logs?.current ?? '';
		return timestamps ? t : t.replace(/^\S+Z /gm, '');
	});
</script>

{#if containers.length === 0}
	<div class="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800">
		<EmptyState
			icon={ScrollText}
			title="No containers"
			description="Deploy the project to see logs."
		/>
	</div>
{:else}
	<div class="grid gap-3">
		<div class="flex flex-wrap items-center gap-3">
			<div class="w-full max-w-xs">
				<Select bind:value={selected} size="sm">
					{#each containers as c (c.id)}
						<option value={c.id}>{c.name} ({c.state})</option>
					{/each}
				</Select>
			</div>
			<div class="w-28">
				<Select bind:value={tail} size="sm">
					{#each [100, 300, 1000, 5000] as n (n)}<option value={n}>last {n}</option>{/each}
				</Select>
			</div>
			<label class="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
				<input type="checkbox" bind:checked={timestamps} class="size-4 accent-primary" /> Timestamps
			</label>
			{#if logs}
				<span class="ml-auto flex items-center gap-1.5 text-xs text-zinc-500">
					<span class={['size-1.5 rounded-full', logs.connected ? 'bg-emerald-500' : 'bg-zinc-500']}
					></span>
					{logs.connected ? 'Live' : 'Disconnected'}
				</span>
			{/if}
		</div>
		<Terminal text={text || 'Waiting for output…'} class="h-[65vh]" />
	</div>
{/if}
