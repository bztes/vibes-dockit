import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	basicAuthFor,
	listRegistryLogins,
	normalizeRegistry,
	REGISTRY_PATTERN
} from './registries';

const b64 = (s: string) => Buffer.from(s).toString('base64');
let dir: string;

beforeEach(() => {
	dir = mkdtempSync(path.join(os.tmpdir(), 'dockit-registries-'));
	process.env.DOCKER_CONFIG = dir;
	writeFileSync(
		path.join(dir, 'config.json'),
		JSON.stringify({
			auths: {
				'https://index.docker.io/v1/': { auth: b64('hub-user:secret') },
				'https://ghcr.io': { auth: b64('bob:ghp_x') },
				'registry.example.com:5000': {}
			}
		})
	);
});

afterEach(() => {
	delete process.env.DOCKER_CONFIG;
	rmSync(dir, { recursive: true, force: true });
});

describe('registries', () => {
	it('lists logins with their usernames, never the passwords', () => {
		expect(listRegistryLogins()).toEqual([
			{ registry: 'docker.io', username: 'hub-user' },
			{ registry: 'ghcr.io', username: 'bob' },
			{ registry: 'registry.example.com:5000', username: null }
		]);
	});

	it('finds the credentials of a registry', () => {
		expect(basicAuthFor('ghcr.io')).toBe(b64('bob:ghp_x'));
		expect(basicAuthFor('docker.io')).toBe(b64('hub-user:secret'));
		expect(basicAuthFor('quay.io')).toBeNull();
	});

	it('normalizes and validates registry input', () => {
		expect(normalizeRegistry(' https://GHCR.io/owner ')).toBe('ghcr.io');
		expect(normalizeRegistry('index.docker.io')).toBe('docker.io');
		expect(REGISTRY_PATTERN.test('registry.example.com:5000')).toBe(true);
		expect(REGISTRY_PATTERN.test('--password=x')).toBe(false);
	});
});
