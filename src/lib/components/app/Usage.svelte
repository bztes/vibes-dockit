<script lang="ts">
	import { Cpu, MemoryStick } from '@lucide/svelte';
	import { bytes } from '#lib/format.js';
	import type { Usage } from '#lib/server/system.js';

	let { usage, class: className }: { usage: Usage | undefined; class?: string } = $props();

	const cpu = $derived(usage ? (usage.cpu < 10 ? usage.cpu.toFixed(1) : usage.cpu.toFixed(0)) : '');
</script>

{#if usage}
	<span
		class={['inline-flex items-center gap-2.5 text-xs text-zinc-500 tabular-nums', className]}
		title="Share of host CPU · memory in use"
	>
		<span class="inline-flex items-center gap-1"><Cpu class="size-3" /> {cpu}%</span>
		<span class="inline-flex items-center gap-1"
			><MemoryStick class="size-3" /> {bytes(usage.mem)}</span
		>
	</span>
{/if}
