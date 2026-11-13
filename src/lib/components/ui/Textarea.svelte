<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { input } from './variants';

	type Props = HTMLTextareaAttributes & { mono?: boolean };

	let { class: className, mono, value = $bindable(), ...rest }: Props = $props();
</script>

<textarea class={input({ mono, multiline: true, class: className as string })} bind:value {...rest}
></textarea>
