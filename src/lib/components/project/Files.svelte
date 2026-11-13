<script lang="ts">
	import { CircleCheck, FileCode, KeyRound, Rocket, RotateCcw, Save } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { getFiles, saveFiles, validateFiles } from '#lib/remote/projects.remote.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import CodeEditor from '#lib/components/ui/CodeEditor.svelte';
	import EnvEditor from '#lib/components/app/EnvEditor.svelte';
	import { openJob } from '#lib/components/app/jobs.svelte.js';
	import { toast } from '#lib/components/ui/toast.svelte.js';

	let { name }: { name: string } = $props();

	const files = $derived(await getFiles(name));

	let compose = $state('');
	let env = $state('');
	let original = $state({ compose: '', env: '' });
	let problem = $state<string | null>(null);
	let busy = $state<'save' | 'deploy' | 'validate' | null>(null);

	$effect.pre(() => {
		// (re)load when the files changed on the server and there are no local edits
		const f = files;
		untrack(() => {
			if (compose === original.compose && env === original.env) {
				compose = f.compose;
				env = f.env;
			}
			original = { compose: f.compose, env: f.env };
		});
	});

	const dirty = $derived(compose !== original.compose || env !== original.env);

	async function save(deploy: boolean) {
		busy = deploy ? 'deploy' : 'save';
		problem = null;
		try {
			const res = await saveFiles({ name, compose, env, deploy });
			if (res.error) {
				problem = res.error;
				toast.error('The compose file is invalid');
				return;
			}
			original = { compose, env };
			toast.success(deploy ? 'Saved, deploying…' : 'Saved');
			if (res.jobId) openJob(res.jobId);
		} catch (e) {
			toast.error('Could not save', e);
		} finally {
			busy = null;
		}
	}

	async function validate() {
		busy = 'validate';
		try {
			problem = await validateFiles({ name, compose, env });
			if (!problem) toast.success('Configuration is valid');
		} catch (e) {
			toast.error('Validation failed', e);
		} finally {
			busy = null;
		}
	}
</script>

<div class="grid gap-4">
	<div
		class="sticky top-14 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white/90 px-3 py-2 backdrop-blur lg:top-2 dark:border-zinc-800 dark:bg-zinc-900/90"
	>
		<p class="text-sm text-zinc-500">
			{#if dirty}<span class="font-medium text-amber-600 dark:text-amber-400">Unsaved changes</span
				>{:else}All changes saved{/if}
			<span class="hidden sm:inline"> · Ctrl+S to save</span>
		</p>
		<div class="flex flex-wrap gap-2">
			{#if dirty}
				<Button
					size="sm"
					variant="ghost"
					onclick={() => ((compose = original.compose), (env = original.env), (problem = null))}
					><RotateCcw /> Discard</Button
				>
			{/if}
			<Button size="sm" onclick={validate} loading={busy === 'validate'}
				><CircleCheck /> Validate</Button
			>
			<Button size="sm" onclick={() => save(false)} loading={busy === 'save'} disabled={!dirty}
				><Save /> Save</Button
			>
			<Button size="sm" variant="primary" onclick={() => save(true)} loading={busy === 'deploy'}
				><Rocket /> Save & deploy</Button
			>
		</div>
	</div>

	{#if problem}
		<pre
			class="rounded-xl border border-red-500/30 bg-red-500/5 p-4 font-mono text-xs whitespace-pre-wrap text-red-600 dark:text-red-400">{problem}</pre>
	{/if}

	<Card
		title={files.composeFile}
		description="Metadata for Dockit is stored in the x-dockit block."
	>
		{#snippet actions()}<FileCode class="size-4 text-zinc-400" />{/snippet}
		<CodeEditor bind:value={compose} invalid={!!problem} onsave={() => save(false)} />
	</Card>

	<Card title=".env" description="Environment variables used for interpolation (and env_file).">
		{#snippet actions()}<KeyRound class="size-4 text-zinc-400" />{/snippet}
		<EnvEditor bind:value={env} onsave={() => save(false)} />
	</Card>
</div>
