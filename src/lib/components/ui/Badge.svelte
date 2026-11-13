<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { badge, type BadgeVariants } from './variants';

	let {
		tone,
		class: className,
		children,
		...rest
	}: BadgeVariants & HTMLAttributes<HTMLSpanElement> = $props();
</script>

<span class={badge({ tone, class: className as string })} {...rest}>{@render children?.()}</span>
