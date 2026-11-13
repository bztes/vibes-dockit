export function bytes(n: number) {
	if (!n) return '0 B';
	const u = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1000)));
	return `${(n / 1000 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function ago(date: Date | string | number | null | undefined) {
	if (!date) return 'never';
	const d = new Date(date).getTime();
	const s = Math.round((d - Date.now()) / 1000);
	const abs = Math.abs(s);
	if (abs < 60) return rtf.format(s, 'second');
	if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
	if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
	if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
	return new Date(d).toLocaleDateString();
}

export function shortId(id: string) {
	return id.replace(/^sha256:/, '').slice(0, 12);
}
