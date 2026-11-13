<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	type Props = Omit<HTMLInputAttributes, 'type'> & { label?: string; description?: string };

	let {
		checked = $bindable(false),
		label,
		description,
		class: className,
		...rest
	}: Props = $props();
</script>

<label class={['group inline-flex cursor-pointer items-start gap-3', className]}>
	<span class="relative mt-0.5 inline-flex shrink-0">
		<input type="checkbox" class="peer sr-only" bind:checked {...rest} />
		<span
			class="h-5 w-9 rounded-full bg-zinc-300 transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50 peer-disabled:opacity-50 dark:bg-zinc-700"
		></span>
		<span
			class="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4"
		></span>
	</span>
	{#if label || description}
		<span class="grid gap-0.5">
			{#if label}<span class="text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</span
				>{/if}
			{#if description}<span class="text-xs text-zinc-500">{description}</span>{/if}
		</span>
	{/if}
</label>
