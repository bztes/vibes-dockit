<script lang="ts">
	import type { Snippet } from 'svelte';
	import { card } from './variants';

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
