'use client';

import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useTransition } from 'react';

import { archiveChatSessionAction } from '@/app/actions/chat';
import { useAppDialog } from '@/components/ui/app-dialog';
import { cn } from '@/lib/utils';

interface SessionEntry {
  id: string;
  title: string | null;
  pinnedEntityId: string | null;
  pinnedEntityName: string | null;
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
    <aside className="hidden h-full w-60 shrink-0 flex-col border-r bg-card/40 p-3 md:flex">
      <button
        type="button"
        onClick={newChat}
        className="mb-3 flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
      >
        <Plus className="size-3.5" /> New chat
      </button>
      <div data-visual-dynamic="chat-sessions" className="min-h-0 flex-1">
        {sessions.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">No chats yet.</p>
        ) : (
          <ul className="h-full space-y-1 overflow-y-auto">
            {sessions.map((s) => {
              const isActive = s.id === activeSessionId;
              const label = sessionLabel(s);
              return (
                <li key={s.id} className="group relative">
                  <Link
                    href={`/app/chat?session=${s.id}`}
                    className={cn(
                      'block truncate rounded-md px-2 py-1.5 pr-7 text-sm',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground/80 hover:bg-accent/60',
                    )}
                  >
                    <span className="block truncate">{label}</span>
                    {s.pinnedEntityName && !s.title && (
                      <span className="block truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                        pinned · {s.pinnedEntityName}
                      </span>
                    )}
                  </Link>
                  <button
                    type="button"
                    disabled={pending}
                    aria-label="Archive chat"
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
                    className="absolute right-1 top-1.5 hidden rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:block"
                  >
                    <Trash2 className="size-3" />
                  </button>
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

  function newChat(): void {
    const params = new URLSearchParams(search.toString());
    params.delete('session');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <nav aria-label="Chat sessions" className="mb-3 shrink-0 md:hidden">
      <details className="group rounded-md border bg-card/40">
        <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-medium marker:hidden">
          <span>{activeSessionId ? 'Current chat' : 'Chats'}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {sessions.length} session{sessions.length === 1 ? '' : 's'}
          </span>
        </summary>
        <div className="max-h-56 space-y-2 overflow-y-auto border-t p-2">
          <button
            type="button"
            onClick={newChat}
            className="flex min-h-9 w-full items-center gap-2 rounded-md border px-2 text-left text-sm font-medium hover:bg-accent"
          >
            <Plus className="size-3.5" /> New chat
          </button>
          {sessions.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">No chats yet.</p>
          ) : (
            <ul className="space-y-1" data-visual-dynamic="mobile-chat-sessions">
              {sessions.map((session) => {
                const isActive = session.id === activeSessionId;
                return (
                  <li key={session.id}>
                    <Link
                      href={`/app/chat?session=${session.id}`}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'block truncate rounded-md px-2 py-2 text-sm',
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-foreground/80 hover:bg-accent/60',
                      )}
                    >
                      {sessionLabel(session)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>
    </nav>
  );
}
