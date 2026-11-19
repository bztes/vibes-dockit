<script lang="ts">
	import { CircleCheck, TriangleAlert } from '@lucide/svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import Switch from '#lib/components/ui/Switch.svelte';
	import type { ResticValues } from './index';
	import { parseRepository } from './restic';

	let { values = $bindable() }: { values: ResticValues } = $props();

	const info = $derived(parseRepository(values.repository));
	const rest = $derived(info?.backend === 'rest');
</script>

<div class="grid gap-5">
	<div class="grid gap-5 md:grid-cols-2">
		<Field label="Repository" for="restic-repository">
			<Input
				id="restic-repository"
				bind:value={values.repository}
				placeholder="/srv/backups/restic"
				aria-invalid={!!info?.problem}
				aria-describedby="restic-repository-info"
				spellcheck={false}
				mono
			/>
			{#snippet hint()}
				<p id="restic-repository-info" class="text-xs">
					{#if !info}
						<span class="text-zinc-500">
							A folder on this host or any restic repository, e.g. rest:https://…, s3:…, b2:…,
							sftp:…
						</span>
					{:else if info.problem}
						<span class="text-red-600 dark:text-red-400">{info.problem}</span>
					{:else}
						<span class="flex items-start gap-1.5 text-zinc-600 dark:text-zinc-400">
							<CircleCheck class="mt-px size-3.5 shrink-0 text-emerald-500" />
							<span>
								<span class="font-medium text-zinc-700 dark:text-zinc-300">{info.label}</span>
								<code class="font-mono break-all">{info.location}</code>
								{#if info.backend === 'local'}— mounted into the container{/if}
							</span>
						</span>
					{/if}
				</p>
			{/snippet}
		</Field>
		<Field label="Repository password" hint="Encrypts the repository." for="restic-password">
			<Input
				id="restic-password"
				bind:value={values.password}
				required
				type="password"
				autocomplete="new-password"
			/>
		</Field>
		<Field
			label="REST server username"
			hint={rest
				? 'Leave empty if the server runs without --htpasswd-file'
				: 'Only for rest: repositories'}
			for="restic-rest-user"
		>
			<Input
				id="restic-rest-user"
				bind:value={values.restUser}
				disabled={!rest}
				autocomplete="off"
				spellcheck={false}
			/>
		</Field>
		<Field label="REST server password" for="restic-rest-password">
			<Input
				id="restic-rest-password"
				bind:value={values.restPassword}
				disabled={!rest}
				type="password"
				autocomplete="new-password"
			/>
		</Field>
	</div>

	<Switch
		bind:checked={values.appendOnly}
		label="Append-only repository"
		description="The repository refuses deletes, e.g. rest-server --append-only. Old snapshots are then neither forgotten nor pruned by Dockit — do that with full access to the repository."
	/>

	{#if !values.appendOnly}
		<div class="grid gap-5 sm:grid-cols-3">
			<Field label="Keep daily" for="restic-daily">
				<Input id="restic-daily" bind:value={values.keepDaily} type="number" min="0" />
			</Field>
			<Field label="Keep weekly" for="restic-weekly">
				<Input id="restic-weekly" bind:value={values.keepWeekly} type="number" min="0" />
			</Field>
			<Field label="Keep monthly" for="restic-monthly">
				<Input id="restic-monthly" bind:value={values.keepMonthly} type="number" min="0" />
			</Field>
		</div>
	{/if}

	<p class="text-sm text-zinc-500">
		Runs resticprofile on a schedule. Every other project gets a
		<span class="font-medium text-zinc-700 dark:text-zinc-300">Backups</span> tab to back up its
		folder and volumes. Dockit writes the profiles to
		<code class="font-mono text-xs">conf/dockit.yaml</code>;
		<code class="font-mono text-xs">conf/profiles.yaml</code> is yours for the repository, retention
		and prune schedule. Credentials of remote repositories (including the REST server) go into the
		<code class="font-mono text-xs">.env</code> file.
	</p>

	<p
		class="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
	>
		<TriangleAlert class="mt-0.5 size-4 shrink-0 text-amber-500" />
		<span>
			Keep a copy of the password (<code class="font-mono text-xs">conf/password</code>) somewhere
			else. Without it the backups can't be restored.
		</span>
	</p>
</div>
