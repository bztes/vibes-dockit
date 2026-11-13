export type ToastTone = 'success' | 'error' | 'info';

interface Toast {
	id: number;
	tone: ToastTone;
	title: string;
	description?: string;
}

let next = 0;
export const toasts = $state<Toast[]>([]);

function push(tone: ToastTone, title: string, description?: string) {
	const id = next++;
	toasts.push({ id, tone, title, description });
	setTimeout(() => dismiss(id), tone === 'error' ? 8000 : 4000);
}

export function dismiss(id: number) {
	const i = toasts.findIndex((t) => t.id === id);
	if (i !== -1) toasts.splice(i, 1);
}

export function errorMessage(e: unknown) {
	if (e && typeof e === 'object') {
		const body = (e as { body?: { message?: string } }).body;
		if (body?.message) return body.message;
		if ('message' in e && typeof e.message === 'string') return e.message;
	}
	return String(e);
}

export const toast = {
	success: (title: string, description?: string) => push('success', title, description),
	info: (title: string, description?: string) => push('info', title, description),
	error: (title: string, e?: unknown) =>
		push('error', title, e === undefined ? undefined : typeof e === 'string' ? e : errorMessage(e))
};
