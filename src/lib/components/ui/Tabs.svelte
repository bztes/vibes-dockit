<script lang="ts">
	import type { Component } from 'svelte';

	interface Tab {
		id: string;
		label: string;
		icon?: Component;
		count?: number | null;
	}

	let { tabs, value = $bindable() }: { tabs: Tab[]; value: string } = $props();
</script>

<div
	class="-mb-px flex scrollbar-thin gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800"
	role="tablist"
>
	{#each tabs as tab (tab.id)}
		<button
			role="tab"
			aria-selected={value === tab.id}
			class={[
				'relative flex items-center gap-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
				'after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:transition-colors',
				value === tab.id
					? 'text-zinc-900 after:bg-primary dark:text-zinc-100'
					: 'text-zinc-500 after:bg-transparent hover:text-zinc-800 dark:hover:text-zinc-200'
			]}
			onclick={() => (value = tab.id)}
		>
			{#if tab.icon}<tab.icon class="size-4" />{/if}
			{tab.label}
			{#if tab.count}
				<span
					class="rounded-full bg-zinc-100 px-1.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
					>{tab.count}</span
				>
			{/if}
		</button>
	{/each}
</div>
