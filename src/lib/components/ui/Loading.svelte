<script module lang="ts">
	import { tv } from 'tailwind-variants';

	export const loading = tv({ base: 'grid place-items-center py-20 text-zinc-400' });
</script>

<script lang="ts">
	import { LoaderCircle } from '@lucide/svelte';

	let { class: className }: { class?: string } = $props();
</script>

<div class={loading({ class: className })}>
	<LoaderCircle class="size-5 animate-spin" />
</div>
