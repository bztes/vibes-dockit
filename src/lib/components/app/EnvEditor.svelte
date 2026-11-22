<script lang="ts">
	import { SECRET_MARK, SECRET_MASK } from '#lib/env.js';
	import CodeEditor from '#lib/components/ui/CodeEditor.svelte';

	let { value = $bindable(''), onsave }: { value: string; onsave?: () => void } = $props();
</script>

<div class="grid gap-2">
	<CodeEditor
		bind:value
		language="env"
		minLines={8}
		placeholder={`# database\nDB_USER=app\n\n${SECRET_MARK}\nDB_PASSWORD=change-me`}
		{onsave}
	/>
	<p class="text-xs text-zinc-500">
		Put <code class="font-mono">{SECRET_MARK}</code> on the line above a variable to make it a
		secret: stored, but never shown again. Leave <code class="font-mono">{SECRET_MASK}</code> as is
		to keep the stored value.
	</p>
</div>
