<script lang="ts">
	import { Cpu, Gauge, HardDrive, MemoryStick } from '@lucide/svelte';
	import { watchSystemLoad } from '#lib/remote/system.remote.js';
	import { bytes } from '#lib/format.js';

	const query = watchSystemLoad();
	const sys = $derived(query.current);

	const pct = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);
	const tone = (p: number) => (p >= 90 ? 'bg-danger' : p >= 75 ? 'bg-warning' : 'bg-primary');
	const text = (p: number) => (p >= 90 ? 'text-danger' : p >= 75 ? 'text-warning' : '');

	function uptime(s: number) {
		const d = Math.floor(s / 86400);
		const h = Math.floor((s % 86400) / 3600);
		const m = Math.floor((s % 3600) / 60);
		return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
	}

	/** svg polyline points for the cpu sparkline, 60 samples wide */
	const spark = $derived.by(() => {
		const h = sys?.history ?? [];
		if (h.length < 2) return '';
		const offset = 60 - h.length;
		return h.map((s, i) => `${offset + i},${(20 - (s.cpu / 100) * 20).toFixed(2)}`).join(' ');
	});

	const memPct = $derived(sys ? pct(sys.mem.used, sys.mem.total) : 0);
	const diskPct = $derived(sys?.disk ? pct(sys.disk.used, sys.disk.total) : 0);
	const loadPct = $derived(sys ? (sys.load[0] / sys.cores) * 100 : 0);
</script>

{#snippet bar(p: number)}
	<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
		<div
			class={['h-full rounded-full transition-[width] duration-500', tone(p)]}
			style:width="{Math.min(100, p)}%"
		></div>
	</div>
{/snippet}

<section class="mt-8">
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<h2 class="text-sm font-semibold">System</h2>
		{#if sys}
			<p class="text-xs text-zinc-500">
				<span class="font-mono">{sys.hostname}</span> · {sys.cores} cores · up {uptime(sys.uptime)}
			</p>
		{/if}
	</div>

	<div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
		<div
			class="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800/80 dark:bg-zinc-900/60"
		>
			<p class="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
				<Cpu class="size-3.5" /> CPU
			</p>
			<div class="mt-1 flex items-end justify-between gap-3">
				<p class={['text-2xl font-semibold tabular-nums', text(sys?.cpu ?? 0)]}>
					{sys ? `${sys.cpu.toFixed(0)}%` : '–'}
				</p>
				<svg
					viewBox="0 0 59 20"
					preserveAspectRatio="none"
					class="h-8 w-28 text-primary"
					aria-hidden="true"
				>
					{#if spark}
						<polyline
							points={spark}
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linejoin="round"
							vector-effect="non-scaling-stroke"
						/>
					{/if}
				</svg>
			</div>
		</div>

		<div
			class="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800/80 dark:bg-zinc-900/60"
		>
			<p class="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
				<Gauge class="size-3.5" /> Load average
			</p>
			<p class="mt-1 text-2xl font-semibold tabular-nums">
				<span class={text(loadPct)}>{sys ? sys.load[0].toFixed(2) : '–'}</span>
				{#if sys}
					<span class="text-sm font-normal text-zinc-500">
						{sys.load[1].toFixed(2)} · {sys.load[2].toFixed(2)}
					</span>
				{/if}
			</p>
			{@render bar(loadPct)}
		</div>

		<div
			class="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800/80 dark:bg-zinc-900/60"
		>
			<p class="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
				<MemoryStick class="size-3.5" /> Memory
			</p>
			<p class="mt-1 text-2xl font-semibold tabular-nums">
				<span class={text(memPct)}>{sys ? `${memPct.toFixed(0)}%` : '–'}</span>
				{#if sys}
					<span class="text-sm font-normal text-zinc-500">
						{bytes(sys.mem.used)} / {bytes(sys.mem.total)}
					</span>
				{/if}
			</p>
			{@render bar(memPct)}
		</div>

		<div
			class="rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800/80 dark:bg-zinc-900/60"
		>
			<p
				class="flex items-center gap-1.5 text-xs font-medium text-zinc-500"
				title={sys?.disk?.path}
			>
				<HardDrive class="size-3.5" /> Disk
			</p>
			{#if sys && !sys.disk}
				<p class="mt-1 text-sm text-zinc-500">No projects folder</p>
			{:else}
				<p class="mt-1 text-2xl font-semibold tabular-nums">
					<span class={text(diskPct)}>{sys?.disk ? `${diskPct.toFixed(0)}%` : '–'}</span>
					{#if sys?.disk}
						<span class="text-sm font-normal text-zinc-500">
							{bytes(sys.disk.used)} / {bytes(sys.disk.total)}
						</span>
					{/if}
				</p>
				{@render bar(diskPct)}
			{/if}
		</div>
	</div>
</section>
