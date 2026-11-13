<script lang="ts">
	import { Bell, Mail, Pencil, Plus, Send, Trash2, Webhook } from '@lucide/svelte';
	import {
		deleteChannel,
		listChannels,
		saveChannel,
		testChannel,
		toggleChannel
	} from '#lib/remote/notifications.remote.js';
	import { watchOverview } from '#lib/remote/projects.remote.js';
	import {
		EVENT_TYPES,
		type Channel,
		type ChannelType,
		type EventType
	} from '#lib/notifications.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import Switch from '#lib/components/ui/Switch.svelte';
	import Textarea from '#lib/components/ui/Textarea.svelte';
	import { confirm } from '#lib/components/ui/confirm.svelte.js';
	import { toast } from '#lib/components/ui/toast.svelte.js';

	const channels = $derived(await listChannels());
	const overview = watchOverview();
	const projectNames = $derived((overview.current?.projects ?? []).map((p) => p.name));

	const ICONS = { ntfy: Bell, email: Mail, webhook: Webhook };
	const TYPE_LABEL: Record<ChannelType, string> = {
		ntfy: 'ntfy',
		email: 'E-Mail (SMTP)',
		webhook: 'Webhook'
	};

	function blank(type: ChannelType = 'ntfy'): Channel {
		const common = {
			id: '',
			name: '',
			enabled: true,
			events: [
				'update_available',
				'update_failed',
				'container_died',
				'container_unhealthy',
				'action_failed'
			] as EventType[],
			projects: []
		};
		if (type === 'email')
			return {
				...common,
				type,
				config: { host: '', port: 587, secure: false, username: '', password: '', from: '', to: '' }
			};
		if (type === 'webhook') return { ...common, type, config: { url: '', headers: '' } };
		return {
			...common,
			type: 'ntfy',
			config: { server: 'https://ntfy.sh', topic: '', token: '', priority: 3 }
		};
	}

	let open = $state(false);
	let draft = $state<Channel>(blank());
	let saving = $state(false);
	let testing = $state<string | null>(null);

	function edit(c?: Channel) {
		draft = c ? (structuredClone($state.snapshot(c)) as Channel) : blank();
		open = true;
	}

	function setType(type: ChannelType) {
		const { id, name, enabled, events, projects } = draft;
		draft = { ...blank(type), id, name, enabled, events, projects };
	}

	function payload(c: Channel) {
		const snap = $state.snapshot(c) as Channel;
		return { ...snap, id: snap.id || undefined } as Parameters<typeof saveChannel>[0];
	}

	async function save() {
		saving = true;
		try {
			await saveChannel(payload(draft));
			toast.success('Channel saved');
			open = false;
		} catch (e) {
			toast.error('Could not save channel', e);
		} finally {
			saving = false;
		}
	}

	async function test(c: Channel) {
		testing = c.id || 'draft';
		try {
			await testChannel(payload(c));
			toast.success('Test notification sent');
		} catch (e) {
			toast.error('Test failed', e);
		} finally {
			testing = null;
		}
	}

	async function remove(c: Channel) {
		if (!(await confirm({ title: `Delete ${c.name}?`, confirmLabel: 'Delete', danger: true })))
			return;
		try {
			await deleteChannel(c.id);
		} catch (e) {
			toast.error('Could not delete', e);
		}
	}

	function toggleIn<T>(list: T[], item: T) {
		const i = list.indexOf(item);
		if (i === -1) list.push(item);
		else list.splice(i, 1);
	}
</script>

<svelte:head><title>Notifications · Dockit</title></svelte:head>

<div class="flex flex-wrap items-end justify-between gap-4">
	<div>
		<h1 class="text-2xl font-semibold tracking-tight">Notifications</h1>
		<p class="mt-1 text-sm text-zinc-500">
			Get notified about updates, crashes and failed deployments.
		</p>
	</div>
	<Button variant="primary" onclick={() => edit()}><Plus /> Add channel</Button>
</div>

<div class="mt-8 grid gap-3">
	{#each channels as c (c.id)}
		{@const Icon = ICONS[c.type]}
		<div
			class="flex flex-wrap items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800/80 dark:bg-zinc-900/60"
		>
			<div
				class="grid size-10 place-items-center rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
			>
				<Icon class="size-5" />
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-2">
					<p class="font-medium">{c.name}</p>
					<Badge>{TYPE_LABEL[c.type]}</Badge>
				</div>
				<div class="mt-1.5 flex flex-wrap gap-1">
					{#each c.events as e (e)}
						<Badge tone="info">{EVENT_TYPES.find((x) => x.id === e)?.label}</Badge>
					{/each}
					<Badge>{c.projects.length ? c.projects.join(', ') : 'All projects'}</Badge>
				</div>
			</div>
			<div class="flex items-center gap-1">
				<Switch
					checked={c.enabled}
					aria-label="Enabled"
					onchange={(e) => toggleChannel({ id: c.id, enabled: e.currentTarget.checked })}
				/>
				<Button
					size="icon-sm"
					variant="ghost"
					title="Send test"
					onclick={() => test(c)}
					loading={testing === c.id}
				>
					{#if testing !== c.id}<Send />{/if}
				</Button>
				<Button size="icon-sm" variant="ghost" title="Edit" onclick={() => edit(c)}
					><Pencil /></Button
				>
				<Button size="icon-sm" variant="danger-ghost" title="Delete" onclick={() => remove(c)}
					><Trash2 /></Button
				>
			</div>
		</div>
	{:else}
		<div class="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-800">
			<EmptyState
				icon={Bell}
				title="No notification channels"
				description="Add an ntfy topic, an email address or a webhook (Discord, Slack, Gotify, …)."
			>
				<Button variant="primary" onclick={() => edit()}><Plus /> Add channel</Button>
			</EmptyState>
		</div>
	{/each}
</div>

<Dialog bind:open title={draft.id ? 'Edit channel' : 'New channel'} size="lg">
	<div class="grid gap-5">
		<div class="grid gap-4 sm:grid-cols-2">
			<Field label="Name">
				<Input bind:value={draft.name} placeholder="My phone" />
			</Field>
			<Field label="Type">
				<div class="inline-flex rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800">
					{#each ['ntfy', 'email', 'webhook'] as const as t (t)}
						<button
							class={[
								'rounded-md px-3 py-1.5 text-sm font-medium',
								draft.type === t
									? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white'
									: 'text-zinc-500'
							]}
							onclick={() => setType(t)}>{TYPE_LABEL[t]}</button
						>
					{/each}
				</div>
			</Field>
		</div>

		{#if draft.type === 'ntfy'}
			<div class="grid gap-4 sm:grid-cols-2">
				<Field label="Server"
					><Input bind:value={draft.config.server} placeholder="https://ntfy.sh" /></Field
				>
				<Field label="Topic"
					><Input bind:value={draft.config.topic} placeholder="my-server-alerts" mono /></Field
				>
				<Field label="Access token" hint="Optional"
					><Input bind:value={draft.config.token} type="password" autocomplete="off" /></Field
				>
				<Field label="Priority" hint="1 (min) – 5 (urgent). Failures are sent with 4 if empty.">
					<Input bind:value={draft.config.priority} type="number" min="1" max="5" />
				</Field>
			</div>
		{:else if draft.type === 'email'}
			<div class="grid gap-4 sm:grid-cols-[1fr_8rem]">
				<Field label="SMTP host"
					><Input bind:value={draft.config.host} placeholder="smtp.example.com" /></Field
				>
				<Field label="Port"><Input bind:value={draft.config.port} type="number" /></Field>
				<Field label="Username"
					><Input bind:value={draft.config.username} autocomplete="off" /></Field
				>
				<Field label="Password"
					><Input bind:value={draft.config.password} type="password" autocomplete="off" /></Field
				>
				<Field label="From"
					><Input bind:value={draft.config.from} placeholder="Dockit <dockit@example.com>" /></Field
				>
				<div class="flex items-end pb-2">
					<Switch bind:checked={draft.config.secure} label="TLS" />
				</div>
				<Field label="To" class="sm:col-span-2" hint="Multiple addresses separated by comma"
					><Input bind:value={draft.config.to} placeholder="me@example.com" /></Field
				>
			</div>
		{:else}
			<div class="grid gap-4">
				<Field
					label="URL"
					hint="Receives a JSON POST with type, project, title, message (+ Discord/Slack compatible content/text fields)."
				>
					<Input bind:value={draft.config.url} placeholder="https://discord.com/api/webhooks/…" />
				</Field>
				<Field label="Extra headers" hint="One per line, e.g. Authorization: Bearer xyz">
					<Textarea bind:value={draft.config.headers} rows={2} mono />
				</Field>
			</div>
		{/if}

		<Field label="Send when">
			<div class="grid gap-2 sm:grid-cols-2">
				{#each EVENT_TYPES as e (e.id)}
					<label
						class="flex cursor-pointer items-start gap-2.5 rounded-lg border border-zinc-200 p-2.5 has-checked:border-primary/50 has-checked:bg-primary/5 dark:border-zinc-800"
					>
						<input
							type="checkbox"
							class="mt-0.5 size-4 accent-primary"
							checked={draft.events.includes(e.id)}
							onchange={() => toggleIn(draft.events, e.id)}
						/>
						<span>
							<span class="block text-sm font-medium">{e.label}</span>
							<span class="block text-xs text-zinc-500">{e.description}</span>
						</span>
					</label>
				{/each}
			</div>
		</Field>

		<Field label="Projects" hint="No selection = all projects">
			<div class="flex flex-wrap gap-1.5">
				{#each projectNames as p (p)}
					<button
						class={[
							'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
							draft.projects.includes(p)
								? 'border-primary bg-primary/10 text-link'
								: 'border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400'
						]}
						onclick={() => toggleIn(draft.projects, p)}>{p}</button
					>
				{/each}
			</div>
		</Field>
	</div>

	{#snippet footer()}
		<Button
			variant="ghost"
			class="mr-auto"
			onclick={() => test(draft)}
			loading={testing === (draft.id || 'draft')}><Send /> Send test</Button
		>
		<Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" onclick={save} loading={saving}>Save</Button>
	{/snippet}
</Dialog>
