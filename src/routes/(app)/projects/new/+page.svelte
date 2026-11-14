<script lang="ts">
	import { ArrowLeft, FileCode, KeyRound, Save } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { createProject } from '#lib/remote/projects.remote.js';
	import { createFromTemplate, getTemplates } from '#lib/remote/templates.remote.js';
	import { getTemplate, templates, type Template } from '#lib/templates/index.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import CodeEditor from '#lib/components/ui/CodeEditor.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import EnvEditor from '#lib/components/app/EnvEditor.svelte';
	import { toast } from '#lib/components/ui/toast.svelte.js';

	const composeHint = 'Use ${VAR} to reference environment variables.';
	const availability = $derived(await getTemplates());
	const unavailable = (id: string) => availability.find((a) => a.id === id)?.unavailable ?? null;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let template = $state<Template<any> | null>(null);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let values = $state<any>({});
	let name = $state('');
	let compose = $state(`services:
  app:
    image: nginx:alpine
    restart: unless-stopped
`);
	let env = $state('');
	let saving = $state(false);
	let problem = $state<string | null>(null);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function apply(next: Template<any> | null) {
		// keep a name the user typed, replace a suggested one
		if (!name || name === template?.defaultName) name = next?.defaultName ?? '';
		template = next;
		values = next?.defaults() ?? {};
		problem = null;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function select(next: Template<any> | null) {
		if (next?.id === template?.id) return;
		apply(next);
		const url = new URL(page.url.href);
		if (next) url.searchParams.set('template', next.id);
		else url.searchParams.delete('template');
		goto(url, { shallow: true, replace: true });
	}

	// ?template=caddy preselects a template
	apply(getTemplate(page.url.searchParams.get('template')));

	const nameValid = $derived(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(name));
	const blocked = $derived(template ? unavailable(template.id) : null);

	async function submit() {
		if (!nameValid || blocked) return;
		saving = true;
		problem = null;
		try {
			const res = template
				? await createFromTemplate({ template: template.id, name, values })
				: await createProject({ name, compose, env });
			if (res.error) {
				problem = res.error;
				return;
			}
			toast.success(`Project ${name} created`);
			await goto(`/projects/${name}`);
		} catch (e) {
			toast.error('Could not create project', e);
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>New project · Dockit</title></svelte:head>

{#snippet option(
	active: boolean,
	icon: Template['icon'],
	title: string,
	text: string,
	disabledReason: string | null,
	onclick: () => void
)}
	{@const Icon = icon}
	<button
		type="button"
		class={[
			'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors',
			active
				? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900'
				: 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700',
			disabledReason && 'opacity-60'
		]}
		aria-pressed={active}
		{onclick}
	>
		<Icon class="mt-0.5 size-5 shrink-0 text-zinc-500" />
		<span class="min-w-0">
			<span class="block text-sm font-medium">{title}</span>
			<span class="mt-0.5 block text-xs text-zinc-500">{disabledReason ?? text}</span>
		</span>
	</button>
{/snippet}

<a
	href="/"
	class="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
>
	<ArrowLeft class="size-4" /> Projects
</a>
<h1 class="mt-3 text-2xl font-semibold tracking-tight">New project</h1>
<p class="mt-1 text-sm text-zinc-500">
	Creates a folder with a <code class="font-mono text-xs">compose.yaml</code> — written by you or generated
	from a template.
</p>

<div class="mt-8 grid gap-6">
	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{@render option(!template, FileCode, 'Custom', 'Write your own compose file.', null, () =>
			select(null)
		)}
		{#each templates as t (t.id)}
			{@render option(template?.id === t.id, t.icon, t.name, t.description, unavailable(t.id), () =>
				select(t)
			)}
		{/each}
	</div>

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

	{#if template}
		{@const Form = template.form}
		{@const Icon = template.icon}
		<Card title={template.name} description={template.description}>
			{#snippet actions()}<Icon class="size-4 text-zinc-400" />{/snippet}
			{#if blocked}
				<p class="text-sm text-zinc-500">{blocked}</p>
			{:else}
				<Form bind:values />
			{/if}
			{#if problem}
				<pre
					class="mt-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3 font-mono text-xs whitespace-pre-wrap text-red-600 dark:text-red-400">{problem}</pre>
			{/if}
		</Card>
	{:else}
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
	{/if}

	<div class="flex justify-end">
		<Button
			variant="primary"
			size="lg"
			onclick={submit}
			loading={saving}
			disabled={!nameValid || !!blocked}
		>
			<Save /> Create project
		</Button>
	</div>
</div>
