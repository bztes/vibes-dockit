<script lang="ts">
	import Badge from '#lib/components/ui/Badge.svelte';
	import { getTemplate } from './index';

	/** id of the template a project matches */
	let { template }: { template: string | null } = $props();

	const t = $derived(getTemplate(template));
</script>

{#if t}
	<Badge title="Matches the {t.name} template"><t.icon /> {t.badge}</Badge>
{/if}
