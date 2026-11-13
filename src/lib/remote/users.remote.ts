import * as v from 'valibot';
import { error, invalid } from '@sveltejs/kit';
import { asc, count, eq } from 'drizzle-orm';
import { command, form, query } from '$app/server';
import { db } from '#lib/server/db/index.js';
import { session, user } from '#lib/server/db/schema.js';
import { hashPassword, requireAdmin } from '#lib/server/auth.js';

export const listUsers = query(async () => {
	requireAdmin();
	return db
		.select({ id: user.id, username: user.username, role: user.role, createdAt: user.createdAt })
		.from(user)
		.orderBy(asc(user.createdAt));
});

export const createUser = form(
	v.object({
		username: v.pipe(
			v.string(),
			v.trim(),
			v.toLowerCase(),
			v.minLength(3, 'At least 3 characters'),
			v.regex(/^[a-z0-9._-]+$/, 'Only letters, numbers, . _ and -')
		),
		_password: v.pipe(v.string(), v.minLength(8, 'At least 8 characters')),
		role: v.picklist(['admin', 'user'])
	}),
	async (data, issue) => {
		requireAdmin();
		const [exists] = await db.select().from(user).where(eq(user.username, data.username));
		if (exists) invalid(issue.username('Username already taken'));
		await db.insert(user).values({
			username: data.username,
			passwordHash: await hashPassword(data._password),
			role: data.role
		});
		void listUsers().refresh();
		return { created: data.username };
	}
);

async function adminCount() {
	const [row] = await db.select({ n: count() }).from(user).where(eq(user.role, 'admin'));
	return row.n;
}

export const deleteUser = command(v.string(), async (id) => {
	const me = requireAdmin();
	if (id === me.id) error(400, 'You cannot delete yourself');
	await db.delete(user).where(eq(user.id, id));
	void listUsers().refresh();
});

export const setRole = command(
	v.object({ id: v.string(), role: v.picklist(['admin', 'user']) }),
	async ({ id, role }) => {
		const me = requireAdmin();
		if (id === me.id && role !== 'admin' && (await adminCount()) <= 1) {
			error(400, 'There has to be at least one admin');
		}
		await db.update(user).set({ role }).where(eq(user.id, id));
		void listUsers().refresh();
	}
);

export const resetPassword = command(
	v.object({ id: v.string(), password: v.pipe(v.string(), v.minLength(8)) }),
	async ({ id, password }) => {
		requireAdmin();
		await db
			.update(user)
			.set({ passwordHash: await hashPassword(password) })
			.where(eq(user.id, id));
		await db.delete(session).where(eq(session.userId, id));
	}
);
