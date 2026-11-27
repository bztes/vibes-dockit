import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { renderSVG } from 'uqr';
import { db } from './db';
import { credential, type RecoveryData, type TotpData } from './db/schema';

/** RFC 6238 TOTP: SHA-1, 6 digits, 30 s steps (what every authenticator app supports). */
const STEP = 30;
const DIGITS = 6;
/** accept the previous and next code too (clock drift) */
const WINDOW = 1;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer) {
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of buf) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += B32[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += B32[(value << (5 - bits)) & 31];
	return out;
}

export function base32Decode(str: string) {
	const clean = str.toUpperCase().replace(/[\s=-]/g, '');
	let bits = 0;
	let value = 0;
	const out: number[] = [];
	for (const char of clean) {
		const idx = B32.indexOf(char);
		if (idx === -1) throw new Error('Invalid base32');
		value = (value << 5) | idx;
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}
	return Buffer.from(out);
}

export function codeAt(secret: Buffer, step: number, digits = DIGITS) {
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(step));
	const hmac = createHmac('sha1', secret).update(counter).digest();
	const offset = hmac[hmac.length - 1] & 15;
	const bin = hmac.readUInt32BE(offset) & 0x7fffffff;
	return String(bin % 10 ** digits).padStart(digits, '0');
}

const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP);

/**
 * Returns the matched time step, or null. Steps `<= lastStep` are rejected so a
 * code can't be used twice.
 */
export function verifyCode(secret: string, code: string, lastStep = -1, now = Date.now()) {
	const clean = code.replace(/\s/g, '');
	if (clean.length !== DIGITS || !/^\d+$/.test(clean)) return null;
	const key = base32Decode(secret);
	const step = currentStep(now);
	for (let s = step - WINDOW; s <= step + WINDOW; s++) {
		if (s <= lastStep) continue;
		if (timingSafeEqual(Buffer.from(codeAt(key, s)), Buffer.from(clean))) return s;
	}
	return null;
}

export function otpauthUri(secret: string, account: string, issuer = 'Dockit') {
	const label = encodeURIComponent(`${issuer}:${account}`);
	const params = new URLSearchParams({
		secret,
		issuer,
		algorithm: 'SHA1',
		digits: String(DIGITS),
		period: String(STEP)
	});
	return `otpauth://totp/${label}?${params}`;
}

export const qrSvg = (text: string) => renderSVG(text, { border: 1 });

// --- recovery codes -------------------------------------------------------

const RECOVERY_COUNT = 10;
const hashCode = (code: string) =>
	createHash('sha256')
		.update(code.toLowerCase().replace(/[^a-z0-9]/g, ''))
		.digest('hex');

export function generateRecoveryCodes() {
	return Array.from({ length: RECOVERY_COUNT }, () => {
		const raw = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
		return `${raw.slice(0, 5)}-${raw.slice(5)}`;
	});
}

// --- persistence ----------------------------------------------------------

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CredentialType = (typeof credential.$inferSelect)['type'];

const byType = (userId: string, type: CredentialType) =>
	and(eq(credential.userId, userId), eq(credential.type, type));

async function getTotp(userId: string, type: 'totp' | 'totp_pending' = 'totp') {
	const [row] = await db.select().from(credential).where(byType(userId, type));
	return row ? { id: row.id, ...(row.data as TotpData) } : null;
}

/** Stores the used time step (no replays) and activates a pending secret. */
const markUsed = (q: Tx | typeof db, id: string, secret: string, step: number) =>
	q
		.update(credential)
		.set({ type: 'totp', data: { secret, lastStep: step }, lastUsedAt: new Date() })
		.where(eq(credential.id, id));

export async function hasTotp(userId: string) {
	const [row] = await db
		.select({ id: credential.id })
		.from(credential)
		.where(byType(userId, 'totp'))
		.limit(1);
	return !!row;
}

export async function usersWithTotp() {
	const rows = await db
		.select({ userId: credential.userId })
		.from(credential)
		.where(eq(credential.type, 'totp'));
	return new Set(rows.map((r) => r.userId));
}

export async function totpStatus(userId: string) {
	const rows = await db
		.select({ type: credential.type })
		.from(credential)
		.where(eq(credential.userId, userId));
	return {
		totp: rows.some((r) => r.type === 'totp'),
		recoveryCodes: rows.filter((r) => r.type === 'recovery').length
	};
}

/** Starts (or restarts) setup. TOTP stays inactive until `confirmTotp`. */
export async function beginTotp(userId: string) {
	if (await hasTotp(userId)) throw new Error('Two-factor authentication is already enabled');
	const secret = base32Encode(randomBytes(20));
	await db.transaction(async (tx) => {
		await tx.delete(credential).where(byType(userId, 'totp_pending'));
		await tx
			.insert(credential)
			.values({ userId, type: 'totp_pending', data: { secret, lastStep: -1 } });
	});
	return secret;
}

async function writeRecoveryCodes(tx: Tx, userId: string) {
	const codes = generateRecoveryCodes();
	await tx.delete(credential).where(byType(userId, 'recovery'));
	await tx
		.insert(credential)
		.values(codes.map((c) => ({ userId, type: 'recovery' as const, data: { hash: hashCode(c) } })));
	return codes;
}

/** Activates TOTP if the code matches. Returns fresh recovery codes, or null. */
export async function confirmTotp(userId: string, code: string) {
	const row = await getTotp(userId, 'totp_pending');
	if (!row) return null;
	const step = verifyCode(row.secret, code, row.lastStep);
	if (step === null) return null;
	return db.transaction(async (tx) => {
		await markUsed(tx, row.id, row.secret, step);
		return writeRecoveryCodes(tx, userId);
	});
}

export function replaceRecoveryCodes(userId: string) {
	return db.transaction((tx) => writeRecoveryCodes(tx, userId));
}

export async function removeTotp(userId: string) {
	await db
		.delete(credential)
		.where(
			and(
				eq(credential.userId, userId),
				inArray(credential.type, ['totp', 'totp_pending', 'recovery'])
			)
		);
}

/** Checks a login code: a 6 digit TOTP code or a one-time recovery code. */
export async function verifySecondFactor(userId: string, input: string) {
	const code = input.trim();
	const row = await getTotp(userId);
	if (!row) return false;

	if (/^\d[\d\s]*$/.test(code)) {
		const step = verifyCode(row.secret, code, row.lastStep);
		if (step === null) return false;
		await markUsed(db, row.id, row.secret, step);
		return true;
	}

	const hash = Buffer.from(hashCode(code));
	const rows = await db.select().from(credential).where(byType(userId, 'recovery'));
	const match = rows.find((r) => {
		const stored = Buffer.from((r.data as RecoveryData).hash);
		return stored.length === hash.length && timingSafeEqual(stored, hash);
	});
	if (!match) return false;
	await db.delete(credential).where(eq(credential.id, match.id));
	return true;
}
