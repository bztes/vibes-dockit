// See https://svelte.dev/docs/kit/types#app.d.ts
import type { SessionUser } from '#lib/server/auth.js';

declare global {
	/** Dockit's version from package.json, injected at build time. */
	const __DOCKIT_VERSION__: string;

	namespace App {
		interface Locals {
			user: SessionUser | null;
		}
	}
}

export {};
