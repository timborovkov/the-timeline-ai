'use client';

import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useTransition } from 'react';

import { archiveChatSessionAction } from '@/app/actions/chat';
import { useAppDialog } from '@/components/ui/app-dialog';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { cn } from '@/lib/utils';

interface SessionEntry {
  id: string;
  surface: string;
  title: string | null;
  pinnedEntityId: string | null;
  pinnedEntityName: string | null;
}

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

function sessionLabel(session: SessionEntry): string {
  return (
    session.title ??
    (session.pinnedEntityName ? `Chat about ${session.pinnedEntityName}` : 'Untitled chat')
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

  function newChat(): void {
    const params = new URLSearchParams(search.toString());
    params.delete('session');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <aside className="hidden h-full w-60 shrink-0 flex-col border-r border-border bg-surface p-3 md:flex">
      <button
        type="button"
        onClick={newChat}
        className="mb-3 flex min-h-9 items-center gap-2 rounded-sm border border-border px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <Plus aria-hidden="true" className="size-3.5" /> New chat
      </button>
      <div data-visual-dynamic="chat-sessions" className="min-h-0 flex-1">
        {sessions.length === 0 ? (
          <p className="px-1 text-xs text-fg-muted">
            No chats yet. Start a new chat to ask about your timeline.
          </p>
        ) : (
          <ul className="h-full space-y-1 overflow-y-auto">
            {sessions.map((s) => {
              const isActive = s.id === activeSessionId;
              const label = sessionLabel(s);
              return (
                <li key={s.id} className="group relative">
                  <Link
                    href={`/app/chat?session=${s.id}`}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'block truncate rounded-sm px-2 py-1.5 pr-10 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                      isActive
                        ? 'bg-signal-soft text-signal'
                        : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <SurfaceBadge surface={s.surface} />
                      <span className="truncate">{label}</span>
                    </span>
                    {s.pinnedEntityName && !s.title && (
                      <span className="block truncate text-[10px] text-fg-dim">
                        Pinned · {s.pinnedEntityName}
                      </span>
                    )}
                  </Link>
                  <ItemActionGroup
                    label={`Actions for ${label}`}
                    className="absolute right-1 top-1 w-auto"
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
          <span>{activeSessionId ? 'Current chat' : 'Chats'}</span>
          <span className="font-mono text-xs text-fg-muted">
            {sessions.length} session{sessions.length === 1 ? '' : 's'}
          </span>
        </summary>
        <div className="max-h-56 space-y-2 overflow-y-auto border-t p-2">
          <button
            type="button"
            onClick={newChat}
            className="flex min-h-9 w-full items-center gap-2 rounded-sm border border-border px-2 text-left text-sm font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <Plus aria-hidden="true" className="size-3.5" /> New chat
          </button>
          {sessions.length === 0 ? (
            <p className="px-1 py-2 text-xs text-fg-muted">
              No chats yet. Start a new chat to ask about your timeline.
            </p>
          ) : (
            <ul className="space-y-1" data-visual-dynamic="mobile-chat-sessions">
              {sessions.map((session) => {
                const isActive = session.id === activeSessionId;
                return (
                  <li key={session.id} className="flex items-center gap-1">
                    <Link
                      href={`/app/chat?session=${session.id}`}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'min-w-0 flex-1 truncate rounded-sm px-2 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                        isActive
                          ? 'bg-signal-soft text-signal'
                          : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <SurfaceBadge surface={session.surface} />
                        <span className="truncate">{sessionLabel(session)}</span>
                      </span>
                    </Link>
                    <ItemActionGroup label={`Actions for ${sessionLabel(session)}`}>
                      <button
                        type="button"
                        disabled={pending}
                        aria-label={`Archive chat: ${sessionLabel(session)}`}
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
