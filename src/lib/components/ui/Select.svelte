<script lang="ts">
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import { ChevronDown } from '@lucide/svelte';
	import { input } from './variants';

	type Props = Omit<HTMLSelectAttributes, 'size'> & { size?: 'sm' | 'md' | 'lg' };

	let { class: className, size, value = $bindable(), children, ...rest }: Props = $props();
</script>

<div class="relative">
	<select
		class={input({ size, class: ['appearance-none pr-8', className as string] })}
		bind:value
		{...rest}
	>
		{@render children?.()}
	</select>
	<ChevronDown
		class="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-zinc-400"
	/>
</div>
