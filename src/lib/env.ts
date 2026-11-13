export interface EnvEntry {
	key: string;
	value: string;
	/** marked with `# dockit:secret` – never sent to the browser */
	secret: boolean;
}

/** Comment line placed directly above a variable to mark it as secret. */
export const SECRET_MARK = '# dockit:secret';
/** Placeholder that replaces secret values outside the server. */
export const SECRET_MASK = '********';

const VAR_RE = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_.-]*)(\s*=\s*)(.*)$/;

function unquote(value: string) {
	if (/^".*"$/.test(value)) return value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
	if (/^'.*'$/.test(value)) return value.slice(1, -1);
	return value.replace(/\s+#.*$/, '');
}

const isMark = (line: string) => line.trim() === SECRET_MARK;

/** Parses a dotenv file. Comments (except secret markers) and blank lines are dropped. */
export function parseEnv(source: string): EnvEntry[] {
	const out: EnvEntry[] = [];
	let secret = false;
	for (const raw of source.split('\n')) {
		if (isMark(raw)) {
			secret = true;
			continue;
		}
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		const m = line.match(VAR_RE);
		if (!m) continue;
		out.push({ key: m[2], value: unquote(m[4]), secret });
		secret = false;
	}
	return out;
}

function quote(value: string) {
	if (value === '') return '';
	if (/^[A-Za-z0-9_./:@%+,-]*$/.test(value)) return value;
	if (value === SECRET_MASK) return value;
	if (!value.includes("'") && !value.includes('\n')) return `'${value}'`;
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function serializeEnv(entries: EnvEntry[]) {
	return entries
		.filter((e) => e.key.trim())
		.map((e) => `${e.secret ? `${SECRET_MARK}\n` : ''}${e.key.trim()}=${quote(e.value)}`)
		.join('\n');
}

/** true if the source contains comments other than secret markers */
export function hasPlainComments(source: string) {
	return source.split('\n').some((l) => l.trim().startsWith('#') && !isMark(l));
}

interface EnvLine {
	raw: string;
	key: string | null;
	/** raw value part (with quotes) */
	value: string;
	secret: boolean;
	prefix: string;
}

/** Line-based view that keeps comments and formatting intact. */
function lines(source: string): EnvLine[] {
	let secret = false;
	return source.split('\n').map((raw) => {
		if (isMark(raw)) {
			secret = true;
			return { raw, key: null, value: '', secret: false, prefix: '' };
		}
		const m = raw.match(VAR_RE);
		if (!m || raw.trim().startsWith('#')) {
			return { raw, key: null, value: '', secret: false, prefix: '' };
		}
		const line = { raw, key: m[2], value: m[4], secret, prefix: m[1] + m[2] + m[3] };
		secret = false;
		return line;
	});
}

/** Replaces the values of secret variables with the mask. Use before sending to the browser. */
export function maskEnv(source: string) {
	return lines(source)
		.map((l) => (l.key && l.secret ? l.prefix + SECRET_MASK : l.raw))
		.join('\n');
}

/**
 * Puts the stored values of secrets back where the browser sent the mask.
 * Returns the keys that are masked but have no stored value.
 */
export function unmaskEnv(incoming: string, stored: string) {
	const storedSecrets = new Map(
		lines(stored)
			.filter((l) => l.key && l.secret)
			.map((l) => [l.key!, l.value])
	);
	const missing: string[] = [];
	const env = lines(incoming)
		.map((l) => {
			if (!l.key || unquote(l.value.trim()) !== SECRET_MASK) return l.raw;
			const original = storedSecrets.get(l.key);
			if (original === undefined) {
				if (l.secret) missing.push(l.key);
				return l.raw;
			}
			return l.prefix + original;
		})
		.join('\n');
	return { env, missing };
}
