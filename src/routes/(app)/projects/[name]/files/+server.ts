import { error, json } from '@sveltejs/kit';
import { logActivity } from '#lib/server/db/index.js';
import { downloadFile, uploadFile } from '#lib/server/files.js';
import type { RequestHandler } from './$types';

/** Download a file: GET ?path=sub/file.txt */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	if (!locals.user) error(401, 'Not logged in');
	const file = await downloadFile(params.name, url.searchParams.get('path') ?? '');
	return new Response(file.stream, {
		headers: {
			'content-type': 'application/octet-stream',
			'content-length': String(file.size),
			'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
			'cache-control': 'no-store'
		}
	});
};

/** Upload a file, the raw request body is the content: PUT ?path=sub/file.txt[&overwrite=1] */
export const PUT: RequestHandler = async ({ locals, params, url, request }) => {
	if (!locals.user) error(401, 'Not logged in');
	if (!request.body) error(400, 'Empty request body');
	const path = await uploadFile(
		params.name,
		url.searchParams.get('path') ?? '',
		request.body,
		url.searchParams.get('overwrite') === '1'
	);
	await logActivity({
		project: params.name,
		type: 'edit',
		message: `Uploaded ${path} (${locals.user.username})`
	});
	return json({ path });
};
