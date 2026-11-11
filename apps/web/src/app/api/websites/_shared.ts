import { resolveMcpBearer } from '@timeline/shared/mcp-server';
import { withTeam } from '@timeline/shared/team-scope';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { readCappedTextBody } from '@/lib/request-body';
import { appUrl } from '@/lib/site-url';

export const websiteInput = z.strictObject({
  url: z.string().min(1).max(2048),
  subject: z.enum(['own_team', 'other_company']).default('own_team'),
  permissionConfirmed: z.literal(true),
});
export const scheduleInput = z.strictObject({
  frequency: z.enum(['manual', 'daily', 'weekly']),
  time: z.string(),
  weekday: z.number().int().min(1).max(7),
  timezone: z.string().max(100),
});
export async function websiteScope(
  req: Request,
  permission: 'read' | 'websites:scan' | 'websites:manage',
) {
  const authorization = req.headers.get('authorization');
  if (authorization) {
    const token = /^Bearer (.+)$/i.exec(authorization)?.[1];
    const principal = token
      ? await resolveMcpBearer(db, token, appUrl('/api/mcp/server').toString())
      : null;
    if (!principal) throw new Error('unauthorized');
    if (!principal.scopes.includes('read') || !principal.scopes.includes(permission))
      throw new Error('forbidden');
    return withTeam(db, principal.teamId, principal.userId, {
      skipMembershipCheck: principal.authType === 'api_key',
      websitePrincipal: principal,
    });
  }
  if (req.method !== 'GET' && req.headers.get('origin') !== appUrl('/').origin)
    throw new Error('forbidden');
  const session = await auth();
  if (!session?.user.id) throw new Error('unauthorized');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) throw new Error('forbidden');
  return withTeam(db, active.teamId, session.user.id);
}
export async function websiteBody(req: Request): Promise<unknown> {
  const body = await readCappedTextBody(req, 16_384);
  if (body.tooLarge) throw new Error('Request too large');
  return JSON.parse(body.text) as unknown;
}
export async function websiteResponse(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Website request failed';
    const status =
      message === 'unauthorized'
        ? 401
        : message === 'forbidden' ||
            message.includes('Requires admin') ||
            message.includes('permission')
          ? 403
          : message.includes('not found')
            ? 404
            : 400;
    // Validation errors and operational failures do not expose SQL/provider payloads.
    const safe =
      error instanceof z.ZodError
        ? 'Invalid website request'
        : /^(Website |Wait |A website |Daily crawl |Confirm |Only public |Requires admin|unauthorized|forbidden|Invalid |Missing website)/.test(
              message,
            )
          ? message
          : 'Could not complete the website request';
    return Response.json({ error: safe }, { status, headers: { 'cache-control': 'no-store' } });
  }
}
