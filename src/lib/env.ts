/** Comment line placed directly above a variable to mark it as secret (env-spec `@sensitive`). */
export const SECRET_MARK = '# @sensitive';
/** Placeholder that replaces secret values outside the server. */
export const SECRET_MASK = '********';

const VAR_RE = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_.-]*)(\s*=\s*)(.*)$/;

/** Drops a trailing comment and one pair of surrounding quotes. */
const unquote = (value: string) => value.replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2');

const isMark = (line: string) => line.trim() === SECRET_MARK;

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
		const m = !raw.trim().startsWith('#') && raw.match(VAR_RE);
		if (m) {
			const line = { raw, key: m[2], value: m[4], secret, prefix: m[1] + m[2] + m[3] };
			secret = false;
			return line;
		}
		if (isMark(raw)) secret = true;
		return { raw, key: null, value: '', secret: false, prefix: '' };
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
 * A secret that kept the mask but lost its mark gets the mark back.
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
			// the mark was removed but the value kept: put the mark back so it stays secret
			return (l.secret ? '' : `${SECRET_MARK}\n`) + l.prefix + original;
		})
		.join('\n');
	return { env, missing };
}
