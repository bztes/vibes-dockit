<script lang="ts">
	import {
		ArrowUpCircle,
		Boxes,
		ExternalLink,
		FolderOpen,
		LoaderCircle,
		Play,
		Plus,
		RefreshCw,
		RotateCw,
		Search,
		Square,
		TriangleAlert,
		Zap
	} from '@lucide/svelte';
	import { watchOverview } from '#lib/remote/projects.remote.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import ProjectState from '#lib/components/app/ProjectState.svelte';
	import SystemLoad from '#lib/components/app/SystemLoad.svelte';
	import Usage from '#lib/components/app/Usage.svelte';
	import { watchSystemLoad } from '#lib/remote/system.remote.js';
	import { runAction, runCheckUpdates } from '#lib/components/app/actions.js';

	const overview = $derived(await watchOverview());
	const system = watchSystemLoad();

	let search = $state('');
	let checking = $state(false);

	const projects = $derived(
		overview.projects.filter(
			(p) =>
				!search ||
				p.name.toLowerCase().includes(search.toLowerCase()) ||
				p.description?.toLowerCase().includes(search.toLowerCase())
		)
	);
	const stats = $derived({
		total: overview.projects.length,
		running: overview.projects.filter((p) => p.state === 'running').length,
		problems: overview.projects.filter((p) => p.state === 'unhealthy' || p.state === 'partial')
			.length,
		updates: overview.projects.filter((p) => p.updates > 0)
	});

	async function check() {
		checking = true;
		await runCheckUpdates();
		checking = false;
	}

	async function updateAll() {
		for (const p of stats.updates) await runAction(p.name, 'update');
	}
</script>

<svelte:head><title>Projects · Dockit</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-4">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Projects</h1>
		<p class="mt-1 text-sm text-zinc-500">
			<FolderOpen class="-mt-0.5 inline size-3.5" />
			<code class="font-mono text-xs">{overview.root}</code>
		</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<Button onclick={check} loading={checking}>
			{#if !checking}<RefreshCw />{/if} Check updates
		</Button>
		{#if stats.updates.length > 0}
			<Button variant="secondary" onclick={updateAll}
				><Zap /> Update all ({stats.updates.length})</Button
			>
		{/if}
		<Button href="/projects/new" variant="primary"><Plus /> New project</Button>
	</div>
</div>

{#if !overview.rootExists}
	<div
		class="mt-8 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
	>
		<TriangleAlert class="mt-0.5 size-4 shrink-0 text-amber-500" />
		<div>
			<p class="font-medium text-amber-700 dark:text-amber-400">
				The folder {overview.root} does not exist.
			</p>
			<p class="mt-1 text-zinc-600 dark:text-zinc-400">
				Check the <code class="font-mono text-xs">PROJECTS_ROOT</code> environment variable (and the volume
				mount when Dockit runs in docker).
			</p>
		</div>
	</div>
{/if}

<div class="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
	{#each [{ label: 'Projects', value: stats.total, cls: '' }, { label: 'Running', value: stats.running, cls: '' }, { label: 'Need attention', value: stats.problems, cls: stats.problems ? 'text-amber-600 dark:text-amber-400' : '' }, { label: 'Updates', value: stats.updates.length, cls: '' }] as s (s.label)}
		<div
			class="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800/80 dark:bg-zinc-900/60"
		>
			<p class="text-xs font-medium text-zinc-500">{s.label}</p>
			<p class={['mt-1 text-2xl font-semibold tabular-nums', s.cls]}>{s.value}</p>
		</div>
	{/each}
</div>

<SystemLoad />

{#if overview.projects.length > 0}
	<div class="relative mt-8 max-w-xs">
		<Search class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
		<Input bind:value={search} placeholder="Search projects…" class="pl-9" />
	</div>
{/if}

{#if projects.length === 0}
	<div class="mt-6 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800">
		<EmptyState
			icon={Boxes}
			title={search ? 'No matching projects' : 'No projects yet'}
			description={search
				? undefined
				: 'Create your first project — Dockit creates the folder and the compose file for you.'}
		>
			{#if !search && overview.rootExists}
				<Button href="/projects/new" variant="primary"><Plus /> New project</Button>
			{/if}
		</EmptyState>
	</div>
{:else}
	<div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
		{#each projects as p (p.name)}
			<article
				class="group relative flex flex-col rounded-lg border border-zinc-200 bg-white p-4 shadow-xs transition-colors hover:border-zinc-300 dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:hover:border-zinc-700"
			>
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0">
						<a href="/projects/{p.name}" class="after:absolute after:inset-0">
							<h2 class="truncate font-semibold">{p.name}</h2>
						</a>
						<p class="mt-0.5 line-clamp-1 text-sm text-zinc-500">
							{p.description ?? `${p.serviceCount} service${p.serviceCount === 1 ? '' : 's'}`}
						</p>
					</div>
					{#if p.busy}
						<Badge tone="info"><LoaderCircle class="animate-spin" /> Working</Badge>
					{:else}
						<ProjectState state={p.state} running={p.running} total={p.total} />
					{/if}
				</div>

				<div class="mt-3 flex flex-wrap gap-1.5">
					{#if p.isSelf}<Badge tone="violet">Dockit</Badge>{/if}
					{#if p.updates > 0}
						<Badge tone="info"><ArrowUpCircle /> {p.updates} update{p.updates > 1 ? 's' : ''}</Badge
						>
					{/if}
					{#if p.autoUpdate}<Badge>Auto update</Badge>{/if}
					{#if p.parseError}<Badge tone="danger">Invalid compose file</Badge>{/if}
				</div>

				<div class="relative z-10 mt-auto flex items-center gap-1 pt-4">
					{#if p.updates > 0}
						<Button size="xs" variant="primary" onclick={() => runAction(p.name, 'update')}
							><Zap /> Update</Button
						>
					{/if}
					{#if p.state === 'running' || p.state === 'partial' || p.state === 'unhealthy'}
						<Button
							size="icon-xs"
							variant="ghost"
							title="Restart"
							onclick={() => runAction(p.name, 'restart')}><RotateCw /></Button
						>
						{#if !p.isSelf}
							<Button
								size="icon-xs"
								variant="ghost"
								title="Stop"
								onclick={() => runAction(p.name, 'stop')}><Square /></Button
							>
						{/if}
					{:else}
						<Button size="xs" variant="ghost" onclick={() => runAction(p.name, 'up')}
							><Play /> Start</Button
						>
					{/if}
					<Usage usage={system.current?.projects[p.name]} class="ml-auto" />
					{#if p.link}
						<Button
							size="icon-xs"
							variant="ghost"
							href={p.link}
							target="_blank"
							rel="noreferrer"
							title="Open {p.link}"
							class={system.current?.projects[p.name] ? '' : 'ml-auto'}><ExternalLink /></Button
						>
					{/if}
				</div>
			</article>
		{/each}
	</div>
{/if}
