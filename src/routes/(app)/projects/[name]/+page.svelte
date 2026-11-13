<script lang="ts">
	import {
		ArrowLeft,
		ArrowUpCircle,
		Boxes,
		Download,
		ExternalLink,
		FileCode,
		Globe,
		History,
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
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { watchProject } from '#lib/remote/projects.remote.js';
	import { domainUrl } from '#lib/proxy.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Tabs from '#lib/components/ui/Tabs.svelte';
	import ProjectState from '#lib/components/app/ProjectState.svelte';
	import { runAction, runCheckUpdates } from '#lib/components/app/actions.js';
	import Overview from '#lib/components/project/Overview.svelte';
	import Files from '#lib/components/project/Files.svelte';
	import Resources from '#lib/components/project/Resources.svelte';
	import Logs from '#lib/components/project/Logs.svelte';
	import Settings from '#lib/components/project/Settings.svelte';
	import Activity from '#lib/components/project/Activity.svelte';
	import Domains from '#lib/components/project/Domains.svelte';

	let { params } = $props();

	const status = $derived(await watchProject(params.name));
	const s = $derived(status.summary);
	const links = $derived([...new Set([...(s.url ? [s.url] : []), ...s.domains.map(domainUrl)])]);
	const containers = $derived([...status.services.flatMap((x) => x.containers), ...status.orphans]);

	let tab = $state(page.url.searchParams.get('tab') ?? 'overview');
	let logContainer = $state<string | null>(null);
	let checking = $state(false);

	const tabs = $derived([
		{ id: 'overview', label: 'Containers', icon: Boxes, count: containers.length },
		{ id: 'files', label: 'Configuration', icon: FileCode },
		{ id: 'domains', label: 'Domains', icon: Globe, count: s.domains.length || undefined },
		{ id: 'logs', label: 'Logs', icon: ScrollText },
		{ id: 'resources', label: 'Images & Volumes', icon: Layers },
		{ id: 'activity', label: 'Activity', icon: History },
		{ id: 'settings', label: 'Settings', icon: Settings2 }
	]);

	// keep ?tab= in sync (only depends on `tab`)
	$effect(() => {
		const current = tab;
		untrack(() => {
			const url = new URL(page.url.href);
			if (url.searchParams.get('tab') === current) return;
			url.searchParams.set('tab', current);
			goto(url, { shallow: true, replace: true });
		});
	});

	async function check() {
		checking = true;
		await runCheckUpdates(s.name);
		checking = false;
	}

	const deployed = $derived(s.total > 0);
	const active = $derived(s.running > 0);
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
			<Button variant="primary" onclick={() => runAction(s.name, 'update')} disabled={s.busy}
				><ArrowUpCircle /> Update</Button
			>
		{/if}
		<Button onclick={() => runAction(s.name, 'up')} disabled={s.busy}>
			<Play />
			{deployed ? 'Deploy' : 'Start'}
		</Button>
		{#if active}
			<Button onclick={() => runAction(s.name, 'restart')} disabled={s.busy}
				><RotateCw /> Restart</Button
			>
			{#if !s.isSelf}
				<Button onclick={() => runAction(s.name, 'stop')} disabled={s.busy}><Square /> Stop</Button>
			{/if}
		{/if}
		{#if deployed && !s.isSelf}
			<Button
				variant="danger-ghost"
				onclick={() => runAction(s.name, 'down')}
				disabled={s.busy}
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
	<Tabs {tabs} bind:value={tab} />
</div>

<div class="mt-6">
	<svelte:boundary>
		{#if tab === 'overview'}
			<Overview {status} onlogs={(id) => ((logContainer = id), (tab = 'logs'))} />
		{:else if tab === 'files'}
			<Files name={s.name} />
		{:else if tab === 'domains'}
			<Domains name={s.name} />
		{:else if tab === 'logs'}
			<Logs {containers} bind:selected={logContainer} />
		{:else if tab === 'resources'}
			<Resources name={s.name} />
		{:else if tab === 'activity'}
			<Activity name={s.name} />
		{:else if tab === 'settings'}
			<Settings summary={s} />
		{/if}
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
