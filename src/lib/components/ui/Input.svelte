<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { input } from './variants';

	type Props = Omit<HTMLInputAttributes, 'size'> & {
		size?: 'sm' | 'md' | 'lg';
		mono?: boolean;
		value?: unknown;
	};

	let { class: className, size, mono, value = $bindable(), ...rest }: Props = $props();
</script>

<input class={input({ size, mono, class: className as string })} bind:value {...rest} />
