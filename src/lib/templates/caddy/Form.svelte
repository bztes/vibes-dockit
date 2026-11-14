<script lang="ts">
	import { getCaddyStatus } from './caddy.remote';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import type { CaddyValues } from './index';

	let { values = $bindable() }: { values: CaddyValues } = $props();

	const caddy = $derived(await getCaddyStatus());
</script>

<div class="grid gap-5">
	<div class="grid gap-5 md:grid-cols-2">
		<Field
			label="Email for Let's Encrypt"
			hint="Optional. Used for certificate expiry notices."
			for="caddy-email"
		>
			<Input
				id="caddy-email"
				bind:value={values.email}
				type="email"
				placeholder="admin@example.com"
			/>
		</Field>
	</div>

	<p class="text-sm text-zinc-500">
		Runs Caddy on ports 80 and 443 and creates the docker network
		<code class="font-mono text-xs">{caddy.network}</code>. Every other project gets a
		<span class="font-medium text-zinc-700 dark:text-zinc-300">Domains</span> tab to route domains
		to its containers with automatic HTTPS. Dockit writes them to
		<code class="font-mono text-xs">conf/dockit.caddy</code> and reloads Caddy;
		<code class="font-mono text-xs">conf/Caddyfile</code> is yours for global options and further sites.
	</p>
</div>
