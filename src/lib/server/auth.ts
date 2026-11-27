import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { error, redirect } from '@sveltejs/kit';
import { count, eq, sql } from 'drizzle-orm';
import { getRequestEvent } from '$app/server';
import { db } from './db';
import { session, user } from './db/schema';
import { hasTotp } from './totp';

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

/** Re-authentication, e.g. before turning off two-factor auth. */
export async function checkUserPassword(userId: string, password: string) {
	const [found] = await db
		.select({ passwordHash: user.passwordHash })
		.from(user)
		.where(eq(user.id, userId));
	return !!found && (await verifyPassword(password, found.passwordHash));
}

/**
 * A login runs through stages; only `full` sessions are logged in. Every other
 * stage is limited to its own page and expires quickly.
 */
const STAGES = {
	full: { ttl: SESSION_DAYS * 864e5, route: null },
	/** password ok, second factor missing */
	mfa: { ttl: 5 * 6e4, route: '/login/verify' }
} as const;
type SessionStage = keyof typeof STAGES;

export const stageRoute = (stage: SessionStage | undefined) => (stage ? STAGES[stage].route : null);
export const STAGE_PATHS: string[] = Object.values(STAGES).flatMap((s) => s.route ?? []);

/** wrong second-factor codes before the password has to be entered again */
const MFA_MAX_ATTEMPTS = 5;

function setCookie(token: string, stage: SessionStage, expiresAt: Date) {
	const { cookies, url } = getRequestEvent();
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		// pending logins only live as long as the browser session
		expires: stage === 'full' ? expiresAt : undefined
	});
}

const currentSessionId = () => {
	const token = getRequestEvent().cookies.get(SESSION_COOKIE);
	return token ? hashToken(token) : null;
};

async function createSession(userId: string, stage: SessionStage) {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + STAGES[stage].ttl);
	await db.insert(session).values({ id: hashToken(token), userId, expiresAt, stage });
	setCookie(token, stage, expiresAt);
}

/**
 * Every login method ends here once the user is identified: either a full
 * session, or a pending one when a second factor is still needed.
 * Returns where to go next.
 */
export async function startLogin(userId: string) {
	const stage: SessionStage = (await hasTotp(userId)) ? 'mfa' : 'full';
	await createSession(userId, stage);
	return STAGES[stage].route ?? '/';
}

/** Turns the pending session into a full one (with a new token). */
export async function upgradeSession() {
	const oldId = currentSessionId();
	if (!oldId) return;
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + STAGES.full.ttl);
	await db
		.update(session)
		.set({ id: hashToken(token), stage: 'full', expiresAt, mfaFailures: 0 })
		.where(eq(session.id, oldId));
	setCookie(token, 'full', expiresAt);
}

/** Counts a wrong second-factor code. Ends the pending login once the limit is reached. */
export async function recordMfaFailure() {
	const id = currentSessionId();
	if (!id) return false;
	const [row] = await db
		.update(session)
		.set({ mfaFailures: sql`${session.mfaFailures} + 1` })
		.where(eq(session.id, id))
		.returning({ n: session.mfaFailures });
	if (row && row.n < MFA_MAX_ATTEMPTS) return true;
	await destroySession();
	return false;
}

export async function validateSession(
	token: string
): Promise<{ user: SessionUser; stage: SessionStage } | null> {
	const id = hashToken(token);
	const [row] = await db
		.select({
			id: user.id,
			username: user.username,
			role: user.role,
			expiresAt: session.expiresAt,
			stage: session.stage
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
	if (row.stage === 'full' && row.expiresAt.getTime() - Date.now() < STAGES.full.ttl / 2) {
		await db
			.update(session)
			.set({ expiresAt: new Date(Date.now() + STAGES.full.ttl) })
			.where(eq(session.id, id));
	}
	return { user: { id: row.id, username: row.username, role: row.role }, stage: row.stage };
}

export async function destroySession() {
	const id = currentSessionId();
	if (id) await db.delete(session).where(eq(session.id, id));
	getRequestEvent().cookies.delete(SESSION_COOKIE, { path: '/' });
}

/** The user of a pending login in the given stage; otherwise back to the login page. */
export function requireStage(stage: Exclude<SessionStage, 'full'>): SessionUser {
	const current = getRequestEvent().locals.session;
	if (current?.stage !== stage) redirect(303, '/login');
	return current.user;
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
