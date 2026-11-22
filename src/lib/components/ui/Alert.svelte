<script module lang="ts">
	import { tv, type VariantProps } from 'tailwind-variants';

	export const alert = tv({
		slots: {
			root: 'flex flex-wrap items-start border text-sm',
			icon: 'mt-0.5 size-4 shrink-0'
		},
		variants: {
			tone: {
				warning: { root: 'border-amber-500/30 bg-amber-500/5', icon: 'text-amber-500' },
				danger: { root: 'border-red-500/30 bg-red-500/5', icon: 'text-red-500' }
			},
			size: {
				md: { root: 'gap-3 rounded-xl p-4' },
				sm: { root: 'gap-2 rounded-lg p-3' }
			}
		},
		defaultVariants: { tone: 'warning', size: 'md' }
	});
	export type AlertVariants = VariantProps<typeof alert>;
</script>

<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { TriangleAlert } from '@lucide/svelte';

	type Props = AlertVariants & {
		icon?: Component;
		title?: string;
		/** body; muted below a title */
		children?: Snippet;
		actions?: Snippet;
		class?: string;
	};

	let { tone, size, icon, title, children, actions, class: className }: Props = $props();

	const styles = $derived(alert({ tone, size }));
	const Icon = $derived(icon ?? TriangleAlert);
</script>

<div class={styles.root({ class: className })}>
	<Icon class={styles.icon()} />
	<div class="min-w-0 flex-1">
		{#if title}<p class="font-medium">{title}</p>{/if}
		{#if children}
			<div class={title && 'mt-0.5 text-zinc-500'}>{@render children()}</div>
		{/if}
	</div>
	{#if actions}<div class="flex gap-2">{@render actions()}</div>{/if}
</div>
