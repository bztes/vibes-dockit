<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label?: string;
		hint?: string;
		issues?: { message: string }[];
		children: Snippet;
		class?: string;
		for?: string;
	}

	let { label, hint, issues, children, class: className, for: htmlFor }: Props = $props();
</script>

<div class={['grid gap-1.5', className]}>
	{#if label}
		<label for={htmlFor} class="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</label
		>
	{/if}
	{@render children()}
	{#each issues ?? [] as issue (issue.message)}
		<p class="text-xs text-red-600 dark:text-red-400">{issue.message}</p>
	{/each}
	{#if hint && !issues?.length}
		<p class="text-xs text-zinc-500">{hint}</p>
	{/if}
</div>
