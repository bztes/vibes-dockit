import * as v from 'valibot';
import { error, invalid, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { form, getRequestEvent, query } from '$app/server';
import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema.js';
import {
	createSession,
	destroySession,
	hashPassword,
	requireUser,
	userCount,
	verifyPassword
} from '#lib/server/auth.js';

const username = v.pipe(
	v.string(),
	v.trim(),
	v.toLowerCase(),
	v.minLength(3, 'At least 3 characters'),
	v.maxLength(32, 'At most 32 characters'),
	v.regex(/^[a-z0-9._-]+$/, 'Only letters, numbers, . _ and -')
);
const password = v.pipe(v.string(), v.minLength(8, 'At least 8 characters'));

export const getMe = query(async () => {
	return getRequestEvent().locals.user;
});

export const setup = form(
	v.object({ username, _password: password, _confirm: v.string() }),
	async (data, issue) => {
		if ((await userCount()) > 0) error(403, 'Signup is closed');
		if (data._password !== data._confirm) invalid(issue._confirm('Passwords do not match'));
		const [created] = await db
			.insert(user)
			.values({
				username: data.username,
				passwordHash: await hashPassword(data._password),
				role: 'admin'
			})
			.returning();
		const event = getRequestEvent();
		await createSession(event.cookies, created.id, event.url.protocol === 'https:');
		redirect(303, '/');
	}
);

export const login = form(
	v.object({ username: v.pipe(v.string(), v.trim(), v.toLowerCase()), _password: v.string() }),
	async (data) => {
		const [found] = await db.select().from(user).where(eq(user.username, data.username));
		const ok = found ? await verifyPassword(data._password, found.passwordHash) : false;
		if (!found || !ok) {
			await new Promise((r) => setTimeout(r, 500));
			invalid('Wrong username or password');
		}
		const event = getRequestEvent();
		await createSession(event.cookies, found.id, event.url.protocol === 'https:');
		redirect(303, '/');
	}
);

export const logout = form(async () => {
	await destroySession(getRequestEvent().cookies);
	redirect(303, '/login');
});

export const changePassword = form(
	v.object({ _current: v.string(), _new: password, _confirm: v.string() }),
	async (data, issue) => {
		const me = requireUser();
		const [found] = await db.select().from(user).where(eq(user.id, me.id));
		if (!found || !(await verifyPassword(data._current, found.passwordHash))) {
			invalid(issue._current('Current password is wrong'));
		}
		if (data._new !== data._confirm) invalid(issue._confirm('Passwords do not match'));
		await db
			.update(user)
			.set({ passwordHash: await hashPassword(data._new) })
			.where(eq(user.id, me.id));
		return { success: true };
	}
);
