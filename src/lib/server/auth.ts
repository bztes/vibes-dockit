import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { error, redirect, type Cookies } from '@sveltejs/kit';
import { count, eq } from 'drizzle-orm';
import { getRequestEvent } from '$app/server';
import { db } from './db';
import { session, user } from './db/schema';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SESSION_COOKIE = 'dockit_session';
const SESSION_DAYS = 30;

export interface SessionUser {
	id: string;
	username: string;
	role: 'admin' | 'user';
}

export async function hashPassword(password: string) {
	const salt = randomBytes(16);
	const hash = await scrypt(password, salt, 64);
	return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string) {
	const [algo, salt, hash] = stored.split('$');
	if (algo !== 'scrypt' || !salt || !hash) return false;
	const expected = Buffer.from(hash, 'hex');
	const actual = await scrypt(password, Buffer.from(salt, 'hex'), expected.length);
	return timingSafeEqual(actual, expected);
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function userCount() {
	const [row] = await db.select({ n: count() }).from(user);
	return row?.n ?? 0;
}

export async function createSession(cookies: Cookies, userId: string, secure: boolean) {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
	await db.insert(session).values({ id: hashToken(token), userId, expiresAt });
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		expires: expiresAt
	});
}

export async function validateSession(token: string): Promise<SessionUser | null> {
	const id = hashToken(token);
	const [row] = await db
		.select({
			id: user.id,
			username: user.username,
			role: user.role,
			expiresAt: session.expiresAt
		})
		.from(session)
		.innerJoin(user, eq(session.userId, user.id))
		.where(eq(session.id, id));
	if (!row) return null;
	if (row.expiresAt.getTime() < Date.now()) {
		await db.delete(session).where(eq(session.id, id));
		return null;
	}
	// sliding expiration
	if (row.expiresAt.getTime() - Date.now() < (SESSION_DAYS / 2) * 864e5) {
		await db
			.update(session)
			.set({ expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5) })
			.where(eq(session.id, id));
	}
	return { id: row.id, username: row.username, role: row.role };
}

export async function destroySession(cookies: Cookies) {
	const token = cookies.get(SESSION_COOKIE);
	if (token) await db.delete(session).where(eq(session.id, hashToken(token)));
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** Use inside remote functions. Queries/forms redirect, commands get a 401. */
export function requireUser(): SessionUser {
	const { locals } = getRequestEvent();
	if (!locals.user) redirect(303, '/login');
	return locals.user;
}

export function requireUserCommand(): SessionUser {
	const { locals } = getRequestEvent();
	if (!locals.user) error(401, 'Not logged in');
	return locals.user;
}

export function requireAdmin(): SessionUser {
	const { locals } = getRequestEvent();
	if (!locals.user) error(401, 'Not logged in');
	if (locals.user.role !== 'admin') error(403, 'Only admins can do this');
	return locals.user;
}
