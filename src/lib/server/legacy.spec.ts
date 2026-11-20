import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { legacyConfig, removeLegacyBlock } from './legacy';

describe('x-dockit block', () => {
	it('moves the x-dockit block into template sections', () => {
		expect(
			legacyConfig({
				'x-dockit': {
					description: 'My app',
					autoUpdate: true,
					domains: [{ service: 'app', port: 80, domains: ['a.dev'] }],
					restic: { schedule: 'daily' }
				}
			})
		).toEqual({
			description: 'My app',
			autoUpdate: true,
			caddy: { domains: [{ service: 'app', port: 80, domains: ['a.dev'] }] },
			restic: { schedule: 'daily' }
		});
		expect(legacyConfig({ services: {} })).toBeNull();
	});

	it('reads the x-dockit block of older compose files', () => {
		const old = parse(`x-dockit:
  description: My app
  restic:
    schedule: daily
services:
  app:
    image: nginx
`);
		const config = legacyConfig(old)!;
		expect(config.description).toBe('My app');
		expect(config.restic).toEqual({ schedule: 'daily' });
		expect(legacyConfig({ 'x-dockit': { restic: true } })?.restic).toEqual({});
		expect(legacyConfig({ 'x-dockit': { restic: null } })?.restic).toBeUndefined();
	});

	it('removes the x-dockit block, keeping the rest of the file', () => {
		const source =
			'# app\nx-dockit:\n  description: x\n\nservices:\n  app:\n    image: nginx # web\n';
		expect(removeLegacyBlock(source)).toBe('# app\n\nservices:\n  app:\n    image: nginx # web\n');
		// like the example compose.yaml of Dockit: the comment right above the block
		const example =
			'# put me there\n# and so on\nx-dockit:\n  description: x\n\nservices:\n  app: {}\n';
		expect(removeLegacyBlock(example)).toBe(
			'# put me there\n# and so on\n\nservices:\n  app: {}\n'
		);
		const plain = 'services:\n  app:\n    image: nginx\n';
		expect(removeLegacyBlock(plain)).toBe(plain);
	});
});
