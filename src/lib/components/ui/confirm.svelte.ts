export interface ConfirmOptions {
	title: string;
	description?: string;
	confirmLabel?: string;
	danger?: boolean;
	/** user has to type this text to confirm */
	typeToConfirm?: string;
	/** optional checkbox, its value is returned */
	checkbox?: string;
}

interface State extends ConfirmOptions {
	open: boolean;
	resolve: (value: false | { checked: boolean }) => void;
}

export const confirmState = $state<{ current: State | null }>({ current: null });

/** Shows the global confirm dialog. Resolves with `false` or `{ checked }`. */
export function confirm(options: ConfirmOptions) {
	return new Promise<false | { checked: boolean }>((resolve) => {
		confirmState.current = { ...options, open: true, resolve };
	});
}
