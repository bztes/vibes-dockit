import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { migrateNetworks } from './migrate';

describe('migration', () => {
	it('moves the networks of older projects out of the compose file', () => {
		const legacy = `services:
  app:
    image: nginx # web
    networks:
      - default
      - caddy
  db:
    image: postgres
    networks: [backend, caddy]
networks:
  backend: {}
  caddy:
    name: caddy
    external: true
`;
		const section = {
			domains: [
				{ service: 'app', port: 80, domains: ['a.dev'] },
				{ service: 'db', port: 5432, domains: ['db.dev'] }
			]
		};
		const out = migrateNetworks(legacy, '', section)!;
		expect(out.compose).toContain('# web');
		expect(parse(out.compose)).toEqual({
			services: { app: { image: 'nginx' }, db: { image: 'postgres', networks: ['backend'] } },
			networks: { backend: {} }
		});
		expect(parse(out.override)).toEqual({
			services: { app: { networks: ['default', 'caddy'] }, db: { networks: ['caddy'] } },
			networks: { caddy: { name: 'caddy', external: true } }
		});
		expect(migrateNetworks(out.compose, out.override, section)).toBeNull();
		expect(migrateNetworks(legacy, '', null)).toBeNull();
	});
});
