import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { mergeCompose } from '#lib/dockit-config.js';
import { applyProxy, caddySites, proxySection, readProxy, readRoutes } from './proxy';

const source = `# my app
services:
  app:
    image: nginx:alpine # web
    ports:
      - "8080:80"
  db:
    image: postgres:17
    networks: [backend]

networks:
  backend: {}
`;
const base = parse(source);

describe('proxy routes', () => {
	it('joins the caddy network in the override file', () => {
		const out = applyProxy(base, '', ['app'], 'caddy');
		const json = parse(out);
		expect(json).toEqual({
			services: { app: { networks: ['default', 'caddy'] } },
			networks: { caddy: { name: 'caddy', external: true } }
		});
	});

	it('adds to the networks of the compose file', () => {
		const json = parse(applyProxy(base, '', ['db', 'app'], 'proxy'));
		expect(json.services.db.networks).toEqual(['caddy']);
		expect(json.networks.caddy.name).toBe('proxy');
		const merged = mergeCompose(base, json);
		expect((merged.services as Record<string, { networks: string[] }>).db.networks).toEqual([
			'backend',
			'caddy'
		]);
	});

	it('keeps an existing override file and removes only its own entries', () => {
		const override = '# mine\nservices:\n  app:\n    restart: always # yes\n';
		const added = applyProxy(base, override, ['app'], 'caddy');
		expect(added).toContain('# yes');
		const removed = applyProxy(base, added, [], 'caddy');
		expect(parse(removed)).toEqual(parse(override));
		expect(removed).toContain('# yes');
	});

	it('removing all routes empties the override file', () => {
		const added = applyProxy(base, '', ['app', 'db'], 'caddy');
		expect(applyProxy(base, added, [], 'caddy')).toBe('');
	});

	it('leaves services attached by the user alone', () => {
		const own = parse(source.replace('networks: [backend]', 'networks: [backend, caddy]'));
		own.networks.caddy = { external: true };
		expect(applyProxy(own, '', ['db'], 'caddy')).toBe('');
	});

	it('refuses unknown services and network_mode', () => {
		expect(() => applyProxy(base, '', ['nope'], 'caddy')).toThrow(/Unknown service/);
		const host = parse('services:\n  app:\n    image: x\n    network_mode: host\n');
		expect(() => applyProxy(host, '', ['app'], 'caddy')).toThrow(/network_mode/);
	});

	it('stores the routes in the order of the services', () => {
		const section = proxySection(
			{ other: 1 },
			[
				{ service: 'db', port: 5432, domains: ['db.example.com'] },
				{ service: 'app', port: 80, domains: ['a.example.com'] }
			],
			['app', 'db']
		);
		expect(readRoutes(section).map((r) => r.service)).toEqual(['app', 'db']);
		expect(section?.other).toBe(1);
		expect(proxySection({ domains: [] }, [], [])).toBeNull();
	});

	it('ignores invalid routes', () => {
		const section = {
			domains: [
				{ service: 'app', port: 0, domains: ['a.dev'] },
				{ service: 'app', port: 80, domains: ['bad domain'] },
				{ service: 'app', port: 80, domains: ['ok.dev'] }
			]
		};
		expect(readRoutes(section)).toEqual([{ service: 'app', port: 80, domains: ['ok.dev'] }]);
	});

	it('suggests container ports', () => {
		const src = `services:\n  app:\n    image: x\n    ports: ["127.0.0.1:8080:3000/tcp"]\n    expose: [9000]\n`;
		expect(readProxy(parse(src), null)[0].ports).toEqual([3000, 9000]);
	});
});

describe('caddyfile', () => {
	it('generates a site per route with the container name as upstream', () => {
		const named = parse(`services:\n  web:\n    image: x\n    container_name: my-web\n`);
		const out = caddySites([
			{
				project: 'zeta',
				composeName: 'zeta',
				compose: named,
				section: { domains: [{ service: 'web', port: 3000, domains: ['c.dev', 'a.dev'] }] }
			},
			{
				project: 'Blog',
				composeName: 'blog',
				compose: base,
				section: { domains: [{ service: 'app', port: 80, domains: ['a.dev', 'b.dev'] }] }
			}
		]);
		expect(out).toContain('a.dev, b.dev {\n\treverse_proxy blog-app-1:80\n}');
		// a.dev is already served by Blog
		expect(out).toContain('c.dev {\n\treverse_proxy my-web:3000\n}');
	});
});
