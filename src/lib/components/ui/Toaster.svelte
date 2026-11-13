<script lang="ts">
	import { CircleCheck, CircleAlert, Info, X } from '@lucide/svelte';
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { dismiss, toasts } from './toast.svelte';

	const icons = { success: CircleCheck, error: CircleAlert, info: Info };
	const colors = {
		success: 'text-emerald-500',
		error: 'text-red-500',
		info: 'text-primary'
	};
</script>

<div
	class="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
>
	{#each toasts as t (t.id)}
		{@const Icon = icons[t.tone]}
		<div
			animate:flip={{ duration: 200 }}
			in:fly={{ y: 12, duration: 200 }}
			out:fly={{ x: 40, duration: 150 }}
			class="pointer-events-auto flex items-start gap-3 rounded-xl border border-zinc-200 bg-white/95 p-3.5 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95"
		>
			<Icon class={['mt-0.5 size-4 shrink-0', colors[t.tone]]} />
			<div class="min-w-0 flex-1">
				<p class="text-sm font-medium">{t.title}</p>
				{#if t.description}
					<p
						class="mt-0.5 text-xs break-words whitespace-pre-wrap text-zinc-500 dark:text-zinc-400"
					>
						{t.description}
					</p>
				{/if}
			</div>
			<button
				class="rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
				onclick={() => dismiss(t.id)}
				aria-label="Dismiss"
			>
				<X class="size-3.5" />
			</button>
		</div>
	{/each}
</div>
