'use client';

import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { archiveChatSessionAction } from '@/app/actions/chat';
import { cn } from '@/lib/utils';

interface SessionEntry {
  id: string;
  title: string | null;
  pinnedEntityId: string | null;
  pinnedEntityName: string | null;
  updatedAt: string;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
}: {
  sessions: SessionEntry[];
  activeSessionId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  function newChat(): void {
    const params = new URLSearchParams(search.toString());
    params.delete('session');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r bg-card/40 p-3">
      <button
        type="button"
        onClick={newChat}
        className="mb-3 flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20"
      >
        <Plus className="h-3.5 w-3.5" /> New chat
      </button>
      {sessions.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">No chats yet.</p>
      ) : (
        <ul className="flex-1 space-y-1 overflow-y-auto">
          {sessions.map((s) => {
            const isActive = s.id === activeSessionId;
            const label = s.title ?? (s.pinnedEntityName ? `Chat about ${s.pinnedEntityName}` : 'Untitled chat');
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
                  onClick={() => {
                    if (!confirm('Archive this chat?')) return;
                    startTransition(async () => {
                      await archiveChatSessionAction({ sessionId: s.id });
                      if (isActive) {
                        const params = new URLSearchParams(search.toString());
                        params.delete('session');
                        router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
                      }
                      router.refresh();
                    });
                  }}
                  className="absolute right-1 top-1.5 hidden rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:block"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
