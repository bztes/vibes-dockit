const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const C = {
	comment: 'text-zinc-500 italic',
	key: 'text-sky-600 dark:text-sky-300',
	string: 'text-emerald-700 dark:text-emerald-300',
	number: 'text-amber-600 dark:text-amber-300',
	bool: 'text-violet-600 dark:text-violet-300',
	variable: 'text-pink-600 dark:text-pink-300',
	punct: 'text-zinc-400 dark:text-zinc-500'
};

const span = (cls: string, text: string) => `<span class="${cls}">${text}</span>`;

function value(text: string) {
	if (!text) return '';
	let out = esc(text);
	const trimmed = text.trim();
	if (/^(true|false|null|yes|no|on|off|~)$/i.test(trimmed)) return span(C.bool, out);
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) return span(C.number, out);
	if (/^["']/.test(trimmed)) out = span(C.string, out);
	return out.replace(/\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*/g, (m) => span(C.variable, m));
}

function splitComment(line: string): [string, string] {
	let quote: string | null = null;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (quote) {
			if (ch === quote) quote = null;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
		} else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
			return [line.slice(0, i), line.slice(i)];
		}
	}
	return [line, ''];
}

export function highlightYaml(source: string) {
	return source
		.split('\n')
		.map((line) => {
			const [code, comment] = splitComment(line);
			let html: string;
			const m = code.match(/^(\s*)(- )?([A-Za-z0-9_.\-"'/${}]+)(:)(\s|$)(.*)$/);
			if (m) {
				const [, indent, dash = '', key, colon, sp, rest] = m;
				html =
					indent +
					(dash ? span(C.punct, dash) : '') +
					span(C.key, esc(key)) +
					span(C.punct, colon) +
					sp +
					value(rest);
			} else {
				const d = code.match(/^(\s*)(- )(.*)$/);
				html = d ? d[1] + span(C.punct, d[2]) + value(d[3]) : value(code);
			}
			return html + (comment ? span(C.comment, esc(comment)) : '');
		})
		.join('\n');
}

export function highlightEnv(source: string) {
	return source
		.split('\n')
		.map((line) => {
			if (/^\s*#/.test(line)) return span(C.comment, esc(line));
			const m = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_.-]*)(\s*=)(.*)$/);
			if (!m) return esc(line);
			return esc(m[1]) + span(C.key, esc(m[2])) + span(C.punct, esc(m[3])) + value(m[4]);
		})
		.join('\n');
}
