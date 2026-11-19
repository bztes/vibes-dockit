<script lang="ts">
	import { Plus, Trash } from '@lucide/svelte';
	import { addHookRunner, removeHookRunner } from './restic.remote';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Select from '#lib/components/ui/Select.svelte';
	import StatusDot from '#lib/components/ui/StatusDot.svelte';
	import { confirm } from '#lib/components/ui/confirm.svelte.js';
	import { toast } from '#lib/components/ui/toast.svelte.js';
	import type { Runner } from './hooks';
	import { PRESET_INFO, PRESETS, type Preset } from './presets';

	let {
		name,
		runners,
		candidates
	}: {
		name: string;
		runners: (Runner & { registered: boolean })[];
		candidates: { name: string; image: string }[];
	} = $props();

	let busy = $state<string | null>(null);
	let problem = $state<string | null>(null);

	let adding = $state(false);
	let addBusy = $state(false);
	let addProblem = $state<string | null>(null);
	let service = $state('');
	let preset = $state<Preset>('custom');
	const templates = PRESETS.filter((p) => p !== 'custom');

	function openAdd() {
		service = candidates[0]?.name ?? '';
		preset = 'custom';
		addProblem = null;
		adding = true;
	}

	async function add() {
		if (!service) return;
		addBusy = true;
		addProblem = null;
		try {
			const res = await addHookRunner({ name, service, preset });
			if (res.error) addProblem = res.error;
			else {
				adding = false;
				toast.success(`Hook runner for ${service} added`, 'Deploy the project to start it.');
			}
		} catch (e) {
			toast.error('Could not add the hook runner', e);
		} finally {
			addBusy = false;
		}
	}

	async function remove(runner: Runner) {
		const ok = await confirm({
			title: `Remove ${runner.service}?`,
			description:
				'The hook runner and its hooks are removed from the compose file. Deploy the project to stop it.',
			confirmLabel: 'Remove',
			danger: true
		});
		if (!ok) return;
		busy = runner.service;
		problem = null;
		try {
			const res = await removeHookRunner({ name, service: runner.service });
			if (res.error) problem = res.error;
			else toast.success(`${runner.service} removed`);
		} catch (e) {
			toast.error('Could not remove the hook runner', e);
		} finally {
			busy = null;
		}
	}
</script>

{#snippet error(message: string)}
	<pre
		class="rounded-lg bg-red-500/5 p-3 font-mono text-xs whitespace-pre-wrap text-red-600 dark:text-red-400">{message}</pre>
{/snippet}

{#snippet option(id: Preset)}
	<label
		class="flex cursor-pointer items-start gap-2.5 rounded-lg border border-zinc-200 p-2.5 has-checked:border-primary/50 has-checked:bg-primary/5 dark:border-zinc-800"
	>
		<input
			type="radio"
			name="hooks-preset"
			class="mt-0.5 size-4 accent-primary"
			value={id}
			bind:group={preset}
		/>
		<span>
			<span class="block text-sm font-medium">{PRESET_INFO[id].label}</span>
			<span class="block text-xs text-zinc-500">{PRESET_INFO[id].description}</span>
		</span>
	</label>
{/snippet}

<Card
	title="Backup hooks"
	description="Commands that run before backups and after restores, e.g. a database dump. They run in a hook runner next to their service: same image, volumes and network."
>
	<div class="grid gap-4">
		{#if runners.length}
			<ul class="-mx-5 -mt-4 divide-y divide-zinc-100 dark:divide-zinc-800/60">
				{#each runners as runner (runner.service)}
					<li class="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
						<div class="min-w-0 flex-1">
							<p class="flex items-center gap-2 text-sm font-medium">
								<StatusDot tone={runner.registered ? 'running' : 'stopped'} />
								<span class="font-mono">{runner.service}</span>
								{#if runner.target}
									<span class="text-xs font-normal text-zinc-500">for {runner.target}</span>
								{/if}
							</p>
							<p class="mt-0.5 text-xs text-zinc-500">
								{runner.registered
									? 'Ready'
									: 'Not running: its hooks are skipped. Deploy the project to start it.'}
							</p>
						</div>
						<div class="flex flex-wrap gap-1.5">
							{#each runner.phases as phase (phase)}
								<Badge>{phase}</Badge>
							{:else}
								<Badge tone="warning">no hooks</Badge>
							{/each}
						</div>
						<Button
							size="icon-sm"
							variant="ghost"
							title="Remove"
							aria-label="Remove {runner.service}"
							onclick={() => remove(runner)}
							loading={busy === runner.service}
							disabled={busy !== null}><Trash /></Button
						>
					</li>
				{/each}
			</ul>
		{/if}

		{#if candidates.length}
			<div>
				<Button size="sm" onclick={openAdd} disabled={busy !== null}
					><Plus /> Add hook runner</Button
				>
			</div>
		{:else if !runners.length}
			<p class="text-sm text-zinc-500">No service with an image to add hooks for.</p>
		{/if}

		{#if problem}{@render error(problem)}{/if}

		<p class="text-xs text-zinc-500">
			The commands are the <code class="font-mono">HOOK_*</code> variables of the runner in the
			compose file. Dumps go to <code class="font-mono">.backup/dumps</code> and are backed up with the
			project files; post-restore hooks run when the project files are restored.
		</p>
	</div>
</Card>

<Dialog
	bind:open={adding}
	size="lg"
	title="Add a hook runner"
	description="Runs next to the service with its image, volumes and network."
>
	<div class="grid gap-4">
		<Field label="Service" for="hooks-service">
			<Select id="hooks-service" bind:value={service}>
				{#each candidates as c (c.name)}
					<option value={c.name}>{c.name} ({c.image})</option>
				{/each}
			</Select>
		</Field>

		<Field label="Hooks">
			<div class="grid gap-2">
				{@render option('custom')}
				<p class="mt-2 text-xs font-medium text-zinc-500">Database templates</p>
				<div class="grid gap-2 sm:grid-cols-2">
					{#each templates as id (id)}{@render option(id)}{/each}
				</div>
			</div>
		</Field>

		{#if preset !== 'custom'}
			<p class="text-xs text-zinc-500">
				The commands use the tools of the service's image: pick the template of its database. You
				can edit them in the compose file afterwards.
			</p>
		{/if}

		{#if addProblem}{@render error(addProblem)}{/if}
	</div>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (adding = false)}>Cancel</Button>
		<Button onclick={add} loading={addBusy} disabled={!service || addBusy}><Plus /> Add</Button>
	{/snippet}
</Dialog>
