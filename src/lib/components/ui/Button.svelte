<script module lang="ts">
	import { tv, type VariantProps } from 'tailwind-variants';

	export const button = tv({
		base: [
			'inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap select-none',
			'transition-colors duration-150',
			'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:focus-visible:ring-offset-zinc-950',
			'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0'
		],
		variants: {
			variant: {
				primary: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover',
				secondary:
					'bg-zinc-100 text-zinc-900 hover:bg-zinc-200/80 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700/80',
				outline:
					'border border-zinc-200 bg-white text-zinc-700 shadow-xs hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-white',
				ghost:
					'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100',
				danger: 'bg-danger text-danger-foreground shadow-xs hover:bg-danger-hover',
				'danger-ghost': 'text-danger hover:bg-danger/10',
				success: 'bg-success text-white shadow-xs hover:bg-success/90'
			},
			size: {
				xs: 'h-7 rounded-md px-2 text-xs [&_svg]:size-3.5',
				sm: 'h-8 px-3 text-sm',
				md: 'h-9 px-4 text-sm',
				lg: 'h-11 px-5 text-base',
				icon: 'size-9',
				'icon-sm': 'size-8 rounded-md',
				'icon-xs': 'size-7 rounded-md [&_svg]:size-3.5'
			}
		},
		defaultVariants: { variant: 'outline', size: 'md' }
	});
	export type ButtonVariants = VariantProps<typeof button>;
</script>

<script lang="ts">
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import { LoaderCircle } from '@lucide/svelte';

	type Props = ButtonVariants & {
		href?: string;
		loading?: boolean;
		class?: string;
	} & HTMLButtonAttributes &
		HTMLAnchorAttributes;

	let {
		variant,
		size,
		href,
		loading = false,
		class: className,
		children,
		disabled,
		type = 'button',
		...rest
	}: Props = $props();
</script>

{#if href}
	<a {href} class={button({ variant, size, class: className })} {...rest}>
		{@render children?.()}
	</a>
{:else}
	<button
		{type}
		class={button({ variant, size, class: className })}
		disabled={disabled || loading}
		{...rest}
	>
		{#if loading}
			<LoaderCircle class="animate-spin" />
		{/if}
		{@render children?.()}
	</button>
{/if}
