<script lang="ts">
	import { CircleCheck, CircleX, LoaderCircle, X } from '@lucide/svelte';
	import type { JobSummary } from '#lib/server/jobs.js';
	import { closeJob, jobPanel } from './jobs.svelte';

	let {
		id,
		job: current,
		paused,
		closable
	}: { id: string; job: JobSummary | undefined; paused: boolean; closable: boolean } = $props();

	const active = $derived(jobPanel.active === id);

	// successful jobs close themselves, failures stay open
	$effect(() => {
		if (current?.status !== 'success' || paused) return;
		const t = setTimeout(() => closeJob(id), 4000);
		return () => clearTimeout(t);
	});
</script>

<div
	class={[
		'flex max-w-64 min-w-0 shrink-0 items-center gap-2 rounded-lg py-1 pr-1 pl-2 text-sm',
		closable && (active ? 'bg-zinc-800' : 'text-zinc-400 hover:bg-zinc-800/60')
	]}
>
	<button
		class="flex min-w-0 items-center gap-2"
		onclick={() => (jobPanel.active = id)}
		aria-pressed={active}
	>
		{#if !current || current.status === 'running' || current.status === 'queued'}
			<LoaderCircle class="size-4 shrink-0 animate-spin text-zinc-400" />
		{:else if current.status === 'success'}
			<CircleCheck class="size-4 shrink-0 text-emerald-400" />
		{:else}
			<CircleX class="size-4 shrink-0 text-red-400" />
		{/if}
		<span class="truncate">
			<span class="font-medium">{current?.action ?? 'Loading…'}</span>
			{#if current}<span class="text-zinc-500"> · {current.project}</span>{/if}
			{#if current?.status === 'queued'}<span class="text-zinc-500"> · waiting…</span>{/if}
		</span>
	</button>
	{#if closable}
		<button
			class="rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-100"
			onclick={() => closeJob(id)}
			aria-label="Close job"
		>
			<X class="size-3.5" />
		</button>
	{/if}
</div>
