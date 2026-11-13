<script lang="ts">
	import { highlightEnv, highlightYaml } from './highlight';

	interface Props {
		value: string;
		language?: 'yaml' | 'env';
		placeholder?: string;
		minLines?: number;
		onsave?: () => void;
		readonly?: boolean;
		invalid?: boolean;
	}

	let {
		value = $bindable(''),
		language = 'yaml',
		placeholder,
		minLines = 20,
		onsave,
		readonly = false,
		invalid = false
	}: Props = $props();

	let pre: HTMLPreElement;
	let gutter: HTMLDivElement;

	const lines = $derived(Math.max(value.split('\n').length, minLines));
	const html = $derived((language === 'yaml' ? highlightYaml(value) : highlightEnv(value)) + '\n');

	function sync(e: Event) {
		const t = e.currentTarget as HTMLTextAreaElement;
		pre.scrollTop = t.scrollTop;
		pre.scrollLeft = t.scrollLeft;
		gutter.scrollTop = t.scrollTop;
	}

	function keydown(e: KeyboardEvent) {
		const t = e.currentTarget as HTMLTextAreaElement;
		if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			e.preventDefault();
			onsave?.();
			return;
		}
		if (e.key === 'Tab' && !readonly) {
			e.preventDefault();
			const { selectionStart: s, selectionEnd: end } = t;
			if (e.shiftKey) {
				const lineStart = value.lastIndexOf('\n', s - 1) + 1;
				if (value.slice(lineStart, lineStart + 2) === '  ') {
					value = value.slice(0, lineStart) + value.slice(lineStart + 2);
					requestAnimationFrame(() => t.setSelectionRange(Math.max(lineStart, s - 2), end - 2));
				}
				return;
			}
			value = value.slice(0, s) + '  ' + value.slice(end);
			requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2));
		}
		if (e.key === 'Enter' && !readonly) {
			// keep indentation
			const s = t.selectionStart;
			const lineStart = value.lastIndexOf('\n', s - 1) + 1;
			const line = value.slice(lineStart, s);
			let indent = line.match(/^\s*/)?.[0] ?? '';
			if (language === 'yaml' && /:\s*$/.test(line)) indent += '  ';
			if (indent) {
				e.preventDefault();
				value = value.slice(0, s) + '\n' + indent + value.slice(t.selectionEnd);
				requestAnimationFrame(() =>
					t.setSelectionRange(s + 1 + indent.length, s + 1 + indent.length)
				);
			}
		}
	}
</script>

<div
	class={[
		'flex overflow-hidden rounded-xl border bg-zinc-50 font-mono text-[13px] leading-6 shadow-xs dark:bg-zinc-950',
		invalid ? 'border-red-500/70' : 'border-zinc-200 focus-within:border-ring dark:border-zinc-800'
	]}
	style:height="{Math.min(lines, 40) * 24 + 24}px"
>
	<div
		bind:this={gutter}
		class="w-12 shrink-0 overflow-hidden border-r border-zinc-200 bg-zinc-100/60 py-3 pr-3 text-right text-zinc-400 select-none dark:border-zinc-800/80 dark:bg-zinc-900/50 dark:text-zinc-600"
		aria-hidden="true"
	>
		{#each { length: lines }, i (i)}
			<div>{i + 1}</div>
		{/each}
		<div class="h-6"></div>
	</div>
	<div class="relative min-w-0 flex-1">
		<pre
			bind:this={pre}
			aria-hidden="true"
			class="pointer-events-none absolute inset-0 m-0 overflow-hidden px-4 py-3 whitespace-pre text-zinc-800 dark:text-zinc-200">{@html html}</pre>
		<textarea
			bind:value
			{placeholder}
			{readonly}
			spellcheck="false"
			autocapitalize="off"
			autocomplete="off"
			wrap="off"
			class="absolute inset-0 resize-none scrollbar-thin overflow-auto bg-transparent px-4 py-3 whitespace-pre text-transparent caret-zinc-900 outline-none placeholder:text-zinc-400 dark:caret-zinc-100 dark:placeholder:text-zinc-600"
			onscroll={sync}
			onkeydown={keydown}></textarea>
	</div>
</div>
