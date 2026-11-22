<script lang="ts">
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import type { Draft } from './drafts.svelte.js';

	let { draft, what, ondiscard }: { draft: Draft<unknown>; what: string; ondiscard: () => void } =
		$props();
</script>

{#if draft.stale}
	<Alert title="{what} changed since you started editing">
		Saving your edits overwrites that change.
		{#snippet actions()}
			<Button size="sm" variant="ghost" onclick={ondiscard}>Load the new version</Button>
			<Button size="sm" onclick={() => draft.rebase()}>Keep my edits</Button>
		{/snippet}
	</Alert>
{/if}
