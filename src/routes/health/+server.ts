// Liveness probe: answers once the server is up. Unauthenticated, for any health checker (Docker, k8s, uptime monitors).
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => new Response('ok');
