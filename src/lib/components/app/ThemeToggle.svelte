<script lang="ts">
	import { Moon, Sun } from '@lucide/svelte';
	import { onMount } from 'svelte';

	let dark = $state(true);
	onMount(() => (dark = document.documentElement.classList.contains('dark')));

	function toggle() {
		dark = !dark;
		document.documentElement.classList.toggle('dark', dark);
		try {
			localStorage.setItem('dockit-theme', dark ? 'dark' : 'light');
		} catch {
			/* ignore */
		}
	}
</script>

<button
	class="grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
	onclick={toggle}
	aria-label="Toggle theme"
	title="Toggle theme"
>
	{#if dark}<Sun class="size-4" />{:else}<Moon class="size-4" />{/if}
</button>
