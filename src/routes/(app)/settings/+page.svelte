<script lang="ts">
	import { KeyRound, Save, ShieldCheck, Trash2, UserPlus } from '@lucide/svelte';
	import { getMe } from '#lib/remote/auth.remote.js';
	import { getSettings, saveSettings } from '#lib/remote/settings.remote.js';
	import {
		createUser,
		deleteUser,
		listUsers,
		resetPassword,
		setRole
	} from '#lib/remote/users.remote.js';
	import { getSystemInfo } from '#lib/remote/projects.remote.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import Select from '#lib/components/ui/Select.svelte';
	import Switch from '#lib/components/ui/Switch.svelte';
	import CaddySetup from '#lib/components/app/CaddySetup.svelte';
	import { confirm } from '#lib/components/ui/confirm.svelte.js';
	import { toast } from '#lib/components/ui/toast.svelte.js';
	import { ago } from '#lib/format.js';

	const me = $derived(await getMe());
	const settings = $derived(await getSettings());
	const users = $derived(await listUsers());
	const info = $derived(await getSystemInfo());

	let resetFor = $state<{ id: string; username: string } | null>(null);
	let resetOpen = $state(false);
	let newPassword = $state('');

	async function changeRole(id: string, role: 'admin' | 'user') {
		try {
			await setRole({ id, role });
			toast.success('Role updated');
		} catch (e) {
			toast.error('Could not change role', e);
		}
	}

	async function remove(id: string, username: string) {
		if (!(await confirm({ title: `Delete ${username}?`, confirmLabel: 'Delete', danger: true })))
			return;
		try {
			await deleteUser(id);
			toast.success('User deleted');
		} catch (e) {
			toast.error('Could not delete user', e);
		}
	}

	async function doReset() {
		if (!resetFor) return;
		try {
			await resetPassword({ id: resetFor.id, password: newPassword });
			toast.success(`Password of ${resetFor.username} changed`);
			resetOpen = false;
			newPassword = '';
		} catch (e) {
			toast.error('Could not reset password', e);
		}
	}
</script>

<svelte:head><title>Settings · Dockit</title></svelte:head>

<h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
<p class="mt-1 text-sm text-zinc-500">
	Stored in <code class="font-mono text-xs">config.json</code> in the data folder — not in the database.
</p>

<div class="mt-8 grid gap-6">
	<Card title="General">
		<form
			{...saveSettings.enhance(async ({ submit }) => {
				if (await submit()) toast.success('Settings saved');
			})}
			class="grid gap-5"
		>
			<div class="grid gap-1.5 text-sm">
				<p class="font-medium">Projects folder</p>
				<code class="font-mono text-xs">{settings.projectsRoot}</code>
				<p class="text-xs text-zinc-500">
					Set with the <code class="font-mono">PROJECTS_ROOT</code> environment variable. Every sub folder
					with a compose file is a project.
				</p>
			</div>
			<div class="grid gap-5 sm:grid-cols-2">
				<Field
					label="Update check interval (hours)"
					hint="0 disables the scheduled check{settings.lastFullCheck
						? ` · last check ${ago(settings.lastFullCheck)}`
						: ''}"
					issues={saveSettings.fields.updateCheckIntervalHours.issues()}
				>
					<Input
						{...saveSettings.fields.updateCheckIntervalHours.as(
							'number',
							settings.updateCheckIntervalHours
						)}
						min="0"
						step="1"
					/>
				</Field>
			</div>
			<Switch
				{...saveSettings.fields.pruneImagesAfterUpdate.as(
					'checkbox',
					settings.pruneImagesAfterUpdate
				)}
				label="Remove old images after updates"
				description="Deletes the previous image version once the update succeeded and nothing uses it anymore."
			/>
			<div class="flex justify-end border-t border-zinc-100 pt-4 dark:border-zinc-800/60">
				<Button type="submit" variant="primary" loading={!!saveSettings.pending}
					><Save /> Save settings</Button
				>
			</div>
		</form>
	</Card>

	<Card
		title="Reverse proxy"
		description="Dockit uses a running caddy-docker-proxy container automatically. Domains are set per project."
	>
		<CaddySetup />
	</Card>

	<Card title="Users" description="Signup is closed — new users can only be created here." flush>
		<div class="divide-y divide-zinc-100 dark:divide-zinc-800/60">
			{#each users as u (u.id)}
				<div class="flex flex-wrap items-center gap-3 px-5 py-3">
					<div
						class="grid size-8 place-items-center rounded-full bg-zinc-100 text-xs font-semibold uppercase dark:bg-zinc-800"
					>
						{u.username.slice(0, 2)}
					</div>
					<div class="min-w-0 flex-1">
						<p class="text-sm font-medium">
							{u.username}
							{#if u.id === me?.id}<span class="text-zinc-500">(you)</span>{/if}
						</p>
						<p class="text-xs text-zinc-500">created {ago(u.createdAt)}</p>
					</div>
					<div class="w-28">
						<Select
							size="sm"
							value={u.role}
							onchange={(e) => changeRole(u.id, e.currentTarget.value as 'admin' | 'user')}
						>
							<option value="admin">Admin</option>
							<option value="user">User</option>
						</Select>
					</div>
					<Button
						size="icon-sm"
						variant="ghost"
						title="Set password"
						onclick={() => ((resetFor = u), (resetOpen = true))}><KeyRound /></Button
					>
					<Button
						size="icon-sm"
						variant="danger-ghost"
						title="Delete user"
						disabled={u.id === me?.id}
						onclick={() => remove(u.id, u.username)}><Trash2 /></Button
					>
				</div>
			{/each}
		</div>
		<form
			{...createUser.enhance(async ({ element, submit }) => {
				if (await submit()) {
					element.reset();
					toast.success('User created');
				}
			})}
			class="grid items-start gap-3 border-t border-zinc-200 bg-zinc-50/50 p-5 sm:grid-cols-[1fr_1fr_8rem_auto] dark:border-zinc-800 dark:bg-zinc-900/30"
		>
			<Field issues={createUser.fields.username.issues()}>
				<Input
					{...createUser.fields.username.as('text')}
					placeholder="Username"
					size="sm"
					autocomplete="off"
				/>
			</Field>
			<Field issues={createUser.fields._password.issues()}>
				<Input
					{...createUser.fields._password.as('password')}
					placeholder="Password"
					size="sm"
					autocomplete="new-password"
				/>
			</Field>
			<Select {...createUser.fields.role.as('select')} size="sm">
				<option value="user">User</option>
				<option value="admin">Admin</option>
			</Select>
			<Button type="submit" size="sm" variant="secondary" loading={!!createUser.pending}
				><UserPlus /> Add user</Button
			>
		</form>
	</Card>

	<Card title="System">
		<dl class="grid gap-4 text-sm sm:grid-cols-4">
			<div>
				<dt class="text-xs text-zinc-500">Docker engine</dt>
				<dd class="mt-0.5 font-medium">
					{#if info.dockerOk}{info.version.server}{:else}<Badge tone="danger">not reachable</Badge
						>{/if}
				</dd>
			</div>
			<div>
				<dt class="text-xs text-zinc-500">Compose</dt>
				<dd class="mt-0.5 font-medium">{info.version.compose || '—'}</dd>
			</div>
			<div>
				<dt class="text-xs text-zinc-500">Containers</dt>
				<dd class="mt-0.5 font-medium">{info.running} running / {info.containers}</dd>
			</div>
			<div>
				<dt class="text-xs text-zinc-500">Dockit project</dt>
				<dd class="mt-0.5 font-medium">
					{#if info.self}<span class="inline-flex items-center gap-1"
							><ShieldCheck class="size-4 text-emerald-500" />{info.self}</span
						>{:else}<span class="text-zinc-500">not running in docker</span>{/if}
				</dd>
			</div>
		</dl>
		{#if info.dockerError}
			<pre
				class="mt-4 rounded-lg bg-red-500/5 p-3 font-mono text-xs whitespace-pre-wrap text-red-600 dark:text-red-400">{info.dockerError}</pre>
		{/if}
	</Card>
</div>

<Dialog
	bind:open={resetOpen}
	title="Set password for {resetFor?.username}"
	description="The user is signed out on all devices."
	size="sm"
>
	<Input
		bind:value={newPassword}
		type="password"
		placeholder="New password (min. 8 characters)"
		autocomplete="new-password"
	/>
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (resetOpen = false)}>Cancel</Button>
		<Button variant="primary" disabled={newPassword.length < 8} onclick={doReset}
			>Set password</Button
		>
	{/snippet}
</Dialog>
