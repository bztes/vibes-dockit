<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	type Props = Omit<HTMLInputAttributes, 'type'> & {
		type?: 'checkbox' | 'radio';
		label: string;
		description?: string;
	};

	let { type = 'checkbox', label, description, class: className, ...rest }: Props = $props();
</script>

<label
	class={[
		'flex cursor-pointer items-start gap-2.5 rounded-lg border border-zinc-200 p-2.5 has-checked:border-primary/50 has-checked:bg-primary/5 dark:border-zinc-800',
		className
	]}
>
	<input {type} class="mt-0.5 size-4 accent-primary" {...rest} />
	<span>
		<span class="block text-sm font-medium">{label}</span>
		{#if description}<span class="block text-xs text-zinc-500">{description}</span>{/if}
	</span>
</label>
