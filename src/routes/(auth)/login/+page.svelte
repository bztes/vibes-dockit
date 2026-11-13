<script lang="ts">
	import { LogIn } from '@lucide/svelte';
	import { login } from '#lib/remote/auth.remote.js';
	import Button from '#lib/components/ui/Button.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';
</script>

<svelte:head><title>Sign in · Dockit</title></svelte:head>

<h1 class="text-lg font-semibold">Welcome back</h1>
<p class="mt-1 mb-6 text-sm text-zinc-500">Sign in to manage your containers.</p>

<form {...login} class="grid gap-4">
	<Field label="Username" issues={login.fields.username.issues()}>
		<Input {...login.fields.username.as('text')} autocomplete="username" required />
	</Field>
	<Field label="Password" issues={login.fields._password.issues()}>
		<Input {...login.fields._password.as('password')} autocomplete="current-password" required />
	</Field>
	{#each login.fields.allIssues()?.filter((i) => !i.path?.length) ?? [] as issue (issue.message)}
		<p
			class="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
		>
			{issue.message}
		</p>
	{/each}
	<Button type="submit" variant="primary" class="mt-2 w-full" loading={!!login.pending}>
		<LogIn /> Sign in
	</Button>
</form>
