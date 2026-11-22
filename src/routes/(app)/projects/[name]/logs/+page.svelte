<script lang="ts">
	import { page } from '$app/state';
	import { ScrollText } from '@lucide/svelte';
	import { getProjectStatus } from '#lib/remote/projects.remote.js';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Select from '#lib/components/ui/Select.svelte';
	import Terminal from '#lib/components/ui/Terminal.svelte';

	let { params } = $props();

	const status = $derived(await getProjectStatus(params.name));
	const containers = $derived([...status.services.flatMap((x) => x.containers), ...status.orphans]);
	// preselected via ?container= (e.g. from the Containers tab)
	let selected = $derived(page.url.searchParams.get('container'));

	let tail = $state(300);
	let timestamps = $state(false);

	$effect.pre(() => {
		if (!selected || !containers.some((c) => c.id === selected))
			selected = containers[0]?.id ?? null;
	});

	const MAX_LINES = 2000;
	let raw = $state('');
	let connected = $state(false);
	// reconnect when the container (re)starts, `docker logs -f` ends when it stops
	const running = $derived(containers.find((c) => c.id === selected)?.state === 'running');

	// a plain fetch stream instead of a live query, so it closes as soon as this page is left
	$effect(() => {
		if (!selected) return;
		const controller = new AbortController();
		void follow(selected, tail, running, controller.signal);
		return () => controller.abort();
	});

	async function follow(id: string, n: number, retry: boolean, signal: AbortSignal) {
		const url = `/projects/${params.name}/logs/stream?container=${id}&tail=${n}`;
		raw = '';
		while (!signal.aborted) {
			const lines: string[] = [];
			let frame = 0;
			const flush = () => {
				frame = 0;
				if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
				if (!signal.aborted) raw = lines.join('\n');
			};
			try {
				const res = await fetch(url, { signal });
				if (!res.ok || !res.body) throw new Error(res.statusText);
				connected = true;
				let partial = '';
				const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					const parts = (partial + value).split('\n');
					partial = parts.pop() ?? '';
					lines.push(...parts);
					frame ||= requestAnimationFrame(flush);
				}
				if (partial) lines.push(partial);
				flush();
			} catch {
				// aborted, or the connection dropped
			}
			cancelAnimationFrame(frame);
			if (signal.aborted) return;
			connected = false;
			if (!retry) return;
			await new Promise((r) => setTimeout(r, 2000));
		}
	}

	const text = $derived(timestamps ? raw : raw.replace(/^\S+Z /gm, ''));
</script>

{#if containers.length === 0}
	<div class="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800">
		<EmptyState
			icon={ScrollText}
			title="No containers"
			description="Deploy the project to see logs."
		/>
	</div>
{:else}
	<div class="grid gap-3">
		<div class="flex flex-wrap items-center gap-3">
			<div class="w-full max-w-xs">
				<Select bind:value={selected} size="sm">
					{#each containers as c (c.id)}
						<option value={c.id}>{c.name} ({c.state})</option>
					{/each}
				</Select>
			</div>
			<div class="w-28">
				<Select bind:value={tail} size="sm">
					{#each [100, 300, 1000, 5000] as n (n)}<option value={n}>last {n}</option>{/each}
				</Select>
			</div>
			<label class="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
				<input type="checkbox" bind:checked={timestamps} class="size-4 accent-primary" /> Timestamps
			</label>
			{#if selected}
				<span class="ml-auto flex items-center gap-1.5 text-xs text-zinc-500">
					<span class={['size-1.5 rounded-full', connected ? 'bg-emerald-500' : 'bg-zinc-500']}
					></span>
					{connected ? 'Live' : 'Disconnected'}
				</span>
			{/if}
		</div>
		<Terminal text={text || 'Waiting for output…'} class="h-[65vh]" />
	</div>
{/if}
