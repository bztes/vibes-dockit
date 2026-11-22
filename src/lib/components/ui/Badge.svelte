<script module lang="ts">
	import { tv, type VariantProps } from 'tailwind-variants';

	export const badge = tv({
		base: [
			'inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3',
			'dark:border-zinc-800 dark:bg-zinc-900'
		],
		variants: {
			tone: {
				neutral: 'text-zinc-600 dark:text-zinc-400',
				success: 'text-zinc-700 dark:text-zinc-300',
				warning: 'text-warning',
				danger: 'border-danger/30 text-danger',
				info: 'border-primary/30 text-link',
				violet: 'text-zinc-700 dark:text-zinc-300'
			}
		},
		defaultVariants: { tone: 'neutral' }
	});
	export type BadgeVariants = VariantProps<typeof badge>;
</script>

<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		tone,
		class: className,
		children,
		...rest
	}: BadgeVariants & HTMLAttributes<HTMLSpanElement> = $props();
</script>

<span class={badge({ tone, class: className as string })} {...rest}>{@render children?.()}</span>
