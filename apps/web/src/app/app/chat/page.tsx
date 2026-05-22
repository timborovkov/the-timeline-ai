import { entities, type Db } from '@timeline/db';
import { objects, withTeam } from '@timeline/shared';
import { type UIMessage } from 'ai';
import { and, eq, inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { ChatPane } from '@/components/chat/chat-pane';
import { SessionSidebar } from '@/components/chat/session-sidebar';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface PersistedUser {
  ui_message?: UIMessage;
}

interface PersistedToolCall {
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  // AI SDK uses different field names across minor versions; accept either.
  args?: unknown;
  result?: unknown;
}

interface PersistedAssistant {
  text?: string | null;
  tool_calls?: PersistedToolCall[];
}

/**
 * Reconstruct UIMessages from persisted rows. User turns store the original
 * UIMessage under `ui_message` — we replay it verbatim. Assistant turns
 * store text + the `e.toolCalls` array from streamChat's onFinish event;
 * we rebuild the matching `tool-<name>` parts so the ToolStep component
 * shows the same "what did the agent do" panels on reload that it showed
 * during the live stream. Without this, citations land in the transcript
 * but the tool invocations that produced them silently disappear.
 */
function hydrate(
  rows: Awaited<ReturnType<typeof objects.getChatSession>>,
): UIMessage[] {
  if (!rows) return [];
  return rows.messages
    .map<UIMessage | null>((m) => {
      if (m.role === 'user') {
        const content = m.content as PersistedUser;
        if (content.ui_message) return content.ui_message;
        return null;
      }
      if (m.role === 'assistant') {
        const content = m.content as PersistedAssistant;
        const parts: UIMessage['parts'] = [];
        if (Array.isArray(content.tool_calls)) {
          for (const tc of content.tool_calls) {
            const toolName = typeof tc.toolName === 'string' ? tc.toolName : 'unknown';
            const input = tc.input ?? tc.args;
            const output = tc.output ?? tc.result;
            // Cast: UIMessage['parts'] is a discriminated union the SDK
            // builds at runtime from registered tool names. We're injecting
            // synthetic parts the SDK never typed against, so the cast is
            // unavoidable. ToolStep reads `type`/`state`/`input`/`output`
            // structurally, so the runtime contract holds.
            parts.push({
              type: `tool-${toolName}`,
              toolCallId: typeof tc.toolCallId === 'string' ? tc.toolCallId : `${m.id}-${String(parts.length)}`,
              state: output === undefined ? 'input-available' : 'output-available',
              input,
              output,
            } as unknown as UIMessage['parts'][number]);
          }
        }
        const text = content.text ?? '';
        if (text.length > 0) parts.push({ type: 'text', text });
        if (parts.length === 0) return null;
        return { id: m.id, role: 'assistant', parts };
      }
      return null;
    })
    .filter((m): m is UIMessage => m !== null);
}

async function loadPinnedEntity(
  database: Db,
  teamId: string,
  entityIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (entityIds.length === 0) return out;
  const rows = await database
    .select({ id: entities.id, canonicalName: entities.canonicalName })
    .from(entities)
    .where(and(eq(entities.teamId, teamId), inArray(entities.id, entityIds)));
  for (const r of rows) out.set(r.id, r.canonicalName);
  return out;
}

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');
  const { active } = await resolveActiveTeam(session.user.id);
  if (!active) redirect('/sign-in');

  const scope = withTeam(db, active.teamId, session.user.id);
  await scope.requireMembership();
  const team = await scope.team();
  const params = await searchParams;
  const activeSessionId = params.session ?? null;

  const sessions = await objects.listChatSessions(db, scope, { limit: 50 });
  const pinnedIds = sessions.map((s) => s.pinnedEntityId).filter((v): v is string => v !== null);
  const pinnedNames = await loadPinnedEntity(db, active.teamId, pinnedIds);

  let initialMessages: UIMessage[] = [];
  let pinnedEntityId: string | null = null;
  let pinnedEntityName: string | null = null;
  if (activeSessionId) {
    const loaded = await objects.getChatSession(db, scope, activeSessionId);
    if (loaded) {
      initialMessages = hydrate(loaded);
      pinnedEntityId = loaded.session.pinnedEntityId;
      pinnedEntityName = pinnedEntityId ? (pinnedNames.get(pinnedEntityId) ?? null) : null;
    }
  }

  return (
    <div className="flex h-[calc(100dvh-9rem)] gap-4 md:h-[calc(100dvh-11rem)]">
      <SessionSidebar
        activeSessionId={activeSessionId}
        sessions={sessions.map((s) => ({
          id: s.id,
          title: s.title,
          pinnedEntityId: s.pinnedEntityId,
          pinnedEntityName: s.pinnedEntityId ? (pinnedNames.get(s.pinnedEntityId) ?? null) : null,
          updatedAt: s.updatedAt.toISOString(),
        }))}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="mb-6 shrink-0">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Chat</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Ask the timeline</h1>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatPane
            teamName={team?.name ?? active.teamName}
            sessionId={activeSessionId}
            initialMessages={initialMessages}
            pinnedEntityId={pinnedEntityId}
            pinnedEntityName={pinnedEntityName}
          />
        </div>
      </div>
    </div>
  );
}
