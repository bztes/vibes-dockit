<script lang="ts">
	import { ChevronDown, ChevronUp, X } from '@lucide/svelte';
	import { watchJob, watchJobs } from '#lib/remote/projects.remote.js';
	import Terminal from '#lib/components/ui/Terminal.svelte';
	import JobTab from './JobTab.svelte';
	import { closeAll, jobPanel } from './jobs.svelte';

	const id = $derived(jobPanel.active!);
	const current = $derived(watchJob(id).current);
	// tabs only need summaries, the full output streams for the active job only
	const summaries = watchJobs();
	const byId = $derived(new Map((summaries.current ?? []).map((j) => [j.id, j])));

	let hovering = $state(false);
</script>

<div
	onmouseenter={() => (hovering = true)}
	onmouseleave={() => (hovering = false)}
	role="region"
	aria-label="Job output"
	class="fixed right-4 bottom-4 z-40 w-[calc(100%-2rem)] max-w-2xl animate-slide-up overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-100 shadow-2xl shadow-black/40"
>
	<div class="flex items-center gap-2 border-b border-zinc-800 py-1.5 pr-4 pl-2">
		<div class="flex min-w-0 flex-1 gap-1 overflow-x-auto">
			{#each jobPanel.ids as jobId (jobId)}
				<JobTab
					id={jobId}
					job={byId.get(jobId)}
					paused={hovering}
					closable={jobPanel.ids.length > 1}
				/>
			{/each}
		</div>
		<button
			class="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
			onclick={() => (jobPanel.minimized = !jobPanel.minimized)}
			aria-label="Toggle output"
		>
			{#if jobPanel.minimized}<ChevronUp class="size-4" />{:else}<ChevronDown class="size-4" />{/if}
		</button>
		<button
			class="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
			onclick={closeAll}
			aria-label="Close all"
		>
			<X class="size-4" />
		</button>
	</div>
	{#if !jobPanel.minimized}
		{#key id}
			<Terminal
				text={current?.output ||
					(current === null ? 'Job not found (the server may have restarted).' : '')}
				class="h-72 rounded-none border-0"
			/>
		{/key}
	{/if}
</div>
