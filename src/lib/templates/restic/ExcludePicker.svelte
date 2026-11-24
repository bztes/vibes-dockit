<script lang="ts">
	import {
		ChevronRight,
		File as FileIcon,
		Folder,
		FolderOpen,
		House,
		LoaderCircle
	} from '@lucide/svelte';
	import { listProjectFiles } from '#lib/remote/projects.remote.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { excludeChecker, patternPath } from './restic';

	let {
		open = $bindable(),
		name,
		dir,
		patterns,
		ontoggle
	}: {
		open: boolean;
		name: string;
		/** absolute project folder */
		dir: string;
		patterns: string[];
		/** adds (`on`) or removes the pattern for exactly `rel` */
		ontoggle: (rel: string, on: boolean) => void;
	} = $props();

	let path = $state('');
	const query = $derived(open ? listProjectFiles({ name, path }) : null);
	const entries = $derived(query?.current ?? []);
	const crumbs = $derived(
		path
			? path.split('/').map((part, i, all) => ({ part, path: all.slice(0, i + 1).join('/') }))
			: []
	);
	/** compiled once per pattern change */
	const excludedBy = $derived(excludeChecker(dir, patterns));
	/** the open folder is excluded already */
	const folderBy = $derived(path ? excludedBy(path) : null);
	/** project relative path → the pattern naming exactly it */
	const own = $derived(new Map(patterns.map((p) => [patternPath(p), p])));
</script>

<Dialog
	bind:open
	size="lg"
	title="Exclude files and folders"
	description="Ticked entries are left out of the backup. Ticking adds a /path pattern."
>
	<div class="grid gap-3">
		<nav class="flex flex-wrap items-center gap-1 font-mono text-xs">
			<button
				class="inline-flex items-center gap-1 rounded px-1 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
				onclick={() => (path = '')}><House class="size-3.5" />{name}</button
			>
			{#each crumbs as c (c.path)}
				<ChevronRight class="size-3.5 text-zinc-400" />
				<button
					class="rounded px-1 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
					onclick={() => (path = c.path)}>{c.part}</button
				>
			{/each}
			{#if query?.loading}
				<LoaderCircle class="ml-auto size-3.5 animate-spin text-zinc-500" />
			{/if}
		</nav>

		{#if folderBy}
			<p class="text-xs text-amber-700 dark:text-amber-400">
				This folder is excluded by <code class="font-mono">{folderBy}</code>.
			</p>
		{/if}

		{#if query?.error}
			<p class="text-sm text-red-600 dark:text-red-400">Could not list the folder.</p>
		{:else if entries.length === 0 && !query?.loading}
			<EmptyState icon={FolderOpen} title="This folder is empty" />
		{:else}
			<ul
				class="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800/60 dark:border-zinc-800"
			>
				{#each entries as entry (entry.path)}
					{@const by = excludedBy(entry.path)}
					{@const locked = !!by && by !== own.get(entry.path)}
					<li class="flex items-center gap-3 px-3 py-1.5 text-sm">
						<input
							type="checkbox"
							class="size-4 accent-primary"
							aria-label="Exclude {entry.path}"
							checked={!!by}
							disabled={locked}
							title={locked ? `Excluded by ${by}` : undefined}
							onchange={(e) => ontoggle(entry.path, e.currentTarget.checked)}
						/>
						{#if entry.type === 'dir'}
							<button
								class="flex min-w-0 items-center gap-2 text-left hover:underline"
								onclick={() => (path = entry.path)}
							>
								<Folder class="size-4 shrink-0 text-primary" />
								<span class="truncate font-mono text-xs">{entry.name}</span>
							</button>
						{:else}
							<span class="flex min-w-0 items-center gap-2">
								<FileIcon class="size-4 shrink-0 text-zinc-400" />
								<span class="truncate font-mono text-xs">{entry.name}</span>
							</span>
						{/if}
						{#if locked}
							<span class="ml-auto shrink-0 font-mono text-xs text-zinc-500">{by}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
	{#snippet footer()}
		<Button variant="primary" onclick={() => (open = false)}>Done</Button>
	{/snippet}
</Dialog>
