<script lang="ts">
	import {
		ArrowLeft,
		CircleArrowUp,
		Boxes,
		Download,
		ExternalLink,
		FileCode,
		FolderOpen,
		RotateCcwClock,
		Layers,
		LoaderCircle,
		Play,
		PowerOff,
		RefreshCw,
		RotateCw,
		ScrollText,
		Settings2,
		Square,
		TriangleAlert
	} from '@lucide/svelte';
	import { getProjectStatus } from '#lib/remote/projects.remote.js';
	import { getProjectTabs } from '#lib/remote/templates.remote.js';
	import { resolveTabs } from '#lib/templates/index.js';
	import TemplateBadge from '#lib/templates/TemplateBadge.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Tabs from '#lib/components/ui/Tabs.svelte';
	import ProjectState from '#lib/components/app/ProjectState.svelte';
	import { runAction, runCheckUpdates } from '#lib/components/app/actions.js';
	import { onChange } from '#lib/components/app/changes.svelte.js';

	let { params, children } = $props();

	// shared with the tab pages, which await the same query
	const query = $derived(getProjectStatus(params.name));
	const status = $derived(await query);
	onChange((overview) => {
		// skip a project that was just deleted, its status would fail with a 404
		if (overview.projects.some((p) => p.name === params.name)) void query.refresh();
	});
	const s = $derived(status.summary);
	const links = $derived([...new Set([...(s.url ? [s.url] : []), ...s.links])]);
	const containerCount = $derived(
		status.services.reduce((n, x) => n + x.containers.length, status.orphans.length)
	);

	let checking = $state(false);

	// tabs added by templates, e.g. Domains when a Caddy project exists
	const extraTabs = $derived(resolveTabs(await getProjectTabs(params.name)));

	const tabs = $derived.by(() => {
		const base = `/projects/${params.name}`;
		return [
			{ href: base, label: 'Containers', icon: Boxes, count: containerCount },
			{ href: `${base}/config`, label: 'Configuration', icon: FileCode },
			{ href: `${base}/files`, label: 'Files', icon: FolderOpen },
			...extraTabs.map((t) => ({ ...t, href: `${base}/${t.id}` })),
			{ href: `${base}/logs`, label: 'Logs', icon: ScrollText },
			{ href: `${base}/resources`, label: 'Images & Volumes', icon: Layers },
			{ href: `${base}/activity`, label: 'Activity', icon: RotateCcwClock },
			{ href: `${base}/settings`, label: 'Settings', icon: Settings2 }
		];
	});

	async function check() {
		checking = true;
		await runCheckUpdates(s.name);
		checking = false;
	}

	const deployed = $derived(s.total > 0);
	const active = $derived(s.running > 0);
	// dockit cannot run docker commands on its own project
	const locked = $derived(s.busy || s.isSelf);
</script>

<svelte:head><title>{params.name} · Dockit</title></svelte:head>

<a
	href="/"
	class="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
>
	<ArrowLeft class="size-4" /> Projects
</a>

<div class="mt-3 flex flex-wrap items-start justify-between gap-4">
	<div class="min-w-0">
		<div class="flex flex-wrap items-center gap-3">
			<h1 class="truncate text-2xl font-semibold tracking-tight">{s.name}</h1>
			{#if s.busy}
				<Badge tone="info"><LoaderCircle class="animate-spin" /> Working</Badge>
			{:else}
				<ProjectState state={s.state} running={s.running} total={s.total} />
			{/if}
			{#if s.isSelf}<Badge tone="violet">This is Dockit</Badge>{/if}
			<TemplateBadge template={s.template} />
			{#if s.autoUpdate}<Badge>Auto update</Badge>{/if}
		</div>
		<p class="mt-1 text-sm text-zinc-500">
			{s.description ?? `${s.serviceCount} service${s.serviceCount === 1 ? '' : 's'}`}
			{#each links as link (link)}
				· <a
					href={link}
					target="_blank"
					rel="noreferrer"
					class="inline-flex items-center gap-1 text-link hover:underline"
					>{link.replace(/^https?:\/\//, '')}<ExternalLink class="size-3" /></a
				>
			{/each}
		</p>
	</div>

	<div class="flex flex-wrap gap-2">
		{#if s.updates > 0}
			<Button variant="primary" onclick={() => runAction(s.name, 'update')} disabled={locked}
				><CircleArrowUp /> Update</Button
			>
		{/if}
		<Button onclick={() => runAction(s.name, 'up')} disabled={locked}>
			<Play />
			{deployed ? 'Deploy' : 'Start'}
		</Button>
		{#if active}
			<Button onclick={() => runAction(s.name, 'restart')} disabled={locked}
				><RotateCw /> Restart</Button
			>
			<Button onclick={() => runAction(s.name, 'stop')} disabled={locked}><Square /> Stop</Button>
		{/if}
		{#if deployed}
			<Button
				variant="danger-ghost"
				onclick={() => runAction(s.name, 'down')}
				disabled={locked}
				title="docker compose down"><PowerOff /> Down</Button
			>
		{/if}
		<Button
			variant="ghost"
			onclick={() => runAction(s.name, 'pull')}
			disabled={s.busy}
			title="docker compose pull"><Download /> Pull</Button
		>
		<Button
			variant="ghost"
			size="icon"
			onclick={check}
			loading={checking}
			title="Check for updates"
			aria-label="Check for updates"
		>
			{#if !checking}<RefreshCw />{/if}
		</Button>
	</div>
</div>

{#if s.parseError}
	<div
		class="mt-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm"
	>
		<TriangleAlert class="mt-0.5 size-4 shrink-0 text-red-500" />
		<div>
			<p class="font-medium text-red-600 dark:text-red-400">The compose file could not be parsed</p>
			<p class="mt-1 font-mono text-xs text-zinc-600 dark:text-zinc-400">{s.parseError}</p>
		</div>
	</div>
{/if}

<div class="mt-8">
	<Tabs {tabs} />
</div>

<div class="mt-6">
	<svelte:boundary>
		{@render children()}
		{#snippet pending()}
			<div class="grid place-items-center py-20 text-zinc-400">
				<LoaderCircle class="size-5 animate-spin" />
			</div>
		{/snippet}
		{#snippet failed(error, reset)}
			<div class="rounded-xl border border-red-500/30 bg-red-500/5 p-5 text-sm">
				<p class="font-medium text-red-600 dark:text-red-400">Could not load this section</p>
				<p class="mt-1 text-zinc-500">
					{(error as { body?: { message?: string } })?.body?.message ?? (error as Error)?.message}
				</p>
				<button class="mt-3 font-medium text-link underline" onclick={reset}>Retry</button>
			</div>
		{/snippet}
	</svelte:boundary>
</div>
