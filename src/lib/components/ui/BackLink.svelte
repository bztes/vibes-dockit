<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ArrowLeft } from '@lucide/svelte';

	let { href, children }: { href: string; children: Snippet } = $props();
</script>

<a
	{href}
	class="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
>
	<ArrowLeft class="size-4" />
	{@render children()}
</a>
