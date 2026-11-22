<script module lang="ts">
	import { tv } from 'tailwind-variants';

	export const input = tv({
		base: [
			'w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400',
			'transition-colors focus:border-ring focus:ring-3 focus:ring-ring/20 focus:outline-none',
			'disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger aria-invalid:focus:ring-danger/15',
			'dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500'
		],
		variants: {
			size: { sm: 'h-8 text-xs', md: 'h-9', lg: 'h-11' },
			mono: { true: 'font-mono text-[13px]' },
			multiline: { true: 'h-auto py-2' }
		},
		defaultVariants: { size: 'md' }
	});
</script>

<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	type Props = Omit<HTMLInputAttributes, 'size'> & {
		size?: 'sm' | 'md' | 'lg';
		mono?: boolean;
		value?: unknown;
	};

	let { class: className, size, mono, value = $bindable(), ...rest }: Props = $props();
</script>

<input class={input({ size, mono, class: className as string })} bind:value {...rest} />
