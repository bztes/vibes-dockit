<script lang="ts">
	import { CircleAlert, CircleCheck, CirclePause, Globe, Rocket } from '@lucide/svelte';
	import { getCaddyStatus, setupCaddy } from '#lib/remote/caddy.remote.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import { openJob } from '#lib/components/app/jobs.svelte.js';
	import { toast } from '#lib/components/ui/toast.svelte.js';

	/** compact: only render something when Caddy is not ready */
	let { compact = false }: { compact?: boolean } = $props();

	const caddy = $derived(await getCaddyStatus());

	let email = $state('');
	let creating = $state(false);

	async function create() {
		creating = true;
		try {
			const res = await setupCaddy({ email });
			openJob(res.jobId);
			toast.success('Caddy project created, deploying…');
			// the container is started by the job, poll until it shows up
			for (let i = 0; i < 20; i++) {
				await new Promise((r) => setTimeout(r, 2000));
				await getCaddyStatus().refresh();
				if (getCaddyStatus().current?.state === 'ready') break;
			}
		} catch (e) {
			toast.error('Could not set up Caddy', e);
		} finally {
			creating = false;
		}
	}
</script>

{#snippet setup()}
	<div class="mt-3 flex flex-wrap items-center gap-2">
		<div class="w-64 max-w-full">
			<Input
				bind:value={email}
				type="email"
				size="sm"
				placeholder="Email for Let's Encrypt (optional)"
			/>
		</div>
		<Button size="sm" variant="primary" onclick={create} loading={creating}
			><Rocket /> Set up Caddy</Button
		>
	</div>
	<p class="mt-2 text-xs text-zinc-500">
		Creates the project <code class="font-mono">caddy</code> (caddy-docker-proxy on ports 80 and
		443) and the docker network <code class="font-mono">{caddy.network}</code>, then deploys it.
	</p>
{/snippet}

{#if caddy.state === 'ready'}
	{#if !compact}
		<div class="flex items-start gap-3 text-sm">
			<CircleCheck class="mt-0.5 size-4 shrink-0 text-emerald-500" />
			<div>
				<p class="font-medium">Caddy is running</p>
				<p class="mt-0.5 text-zinc-500">
					Container <code class="font-mono text-xs">{caddy.container?.name}</code>
					{#if caddy.project}
						(project <a href="/projects/{caddy.project}" class="text-link hover:underline"
							>{caddy.project}</a
						>)
					{/if}
					· network <code class="font-mono text-xs">{caddy.network}</code>. Domains are configured
					in the settings of each project.
				</p>
			</div>
		</div>
	{/if}
{:else if caddy.state === 'stopped'}
	<div
		class="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm"
	>
		<CirclePause class="mt-0.5 size-4 shrink-0 text-amber-500" />
		<div>
			<p class="font-medium">Caddy is not running</p>
			<p class="mt-0.5 text-zinc-500">
				The container <code class="font-mono text-xs">{caddy.container?.name}</code> is {caddy
					.container?.state}. Domains are applied as soon as it runs again.
				{#if caddy.project}
					<a href="/projects/{caddy.project}" class="text-link hover:underline">Open project</a>
				{/if}
			</p>
		</div>
	</div>
{:else if caddy.state === 'incompatible'}
	<div class="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm">
		<CircleAlert class="mt-0.5 size-4 shrink-0 text-red-500" />
		<div>
			<p class="font-medium">Found a Caddy container that Dockit can't configure</p>
			<p class="mt-0.5 text-zinc-500">
				<code class="font-mono text-xs">{caddy.container?.name}</code> uses the official
				<code class="font-mono text-xs">caddy</code> image with a Caddyfile. Dockit configures Caddy
				through docker labels, which needs
				<a
					href="https://github.com/lucaslorentz/caddy-docker-proxy"
					target="_blank"
					rel="noreferrer"
					class="text-link hover:underline">caddy-docker-proxy</a
				>. Stop the existing container (it occupies ports 80/443) and let Dockit set up its own.
			</p>
			{@render setup()}
		</div>
	</div>
{:else}
	<div
		class="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900/60"
	>
		<Globe class="mt-0.5 size-4 shrink-0 text-zinc-500" />
		<div class="min-w-0">
			<p class="font-medium">No Caddy reverse proxy found</p>
			<p class="mt-0.5 text-zinc-500">
				With Caddy, projects get domains with automatic HTTPS — without publishing any ports.
			</p>
			{@render setup()}
		</div>
	</div>
{/if}
