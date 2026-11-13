<script lang="ts">
	import type { Snippet } from 'svelte';
	import { X } from '@lucide/svelte';

	interface Props {
		open: boolean;
		title?: string;
		description?: string;
		children?: Snippet;
		footer?: Snippet;
		size?: 'sm' | 'md' | 'lg' | 'xl';
		onclose?: () => void;
	}

	let {
		open = $bindable(),
		title,
		description,
		children,
		footer,
		size = 'md',
		onclose
	}: Props = $props();

	let dialog: HTMLDialogElement;

	$effect(() => {
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});

	const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
</script>

<dialog
	bind:this={dialog}
	class={[
		'm-auto w-[calc(100%-2rem)] rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl open:animate-slide-up dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100',
		widths[size]
	]}
	onclose={() => {
		open = false;
		onclose?.();
	}}
	onclick={(e) => {
		if (e.target === dialog) dialog.close();
	}}
>
	{#if open}
		<div class="flex items-start justify-between gap-4 px-6 pt-5">
			<div>
				{#if title}<h2 class="text-base font-semibold">{title}</h2>{/if}
				{#if description}<p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
						{description}
					</p>{/if}
			</div>
			<button
				class="-mr-2 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
				onclick={() => dialog.close()}
				aria-label="Close"
			>
				<X class="size-4" />
			</button>
		</div>
		<div class="px-6 py-5">{@render children?.()}</div>
		{#if footer}
			<div
				class="flex flex-wrap justify-end gap-2 rounded-b-2xl border-t border-zinc-200 bg-zinc-50 px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900/80"
			>
				{@render footer()}
			</div>
		{/if}
	{/if}
</dialog>
