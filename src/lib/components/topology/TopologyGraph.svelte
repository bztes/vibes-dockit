<script lang="ts" module>
	import { HardDrive, Layers, Network } from '@lucide/svelte';
	import type { NodeKind, TopologyContainer } from './layout';

	export function containerTone(c: TopologyContainer) {
		if (c.state === 'restarting' || (c.state === 'running' && c.health === 'unhealthy'))
			return 'unhealthy';
		if (c.state === 'running') return 'running';
		if (c.state === 'paused') return 'partial';
		if (c.state === 'created') return 'not-deployed';
		return 'stopped';
	}

	export const kindStyle: Record<
		NodeKind,
		{ icon: typeof Network; label: string; bg: string; text: string }
	> = {
		image: {
			icon: Layers,
			label: 'Images',
			bg: 'bg-violet-500/10',
			text: 'text-violet-600 dark:text-violet-400'
		},
		network: { icon: Network, label: 'Networks', bg: 'bg-primary/10', text: 'text-link' },
		volume: {
			icon: HardDrive,
			label: 'Volumes',
			bg: 'bg-amber-500/10',
			text: 'text-amber-600 dark:text-amber-400'
		}
	};
</script>

<script lang="ts">
	import { Lock } from '@lucide/svelte';
	import StatusDot from '#lib/components/ui/StatusDot.svelte';
	import { bytes } from '#lib/format.js';
	import TopologyDetails from './TopologyDetails.svelte';
	import {
		imageName,
		layoutTopology,
		nodeKey,
		publishedPorts,
		volumeName,
		type LayoutNode,
		type LayoutOptions,
		type Selection,
		type Topology
	} from './layout';

	let { topology, options }: { topology: Topology; options: Omit<LayoutOptions, 'width'> } =
		$props();

	let width = $state(0);
	const layout = $derived(layoutTopology(topology, { ...options, width }));

	let selected = $state<Selection | null>(null);
	let hovered = $state<Selection | null>(null);
	const active = $derived(hovered ?? selected);
	const activeKey = $derived(active && nodeKey(active.kind, active.id));

	/** edges, containers and nodes connected to the active node */
	const related = $derived.by(() => {
		if (!active || !activeKey) return null;
		const edges = layout.edges.filter((e) =>
			active.kind === 'container' ? e.container === active.id : e.node === activeKey
		);
		return {
			edges: new Set(edges.map((e) => e.id)),
			nodes: new Set([
				activeKey,
				...edges.flatMap((e) => [e.node, nodeKey('container', e.container)])
			])
		};
	});
	const connected = $derived(new Set(layout.edges.map((e) => e.node)));

	const dim = (key: string) => !!related && !related.nodes.has(key);
	const isSelected = (s: Selection) => selected?.kind === s.kind && selected.id === s.id;

	function toggle(s: Selection) {
		selected = isSelected(s) ? null : s;
	}

	function onkeydown(e: KeyboardEvent) {
		// Escape inside a dialog (e.g. a confirmation) only closes the dialog
		const inDialog = e.target instanceof Element && e.target.closest('dialog, [role="dialog"]');
		if (e.key === 'Escape' && !inDialog) selected = null;
	}

	const edgeLabels = $derived.by(() => {
		if (!related || !active) return [];
		return layout.edges
			.filter((e) => related.edges.has(e.id) && e.ip)
			.map((e) =>
				// label the end that is not shared by the other highlighted edges
				active.kind === 'container'
					? { id: e.id, x: e.to.x - 10, y: e.to.y - 5, anchor: 'end', text: e.ip }
					: { id: e.id, x: e.from.x + 10, y: e.from.y - 5, anchor: 'start', text: e.ip }
			);
	});

	function title(n: LayoutNode) {
		if (n.kind === 'image') return [...n.image.tags, n.image.id].join('\n');
		if (n.kind === 'volume') return n.volume.name;
		return n.network.name;
	}
</script>

{#snippet sideNode(n: LayoutNode)}
	{@const style = kindStyle[n.kind]}
	{@const s = { kind: n.kind, id: n.id }}
	<button
		type="button"
		class={[
			'absolute flex items-center gap-2.5 rounded-lg border bg-white px-3 text-left shadow-xs transition-[opacity,border-color] duration-150 dark:bg-zinc-900',
			isSelected(s)
				? 'border-primary ring-2 ring-primary/20'
				: 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700',
			!connected.has(n.key) && !isSelected(s) && 'border-dashed',
			dim(n.key) && 'opacity-40'
		]}
		style:left="{n.x}px"
		style:top="{n.y}px"
		style:width="{n.width}px"
		style:height="{n.height}px"
		title={title(n)}
		onmouseenter={() => (hovered = s)}
		onfocus={() => (hovered = s)}
		onblur={() => (hovered = null)}
		onclick={() => toggle(s)}
	>
		<span class={['grid size-7 shrink-0 place-items-center rounded-md', style.bg, style.text]}>
			<style.icon class="size-3.5" />
		</span>
		<span class="min-w-0 flex-1">
			{#if n.kind === 'image'}
				<span class="block truncate text-sm font-medium">{imageName(n.image)}</span>
				<span class="block truncate text-xs text-zinc-500">{bytes(n.image.size)}</span>
			{:else if n.kind === 'volume'}
				<span class="block truncate text-sm font-medium">{volumeName(n.volume)}</span>
				<span class="block truncate text-xs text-zinc-500">
					{n.volume.anonymous ? 'anonymous' : (n.volume.composeProject ?? n.volume.driver)}
				</span>
			{:else}
				<span class="block truncate text-sm font-medium">{n.network.name}</span>
				<span class="flex items-center gap-1 truncate text-xs text-zinc-500">
					{#if n.network.internal}<Lock class="size-3 shrink-0" />{/if}
					{n.network.subnets[0]?.subnet ?? n.network.driver}
				</span>
			{/if}
		</span>
	</button>
{/snippet}

<svelte:window {onkeydown} />

<div class="flex flex-col gap-5 xl:flex-row">
	<!-- clicking the background clears the selection, Escape does the same from the keyboard -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="min-w-0 flex-1 overflow-x-auto"
		bind:clientWidth={width}
		onclick={(e) => e.target === e.currentTarget && (selected = null)}
	>
		<div
			class="relative"
			style:width="{layout.width}px"
			style:height="{layout.height}px"
			role="presentation"
			onmouseleave={() => (hovered = null)}
		>
			<svg
				class="pointer-events-none absolute inset-0 overflow-visible"
				width={layout.width}
				height={layout.height}
				aria-hidden="true"
			>
				{#each layout.edges as e (e.id)}
					{@const on = related?.edges.has(e.id)}
					<path
						d={e.path}
						fill="none"
						class={[
							'transition-[stroke,opacity] duration-150',
							on ? 'stroke-primary' : 'stroke-zinc-300 dark:stroke-zinc-700',
							related && !on && 'opacity-30'
						]}
						stroke-width={on ? 2 : 1.25}
						stroke-dasharray={e.kind === 'image' ? '4 3' : undefined}
					/>
				{/each}
				{#each edgeLabels as l (l.id)}
					<text
						x={l.x}
						y={l.y}
						text-anchor={l.anchor}
						class="fill-zinc-600 stroke-white font-mono text-[10px] dark:fill-zinc-300 dark:stroke-zinc-900"
						paint-order="stroke"
						stroke-width="3"
						stroke-linejoin="round">{l.text}</text
					>
				{/each}
			</svg>

			{#each layout.groups as g (g.key)}
				<div
					class="absolute rounded-lg border border-dashed border-zinc-300 bg-zinc-50/70 dark:border-zinc-700/80 dark:bg-zinc-900/40"
					style:left="{g.x}px"
					style:top="{g.y}px"
					style:width="{g.width}px"
					style:height="{g.height}px"
				>
					<div class="flex h-[34px] items-center px-3 text-xs font-semibold text-zinc-500">
						{#if g.project}
							<a href="/projects/{g.project}" class="truncate hover:text-link hover:underline"
								>{g.label}</a
							>
						{:else}
							<span class="truncate italic">{g.label}</span>
						{/if}
					</div>
					{#each g.containers as n (n.container.id)}
						{@const c = n.container}
						{@const s = { kind: 'container' as const, id: c.id }}
						{@const ports = publishedPorts(c.ports)}
						<button
							type="button"
							class={[
								'absolute flex items-center gap-2 rounded-md border bg-white px-2.5 text-left text-sm shadow-xs transition-[opacity,border-color] duration-150 dark:bg-zinc-900',
								isSelected(s)
									? 'border-primary ring-2 ring-primary/20'
									: 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700',
								dim(nodeKey('container', c.id)) && 'opacity-40'
							]}
							style:left="{n.x}px"
							style:top="{n.y}px"
							style:width="{n.width}px"
							style:height="{n.height}px"
							title={c.name}
							onmouseenter={() => (hovered = s)}
							onfocus={() => (hovered = s)}
							onblur={() => (hovered = null)}
							onclick={() => toggle(s)}
						>
							<StatusDot tone={containerTone(c)} />
							<span class="min-w-0 flex-1 truncate font-medium">{c.service || c.name}</span>
							{#if c.hostNetwork}
								<span
									class="shrink-0 rounded border border-zinc-200 px-1 text-[10px] text-zinc-500 dark:border-zinc-700"
									>host</span
								>
							{/if}
							{#each ports.slice(0, 2) as p (p)}
								<span
									class="shrink-0 rounded bg-zinc-100 px-1 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
									>:{p}</span
								>
							{/each}
							{#if ports.length > 2}
								<span class="shrink-0 text-[10px] text-zinc-500">+{ports.length - 2}</span>
							{/if}
						</button>
					{/each}
				</div>
			{/each}

			{#each layout.nodes as n (n.key)}
				{@render sideNode(n)}
			{/each}
		</div>
	</div>

	<aside
		class="min-w-0 border-t border-zinc-200 pt-5 xl:w-80 xl:shrink-0 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-5 dark:border-zinc-800/80"
	>
		<div class="xl:sticky xl:top-6">
			<TopologyDetails {selected} {topology} onselect={(s) => (selected = s)} />
		</div>
	</aside>
</div>
