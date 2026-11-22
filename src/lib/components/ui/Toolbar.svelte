<script lang="ts">
	import type { Snippet } from 'svelte';

	/** sticky bar above an editor */
	let { children }: { children: Snippet } = $props();
</script>

<div
	class="sticky top-14 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white/90 px-3 py-2 backdrop-blur lg:top-2 dark:border-zinc-800 dark:bg-zinc-900/90"
>
	{@render children()}
</div>
