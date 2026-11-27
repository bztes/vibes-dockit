import * as v from 'valibot';
import { error, invalid } from '@sveltejs/kit';
import { command, form, query } from '$app/server';
import { checkUserPassword, requireUser, requireUserCommand } from '#lib/server/auth.js';
import {
	beginTotp,
	confirmTotp,
	hasTotp,
	otpauthUri,
	qrSvg,
	removeTotp,
	replaceRecoveryCodes,
	totpStatus
} from '#lib/server/totp.js';

export const getMfaStatus = query(async () => totpStatus(requireUser().id));

/** Creates a new (still inactive) secret and returns everything the authenticator app needs. */
export const startTotp = command(async () => {
	const me = requireUserCommand();
	try {
		const secret = await beginTotp(me.id);
		return { secret, qr: qrSvg(otpauthUri(secret, me.username)) };
	} catch (e) {
		error(400, (e as Error).message);
	}
});

export const enableTotp = form(v.object({ _code: v.string() }), async (data, issue) => {
	const me = requireUser();
	const codes = await confirmTotp(me.id, data._code);
	if (!codes) invalid(issue._code('Wrong code — check the time on your phone'));
	void getMfaStatus().refresh();
	return { recoveryCodes: codes };
});

export const turnOffTotp = form(v.object({ _password: v.string() }), async (data, issue) => {
	const me = requireUser();
	if (!(await checkUserPassword(me.id, data._password))) invalid(issue._password('Wrong password'));
	await removeTotp(me.id);
	void getMfaStatus().refresh();
	return { success: true };
});

export const newRecoveryCodes = form(v.object({ _password: v.string() }), async (data, issue) => {
	const me = requireUser();
	if (!(await hasTotp(me.id))) error(400, 'Two-factor authentication is not enabled');
	if (!(await checkUserPassword(me.id, data._password))) invalid(issue._password('Wrong password'));
	const codes = await replaceRecoveryCodes(me.id);
	void getMfaStatus().refresh();
	return { recoveryCodes: codes };
});
