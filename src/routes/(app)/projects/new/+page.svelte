<script lang="ts">
	import { ArrowLeft, FileCode, KeyRound, Rocket, Save } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { createProject } from '#lib/remote/projects.remote.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import CodeEditor from '#lib/components/ui/CodeEditor.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import Switch from '#lib/components/ui/Switch.svelte';
	import EnvEditor from '#lib/components/app/EnvEditor.svelte';
	import { openJob } from '#lib/components/app/jobs.svelte.js';
	import { toast } from '#lib/components/ui/toast.svelte.js';

	const composeHint = 'Use ${VAR} to reference environment variables.';
	let name = $state('');
	let compose = $state(`services:
  app:
    image: nginx:alpine
    restart: unless-stopped
`);
	let env = $state('');
	let deploy = $state(true);
	let saving = $state(false);
	let problem = $state<string | null>(null);

	const nameValid = $derived(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(name));

	async function submit() {
		if (!nameValid) return;
		saving = true;
		problem = null;
		try {
			const res = await createProject({ name, compose, env, deploy });
			if (res.error) {
				problem = res.error;
				return;
			}
			toast.success(`Project ${name} created`);
			if (res.jobId) openJob(res.jobId);
			await goto(`/projects/${name}`);
		} catch (e) {
			toast.error('Could not create project', e);
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>New project · Dockit</title></svelte:head>

<a
	href="/"
	class="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
>
	<ArrowLeft class="size-4" /> Projects
</a>
<h1 class="mt-3 text-2xl font-semibold tracking-tight">New project</h1>
<p class="mt-1 text-sm text-zinc-500">
	Creates a folder with a <code class="font-mono text-xs">compose.yaml</code> and an optional
	<code class="font-mono text-xs">.env</code> file.
</p>

<div class="mt-8 grid gap-6">
	<Card>
		<div class="grid gap-5 md:grid-cols-2">
			<Field
				label="Project name"
				hint="Used as folder name and compose project name."
				issues={name && !nameValid
					? [{ message: 'Letters, numbers, . _ - (must start with a letter or number)' }]
					: undefined}
			>
				<Input
					bind:value={name}
					placeholder="my-app"
					mono
					autofocus
					aria-invalid={!!name && !nameValid}
				/>
			</Field>
		</div>
	</Card>

	<Card title="compose.yaml" description={composeHint}>
		{#snippet actions()}<FileCode class="size-4 text-zinc-400" />{/snippet}
		<CodeEditor bind:value={compose} invalid={!!problem} onsave={submit} />
		{#if problem}
			<pre
				class="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3 font-mono text-xs whitespace-pre-wrap text-red-600 dark:text-red-400">{problem}</pre>
		{/if}
	</Card>

	<Card title=".env" description="Variables for interpolation in the compose file.">
		{#snippet actions()}<KeyRound class="size-4 text-zinc-400" />{/snippet}
		<EnvEditor bind:value={env} />
	</Card>

	<div class="flex flex-wrap items-center justify-between gap-4">
		<Switch
			bind:checked={deploy}
			label="Deploy after creating"
			description="Runs docker compose up -d"
		/>
		<Button variant="primary" size="lg" onclick={submit} loading={saving} disabled={!nameValid}>
			{#if deploy}<Rocket /> Create & deploy{:else}<Save /> Create project{/if}
		</Button>
	</div>
</div>
