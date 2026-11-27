import { describe, expect, it } from 'vitest';
import {
	base32Decode,
	base32Encode,
	codeAt,
	generateRecoveryCodes,
	otpauthUri,
	verifyCode
} from './totp';

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890"
const rfcKey = Buffer.from('12345678901234567890');
const rfcSecret = base32Encode(rfcKey);

describe('totp', () => {
	it('round-trips base32', () => {
		expect(rfcSecret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
		expect(base32Decode(rfcSecret).equals(rfcKey)).toBe(true);
		expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq').equals(rfcKey)).toBe(true);
	});

	it.each([
		[59, '94287082'],
		[1111111109, '07081804'],
		[1111111111, '14050471'],
		[1234567890, '89005924'],
		[2000000000, '69279037'],
		[20000000000, '65353130']
	])('matches the RFC test vector at t=%i', (t, code) => {
		expect(codeAt(rfcKey, Math.floor(t / 30), 8)).toBe(code);
	});

	it('accepts the current and neighbouring codes, rejects others', () => {
		const now = 1111111111_000;
		const step = Math.floor(now / 30_000);
		expect(verifyCode(rfcSecret, codeAt(rfcKey, step), -1, now)).toBe(step);
		expect(verifyCode(rfcSecret, codeAt(rfcKey, step - 1), -1, now)).toBe(step - 1);
		expect(verifyCode(rfcSecret, codeAt(rfcKey, step + 1), -1, now)).toBe(step + 1);
		expect(verifyCode(rfcSecret, codeAt(rfcKey, step - 2), -1, now)).toBeNull();
		expect(verifyCode(rfcSecret, 'abcdef', -1, now)).toBeNull();
	});

	it('rejects a code that was already used', () => {
		const now = 1111111111_000;
		const step = Math.floor(now / 30_000);
		const code = codeAt(rfcKey, step);
		expect(verifyCode(rfcSecret, code, step, now)).toBeNull();
		expect(verifyCode(rfcSecret, codeAt(rfcKey, step - 1), step - 1, now)).toBeNull();
	});

	it('builds an otpauth uri', () => {
		const uri = new URL(otpauthUri(rfcSecret, 'nico'));
		expect(uri.protocol).toBe('otpauth:');
		expect(uri.host).toBe('totp');
		expect(decodeURIComponent(uri.pathname)).toBe('/Dockit:nico');
		expect(uri.searchParams.get('secret')).toBe(rfcSecret);
		expect(uri.searchParams.get('issuer')).toBe('Dockit');
	});

	it('generates 10 unique recovery codes', () => {
		const codes = generateRecoveryCodes();
		expect(codes).toHaveLength(10);
		expect(new Set(codes).size).toBe(10);
		for (const c of codes) expect(c).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
	});
});
