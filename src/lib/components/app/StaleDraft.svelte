<script lang="ts">
	import { TriangleAlert } from '@lucide/svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import type { Draft } from './drafts.svelte.js';

	let { draft, what, ondiscard }: { draft: Draft<unknown>; what: string; ondiscard: () => void } =
		$props();
</script>

{#if draft.stale}
	<div
		class="flex flex-wrap items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
	>
		<TriangleAlert class="mt-0.5 size-4 shrink-0 text-amber-500" />
		<div class="min-w-0 flex-1">
			<p class="font-medium">{what} changed since you started editing</p>
			<p class="mt-0.5 text-zinc-500">Saving your edits overwrites that change.</p>
		</div>
		<div class="flex gap-2">
			<Button size="sm" variant="ghost" onclick={ondiscard}>Load the new version</Button>
			<Button size="sm" onclick={() => draft.rebase()}>Keep my edits</Button>
		</div>
	</div>
{/if}
