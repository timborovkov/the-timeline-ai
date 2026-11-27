import { boardImportConfig } from '@timeline/shared/integrations';
import { withTeam } from '@timeline/shared/team-scope';
import { z } from 'zod';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { readCappedTextBody, payloadTooLargeResponse } from '@/lib/request-body';

async function scope() {
  const session = await auth();
  if (!session?.user.id) return null;
  const { active } = await resolveActiveTeam(session.user.id);
  return active ? withTeam(db, active.teamId, session.user.id) : null;
}
export async function GET(req: Request) {
  const team = await scope();
  if (!team) return Response.json({ error: 'Sign in to a workspace.' }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const item = params.get('item');
  const entity = params.get('entity');
  const id = item ?? entity;
  if (id) {
    if (!z.uuid().safeParse(id).success)
      return Response.json({ error: 'Invalid record.' }, { status: 400 });
    const ownership = await team.boardImports.ownership(item ? { itemId: id } : { entityId: id });
    const role = await team.requireMembership();
    return Response.json({ ownership, canManage: role === 'owner' || role === 'admin' });
  }
  const role = await team.requireMembership();
  if (role !== 'owner' && role !== 'admin')
    return Response.json({ error: 'An admin can set up a board import.' }, { status: 403 });
  return Response.json(await team.boardImports.options());
}

const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), config: boardImportConfig }),
  z.object({
    action: z.literal('confirm'),
    config: boardImportConfig,
    revision: z.string().length(64),
    choices: z.record(z.string(), z.union([z.uuid(), z.literal('create')])).default({}),
  }),
  z.object({ action: z.literal('unlink'), id: z.uuid() }),
]);
export async function POST(req: Request) {
  const team = await scope();
  if (!team) return Response.json({ error: 'Sign in to a workspace.' }, { status: 401 });
  const role = await team.requireMembership();
  if (role !== 'owner' && role !== 'admin')
    return Response.json({ error: 'An admin can manage board imports.' }, { status: 403 });
  const body = await readCappedTextBody(req, 256 * 1024);
  if (body.tooLarge) return payloadTooLargeResponse();
  let raw: unknown;
  try {
    raw = JSON.parse(body.text);
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  const parsed = input.safeParse(raw);
  if (!parsed.success)
    return Response.json(
      { error: 'Check the selected source, board, and import options.' },
      { status: 400 },
    );
  const value = parsed.data;
  try {
    if (value.action === 'preview')
      return Response.json(await team.boardImports.preview(value.config));
    if (value.action === 'unlink') {
      await team.boardImports.unlink(value.id);
      return Response.json({ ok: true });
    }
    return Response.json({
      id: await team.boardImports.confirm(value.config, value.revision, value.choices),
    });
  } catch (error) {
    const messages = [
      'Map each pipeline stage before confirming.',
      'This object type is not allowed on this board.',
      'Select an active team-visible repository or pipeline.',
      'A mapped lane is unavailable.',
      'Destination board is unavailable.',
      'Destination project is unavailable.',
      'This source already syncs to another board.',
      'The preview changed. Review it again.',
      'Select a GitHub import option and a project for merged work.',
    ];
    return Response.json(
      {
        error:
          error instanceof Error && messages.includes(error.message)
            ? error.message
            : 'The import could not be applied. Check access and preview again.',
      },
      { status: 409 },
    );
  }
}
