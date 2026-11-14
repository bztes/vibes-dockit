<script lang="ts">
	import { ExternalLink } from '@lucide/svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Textarea from '#lib/components/ui/Textarea.svelte';
	import {
		CONFIG_EXAMPLE,
		DDNS_CONFIG_FILE,
		DDNS_DOCS,
		parseConfig,
		type DdnsValues
	} from './ddns';

	let { values = $bindable() }: { values: DdnsValues } = $props();

	const problem = $derived.by(() => {
		if (!values.config.trim()) return null;
		const parsed = parseConfig(values.config);
		return typeof parsed === 'string' ? parsed : null;
	});
</script>

<div class="grid gap-3">
	<Field
		label="Config"
		hint="ddns-updater JSON config. Stored in the project's {DDNS_CONFIG_FILE}."
		issues={problem ? [{ message: problem }] : undefined}
		for="ddns-config"
	>
		<Textarea
			id="ddns-config"
			bind:value={values.config}
			rows={12}
			mono
			spellcheck={false}
			placeholder={CONFIG_EXAMPLE}
		/>
	</Field>
	<a
		href={DDNS_DOCS}
		target="_blank"
		rel="noreferrer"
		class="inline-flex items-center gap-1 text-sm text-link hover:underline"
	>
		Configuration and supported providers <ExternalLink class="size-3.5" />
	</a>
</div>
