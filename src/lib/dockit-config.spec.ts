import { describe, expect, it } from 'vitest';
import {
	hasContent,
	mergeCompose,
	parseConfig,
	setSection,
	stringifyConfig
} from './dockit-config';

describe('dockit.json', () => {
	it('drops unset values, an empty config is no file', () => {
		expect(stringifyConfig({ description: undefined })).toBeNull();
		expect(stringifyConfig(setSection({ url: 'https://a.dev' }, 'restic', {}))).toBe(
			'{\n  "url": "https://a.dev",\n  "restic": {}\n}\n'
		);
		expect(setSection({ caddy: { domains: [] } }, 'caddy', null)).toEqual({});
	});

	it('rejects a file that is not an object', () => {
		expect(parseConfig('')).toEqual({});
		expect(() => parseConfig('[]')).toThrow(/not a JSON object/);
		expect(() => parseConfig('{')).toThrow();
	});
});

describe('compose override', () => {
	it('merges like docker compose', () => {
		const merged = mergeCompose(
			{
				services: {
					app: { image: 'nginx', ports: ['80:80'], environment: ['A=1'], command: ['a'] },
					db: { image: 'postgres', networks: { backend: { aliases: ['database'] } } }
				}
			},
			{
				services: {
					app: { ports: ['443:443'], environment: { B: '2' }, command: ['b'] },
					db: { networks: ['caddy'] },
					'db-hooks': { image: 'postgres' }
				}
			}
		);
		expect(merged.services).toEqual({
			app: {
				image: 'nginx',
				ports: ['80:80', '443:443'],
				environment: { A: '1', B: '2' },
				command: ['b']
			},
			db: { image: 'postgres', networks: { backend: { aliases: ['database'] }, caddy: null } },
			'db-hooks': { image: 'postgres' }
		});
	});

	it('knows an empty override file', () => {
		expect(hasContent('# nothing\n')).toBe(false);
		expect(hasContent('services:\n  app: {}\n')).toBe(true);
	});
});
