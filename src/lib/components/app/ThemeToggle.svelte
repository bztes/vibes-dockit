<script lang="ts">
	import { Moon, Sun } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import Button from '#lib/components/ui/Button.svelte';

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

<Button
	variant="ghost"
	size="icon-sm"
	onclick={toggle}
	aria-label="Toggle theme"
	title="Toggle theme"
>
	{#if dark}<Sun />{:else}<Moon />{/if}
</Button>
