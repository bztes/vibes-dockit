<script lang="ts">
	interface Props {
		text: string;
		class?: string;
		follow?: boolean;
	}
	let { text, class: className, follow = true }: Props = $props();

	let el: HTMLPreElement;

	const COLORS: Record<string, string> = {
		'2': 'opacity-60',
		'31': 'text-red-400',
		'32': 'text-emerald-400',
		'33': 'text-amber-300',
		'34': 'text-sky-400',
		'35': 'text-fuchsia-400',
		'36': 'text-cyan-300'
	};

	const segments = $derived.by(() => {
		const out: { text: string; cls: string }[] = [];
		let cls = '';
		// eslint-disable-next-line no-control-regex
		const re = /\x1b\[([0-9;]*)m/g;
		let last = 0;
		const clean = text.replace(/\r(?!\n)/g, '\n');
		for (const m of clean.matchAll(re)) {
			if (m.index! > last) out.push({ text: clean.slice(last, m.index), cls });
			const codes = m[1].split(';');
			cls = codes.includes('0') || m[1] === '' ? '' : codes.map((c) => COLORS[c] ?? '').join(' ');
			last = m.index! + m[0].length;
		}
		if (last < clean.length) out.push({ text: clean.slice(last), cls });
		return out;
	});

	let pinned = true;
	$effect(() => {
		void segments;
		if (follow && pinned && el) el.scrollTop = el.scrollHeight;
	});
</script>

<pre
	bind:this={el}
	onscroll={() => (pinned = el.scrollTop + el.clientHeight >= el.scrollHeight - 24)}
	class={[
		'scrollbar-thin overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-zinc-300',
		className
	]}>{#each segments as s, i (i)}<span class={s.cls}>{s.text}</span>{/each}</pre>
