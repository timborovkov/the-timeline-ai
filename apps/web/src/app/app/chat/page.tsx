import { entities, type Db } from '@timeline/db';
import { type objects, withTeam } from '@timeline/shared';
import { type UIMessage } from 'ai';
import { and, eq, inArray } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import type { Metadata } from 'next';

import { ChatPane } from '@/components/chat/chat-pane';
import { SessionSidebar } from '@/components/chat/session-sidebar';
import { resolveActiveTeam } from '@/lib/active-team';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Chat',
  description: 'Ask questions across timeline context.',
};

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
function hydrate(rows: Awaited<ReturnType<typeof objects.getChatSession>>): UIMessage[] {
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
              toolCallId:
                typeof tc.toolCallId === 'string'
                  ? tc.toolCallId
                  : `${m.id}-${String(parts.length)}`,
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
  const [team, params] = await Promise.all([scope.timeline.team(), searchParams]);
  const requestedSessionId = params.session ?? null;

  const sessions = await scope.objects.listChatSessions({ limit: 50 });
  const pinnedIds = sessions.map((s) => s.pinnedEntityId).filter((v): v is string => v !== null);
  const pinnedNames = await loadPinnedEntity(db, active.teamId, pinnedIds);

  // If the URL points at a session that no longer loads (archived,
  // wrong team, malformed id), do NOT pass that id down to the client.
  // The client would otherwise echo it on every /api/chat turn and the
  // server would return session_not_found in a loop. Resolve to null
  // and let ChatPane behave like a fresh chat — the next sendMessage
  // will create a new session via x-tl-session-id.
  let activeSessionId: string | null = null;
  let initialMessages: UIMessage[] = [];
  let pinnedEntityId: string | null = null;
  let pinnedEntityName: string | null = null;
  if (requestedSessionId) {
    const loaded = await scope.objects.getChatSession(requestedSessionId);
    if (loaded) {
      activeSessionId = requestedSessionId;
      initialMessages = hydrate(loaded);
      pinnedEntityId = loaded.session.pinnedEntityId;
      // Deep-linked or older sessions can fall outside the top-50 sidebar
      // window, so their pinnedEntityId isn't in `pinnedNames`. Fetch the
      // active session's pinned name on demand so the chip shows the
      // entity name instead of a raw UUID.
      if (pinnedEntityId && !pinnedNames.has(pinnedEntityId)) {
        const extra = await loadPinnedEntity(db, active.teamId, [pinnedEntityId]);
        for (const [k, v] of extra) pinnedNames.set(k, v);
      }
      pinnedEntityName = pinnedEntityId ? (pinnedNames.get(pinnedEntityId) ?? null) : null;
    }
  }

  return (
    // Escape main's px/py with negative margins so the chat fills the
    // entire viewport minus the AppShell header (h-14 = 3.5rem). The chat
    // pane has its own internal scroll, so a fixed outer height keeps the
    // layout stable regardless of message count.
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-3.5rem)] md:-mx-8 md:-my-8">
      <SessionSidebar
        activeSessionId={activeSessionId}
        sessions={sessions.map((s) => ({
          id: s.id,
          title: s.title,
          pinnedEntityId: s.pinnedEntityId,
          pinnedEntityName: s.pinnedEntityId ? (pinnedNames.get(s.pinnedEntityId) ?? null) : null,
        }))}
      />
      <div className="flex min-h-0 flex-1 flex-col px-4 py-5 md:px-8 md:py-6">
        <header
          className="mb-5 flex shrink-0 items-baseline gap-x-4 border-y border-border py-3 font-mono text-xs uppercase tracking-[0.12em] text-fg-muted"
          aria-label={`Chat with ${team?.name ?? active.teamName}'s timeline`}
        >
          <span className="text-fg">CHAT</span>
          <span aria-hidden="true" className="text-fg-dim">
            ask the timeline
          </span>
          <span className="ml-auto text-fg-dim">
            <span aria-hidden="true">{sessions.length} sessions</span>
          </span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatPane
            // Key on activeSessionId (or "new" when none) so React remounts
            // ChatPane on every session switch. Without this, navigating from
            // session A → B in the sidebar reconciles the same component and
            // the underlying useChat's Chat instance (created once via
            // useRef) keeps session A's messages alive — new messages get
            // sent against the wrong session id even though props change.
            key={activeSessionId ?? 'new'}
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
