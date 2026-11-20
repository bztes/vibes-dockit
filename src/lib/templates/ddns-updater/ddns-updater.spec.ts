import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ddnsFiles, parseConfig } from './ddns-updater';

const entry = { provider: 'namecheap', domain: 'a.example.com', password: 'p$w' };

describe('parseConfig', () => {
	it('accepts the settings object, an array or a single entry', () => {
		for (const input of [{ settings: [entry] }, [entry], entry]) {
			expect(parseConfig(JSON.stringify(input))).toEqual({ settings: [entry] });
		}
	});

	it('rejects invalid configs', () => {
		expect(parseConfig(' ')).toMatch(/Enter a config/);
		expect(parseConfig('{')).toMatch(/Invalid JSON/);
		expect(parseConfig('[]')).toMatch(/at least one/);
		expect(parseConfig('[{"provider":"x"}]')).toMatch(/needs a "domain"/);
	});
});

describe('ddnsFiles', () => {
	it('writes the config to data/config.json and bind mounts it', () => {
		const { compose, files, config } = ddnsFiles({
			settings: [entry, { ...entry, domain: 'b.example.com' }]
		});
		const json = parse(compose) as {
			services: Record<string, { volumes: string[]; environment?: unknown }>;
		};
		expect(json.services['ddns-updater'].volumes).toEqual(['./data:/updater/data']);
		expect(json.services['ddns-updater'].environment).toBeUndefined();
		expect(config.description).toBe('Dynamic DNS via namecheap for a.example.com, b.example.com');
		expect(JSON.parse(files['data/config.json'])).toEqual({
			settings: [entry, { ...entry, domain: 'b.example.com' }]
		});
	});
});
