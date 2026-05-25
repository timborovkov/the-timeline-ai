'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Send, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CitationText } from './citation';
import { ToolStep } from './tool-step';

import { unpinChatSessionAction } from '@/app/actions/chat';
import { InlineSpinner } from '@/components/loading-states';
import { cn } from '@/lib/utils';

interface Props {
  teamName: string;
  sessionId: string | null;
  initialMessages: UIMessage[];
  pinnedEntityId: string | null;
  pinnedEntityName: string | null;
}

const SUGGESTIONS = [
  'What did the team work on yesterday?',
  'What was discussed with our biggest customer last week?',
  "What's outstanding right now?",
] as const;

export function ChatPane({
  teamName,
  sessionId: initialSessionId,
  initialMessages,
  pinnedEntityId,
  pinnedEntityName,
}: Props) {
  const router = useRouter();
  const search = useSearchParams();
  // Local sessionId so we can pick up an auto-created session id from the
  // first response without forcing a full server round-trip. We then mirror
  // it into the URL via router.replace so a reload lands on the same chat.
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);

  // `useChat` constructs the underlying Chat (and the transport we hand it)
  // once per mount via useRef — the transport's body/fetch closures are
  // FROZEN to whatever `sessionId` was on first render. Without the ref
  // mirror below, every turn after the first re-sends startNewSession=true
  // and the server creates a fresh chat_sessions row per turn, fragmenting
  // the conversation across rows. Mirror state into a ref so the closures
  // always read the latest sessionId.
  const sessionIdRef = useRef<string | null>(initialSessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  // `search` is a stable reference from next/navigation, but capture it
  // in a ref so the transport's fetch closure doesn't snapshot a stale
  // URLSearchParams on a query-param change.
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });
  // Track whether we've already asked the server to create a session this
  // ChatPane lifetime. Without this, if server-side `createChatSession`
  // throws (pinned object missing, DB blip, etc.), the route logs and
  // falls back to no-persistence — but `sessionIdRef.current` stays null,
  // so the next user message would send `startNewSession: true` AGAIN,
  // and we'd either loop on the same failure or spawn a fresh chat row
  // per message once it recovers. After the first attempt we let
  // persistence stay off for the rest of this ChatPane; refreshing
  // re-tries.
  const sessionCreateAttempted = useRef(initialSessionId !== null);

  // useMemo so the Chat instance picks up exactly one transport. The deps
  // array is empty on purpose — we want the transport stable across renders
  // since the closures already read via refs.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: () => {
          // Ask the server to create a session only once per ChatPane
          // lifetime. After the first request fires, future ones either
          // (a) ride the session id we picked up from the response header,
          // or (b) stream without persistence if creation failed.
          const askForNew = sessionIdRef.current === null && !sessionCreateAttempted.current;
          if (askForNew) sessionCreateAttempted.current = true;
          return {
            sessionId: sessionIdRef.current ?? undefined,
            startNewSession: askForNew,
          };
        },
        fetch: async (url, init) => {
          const res = await fetch(url, init);
          const id = res.headers.get('x-tl-session-id');
          if (id && id !== sessionIdRef.current) {
            // Update the ref SYNCHRONOUSLY before scheduling the
            // setSessionId re-render. The body() closure on the next
            // sendMessage call reads from sessionIdRef.current — if we
            // wait for the useEffect to mirror state into the ref, a
            // rapid second message will fire with sessionIdRef.current
            // still null, send startNewSession=true, and the server will
            // create a SECOND chat_sessions row that fragments the
            // conversation.
            sessionIdRef.current = id;
            setSessionId(id);
            // Update the URL via window.history.replaceState rather than
            // router.replace: the latter triggers a Next.js server-component
            // refetch, which would re-render the parent `/app/chat` page and
            // recompute `activeSessionId` from the new URL. Because the
            // parent keys ChatPane on `activeSessionId`, the change would
            // remount ChatPane mid-stream — unmounting the useChat instance
            // that is currently reading the response body, dropping the
            // assistant turn, skipping onFinish, and erasing the
            // conversation visually. window.history.replaceState only
            // touches the address bar (still survives reload + correct
            // deep-link); the sidebar highlight catches up on the next
            // user-initiated navigation.
            if (typeof window !== 'undefined') {
              const params = new URLSearchParams(searchRef.current.toString());
              params.set('session', id);
              window.history.replaceState(null, '', `/app/chat?${params.toString()}`);
            }
          }
          return res;
        },
      }),
    [],
  );

  const { messages, sendMessage, status, error } = useChat({
    transport,
    messages: initialMessages,
  });

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const isStreaming = status === 'streaming' || status === 'submitted';

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, status]);

  function submit(text: string) {
    const t = text.trim();
    if (!t || isStreaming) return;
    setInput('');
    void sendMessage({ text: t });
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {pinnedEntityId && (
        <div className="flex shrink-0 items-center gap-2 self-start rounded-full border border-primary/30 bg-primary/5 py-1 pl-3 pr-1 text-xs">
          <Link href={`/app/objects/${pinnedEntityId}`} className="text-primary hover:underline">
            pinned · {pinnedEntityName ?? pinnedEntityId}
          </Link>
          {sessionId && (
            <button
              type="button"
              aria-label="Unpin"
              onClick={() => {
                void unpinChatSessionAction({ sessionId }).then(() => {
                  router.refresh();
                });
              }}
              className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-6 pt-8">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Try asking
              </p>
              <h2 className="mt-2 text-xl font-medium tracking-tight">
                Ask anything about {teamName}'s timeline
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    submit(s);
                  }}
                  className="rounded-full border bg-card px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent/40 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-6">
            {messages.map((m: UIMessage) => {
              const isUser = m.role === 'user';
              return (
                <li
                  key={m.id}
                  className={cn('flex flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}
                >
                  <span className="px-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {isUser ? 'You' : teamName}
                  </span>
                  <div
                    className={cn(
                      'max-w-[90%] rounded-2xl text-sm',
                      isUser
                        ? 'rounded-br-md bg-secondary px-4 py-3 text-secondary-foreground'
                        : 'border-l-2 border-primary/60 bg-transparent py-1 pl-4 pr-1',
                    )}
                  >
                    <div className="space-y-2">
                      {m.parts.map((part, idx) => {
                        const key = `${m.id}-${String(idx)}`;
                        if (part.type === 'text') {
                          return <CitationText key={key} text={part.text} />;
                        }
                        if (part.type.startsWith('tool-')) {
                          const toolPart = part as unknown as {
                            type: string;
                            toolCallId: string;
                            state: string;
                            input?: unknown;
                            output?: unknown;
                          };
                          return (
                            <ToolStep
                              key={key}
                              name={toolPart.type.slice('tool-'.length)}
                              state={toolPart.state}
                              input={toolPart.input}
                              output={toolPart.output}
                            />
                          );
                        }
                        return null;
                      })}
                    </div>
                  </div>
                </li>
              );
            })}
            {isStreaming && (
              <li>
                <InlineSpinner label="Thinking…" />
              </li>
            )}
          </ol>
        )}
      </div>

      {error && (
        <p className="shrink-0 text-sm text-destructive">
          {error.message || 'Chat failed. Make sure OPENROUTER_API_KEY is configured.'}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="shrink-0"
      >
        <div className="relative rounded-xl border bg-card shadow-sm">
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
            }}
            placeholder="Ask anything about your team's timeline…"
            disabled={isStreaming}
            className="h-14 w-full rounded-xl bg-transparent pl-5 pr-14 text-sm focus:outline-none"
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            aria-label="Send"
            className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
