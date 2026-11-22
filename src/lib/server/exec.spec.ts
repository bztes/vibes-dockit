import { afterEach, describe, expect, it } from 'vitest';
import { childEnv, run } from './exec';

describe('childEnv', () => {
	afterEach(() => {
		delete process.env.DATA_DIR;
	});

	it("drops dockit's own variables so they can't override a project's .env", async () => {
		process.env.DATA_DIR = '/data';
		const env = childEnv();
		expect(env.DATA_DIR).toBeUndefined();
		expect(env.PATH).toBe(process.env.PATH);
		expect(childEnv({}).HOME).toBe(process.env.HOME);
		const res = await run('sh', ['-c', 'echo "${DATA_DIR:-unset}"']);
		expect(res.stdout.trim()).toBe('unset');
	});

	it('keeps explicitly passed variables', () => {
		expect(childEnv({ FOO: 'bar' }).FOO).toBe('bar');
	});
});
