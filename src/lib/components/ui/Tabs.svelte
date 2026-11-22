<script lang="ts">
	import type { Component } from 'svelte';
	import { page } from '$app/state';
	import StatusDot from './StatusDot.svelte';

	interface Tab {
		href: string;
		label: string;
		icon?: Component;
		count?: number | null;
		/** has unsaved edits */
		unsaved?: boolean;
	}

	let { tabs }: { tabs: Tab[] } = $props();
</script>

<nav
	class="-mb-px flex scrollbar-thin gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800"
>
	{#each tabs as tab (tab.href)}
		{@const active = page.url.pathname === tab.href}
		<a
			href={tab.href}
			aria-current={active ? 'page' : undefined}
			class={[
				'relative flex items-center gap-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
				'after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:transition-colors',
				active
					? 'text-zinc-900 after:bg-primary dark:text-zinc-100'
					: 'text-zinc-500 after:bg-transparent hover:text-zinc-800 dark:hover:text-zinc-200'
			]}
		>
			{#if tab.icon}<tab.icon class="size-4" />{/if}
			{tab.label}
			{#if tab.unsaved}
				<StatusDot tone="partial" class="size-1.5" title="Unsaved changes" />
			{/if}
			{#if tab.count}
				<span
					class="rounded-full bg-zinc-100 px-1.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
					>{tab.count}</span
				>
			{/if}
		</a>
	{/each}
</nav>
