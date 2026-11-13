import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ImageRef } from './docker';

/**
 * Minimal docker registry v2 client: resolves the manifest digest of a tag
 * (anonymous or with credentials from ~/.docker/config.json) without pulling.
 */

const ACCEPT = [
	'application/vnd.oci.image.index.v1+json',
	'application/vnd.docker.distribution.manifest.list.v2+json',
	'application/vnd.docker.distribution.manifest.v2+json',
	'application/vnd.oci.image.manifest.v1+json'
].join(', ');

function registryHost(registry: string) {
	return registry === 'docker.io' ? 'registry-1.docker.io' : registry;
}

function basicAuthFor(registry: string): string | null {
	try {
		const configDir = process.env.DOCKER_CONFIG ?? path.join(os.homedir(), '.docker');
		const config = JSON.parse(readFileSync(path.join(configDir, 'config.json'), 'utf8'));
		const keys =
			registry === 'docker.io'
				? ['https://index.docker.io/v1/', 'index.docker.io', 'docker.io', 'registry-1.docker.io']
				: [registry, `https://${registry}`, `https://${registry}/`];
		for (const k of keys) {
			const auth = config.auths?.[k]?.auth;
			if (auth) return auth as string;
		}
	} catch {
		/* no credentials */
	}
	return null;
}

const tokenCache = new Map<string, { token: string; expires: number }>();

function parseChallenge(header: string) {
	const [scheme, ...rest] = header.split(' ');
	const params: Record<string, string> = {};
	for (const m of rest.join(' ').matchAll(/(\w+)="([^"]*)"/g)) params[m[1]] = m[2];
	return { scheme: scheme.toLowerCase(), params };
}

async function getToken(ref: ImageRef, challenge: string): Promise<string | null> {
	const { scheme, params } = parseChallenge(challenge);
	const basic = basicAuthFor(ref.registry);
	if (scheme === 'basic') return basic ? `Basic ${basic}` : null;
	if (scheme !== 'bearer' || !params.realm) return null;

	const scope = params.scope ?? `repository:${ref.repository}:pull`;
	const key = `${params.realm}|${params.service}|${scope}|${basic ?? ''}`;
	const cached = tokenCache.get(key);
	if (cached && cached.expires > Date.now()) return `Bearer ${cached.token}`;

	const url = new URL(params.realm);
	if (params.service) url.searchParams.set('service', params.service);
	url.searchParams.set('scope', scope);
	const res = await fetch(url, {
		headers: basic ? { Authorization: `Basic ${basic}` } : {},
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok) throw new Error(`token request failed (${res.status})`);
	const body = (await res.json()) as { token?: string; access_token?: string; expires_in?: number };
	const token = body.token ?? body.access_token;
	if (!token) return null;
	tokenCache.set(key, {
		token,
		expires: Date.now() + Math.max(30, (body.expires_in ?? 300) - 30) * 1000
	});
	return `Bearer ${token}`;
}

export async function getRemoteDigest(ref: ImageRef): Promise<string> {
	const url = `https://${registryHost(ref.registry)}/v2/${ref.repository}/manifests/${ref.tag}`;
	const request = (auth: string | null, method: 'HEAD' | 'GET') =>
		fetch(url, {
			method,
			headers: { Accept: ACCEPT, ...(auth ? { Authorization: auth } : {}) },
			signal: AbortSignal.timeout(15_000)
		});

	let auth: string | null = null;
	let res = await request(auth, 'HEAD');
	if (res.status === 401) {
		const challenge = res.headers.get('www-authenticate');
		if (!challenge) throw new Error('registry requires authentication');
		auth = await getToken(ref, challenge);
		res = await request(auth, 'HEAD');
	}
	if (res.ok && res.headers.get('docker-content-digest')) {
		return res.headers.get('docker-content-digest')!;
	}
	if (res.ok || res.status === 405) {
		// some registries don't send the digest on HEAD
		const get = await request(auth, 'GET');
		const digest = get.headers.get('docker-content-digest');
		if (get.ok && digest) return digest;
		if (get.ok) {
			const { createHash } = await import('node:crypto');
			const buf = Buffer.from(await get.arrayBuffer());
			return `sha256:${createHash('sha256').update(buf).digest('hex')}`;
		}
		res = get;
	}
	if (res.status === 401 || res.status === 403) throw new Error('access denied by registry');
	if (res.status === 404) throw new Error('tag not found in registry');
	if (res.status === 429) throw new Error('registry rate limit reached');
	throw new Error(`registry responded with ${res.status}`);
}
