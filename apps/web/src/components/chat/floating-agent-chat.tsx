'use client';

import { type UIMessage } from 'ai';
import { ExternalLink, MessageSquare, MessageSquarePlus, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { loadChatSessionAction } from '@/app/actions/chat';
import { ChatSurface, type DashboardChatContext } from '@/components/chat/chat-pane';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface FloatingAgentChatProps {
  teamId: string;
  teamName: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
interface FloatingSessionState {
  sessionId: string | null;
  initialMessages: UIMessage[];
}

export function FloatingAgentChat({ teamId, teamName }: FloatingAgentChatProps) {
  return (
    <Suspense fallback={null}>
      <FloatingAgentChatContent key={teamId} teamId={teamId} teamName={teamName} />
    </Suspense>
  );
}

function FloatingAgentChatContent({ teamId, teamName }: FloatingAgentChatProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const storageKey = `timeline:floating-agent-chat:${teamId}:session`;
  const [{ sessionId, initialMessages }, setSessionState] = useState<FloatingSessionState>(() => ({
    sessionId: readStoredSessionId(storageKey),
    initialMessages: [],
  }));
  const hydratedSessionIdRef = useRef<string | null>(null);
  const sessionGenerationRef = useRef(0);
  const context = useMemo(
    () => buildDashboardChatContext(pathname, searchParams),
    [pathname, searchParams],
  );
  const resetFloatingSession = () => {
    sessionGenerationRef.current += 1;
    window.localStorage.removeItem(storageKey);
    hydratedSessionIdRef.current = null;
    setSessionState({ sessionId: null, initialMessages: [] });
  };

  useEffect(() => {
    if (!sessionId) {
      hydratedSessionIdRef.current = null;
      return;
    }

    if (hydratedSessionIdRef.current === sessionId) return;
    const activeSessionId = sessionId;
    hydratedSessionIdRef.current = activeSessionId;
    const clearStaleSession = () => {
      if (hydratedSessionIdRef.current !== activeSessionId) return;
      window.localStorage.removeItem(storageKey);
      hydratedSessionIdRef.current = null;
      setSessionState({ sessionId: null, initialMessages: [] });
    };

    void loadChatSessionAction({ sessionId: activeSessionId })
      .then((loaded) => {
        if (hydratedSessionIdRef.current !== activeSessionId) return;
        if (loaded.ok) {
          setSessionState((state) =>
            state.sessionId === activeSessionId
              ? { ...state, initialMessages: loaded.messages ?? [] }
              : state,
          );
        } else {
          clearStaleSession();
        }
      })
      .catch(() => {
        if (hydratedSessionIdRef.current !== activeSessionId) return;
        clearStaleSession();
      });
  }, [sessionId, storageKey]);

  if (!pathname || pathname.startsWith('/app/chat')) return null;

  const fullChatHref = sessionId ? `/app/chat?session=${sessionId}` : '/app/chat';
  const activeSessionGeneration = sessionGenerationRef.current;

  return (
    <>
      <Button
        type="button"
        aria-label="Open floating agent chat"
        className={cn(
          'fixed bottom-5 right-5 z-40 hidden h-11 gap-2 rounded-sm border border-signal/40 bg-signal px-4 text-signal-fg shadow-lg shadow-black/10 sm:inline-flex',
          'hover:bg-signal/90 focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        )}
        onClick={() => {
          setOpen(true);
        }}
      >
        <MessageSquare className="size-4" />
        <span className="hidden sm:inline">Ask</span>
      </Button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) resetFloatingSession();
        }}
      >
        <DialogContent
          className="flex h-[min(720px,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] flex-col border-border bg-bg p-0 sm:max-w-2xl"
          showCloseButton={false}
        >
          <DialogHeader className="flex-row items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <DialogTitle className="truncate text-base">Ask {teamName}</DialogTitle>
              <DialogDescription className="truncate">
                {context.routeKind === 'dashboard'
                  ? 'Context from the current dashboard page is included.'
                  : `Context: ${context.routeKind}`}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                type="button"
                className="shrink-0"
                aria-label="Start new conversation"
                title="Start new conversation"
                onClick={resetFloatingSession}
              >
                <MessageSquarePlus className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                asChild
                aria-label="Open full chat"
              >
                <Link href={fullChatHref}>
                  <ExternalLink className="size-4" />
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                className="shrink-0"
                aria-label="Close floating agent chat"
                onClick={() => {
                  setOpen(false);
                  resetFloatingSession();
                }}
              >
                <X className="size-4" />
              </Button>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 p-4">
            <ChatSurface
              key={activeSessionGeneration}
              compact
              teamName={teamName}
              sessionId={sessionId}
              initialMessages={initialMessages}
              pinnedEntityId={null}
              pinnedEntityName={null}
              dashboardContext={context}
              onSessionIdChange={(id) => {
                if (activeSessionGeneration !== sessionGenerationRef.current) {
                  return;
                }
                window.localStorage.setItem(storageKey, id);
                setSessionState((state) => ({ ...state, sessionId: id }));
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function readStoredSessionId(storageKey: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(storageKey);
}

function buildDashboardChatContext(
  pathname: string | null,
  searchParams: URLSearchParams,
): DashboardChatContext {
  const path = pathname ?? '/app';
  const segments = path.split('/').filter(Boolean);
  const search: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (value) search[key] = value;
  }
  const context: DashboardChatContext = {
    pathname: path,
    routeKind: routeKind(path, segments),
  };
  if (Object.keys(search).length > 0) context.search = search;
  if (segments[1] === 'objects' && isUuid(segments[2])) context.objectId = segments[2];
  if (segments[1] === 'boards' && isUuid(segments[2])) context.boardId = segments[2];
  if (segments[1] === 'documents' && isUuid(segments[2])) context.documentId = segments[2];
  if (segments[1] === 'tasks' && isUuid(search.id)) context.taskId = search.id;
  if (segments[1] === 'calendar') {
    if (search.date) context.calendarDate = search.date;
    if (search.view) context.calendarView = search.view;
    if (isUuid(search.event)) context.calendarEventId = search.event;
  }
  if (isUuid(search.item)) context.boardItemId = search.item;
  return context;
}

function routeKind(pathname: string, segments: string[]): string {
  if (pathname === '/app') return 'home';
  if (segments[0] !== 'app') return 'dashboard';
  return segments[1] ?? 'dashboard';
}

function isUuid(value: string | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
