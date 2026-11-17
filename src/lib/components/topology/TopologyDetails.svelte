<script lang="ts">
	import {
		ExternalLink,
		Lock,
		MousePointerClick,
		Pause,
		Play,
		RotateCw,
		Skull,
		Square,
		Trash,
		X
	} from '@lucide/svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import StatusDot from '#lib/components/ui/StatusDot.svelte';
	import { confirm } from '#lib/components/ui/confirm.svelte.js';
	import { toast } from '#lib/components/ui/toast.svelte.js';
	import { ago, bytes, shortId } from '#lib/format.js';
	import { removeObject } from '#lib/remote/topology.remote.js';
	import { containerAction } from '#lib/remote/projects.remote.js';
	import { openJob } from '#lib/components/app/jobs.svelte.js';
	import type { ContainerAction } from '#lib/server/actions.js';
	import { blockers } from '#lib/topology.js';
	import { containerTone, kindStyle } from './TopologyGraph.svelte';
	import {
		imageName,
		publishedPorts,
		volumeName,
		type NodeKind,
		type Selection,
		type Topology,
		type TopologyContainer
	} from './layout';

	interface Props {
		selected: Selection | null;
		topology: Topology;
		onselect: (s: Selection | null) => void;
	}
	let { selected, topology, onselect }: Props = $props();

	const container = $derived(
		selected?.kind === 'container'
			? topology.containers.find((c) => c.id === selected!.id)
			: undefined
	);
	const image = $derived(
		selected?.kind === 'image' ? topology.images.find((i) => i.id === selected!.id) : undefined
	);
	const network = $derived(
		selected?.kind === 'network'
			? topology.networks.find((n) => n.name === selected!.id)
			: undefined
	);
	const volume = $derived(
		selected?.kind === 'volume' ? topology.volumes.find((v) => v.name === selected!.id) : undefined
	);

	const volumeLabel = (name: string) => {
		const v = topology.volumes.find((v) => v.name === name);
		return v ? volumeName(v) : name;
	};
	const imageOf = (c: TopologyContainer) => topology.images.find((i) => i.id === c.imageId);

	let removing = $state(false);

	const ACTIONS = {
		start: { label: 'Start', icon: Play },
		stop: { label: 'Stop', icon: Square },
		restart: { label: 'Restart', icon: RotateCw },
		pause: { label: 'Pause', icon: Pause },
		unpause: { label: 'Resume', icon: Play },
		kill: { label: 'Kill', icon: Skull }
	} satisfies Record<ContainerAction, unknown>;

	/** actions that make sense in the container's current state */
	function actionsFor(c: TopologyContainer): ContainerAction[] {
		if (c.state === 'running') return ['restart', 'stop', 'pause', 'kill'];
		if (c.state === 'paused') return ['unpause', 'kill'];
		if (c.state === 'restarting') return ['stop', 'kill'];
		return ['start'];
	}

	async function act(c: TopologyContainer, action: ContainerAction) {
		if (action === 'kill') {
			const ok = await confirm({
				title: `Kill ${c.name}?`,
				description: 'The container is stopped immediately, without a chance to shut down cleanly.',
				confirmLabel: 'Kill',
				danger: true
			});
			if (!ok) return;
		}
		try {
			openJob(await containerAction({ id: c.id, action }));
		} catch (e) {
			toast.error(`Could not ${ACTIONS[action].label.toLowerCase()} ${c.name}`, e);
		}
	}

	async function remove(kind: Selection['kind'], id: string, name: string, description: string) {
		const ok = await confirm({
			title: `Remove ${kind} ${name}?`,
			description,
			confirmLabel: 'Remove',
			danger: true,
			typeToConfirm: kind === 'volume' ? name : undefined
		});
		if (!ok) return;
		removing = true;
		try {
			await removeObject({ kind, id } as Parameters<typeof removeObject>[0]);
			toast.success(`Removed ${kind} ${name}`);
			onselect(null);
		} catch (e) {
			toast.error(`Could not remove ${kind}`, e);
		} finally {
			removing = false;
		}
	}
</script>

{#snippet label(text: string)}
	<p class="mt-5 mb-1.5 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
		{text}
	</p>
{/snippet}

{#snippet row(key: string, value: string)}
	<div class="flex justify-between gap-3 py-1 text-sm">
		<span class="shrink-0 text-zinc-500">{key}</span>
		<span class="min-w-0 truncate text-right font-mono text-xs leading-5" title={value}
			>{value}</span
		>
	</div>
{/snippet}

{#snippet header(kind: NodeKind, name: string, sub: string)}
	{@const style = kindStyle[kind]}
	<div class="flex items-start gap-2.5">
		<span class={['grid size-8 shrink-0 place-items-center rounded-md', style.bg, style.text]}>
			<style.icon class="size-4" />
		</span>
		<div class="min-w-0 flex-1">
			<h3 class="truncate font-semibold" title={name}>{name}</h3>
			<p class="truncate text-xs text-zinc-500">{sub}</p>
		</div>
		{@render close()}
	</div>
{/snippet}

{#snippet close()}
	<Button size="icon-xs" variant="ghost" title="Close" onclick={() => onselect(null)}><X /></Button>
{/snippet}

{#snippet containerList(items: { c: TopologyContainer; detail: string | null }[], empty: string)}
	{#if items.length === 0}
		<p class="text-sm text-zinc-500">{empty}</p>
	{:else}
		<ul class="grid grid-cols-1 gap-0.5">
			{#each items as { c, detail } (c.id)}
				<li>
					<button
						class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
						onclick={() => onselect({ kind: 'container', id: c.id })}
					>
						<StatusDot tone={containerTone(c)} />
						<span class="min-w-0 flex-1 truncate" title={c.name}>{c.name}</span>
						{#if detail}
							<span
								class="max-w-1/2 min-w-0 truncate font-mono text-xs text-zinc-500"
								title={detail}>{detail}</span
							>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet removeButton(blocked: string | null, onclick: () => void)}
	<div class="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800/80">
		<Button
			size="xs"
			variant="danger-ghost"
			class="w-full"
			disabled={!!blocked}
			loading={removing}
			{onclick}
		>
			<Trash /> Remove
		</Button>
		{#if blocked}<p class="mt-1.5 text-center text-xs text-zinc-500">{blocked}</p>{/if}
	</div>
{/snippet}

{#if container}
	{@const c = container}
	{@const ports = publishedPorts(c.ports)}
	{@const img = imageOf(c)}
	<div class="flex items-start gap-2.5">
		<StatusDot tone={containerTone(c)} class="mt-2" />
		<div class="min-w-0 flex-1">
			<h3 class="truncate font-semibold" title={c.name}>{c.name}</h3>
			<p class="text-xs text-zinc-500">{c.status}</p>
		</div>
		{@render close()}
	</div>

	<div class="mt-3 flex flex-wrap gap-1.5">
		{#each actionsFor(c) as action (action)}
			{@const a = ACTIONS[action]}
			<Button
				size="xs"
				variant={action === 'kill' ? 'danger-ghost' : 'outline'}
				disabled={c.isSelf}
				title={c.isSelf ? 'Dockit can not control its own containers' : undefined}
				onclick={() => act(c, action)}><a.icon /> {a.label}</Button
			>
		{/each}
	</div>

	{@render label('Container')}
	<div class="divide-y divide-zinc-100 dark:divide-zinc-800/60">
		{#if c.service}{@render row('Service', c.service)}{/if}
		{#if c.project ?? c.composeProject}
			{@render row('Project', (c.project ?? c.composeProject)!)}
		{/if}
		{@render row('ID', shortId(c.id))}
	</div>

	{@render label('Image')}
	<button
		class="block w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
		title={c.image}
		onclick={() => img && onselect({ kind: 'image', id: img.id })}>{c.image}</button
	>

	{#if ports.length}
		{@render label('Published ports')}
		<div class="flex flex-wrap gap-1.5">
			{#each ports as p (p)}<Badge><span class="font-mono">:{p}</span></Badge>{/each}
		</div>
	{/if}

	{@render label('Networks')}
	{#if c.hostNetwork}
		<p class="text-sm text-zinc-500">Uses the network of the host directly.</p>
	{:else if c.sharesNetworkWith}
		<p class="text-sm text-zinc-500">
			Uses the network of <span class="font-medium text-zinc-700 dark:text-zinc-300"
				>{c.sharesNetworkWith}</span
			>.
		</p>
	{:else if c.endpoints.length === 0}
		<p class="text-sm text-zinc-500">Not attached to any network.</p>
	{:else}
		<ul class="grid grid-cols-1 gap-0.5">
			{#each c.endpoints as e (e.network)}
				<li>
					<button
						class="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
						onclick={() => onselect({ kind: 'network', id: e.network })}
					>
						<span class="flex items-center gap-2">
							<span class="min-w-0 flex-1 truncate font-medium" title={e.network}>{e.network}</span>
							<span class="shrink-0 font-mono text-xs text-zinc-500">{e.ip ?? '–'}</span>
						</span>
						{#if e.aliases.length}
							<span class="mt-0.5 block truncate text-xs text-zinc-500" title={e.aliases.join(', ')}
								>as {e.aliases.join(', ')}</span
							>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if c.mounts.length}
		{@render label('Mounts')}
		<ul class="grid grid-cols-1 gap-0.5">
			{#each c.mounts as m (m.destination)}
				<li>
					<button
						class={[
							'w-full rounded-md px-2 py-1.5 text-left text-sm',
							m.volume ? 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60' : 'cursor-default'
						]}
						disabled={!m.volume}
						onclick={() => m.volume && onselect({ kind: 'volume', id: m.volume })}
					>
						<span class="flex items-center gap-2">
							<span class="min-w-0 flex-1 truncate font-mono text-xs" title={m.destination}
								>{m.destination}</span
							>
							{#if m.readOnly}<Badge>read-only</Badge>{/if}
						</span>
						<span class="mt-0.5 block truncate text-xs text-zinc-500" title={m.volume ?? m.source}>
							{m.volume ? `volume ${volumeLabel(m.volume)}` : `${m.type} ${m.source}`}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if c.project}
		<Button size="xs" class="mt-5 w-full" href="/projects/{c.project}"
			><ExternalLink /> Open project</Button
		>
	{/if}

	{@render removeButton(blockers.container(c), () =>
		remove(
			'container',
			c.id,
			c.name,
			c.composeProject
				? 'Volumes are kept. docker compose creates the container again on the next deploy.'
				: 'Volumes are kept.'
		)
	)}
{:else if image}
	{@const users = topology.containers.filter((c) => c.imageId === image.id)}
	{@render header('image', imageName(image), `Image · ${bytes(image.size)}`)}

	{@render label('Image')}
	<div class="divide-y divide-zinc-100 dark:divide-zinc-800/60">
		{@render row('ID', shortId(image.id))}
		{@render row('Size', bytes(image.size))}
		{@render row('Created', ago(image.createdAt))}
	</div>

	{#if image.tags.length > 1}
		{@render label('Tags')}
		<div class="grid grid-cols-1 gap-1">
			{#each image.tags as t (t)}<span class="truncate font-mono text-xs" title={t}>{t}</span
				>{/each}
		</div>
	{/if}

	{@render label(`Containers (${users.length})`)}
	{@render containerList(
		users.map((c) => ({ c, detail: null })),
		'No container uses this image.'
	)}

	{@render removeButton(blockers.image(image, topology), () =>
		remove(
			'image',
			image.id,
			imageName(image),
			`Frees ${bytes(image.size)}. The image can be pulled again later.`
		)
	)}
{:else if network}
	{@const members = topology.containers.flatMap((c) =>
		c.endpoints.filter((e) => e.network === network.name).map((e) => ({ c, detail: e.ip }))
	)}
	{@render header('network', network.name, `Network · ${network.driver}`)}

	{#if network.builtin || network.internal}
		<div class="mt-3 flex flex-wrap gap-1.5">
			{#if network.builtin}<Badge>Built-in</Badge>{/if}
			{#if network.internal}<Badge><Lock /> Internal</Badge>{/if}
		</div>
	{/if}

	{@render label('Settings')}
	<div class="divide-y divide-zinc-100 dark:divide-zinc-800/60">
		{@render row('Driver', network.driver)}
		{@render row('Scope', network.scope)}
		{#each network.subnets as s (s.subnet)}
			{@render row('Subnet', s.subnet)}
			{#if s.gateway}{@render row('Gateway', s.gateway)}{/if}
		{/each}
		{#if network.composeProject}{@render row('Created by', network.composeProject)}{/if}
	</div>

	{@render label(`Containers (${members.length})`)}
	{@render containerList(members, 'No containers are attached.')}

	{@render removeButton(blockers.network(network, topology), () =>
		remove('network', network.name, network.name, 'Containers can no longer join this network.')
	)}
{:else if volume}
	{@const users = topology.containers.flatMap((c) =>
		c.mounts.filter((m) => m.volume === volume.name).map((m) => ({ c, detail: m.destination }))
	)}
	{@render header(
		'volume',
		volumeName(volume),
		volume.anonymous ? 'Anonymous volume' : `Volume · ${volume.driver}`
	)}

	{@render label('Volume')}
	<div class="divide-y divide-zinc-100 dark:divide-zinc-800/60">
		{@render row('Driver', volume.driver)}
		{@render row('Mountpoint', volume.mountpoint)}
		{#if volume.createdAt}{@render row('Created', ago(volume.createdAt))}{/if}
		{#if volume.composeProject}{@render row('Created by', volume.composeProject)}{/if}
	</div>

	{@render label(`Mounted by (${users.length})`)}
	{@render containerList(users, 'No container mounts this volume.')}

	{@render removeButton(blockers.volume(volume, topology), () =>
		remove(
			'volume',
			volume.name,
			volumeName(volume),
			'All data stored in this volume is lost permanently.'
		)
	)}
{:else}
	<div class="flex flex-col items-center justify-center gap-2 py-10 text-center">
		<MousePointerClick class="size-5 text-zinc-400" />
		<p class="max-w-56 text-sm text-zinc-500">
			Select a container, image, network or volume to see its details.
		</p>
	</div>
{/if}
