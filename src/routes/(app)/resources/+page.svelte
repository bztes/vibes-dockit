<script lang="ts">
	import { Waypoints } from '@lucide/svelte';
	import { getTopology } from '#lib/remote/topology.remote.js';
	import { onChange } from '#lib/components/app/changes.svelte.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Stat from '#lib/components/ui/Stat.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Switch from '#lib/components/ui/Switch.svelte';
	import TopologyGraph, { kindStyle } from '#lib/components/topology/TopologyGraph.svelte';
	import { bytes } from '#lib/format.js';

	const query = getTopology();
	const topology = $derived(await query);
	onChange(() => void query.refresh());

	let show = $state({ image: true, network: true, volume: true });
	let builtin = $state(false);
	let unused = $state(false);

	const stats = $derived.by(() => {
		const t = topology;
		const usedImages = new Set(t.containers.map((c) => c.imageId));
		const usedVolumes = new Set(t.containers.flatMap((c) => c.mounts.map((m) => m.volume)));
		const usedNetworks = new Set(t.containers.flatMap((c) => c.endpoints.map((e) => e.network)));
		const networks = t.networks.filter((n) => !n.builtin);
		const unusedImages = t.images.filter((i) => !usedImages.has(i.id));
		return [
			{
				label: 'Containers',
				value: t.containers.length,
				sub: `${t.containers.filter((c) => c.state === 'running').length} running`
			},
			{
				label: 'Images',
				value: t.images.length,
				sub: unusedImages.length
					? `${unusedImages.length} unused · ${bytes(unusedImages.reduce((a, i) => a + i.size, 0))}`
					: bytes(t.images.reduce((a, i) => a + i.size, 0))
			},
			{
				label: 'Volumes',
				value: t.volumes.length,
				sub: `${t.volumes.filter((v) => !usedVolumes.has(v.name)).length} unused`
			},
			{
				label: 'Networks',
				value: networks.length,
				sub: `${networks.filter((n) => !usedNetworks.has(n.name)).length} unused`
			}
		];
	});
</script>

<svelte:head><title>Resources · Dockit</title></svelte:head>

<PageHeader
	title="Resources"
	description="All containers on this host with their images, networks and volumes."
/>

<div class="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
	{#each stats as s (s.label)}
		<Stat label={s.label} value={s.value} sub={s.sub} />
	{/each}
</div>

<Card class="mt-6">
	{#snippet actions()}
		<div class="flex flex-wrap items-center gap-1.5">
			{#each ['image', 'network', 'volume'] as const as key (key)}
				{@const style = kindStyle[key]}
				<button
					type="button"
					aria-pressed={show[key]}
					class={[
						'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors',
						show[key]
							? 'border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100'
							: 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
					]}
					onclick={() => (show[key] = !show[key])}
				>
					<style.icon class={['size-3.5', show[key] && style.text]} />
					{style.label}
				</button>
			{/each}
		</div>
		<div class="flex flex-wrap gap-5">
			<Switch bind:checked={unused} label="Unused" />
			<Switch bind:checked={builtin} label="Built-in networks" />
		</div>
	{/snippet}
	{#if topology.containers.length === 0 && topology.images.length === 0}
		<EmptyState
			icon={Waypoints}
			title="Nothing here yet"
			description="Deploy a project to see its containers, images, networks and volumes."
		/>
	{:else}
		<TopologyGraph
			{topology}
			options={{
				images: show.image,
				networks: show.network,
				volumes: show.volume,
				builtin,
				unused
			}}
		/>
	{/if}
</Card>
