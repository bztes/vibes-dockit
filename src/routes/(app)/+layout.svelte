<script lang="ts">
	import {
		Bell,
		Boxes,
		LoaderCircle,
		LogOut,
		Menu,
		Plus,
		Settings,
		UserRound,
		X
	} from '@lucide/svelte';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { getMe, logout } from '#lib/remote/auth.remote.js';
	import { watchJobs, watchOverview } from '#lib/remote/projects.remote.js';
	import Logo from '#lib/components/app/Logo.svelte';
	import ThemeToggle from '#lib/components/app/ThemeToggle.svelte';
	import JobPanel from '#lib/components/app/JobPanel.svelte';
	import { jobPanel, openJob } from '#lib/components/app/jobs.svelte.js';
	import StatusDot from '#lib/components/ui/StatusDot.svelte';

	let { children } = $props();

	const me = $derived(await getMe());
	const overview = watchOverview();
	const jobs = watchJobs();

	const running = $derived(
		(jobs.current ?? []).filter((j) => j.status === 'running' || j.status === 'queued')
	);

	let mobileOpen = $state(false);

	const nav = $derived([
		{
			href: '/',
			label: 'Projects',
			icon: Boxes,
			match: (p: string) => p === '/' || p.startsWith('/projects')
		},
		{
			href: '/notifications',
			label: 'Notifications',
			icon: Bell,
			match: (p: string) => p.startsWith('/notifications')
		},
		...(me?.role === 'admin'
			? [
					{
						href: '/settings',
						label: 'Settings',
						icon: Settings,
						match: (p: string) => p.startsWith('/settings')
					}
				]
			: []),
		{
			href: '/account',
			label: 'Account',
			icon: UserRound,
			match: (p: string) => p.startsWith('/account')
		}
	]);

	afterNavigate(() => (mobileOpen = false));
</script>

{#snippet sidebar()}
	<div class="flex h-full flex-col">
		<div class="flex h-14 items-center justify-between px-4">
			<a href="/"><Logo /></a>
			<button
				class="rounded-md p-1.5 text-zinc-500 lg:hidden"
				onclick={() => (mobileOpen = false)}
				aria-label="Close menu"
			>
				<X class="size-5" />
			</button>
		</div>

		<nav class="grid gap-0.5 px-3 pt-2">
			{#each nav as item (item.href)}
				{@const active = item.match(page.url.pathname)}
				<a
					href={item.href}
					class={[
						'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
						active
							? 'bg-white text-zinc-900 shadow-xs ring-1 ring-zinc-200 dark:bg-zinc-800/80 dark:text-white dark:ring-zinc-700/60'
							: 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-100'
					]}
				>
					<item.icon class="size-4" />
					{item.label}
				</a>
			{/each}
		</nav>

		<div class="mt-6 flex items-center justify-between px-5">
			<span
				class="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase dark:text-zinc-500"
				>Projects</span
			>
			<a
				href="/projects/new"
				class="rounded p-0.5 text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
				title="New project"
				aria-label="New project"
			>
				<Plus class="size-4" />
			</a>
		</div>
		<div
			class="mt-1.5 grid min-h-0 flex-1 scrollbar-thin content-start gap-0.5 overflow-y-auto px-3 pb-4"
		>
			{#each overview.current?.projects ?? [] as p (p.name)}
				{@const active = page.url.pathname === `/projects/${p.name}`}
				<a
					href="/projects/{p.name}"
					class={[
						'group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
						active
							? 'bg-zinc-200/60 text-zinc-900 dark:bg-zinc-800/70 dark:text-white'
							: 'text-zinc-600 hover:bg-zinc-200/40 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/40 dark:hover:text-zinc-100'
					]}
				>
					{#if p.busy}
						<LoaderCircle class="size-3 animate-spin text-zinc-400" />
					{:else}
						<StatusDot tone={p.state} class="mx-0.5" />
					{/if}
					<span class="truncate">{p.name}</span>
					{#if p.updates > 0}
						<span class="ml-auto size-1.5 rounded-full bg-primary" title="Update available"></span>
					{/if}
				</a>
			{/each}
		</div>

		<div class="flex items-center gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800/80">
			<div
				class="grid size-8 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-link uppercase"
			>
				{me?.username.slice(0, 2)}
			</div>
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm font-medium">{me?.username}</p>
				<p class="text-xs text-zinc-500 capitalize">{me?.role}</p>
			</div>
			<ThemeToggle />
			<form {...logout}>
				<button
					class="grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
					title="Sign out"
					aria-label="Sign out"
				>
					<LogOut class="size-4" />
				</button>
			</form>
		</div>
	</div>
{/snippet}

<div class="min-h-dvh lg:pl-64">
	<aside
		class="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-zinc-200 bg-zinc-100/60 lg:block dark:border-zinc-800/80 dark:bg-zinc-900/40"
	>
		{@render sidebar()}
	</aside>

	{#if mobileOpen}
		<div class="fixed inset-0 z-40 lg:hidden">
			<button
				class="absolute inset-0 animate-fade-in bg-zinc-950/60"
				onclick={() => (mobileOpen = false)}
				aria-label="Close menu"
			></button>
			<aside
				class="absolute inset-y-0 left-0 w-72 animate-slide-up border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
			>
				{@render sidebar()}
			</aside>
		</div>
	{/if}

	<header
		class="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-zinc-200 bg-zinc-50/80 px-4 backdrop-blur lg:hidden dark:border-zinc-800 dark:bg-zinc-950/80"
	>
		<button
			class="rounded-md p-1.5 text-zinc-500"
			onclick={() => (mobileOpen = true)}
			aria-label="Open menu"
		>
			<Menu class="size-5" />
		</button>
		<Logo />
	</header>

	<main class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
		<svelte:boundary>
			{@render children()}
			{#snippet pending()}
				<div class="grid place-items-center py-32 text-zinc-400">
					<LoaderCircle class="size-6 animate-spin" />
				</div>
			{/snippet}
			{#snippet failed(error, reset)}
				<div class="rounded-xl border border-red-500/30 bg-red-500/5 p-6">
					<p class="font-medium text-red-600 dark:text-red-400">Something went wrong</p>
					<p class="mt-1 text-sm text-zinc-500">{(error as Error)?.message ?? String(error)}</p>
					<button class="mt-4 text-sm font-medium text-link underline" onclick={reset}
						>Try again</button
					>
				</div>
			{/snippet}
		</svelte:boundary>
	</main>
</div>

{#if running.length > 0 && !jobPanel.id}
	<button
		class="fixed right-4 bottom-4 z-30 flex animate-slide-up items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
		onclick={() => openJob(running[0].id)}
	>
		<LoaderCircle class="size-4 animate-spin text-zinc-400" />
		{running[0].action} · {running[0].project}
		{#if running.length > 1}<span class="text-zinc-500">+{running.length - 1}</span>{/if}
	</button>
{/if}

{#if jobPanel.id}
	{#key jobPanel.id}
		<JobPanel id={jobPanel.id} />
	{/key}
{/if}
