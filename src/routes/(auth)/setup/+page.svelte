<script lang="ts">
	import { Rocket } from '@lucide/svelte';
	import { setup } from '#lib/remote/auth.remote.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';
</script>

<svelte:head><title>Setup · Dockit</title></svelte:head>

<h1 class="text-lg font-semibold">Create the admin account</h1>
<p class="mt-1 mb-6 text-sm text-zinc-500">
	This is the first start of Dockit. After this account is created, signup is closed — further users
	can be added by an admin.
</p>

<form {...setup} class="grid gap-4">
	<Field label="Username" issues={setup.fields.username.issues()}>
		<Input {...setup.fields.username.as('text')} autocomplete="username" required />
	</Field>
	<Field label="Password" issues={setup.fields._password.issues()} hint="At least 8 characters">
		<Input {...setup.fields._password.as('password')} autocomplete="new-password" required />
	</Field>
	<Field label="Confirm password" issues={setup.fields._confirm.issues()}>
		<Input {...setup.fields._confirm.as('password')} autocomplete="new-password" required />
	</Field>
	<Button type="submit" variant="primary" class="mt-2 w-full" loading={!!setup.pending}>
		<Rocket /> Create account
	</Button>
</form>
