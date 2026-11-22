import { describe, expect, it } from 'vitest';
import { SECRET_MASK, maskEnv, unmaskEnv } from './env';

const stored = `# database
DB_USER=app
# @sensitive
DB_PASSWORD='p@ss word#1'
PORT=8080`;

describe('secret env variables', () => {
	it('masks secret values but keeps everything else', () => {
		const masked = maskEnv(stored);
		expect(masked).toBe(`# database
DB_USER=app
# @sensitive
DB_PASSWORD=${SECRET_MASK}
PORT=8080`);
		expect(masked).not.toContain('p@ss');
	});

	it('restores the stored value when the mask comes back', () => {
		const { env, missing } = unmaskEnv(maskEnv(stored), stored);
		expect(env).toBe(stored);
		expect(missing).toEqual([]);
	});

	it('keeps a newly typed secret value', () => {
		const incoming = maskEnv(stored).replace(SECRET_MASK, 'new-secret');
		expect(unmaskEnv(incoming, stored).env).toContain('DB_PASSWORD=new-secret');
	});

	it('reports masked secrets without a stored value', () => {
		const incoming = `# @sensitive\nAPI_TOKEN=${SECRET_MASK}`;
		expect(unmaskEnv(incoming, stored).missing).toEqual(['API_TOKEN']);
	});

	it('puts the mark back when it is removed but the mask is kept', () => {
		const incoming = maskEnv(stored).replace('# @sensitive\n', '');
		const { env, missing } = unmaskEnv(incoming, stored);
		expect(env).toBe(stored);
		expect(maskEnv(env)).not.toContain('p@ss');
		expect(missing).toEqual([]);
	});

	it('allows removing the mark together with a new value', () => {
		const incoming = maskEnv(stored).replace('# @sensitive\n', '').replace(SECRET_MASK, 'plain');
		const { env, missing } = unmaskEnv(incoming, stored);
		expect(env).toContain('DB_PASSWORD=plain');
		expect(missing).toEqual([]);
	});
});
