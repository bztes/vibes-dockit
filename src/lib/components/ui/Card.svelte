<script module lang="ts">
	import { tv } from 'tailwind-variants';

	export const card = tv({
		slots: {
			root: 'rounded-lg border border-zinc-200 bg-white shadow-xs dark:border-zinc-800/80 dark:bg-zinc-900/60',
			header:
				'flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800/80',
			title: 'text-sm font-semibold text-zinc-900 dark:text-zinc-100',
			description: 'text-xs text-zinc-500 dark:text-zinc-400',
			body: 'p-5'
		},
		variants: {
			flush: { true: { body: 'p-0' } },
			interactive: {
				true: {
					root: 'transition-colors hover:border-zinc-300 dark:hover:border-zinc-700'
				}
			}
		}
	});
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title?: string;
		description?: string;
		actions?: Snippet;
		children?: Snippet;
		flush?: boolean;
		interactive?: boolean;
		class?: string;
		bodyClass?: string;
	}

	let {
		title,
		description,
		actions,
		children,
		flush = false,
		interactive = false,
		class: className,
		bodyClass
	}: Props = $props();

	const styles = $derived(card({ flush, interactive }));
</script>

<section class={styles.root({ class: className })}>
	{#if title || actions}
		<header class={styles.header()}>
			<div class="min-w-0">
				{#if title}<h2 class={styles.title()}>{title}</h2>{/if}
				{#if description}<p class={styles.description()}>{description}</p>{/if}
			</div>
			{#if actions}<div class="flex items-center gap-2">{@render actions()}</div>{/if}
		</header>
	{/if}
	<div class={styles.body({ class: bodyClass })}>
		{@render children?.()}
	</div>
</section>
