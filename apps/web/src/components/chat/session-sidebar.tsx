'use client';

import { Plus, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState, useTransition } from 'react';

import { archiveChatSessionAction } from '@/app/actions/chat';
import { useAppDialog } from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import {
  chatSessionLabel,
  filterChatSessions,
  type ChatSessionListEntry,
} from '@/lib/chat-session-list';
import { formatDisplayDateTime, formatRelativeAge } from '@/lib/display-dates';
import { cn } from '@/lib/utils';

type SessionEntry = ChatSessionListEntry;

function SurfaceBadge({ surface }: { surface: string }) {
  if (surface === 'web') return null;
  const label = surface === 'telegram' ? 'TG' : surface === 'slack' ? 'SL' : 'EXT';
  const title =
    surface === 'telegram'
      ? 'Telegram conversation'
      : surface === 'slack'
        ? 'Slack conversation'
        : 'External conversation';
  return (
    <span
      title={title}
      aria-label={title}
      className="inline-flex shrink-0 rounded border border-border px-1 font-mono text-[9px] leading-4 text-muted-foreground"
    >
      {label}
    </span>
  );
}

function SessionAge({ updatedAt }: { updatedAt: string }) {
  const timezone = useWorkspaceTimezone();
  const absolute = formatDisplayDateTime(updatedAt, { timezone });
  return (
    <time
      dateTime={updatedAt}
      title={absolute}
      className="mt-0.5 block truncate font-mono text-[11px] leading-4 text-fg-dim"
    >
      {formatRelativeAge(updatedAt)}
    </time>
  );
}

function SessionSummary({ session }: { session: SessionEntry }) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        <SurfaceBadge surface={session.surface} />
        <span className="truncate">{chatSessionLabel(session)}</span>
      </span>
      {session.pinnedEntityName && !session.title && (
        <span className="block truncate text-[10px] text-fg-dim">
          Pinned · {session.pinnedEntityName}
        </span>
      )}
      <SessionAge updatedAt={session.updatedAt} />
    </>
  );
}

function SessionHairline() {
  return (
    <span
      aria-hidden="true"
      data-session-rule="true"
      className="mx-auto block h-px w-[60%] bg-border/40"
    />
  );
}

function SessionSearch({
  id,
  query,
  onQueryChange,
}: {
  id: string;
  query: string;
  onQueryChange: (value: string) => void;
}) {
  return (
    <label className="relative mb-3 block">
      <span className="sr-only">Search chats</span>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-dim"
      />
      <input
        id={id}
        type="search"
        value={query}
        onChange={(event) => {
          onQueryChange(event.target.value);
        }}
        placeholder="Search chats"
        className="h-9 w-full rounded-sm border border-border bg-bg py-1 pl-8 pr-2 text-sm text-fg outline-none transition-colors placeholder:text-fg-dim focus-visible:ring-2 focus-visible:ring-signal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      />
    </label>
  );
}

function NewChatButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={cn('justify-start px-2 text-fg-muted', className)}
    >
      <Plus aria-hidden="true" />
      New chat
    </Button>
  );
}

export function SessionSidebar(props: {
  sessions: SessionEntry[];
  activeSessionId: string | null;
}) {
  return (
    <Suspense fallback={null}>
      <SessionSidebarContent {...props} />
    </Suspense>
  );
}

function SessionSidebarContent({
  sessions,
  activeSessionId,
}: {
  sessions: SessionEntry[];
  activeSessionId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const dialog = useAppDialog();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const visibleSessions = useMemo(() => filterChatSessions(sessions, query), [sessions, query]);

  function newChat(): void {
    const params = new URLSearchParams(search.toString());
    params.delete('session');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <aside className="hidden h-full w-60 shrink-0 flex-col border-r border-border bg-surface p-3 md:flex">
      <NewChatButton onClick={newChat} className="mb-2 w-full" />
      <SessionSearch id="desktop-chat-search" query={query} onQueryChange={setQuery} />
      <div data-visual-dynamic="chat-sessions" className="min-h-0 flex-1">
        {sessions.length === 0 ? (
          <p className="px-1 text-xs text-fg-muted">
            No chats yet. Start a new chat to ask about your timeline.
          </p>
        ) : visibleSessions.length === 0 ? (
          <p className="px-1 text-xs text-fg-muted">No chats match that search.</p>
        ) : (
          <ul className="h-full overflow-y-auto">
            {visibleSessions.map((s, index) => {
              const isActive = s.id === activeSessionId;
              const label = chatSessionLabel(s);
              return (
                <li key={s.id} className="group relative">
                  {index > 0 ? <SessionHairline /> : null}
                  <Link
                    href={`/app/chat?session=${s.id}`}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'block rounded-sm px-2 py-1.5 pr-9 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                      isActive
                        ? 'bg-signal-soft text-signal'
                        : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                    )}
                  >
                    <SessionSummary session={s} />
                  </Link>
                  <ItemActionGroup
                    label={`Actions for ${label}`}
                    className="pointer-events-none absolute right-0.5 top-1 w-auto opacity-0 transition-opacity duration-[80ms] ease-out group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 motion-reduce:transition-none"
                  >
                    <button
                      type="button"
                      disabled={pending}
                      aria-label={`Archive chat: ${label}`}
                      onClick={async () => {
                        const confirmed = await dialog.confirm({
                          title: 'Archive chat?',
                          description: 'This hides the conversation from the sidebar.',
                          confirmLabel: 'Archive chat',
                          destructive: true,
                        });
                        if (!confirmed) return;
                        startTransition(async () => {
                          await archiveChatSessionAction({ sessionId: s.id });
                          if (isActive) {
                            const params = new URLSearchParams(search.toString());
                            params.delete('session');
                            router.push(
                              params.toString() ? `${pathname}?${params.toString()}` : pathname,
                            );
                          }
                          router.refresh();
                        });
                      }}
                      className="grid size-8 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
                    >
                      <Trash2 aria-hidden="true" className="size-3" />
                    </button>
                  </ItemActionGroup>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {dialog.node}
    </aside>
  );
}

export function MobileSessionNav(props: {
  sessions: SessionEntry[];
  activeSessionId: string | null;
}) {
  return (
    <Suspense fallback={null}>
      <MobileSessionNavContent {...props} />
    </Suspense>
  );
}

function MobileSessionNavContent({
  sessions,
  activeSessionId,
}: {
  sessions: SessionEntry[];
  activeSessionId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const dialog = useAppDialog();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const visibleSessions = useMemo(() => filterChatSessions(sessions, query), [sessions, query]);
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const activeTitle = activeSession ? chatSessionLabel(activeSession) : null;

  function newChat(): void {
    const params = new URLSearchParams(search.toString());
    params.delete('session');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <nav aria-label="Chat sessions" className="mb-3 shrink-0 md:hidden">
      <details className="group rounded-sm border border-border bg-surface">
        <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-medium marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
          <span className="min-w-0 truncate">
            {activeTitle ?? (activeSessionId ? 'Current chat' : 'Chats')}
          </span>
        </summary>
        <div className="max-h-56 space-y-2 overflow-y-auto border-t p-2">
          <NewChatButton onClick={newChat} className="w-full" />
          <SessionSearch id="mobile-chat-search" query={query} onQueryChange={setQuery} />
          {sessions.length === 0 ? (
            <p className="px-1 py-2 text-xs text-fg-muted">
              No chats yet. Start a new chat to ask about your timeline.
            </p>
          ) : visibleSessions.length === 0 ? (
            <p className="px-1 py-2 text-xs text-fg-muted">No chats match that search.</p>
          ) : (
            <ul data-visual-dynamic="mobile-chat-sessions">
              {visibleSessions.map((session, index) => {
                const isActive = session.id === activeSessionId;
                return (
                  <li key={session.id}>
                    {index > 0 ? <SessionHairline /> : null}
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/app/chat?session=${session.id}`}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'min-w-0 flex-1 rounded-sm px-2 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                          isActive
                            ? 'bg-signal-soft text-signal'
                            : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                        )}
                      >
                        <SessionSummary session={session} />
                      </Link>
                      <ItemActionGroup label={`Actions for ${chatSessionLabel(session)}`}>
                        <button
                          type="button"
                          disabled={pending}
                          aria-label={`Archive chat: ${chatSessionLabel(session)}`}
                          onClick={async () => {
                            const confirmed = await dialog.confirm({
                              title: 'Archive chat?',
                              description: 'This hides the conversation from the session list.',
                              confirmLabel: 'Archive chat',
                              destructive: true,
                            });
                            if (!confirmed) return;
                            startTransition(async () => {
                              await archiveChatSessionAction({ sessionId: session.id });
                              if (isActive) {
                                const params = new URLSearchParams(search.toString());
                                params.delete('session');
                                router.push(
                                  params.toString() ? `${pathname}?${params.toString()}` : pathname,
                                );
                              }
                              router.refresh();
                            });
                          }}
                          className="grid size-9 shrink-0 place-items-center rounded-sm text-fg-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
                        >
                          <Trash2 aria-hidden="true" className="size-3.5" />
                        </button>
                      </ItemActionGroup>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>
      {dialog.node}
    </nav>
  );
}
