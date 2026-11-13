<script lang="ts">
	import {
		ArrowUpCircle,
		CircleCheck,
		CircleHelp,
		CircleX,
		Hammer,
		HeartPulse,
		Lock,
		Play,
		RotateCw,
		ScrollText,
		Square
	} from '@lucide/svelte';
	import { containerAction } from '#lib/remote/projects.remote.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import StatusDot from '#lib/components/ui/StatusDot.svelte';
	import { toast } from '#lib/components/ui/toast.svelte.js';
	import { openJob } from '#lib/components/app/jobs.svelte.js';
	import { runAction } from '#lib/components/app/actions.js';
	import { ago } from '#lib/format.js';
	import Usage from '#lib/components/app/Usage.svelte';
	import { watchSystemLoad } from '#lib/remote/system.remote.js';
	import type { getProjectStatus } from '#lib/server/status.js';

	type Status = Awaited<ReturnType<typeof getProjectStatus>>;
	type Container = Status['orphans'][number];

	let { status, onlogs }: { status: Status; onlogs: (id: string) => void } = $props();

	const name = $derived(status.summary.name);
	const system = watchSystemLoad();

	async function act(c: Container, action: 'start' | 'stop' | 'restart') {
		try {
			openJob(await containerAction({ id: c.id, action }));
		} catch (e) {
			toast.error(`Could not ${action} ${c.name}`, e);
		}
	}

	function tone(c: Container) {
		if (c.state === 'running') return c.health === 'unhealthy' ? 'unhealthy' : 'running';
		if (c.state === 'restarting') return 'unhealthy';
		return 'stopped';
	}

	function updateFor(service: string) {
		return status.updates.find((u) => u.services.split(',').includes(service));
	}

	function ports(p: string) {
		const out: string[] = [];
		for (const part of p.split(',')) {
			const m = part.trim().match(/(?:[\d.]+|\[::\]):(\d+(?:-\d+)?)->(\d+(?:-\d+)?)\/(\w+)/);
			const label = m ? `${m[1]}→${m[2]}${m[3] === 'udp' ? '/udp' : ''}` : null;
			if (label && !out.includes(label)) out.push(label);
		}
		return out;
	}
</script>

{#snippet containerRow(c: Container)}
	<div class="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
		<StatusDot tone={tone(c)} pulse={c.state === 'restarting'} />
		<div class="min-w-0 flex-1">
			<p class="truncate font-mono text-sm">{c.name}</p>
			<p class="text-xs text-zinc-500">
				{c.status}
				{#each ports(c.ports) as port (port)}
					<span class="ml-1.5 rounded bg-zinc-100 px-1 font-mono text-[11px] dark:bg-zinc-800"
						>{port}</span
					>
				{/each}
			</p>
		</div>
		{#if c.state === 'running'}<Usage usage={system.current?.containers[c.id]} />{/if}
		{#if c.health !== 'none'}
			<Badge
				tone={c.health === 'healthy' ? 'success' : c.health === 'unhealthy' ? 'danger' : 'warning'}
			>
				<HeartPulse />
				{c.health}
			</Badge>
		{/if}
		<div class="flex items-center gap-0.5">
			<Button size="icon-xs" variant="ghost" title="Logs" onclick={() => onlogs(c.id)}
				><ScrollText /></Button
			>
			{#if c.state === 'running' || c.state === 'restarting'}
				<Button
					size="icon-xs"
					variant="ghost"
					title="Restart"
					onclick={() => act(c, 'restart')}
					disabled={status.summary.isSelf}><RotateCw /></Button
				>
				<Button
					size="icon-xs"
					variant="ghost"
					title="Stop"
					onclick={() => act(c, 'stop')}
					disabled={status.summary.isSelf}><Square /></Button
				>
			{:else}
				<Button size="icon-xs" variant="ghost" title="Start" onclick={() => act(c, 'start')}
					><Play /></Button
				>
			{/if}
		</div>
	</div>
{/snippet}

<div class="grid gap-4">
	{#if system.current?.projects[name]}
		<p class="-mb-1 flex items-center justify-end gap-2 text-xs text-zinc-500">
			Project total <Usage
				usage={system.current.projects[name]}
				class="text-zinc-700 dark:text-zinc-300"
			/>
		</p>
	{/if}
	{#each status.services as s (s.name)}
		{@const update = updateFor(s.name)}
		<Card bodyClass="py-1">
			<div
				class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-100 py-3 dark:border-zinc-800/60"
			>
				<h3 class="font-semibold">{s.name}</h3>
				{#if s.build}
					<Badge><Hammer /> build</Badge>
				{/if}
				{#if s.image}<code class="truncate font-mono text-xs text-zinc-500">{s.image}</code>{/if}
				{#if update}
					{#if update.status === 'available' && !update.localDigest}
						<Badge title="Checked {ago(update.checkedAt)}"><CircleHelp /> Not pulled yet</Badge>
					{:else if update.status === 'available'}
						<Badge tone="info" title="Checked {ago(update.checkedAt)}"
							><ArrowUpCircle /> Update available</Badge
						>
					{:else if update.status === 'up-to-date'}
						<Badge tone="success" title="Checked {ago(update.checkedAt)}"
							><CircleCheck /> Up to date</Badge
						>
					{:else if update.status === 'pinned'}
						<Badge title="Image is pinned to a digest"><Lock /> Pinned</Badge>
					{:else if update.status === 'error'}
						<Badge tone="warning" title={update.error ?? ''}><CircleX /> Check failed</Badge>
					{:else}
						<Badge title="Locally built or no registry digest"><CircleHelp /> Unknown</Badge>
					{/if}
				{/if}
				<div class="ml-auto flex items-center gap-1">
					{#if s.containers.length === 0}
						<Button size="xs" variant="ghost" onclick={() => runAction(name, 'up', [s.name])}
							><Play /> Start</Button
						>
					{:else}
						<Button
							size="xs"
							variant="ghost"
							onclick={() => runAction(name, 'restart', [s.name])}
							disabled={status.summary.isSelf}><RotateCw /> Restart</Button
						>
					{/if}
					{#if update?.status === 'available' && update.localDigest}
						<Button size="xs" variant="primary" onclick={() => runAction(name, 'update', [s.name])}
							><ArrowUpCircle /> Update</Button
						>
					{/if}
				</div>
			</div>
			{#each s.containers as c (c.id)}
				{@render containerRow(c)}
			{:else}
				<p class="py-3 text-sm text-zinc-500">Not created yet.</p>
			{/each}
		</Card>
	{:else}
		<Card><p class="text-sm text-zinc-500">The compose file has no services.</p></Card>
	{/each}

	{#if status.orphans.length}
		<Card
			title="Orphaned containers"
			description="Containers of services that are no longer in the compose file. They are removed on the next deploy."
			bodyClass="py-1"
		>
			{#each status.orphans as c (c.id)}
				{@render containerRow(c)}
			{/each}
		</Card>
	{/if}

	{#if status.updates.length}
		<p class="text-right text-xs text-zinc-500">
			Images checked {ago(
				status.updates
					.map((u) => new Date(u.checkedAt).getTime())
					.sort()
					.at(-1)
			)}
		</p>
	{/if}
</div>
