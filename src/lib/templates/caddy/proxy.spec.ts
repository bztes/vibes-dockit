import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { applyProxy, readProxy } from './proxy';

const base = `# my app
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

const read = (src: string) => readProxy(parse(src));

describe('proxy routes', () => {
	it('adds labels and the caddy network, keeps the default network', () => {
		const out = applyProxy(
			base,
			[{ service: 'app', port: 80, domains: ['app.example.com', 'www.example.com'] }],
			'caddy'
		);
		const json = parse(out);
		expect(out).toContain('# my app');
		expect(out).toContain('# web');
		expect(json.services.app.labels).toEqual({
			caddy: 'app.example.com, www.example.com',
			'caddy.reverse_proxy': '{{upstreams 80}}'
		});
		expect(json.services.app.networks).toEqual(['default', 'caddy']);
		expect(json.services.db.networks).toEqual(['backend']);
		expect(json.networks.caddy).toEqual({ name: 'caddy', external: true });
		expect(read(out)[0].routes).toEqual([
			{ service: 'app', port: 80, domains: ['app.example.com', 'www.example.com'] }
		]);
	});

	it('supports several routes per service and across services', () => {
		const out = applyProxy(
			base,
			[
				{ service: 'app', port: 80, domains: ['a.example.com'] },
				{ service: 'app', port: 9000, domains: ['admin.example.com'] },
				{ service: 'db', port: 5432, domains: ['db.example.com'] }
			],
			'proxy'
		);
		const json = parse(out);
		expect(json.services.app.labels['caddy_1.reverse_proxy']).toBe('{{upstreams 9000}}');
		expect(json.services.db.networks).toEqual(['backend', 'caddy']);
		expect(json.networks.caddy.name).toBe('proxy');
		const routes = read(out).flatMap((s) => s.routes);
		expect(routes.map((r) => r.domains[0])).toEqual([
			'a.example.com',
			'admin.example.com',
			'db.example.com'
		]);
	});

	it('removing all routes restores the original file', () => {
		const added = applyProxy(base, [{ service: 'app', port: 80, domains: ['a.com'] }], 'caddy');
		const removed = applyProxy(added, [], 'caddy');
		expect(parse(removed)).toEqual(parse(base));
		expect(removed).toContain('# web');
	});

	it('works with list style labels and keeps other labels', () => {
		const src = `services:\n  app:\n    image: x\n    labels:\n      - "foo=bar"\n`;
		const out = applyProxy(src, [{ service: 'app', port: 3000, domains: ['x.dev'] }], 'caddy');
		expect(parse(out).services.app.labels).toEqual([
			'foo=bar',
			'caddy=x.dev',
			'caddy.reverse_proxy={{upstreams 3000}}'
		]);
		expect(read(out)[0].routes[0].port).toBe(3000);
		expect(parse(applyProxy(out, [], 'caddy')).services.app.labels).toEqual(['foo=bar']);
	});

	it('marks unknown caddy labels as custom and refuses to touch them', () => {
		const src = `services:\n  app:\n    image: x\n    labels:\n      caddy: x.dev\n      caddy.tls: internal\n`;
		expect(read(src)[0].custom).toBe(true);
		expect(() =>
			applyProxy(src, [{ service: 'app', port: 80, domains: ['y.dev'] }], 'caddy')
		).toThrow(/custom/);
		expect(applyProxy(src, [], 'caddy')).toBe(src);
	});

	it('suggests container ports', () => {
		const src = `services:\n  app:\n    image: x\n    ports: ["127.0.0.1:8080:3000/tcp"]\n    expose: [9000]\n`;
		expect(read(src)[0].ports).toEqual([3000, 9000]);
	});
});
