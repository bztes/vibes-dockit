import { describe, expect, it } from 'vitest';
import { SECRET_MASK, maskEnv, parseEnv, serializeEnv, unmaskEnv } from './env';

const stored = `# database
DB_USER=app
# dockit:secret
DB_PASSWORD='p@ss word#1'
PORT=8080`;

describe('secret env variables', () => {
	it('masks secret values but keeps everything else', () => {
		const masked = maskEnv(stored);
		expect(masked).toBe(`# database
DB_USER=app
# dockit:secret
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
		const incoming = `# dockit:secret\nAPI_TOKEN=${SECRET_MASK}`;
		expect(unmaskEnv(incoming, stored).missing).toEqual(['API_TOKEN']);
	});

	it('round-trips through the table editor', () => {
		const rows = parseEnv(maskEnv(stored));
		expect(rows.find((r) => r.key === 'DB_PASSWORD')).toEqual({
			key: 'DB_PASSWORD',
			value: SECRET_MASK,
			secret: true
		});
		const { env } = unmaskEnv(serializeEnv(rows), stored);
		expect(parseEnv(env)).toEqual(parseEnv(stored));
	});
});
