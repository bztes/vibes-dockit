import { spawn } from 'node:child_process';
import { error } from '@sveltejs/kit';
import { childEnv } from '#lib/server/exec.js';
import type { RequestHandler } from './$types';

/**
 * Follows a container's log: GET ?container=<id>&tail=300 streams `docker logs -f -t` until the
 * client disconnects. A plain response instead of a live query, so it closes the moment the logs
 * page is left (see `watchOverview` for why).
 */
export const GET: RequestHandler = ({ locals, url, request }) => {
	if (!locals.user) error(401, 'Not logged in');
	const id = url.searchParams.get('container') ?? '';
	if (!/^[a-f0-9]{12,64}$/.test(id)) error(400, 'Invalid container id');
	const tail = Math.min(Math.max(Number(url.searchParams.get('tail')) || 300, 1), 5000);

	const child = spawn('docker', ['logs', '-f', '-t', '--tail', String(tail), id], {
		env: childEnv()
	});

	let controller: ReadableStreamDefaultController<Uint8Array>;
	// docker can still deliver buffered output after the client is gone, and enqueueing into a
	// closed stream throws (and would crash the server)
	let open = true;
	const push = (chunk: Buffer) => {
		if (open) controller.enqueue(chunk);
	};
	const end = (err?: Error) => {
		if (!open) return;
		open = false;
		child.stdout.off('data', push);
		child.stderr.off('data', push);
		request.signal.removeEventListener('abort', cancel);
		child.kill();
		try {
			if (err) controller.error(err);
			else controller.close();
		} catch {
			// already cancelled
		}
	};
	const cancel = () => end();

	const body = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;
			child.stdout.on('data', push);
			child.stderr.on('data', push);
			child.on('error', end);
			child.on('close', cancel);
			request.signal.addEventListener('abort', cancel);
		},
		cancel
	});

	return new Response(body, {
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'no-store',
			// don't let a reverse proxy buffer the stream
			'x-accel-buffering': 'no'
		}
	});
};
