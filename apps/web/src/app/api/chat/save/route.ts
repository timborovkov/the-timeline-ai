import { withTeam } from '@timeline/shared/team-scope';

import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { MAX_CHAT_RETRY_BYTES, openChatRecovery } from '@/lib/chat-turn-save';
import { db } from '@/lib/db';
import { reportHandledEvent } from '@/lib/sentry-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function result(status: number, error?: string) {
  return Response.json(error ? { ok: false, error } : { ok: true }, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

async function readToken(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader || request.headers.get('content-type') !== 'text/plain') return null;
  const decoder = new TextDecoder();
  let token = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return token + decoder.decode();
    bytes += value.byteLength;
    if (bytes > MAX_CHAT_RETRY_BYTES) {
      await reader.cancel();
      return null;
    }
    token += decoder.decode(value, { stream: true });
  }
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return result(401, 'unauthenticated');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) return result(403, 'no_active_team');

  const token = await readToken(request).catch(() => null);
  const recovery =
    token &&
    openChatRecovery(token, {
      teamId: active.teamId,
      userId: session.user.id,
    });
  if (!recovery) return result(400, 'invalid_or_expired_save');
  const scope = withTeam(db, active.teamId, session.user.id);
  try {
    const saved = await scope.objects.persistChatTurn(recovery.sessionId, recovery.turn);
    return saved === 'saved' ? result(200) : result(409, 'chat_history_changed');
  } catch {
    reportHandledEvent({
      message: 'chat_turn_retry_failed',
      surface: 'api',
      operation: 'chat_session_append_retry',
      level: 'warning',
    });
    return result(503, 'save_unavailable');
  }
}
