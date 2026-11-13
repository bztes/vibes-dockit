<script lang="ts">
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import { LoaderCircle } from '@lucide/svelte';
	import { button, type ButtonVariants } from './variants';

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
