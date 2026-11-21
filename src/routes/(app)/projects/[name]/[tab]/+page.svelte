<script lang="ts">
	import { error } from '@sveltejs/kit';
	import { getProjectTabs } from '#lib/remote/templates.remote.js';
	import { resolveTabs } from '#lib/templates/index.js';

	let { params } = $props();

	// tabs added by templates, e.g. Domains when a Caddy project exists
	const tabs = $derived(resolveTabs(await getProjectTabs(params.name)));
	const tab = $derived(tabs.find((t) => t.id === params.tab) ?? error(404, 'Not found'));
</script>

<tab.component name={params.name} />
