import { redirect } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { ensureDb } from '#lib/server/db/index.js';
import { SESSION_COOKIE, userCount, validateSession } from '#lib/server/auth.js';
import { detectSelf } from '#lib/server/self.js';
import { checkRoot } from '#lib/server/projects.js';
import { startMonitor } from '#lib/server/monitor.js';
import { startScheduler } from '#lib/server/scheduler.js';

export const init: ServerInit = async () => {
	if (building) return;
	checkRoot();
	await ensureDb();
	await detectSelf().catch((e) => console.error('[dockit] self detection failed', e));
	startMonitor();
	startScheduler();
};

const PUBLIC = ['/login', '/setup'];

export const handle: Handle = async ({ event, resolve }) => {
	await ensureDb();
	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.user = token ? await validateSession(token) : null;

	// page guards (remote functions check auth themselves)
	if (!event.isRemoteRequest && !event.url.pathname.startsWith('/_app')) {
		const path = event.url.pathname;
		const isPublic = PUBLIC.some((p) => path === p || path.startsWith(`${p}/`));
		if (!event.locals.user) {
			const needsSetup = (await userCount()) === 0;
			if (needsSetup && path !== '/setup') redirect(303, '/setup');
			if (!needsSetup && path === '/setup') redirect(303, '/login');
			if (!isPublic) redirect(303, '/login');
		} else if (isPublic) {
			redirect(303, '/');
		} else if (path.startsWith('/settings') && event.locals.user.role !== 'admin') {
			redirect(303, '/');
		}
	}

	return resolve(event);
};
