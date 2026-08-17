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
import { storeChatContextHandoff } from '@/lib/chat-handoff';
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
  ready: boolean;
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
  const [{ open, activated }, setPanel] = useState({ open: false, activated: false });
  const storageKey = `timeline:floating-agent-chat:${teamId}:session`;
  const [{ sessionId, initialMessages, ready: sessionReady }, setSessionState] =
    useState<FloatingSessionState>(() => {
      const storedSessionId = readStoredSessionId(storageKey);
      return {
        sessionId: storedSessionId,
        initialMessages: [],
        contextTrail: [],
        ready: storedSessionId === null,
      };
    });
  const hydratedSessionIdRef = useRef<string | null>(null);
  const sessionGenerationRef = useRef(0);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const trailRef = useRef<ChatContextRef[]>([]);
  const openRef = useRef(open);
  const pathnameRef = useRef(pathname);
  openRef.current = open;
  pathnameRef.current = pathname;
  const excluded = isExcludedPath(pathname);
  const isFullAsk = pathname.startsWith('/app/chat');
  // Accumulate during render so navigation is not one effect behind. Skip Home
  // and full Ask so those routes do not become trail entries.
  const liveTrail = excluded
    ? trailRef.current
    : mergeChatContextTrail(trailRef.current, [current]);
  if (!excluded) trailRef.current = liveTrail;
  const pinnedEntityId = current.objectId ?? null;
  const showChrome = !excluded;
  const showPanel = open && showChrome;
  const mountChat = activated && sessionReady && !isFullAsk;
  const openPanel = useCallback(() => {
    setPanel({ open: true, activated: true });
  }, []);
  const closePanel = useCallback(() => {
    setPanel((panel) => ({ ...panel, open: false }));
    launcherRef.current?.focus();
  }, []);
  const resetFloatingSession = useCallback(() => {
    sessionGenerationRef.current += 1;
    window.localStorage.removeItem(storageKey);
    hydratedSessionIdRef.current = null;
    trailRef.current = excluded ? [] : [current];
    setSessionState({ sessionId: null, initialMessages: [], contextTrail: [], ready: true });
  }, [current, excluded, storageKey]);

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
      trailRef.current = excluded ? [] : [current];
      setSessionState({ sessionId: null, initialMessages: [], contextTrail: [], ready: true });
    };

    void loadChatSessionAction({ sessionId: activeSessionId })
      .then((loaded) => {
        if (hydratedSessionIdRef.current !== activeSessionId) return;
        if (loaded.ok) {
          const nextTrail = mergeChatContextTrail(
            loaded.contextTrail ?? [],
            excluded ? [] : [current],
          );
          trailRef.current = mergeChatContextTrail(trailRef.current, nextTrail);
          setSessionState((state) =>
            state.sessionId === activeSessionId
              ? {
                  ...state,
                  initialMessages: loaded.messages ?? [],
                  contextTrail: trailRef.current,
                  ready: true,
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
  }, [current, excluded, sessionId, storageKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && openRef.current) {
        event.preventDefault();
        setPanel((panel) => ({ ...panel, open: false }));
        launcherRef.current?.focus();
        return;
      }
      if (isExcludedPath(pathnameRef.current)) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'j') return;
      event.preventDefault();
      setPanel((panel) =>
        panel.open ? { ...panel, open: false } : { open: true, activated: true },
      );
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (!showPanel) return;
    const main = document.getElementById('main');
    if (!main) return;
    const previous = main.style.overflowY;
    main.style.overflowY = 'hidden';
    return () => {
      main.style.overflowY = previous;
    };
  }, [showPanel]);

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
          onClick={openPanel}
        >
          <MessageSquare className="size-4" />
          <span className="sr-only">{shortcut}</span>
        </Button>
      ) : null}

      {showPanel ? (
        <button
          type="button"
          aria-label="Dismiss chat overlay"
          className="fixed inset-0 z-[60] bg-bg/50 md:hidden"
          onClick={closePanel}
        />
      ) : null}

      <dialog
        id="floating-agent-chat-panel"
        aria-labelledby="floating-agent-chat-title"
        open={showPanel}
        aria-modal="false"
        inert={!showPanel}
        className={cn(
          'fixed z-[60] m-0 flex-col border-border bg-bg p-0 shadow-2xl shadow-black/20',
          'inset-x-0 top-auto bottom-0 h-[min(82dvh,42rem)] max-h-none w-screen max-w-none rounded-t-md border-t',
          'md:inset-auto md:bottom-20 md:right-5 md:h-[min(36rem,calc(100dvh-8rem))] md:w-[min(26rem,calc(100vw-2.5rem))] md:rounded-sm md:border',
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
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              asChild
              aria-label="Open full chat"
            >
              <Link
                href={fullChatHref}
                onClick={() => {
                  storeChatContextHandoff(window.sessionStorage, teamId, {
                    context: dashboardContext,
                    contextTrail: liveTrail,
                    ...(pinnedEntityId
                      ? {
                          pinnedEntityId,
                          pinnedEntityName: current.label,
                        }
                      : {}),
                  });
                }}
              >
                <ExternalLink className="size-4" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              className="size-8"
              aria-label="Close floating agent chat"
              onClick={closePanel}
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
              consumeHandoff={false}
              onSessionIdChange={(id) => {
                if (activeSessionGeneration !== sessionGenerationRef.current) return;
                window.localStorage.setItem(storageKey, id);
                setSessionState((state) => ({ ...state, sessionId: id, ready: true }));
              }}
            />
          </div>
        ) : null}
      </dialog>
    </>
  );
}

function readStoredSessionId(storageKey: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(storageKey);
}
