'use client';

import { type ChatContextRef, mergeChatContextTrail } from '@timeline/shared/chat-context';
import { type UIMessage } from 'ai';
import { ExternalLink, MessageSquare, MessageSquarePlus, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { loadChatSessionAction } from '@/app/actions/chat';
import { ChatSurface } from '@/components/chat/chat-pane';
import { useCurrentChatView } from '@/components/chat/chat-view-context';
import { Button } from '@/components/ui/button';
import { chatShortcutLabel } from '@/lib/chat-view';
import { cn } from '@/lib/utils';

interface FloatingAgentChatProps {
  teamId: string;
  teamName: string;
}

interface FloatingSessionState {
  sessionId: string | null;
  initialMessages: UIMessage[];
  contextTrail: ChatContextRef[];
}

const EXCLUDED_PREFIXES = ['/app/chat'];

function isExcludedPath(pathname: string | null): boolean {
  if (!pathname) return true;
  return pathname === '/app' || EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
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
  const { current, dashboardContext } = useCurrentChatView();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('ready');
  const storageKey = `timeline:floating-agent-chat:${teamId}:session`;
  const [{ sessionId, initialMessages, contextTrail }, setSessionState] =
    useState<FloatingSessionState>(() => ({
      sessionId: readStoredSessionId(storageKey),
      initialMessages: [],
      contextTrail: [current],
    }));
  const hydratedSessionIdRef = useRef<string | null>(null);
  const sessionGenerationRef = useRef(0);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isStreaming = status === 'streaming' || status === 'submitted';
  const excluded = isExcludedPath(pathname);
  const liveTrail = mergeChatContextTrail(contextTrail, [current]);
  const pinnedEntityId = current.objectId ?? null;
  const resetFloatingSession = useCallback(() => {
    sessionGenerationRef.current += 1;
    window.localStorage.removeItem(storageKey);
    hydratedSessionIdRef.current = null;
    setSessionState({ sessionId: null, initialMessages: [], contextTrail: [current] });
  }, [current, storageKey]);

  useEffect(() => {
    setSessionState((state) => {
      const nextTrail = mergeChatContextTrail(state.contextTrail, [current]);
      if (
        nextTrail.length === state.contextTrail.length &&
        nextTrail.every((ref, index) => ref.href === state.contextTrail[index]?.href)
      ) {
        return state;
      }
      return { ...state, contextTrail: nextTrail };
    });
  }, [current]);

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
      setSessionState({ sessionId: null, initialMessages: [], contextTrail: [current] });
    };

    void loadChatSessionAction({ sessionId: activeSessionId })
      .then((loaded) => {
        if (hydratedSessionIdRef.current !== activeSessionId) return;
        if (loaded.ok) {
          setSessionState((state) =>
            state.sessionId === activeSessionId
              ? {
                  ...state,
                  initialMessages: loaded.messages ?? [],
                  contextTrail: mergeChatContextTrail(loaded.contextTrail ?? [], [current]),
                }
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
  }, [current, sessionId, storageKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isExcludedPath(pathname)) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'j') return;
      event.preventDefault();
      setOpen((value) => !value);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      launcherRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const showChrome = !excluded;
  const showPanel = open && showChrome;
  const mountChat = showPanel || isStreaming;
  const fullChatHref = sessionId ? `/app/chat?session=${sessionId}` : '/app/chat';
  const activeSessionGeneration = sessionGenerationRef.current;
  const shortcut = chatShortcutLabel();

  return (
    <>
      {showChrome ? (
        <Button
          ref={launcherRef}
          type="button"
          size="icon"
          aria-label={`Open floating agent chat (${shortcut})`}
          aria-expanded={open}
          aria-controls="floating-agent-chat-panel"
          title={`Ask · ${shortcut}`}
          className={cn(
            'fixed z-40 size-10 rounded-sm border border-border bg-surface text-fg shadow-lg shadow-black/10',
            'bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-[max(1.25rem,env(safe-area-inset-right))]',
            'hover:border-signal/40 hover:bg-signal-soft hover:text-signal',
            'focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
          )}
          onClick={() => {
            setOpen(true);
          }}
        >
          <MessageSquare className="size-4" />
          <span className="sr-only">{shortcut}</span>
        </Button>
      ) : null}

      {showPanel ? (
        <div
          className="fixed inset-0 z-[60] bg-bg/50 md:hidden"
          onClick={() => {
            setOpen(false);
            launcherRef.current?.focus();
          }}
        />
      ) : null}

      <div
        ref={panelRef}
        id="floating-agent-chat-panel"
        role="dialog"
        aria-modal={showPanel}
        aria-labelledby="floating-agent-chat-title"
        hidden={!showPanel}
        className={cn(
          'fixed z-[60] flex flex-col border-border bg-bg shadow-2xl shadow-black/20',
          'inset-x-0 bottom-0 h-[min(82dvh,42rem)] rounded-t-md border-t',
          'md:inset-auto md:bottom-20 md:right-5 md:h-[min(36rem,calc(100dvh-8rem))] md:w-[min(26rem,calc(100vw-2.5rem))] md:rounded-sm md:border',
          !showPanel && 'invisible pointer-events-none',
        )}
      >
        <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2.5">
          <div className="min-w-0">
            <h2 id="floating-agent-chat-title" className="truncate text-sm font-semibold text-fg">
              {current.label}
            </h2>
            <p className="truncate text-xs text-fg-muted">
              {shortcut}
              {liveTrail.length > 1 ? ` · ${String(liveTrail.length - 1)} earlier` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              type="button"
              className="size-8"
              aria-label="Start new conversation"
              title="New"
              onClick={resetFloatingSession}
            >
              <MessageSquarePlus className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-8" asChild aria-label="Open full chat">
              <Link href={fullChatHref}>
                <ExternalLink className="size-4" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              className="size-8"
              aria-label="Close floating agent chat"
              onClick={() => {
                setOpen(false);
                launcherRef.current?.focus();
              }}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
        {mountChat ? (
          <div className="min-h-0 flex-1 px-3 py-3">
            <ChatSurface
              key={activeSessionGeneration}
              compact
              teamId={teamId}
              teamName={teamName}
              sessionId={sessionId}
              initialMessages={initialMessages}
              pinnedEntityId={pinnedEntityId}
              pinnedEntityName={pinnedEntityId ? current.label : null}
              dashboardContext={dashboardContext}
              contextTrail={liveTrail}
              emptyHint={`Ask about ${current.label}`}
              onStatusChange={setStatus}
              onSessionIdChange={(id) => {
                if (activeSessionGeneration !== sessionGenerationRef.current) return;
                window.localStorage.setItem(storageKey, id);
                setSessionState((state) => ({ ...state, sessionId: id }));
              }}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}

function readStoredSessionId(storageKey: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(storageKey);
}
