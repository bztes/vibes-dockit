<script lang="ts">
	import { CircleAlert } from '@lucide/svelte';
	import { getCaddyStatus } from './caddy.remote';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import type { CaddyValues } from './index';

	let { values = $bindable() }: { values: CaddyValues } = $props();

	const caddy = $derived(await getCaddyStatus());
</script>

<div class="grid gap-5">
	{#if caddy.state === 'incompatible'}
		<div
			class="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm"
		>
			<CircleAlert class="mt-0.5 size-4 shrink-0 text-red-500" />
			<div>
				<p class="font-medium">Found a Caddy container that Dockit can't configure</p>
				<p class="mt-0.5 text-zinc-500">
					<code class="font-mono text-xs">{caddy.container?.name}</code> uses the official
					<code class="font-mono text-xs">caddy</code> image with a Caddyfile. Dockit configures
					Caddy through docker labels, which needs
					<a
						href="https://github.com/lucaslorentz/caddy-docker-proxy"
						target="_blank"
						rel="noreferrer"
						class="text-link hover:underline">caddy-docker-proxy</a
					>. Stop the existing container first — it occupies ports 80 and 443.
				</p>
			</div>
		</div>
	{/if}

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
		Runs caddy-docker-proxy on ports 80 and 443 and creates the docker network
		<code class="font-mono text-xs">{caddy.network}</code>. Every other project gets a
		<span class="font-medium text-zinc-700 dark:text-zinc-300">Domains</span> tab to route domains to
		its containers with automatic HTTPS.
	</p>
</div>
