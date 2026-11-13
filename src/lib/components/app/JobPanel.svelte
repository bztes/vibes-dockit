<script lang="ts">
	import { ChevronDown, ChevronUp, CircleCheck, CircleX, LoaderCircle, X } from '@lucide/svelte';
	import { watchJob } from '#lib/remote/projects.remote.js';
	import Terminal from '#lib/components/ui/Terminal.svelte';
	import { jobPanel } from './jobs.svelte';

	let { id }: { id: string } = $props();

	const job = $derived(watchJob(id));
	const current = $derived(job.current);

	// successful jobs close themselves, failures stay open
	let hovering = $state(false);
	$effect(() => {
		if (current?.status !== 'success' || hovering) return;
		const t = setTimeout(() => {
			if (jobPanel.id === id) jobPanel.id = null;
		}, 4000);
		return () => clearTimeout(t);
	});
</script>

<div
	onmouseenter={() => (hovering = true)}
	onmouseleave={() => (hovering = false)}
	role="region"
	aria-label="Job output"
	class="fixed right-4 bottom-4 z-40 w-[calc(100%-2rem)] max-w-2xl animate-slide-up overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-100 shadow-2xl shadow-black/40"
>
	<div class="flex items-center gap-3 border-b border-zinc-800 px-4 py-2.5">
		{#if !current || current.status === 'running' || current.status === 'queued'}
			<LoaderCircle class="size-4 animate-spin text-zinc-400" />
		{:else if current.status === 'success'}
			<CircleCheck class="size-4 text-emerald-400" />
		{:else}
			<CircleX class="size-4 text-red-400" />
		{/if}
		<div class="min-w-0 flex-1 truncate text-sm">
			<span class="font-medium">{current?.action ?? 'Loading…'}</span>
			{#if current}<span class="text-zinc-500"> · {current.project}</span>{/if}
			{#if current?.status === 'queued'}<span class="text-zinc-500"> · waiting…</span>{/if}
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
			onclick={() => (jobPanel.id = null)}
			aria-label="Close"
		>
			<X class="size-4" />
		</button>
	</div>
	{#if !jobPanel.minimized}
		<Terminal
			text={current?.output ||
				(current === null ? 'Job not found (the server may have restarted).' : '')}
			class="h-72 rounded-none border-0"
		/>
	{/if}
</div>
