<script lang="ts">
	import { KeyRound } from '@lucide/svelte';
	import { changePassword, getMe } from '#lib/remote/auth.remote.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import { toast } from '#lib/components/ui/toast.svelte.js';

	const me = $derived(await getMe());
</script>

<svelte:head><title>Account · Dockit</title></svelte:head>

<h1 class="text-2xl font-semibold tracking-tight">Account</h1>
<p class="mt-1 text-sm text-zinc-500">
	Signed in as <span class="font-medium text-zinc-900 dark:text-zinc-100">{me?.username}</span>
	({me?.role})
</p>

<div class="mt-8 max-w-lg">
	<Card title="Change password">
		<form
			{...changePassword.enhance(async ({ element, submit }) => {
				if (await submit()) {
					element.reset();
					toast.success('Password changed');
				}
			})}
			class="grid gap-4"
		>
			<Field label="Current password" issues={changePassword.fields._current.issues()}>
				<Input {...changePassword.fields._current.as('password')} autocomplete="current-password" />
			</Field>
			<Field label="New password" issues={changePassword.fields._new.issues()}>
				<Input {...changePassword.fields._new.as('password')} autocomplete="new-password" />
			</Field>
			<Field label="Confirm new password" issues={changePassword.fields._confirm.issues()}>
				<Input {...changePassword.fields._confirm.as('password')} autocomplete="new-password" />
			</Field>
			<div class="flex justify-end">
				<Button type="submit" variant="primary" loading={!!changePassword.pending}
					><KeyRound /> Change password</Button
				>
			</div>
		</form>
	</Card>
</div>
