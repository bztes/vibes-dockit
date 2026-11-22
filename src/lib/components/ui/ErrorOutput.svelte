<script module lang="ts">
	import { tv } from 'tailwind-variants';

	export const errorOutput = tv({
		base: 'overflow-x-auto font-mono text-xs whitespace-pre-wrap text-red-600 dark:text-red-400',
		variants: {
			plain: { false: 'rounded-lg border border-red-500/30 bg-red-500/5 p-3' }
		},
		defaultVariants: { plain: false }
	});
</script>

<script lang="ts">
	/** `plain` drops the box, e.g. inside an Alert */
	let {
		text,
		plain,
		class: className
	}: { text: string; plain?: boolean; class?: string } = $props();
</script>

<pre class={errorOutput({ plain, class: className })}>{text}</pre>
