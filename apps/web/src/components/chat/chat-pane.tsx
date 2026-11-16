'use client';

import { useChat } from '@ai-sdk/react';
import {
  chatContextKey,
  mergeChatContextTrail,
  type ChatContextRef,
} from '@timeline/shared/chat-context';
import { numberCitations } from '@timeline/shared/citation';
import { getToolName, isToolUIPart } from 'ai';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from 'ai';
import { Send, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import type { ChatHandoff } from '@/lib/chat-handoff';
import type { DashboardChatContext } from '@/lib/dashboard-chat-context';
export type { DashboardChatContext } from '@/lib/dashboard-chat-context';

import { unpinChatSessionAction } from '@/app/actions/chat';
import { CitationText } from '@/components/chat/citation';
import { ToolStep } from '@/components/chat/tool-step';
import { InlineSpinner } from '@/components/loading-states';
import { consumeChatHandoffEntry } from '@/lib/chat-handoff';
import { chatRequestMessages } from '@/lib/chat-session';
import { displayObjectLabel } from '@/lib/display-labels';
import { notifyError } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { chatErrorMessage } from '@/lib/ux-errors';

interface Props {
  teamId: string;
  teamName: string;
  sessionId: string | null;
  initialMessages: UIMessage[];
  pinnedEntityId: string | null;
  pinnedEntityName: string | null;
  contextTrail?: ChatContextRef[];
  initialPrompt?: string | null;
  suggestionPrompts?: readonly string[];
  emptyTitle?: string | null;
  emptyHint?: string | null;
}

const SUGGESTIONS = [
  'What did the team work on yesterday?',
  'What was discussed with our biggest customer last week?',
  "What's outstanding right now?",
] as const;

export function ChatPane(props: Props) {
  return (
    <Suspense fallback={null}>
      <ChatSurface {...props} updateUrlOnSessionCreate />
    </Suspense>
  );
}

export function ChatSurface(
  props: Props & {
    compact?: boolean;
    dashboardContext?: DashboardChatContext | null;
    contextTrail?: ChatContextRef[];
    emptyHint?: string | null;
    onSessionIdChange?: (sessionId: string) => void;
    updateUrlOnSessionCreate?: boolean;
    consumeHandoff?: boolean;
  },
) {
  const initialSessionSeedRef = useRef(props.sessionId);
  return (
    <Suspense fallback={null}>
      <ChatSurfaceContent key={initialSessionSeedRef.current ?? 'new-chat-session'} {...props} />
    </Suspense>
  );
}

function ChatSurfaceContent({
  teamId,
  teamName,
  sessionId: initialSessionId,
  initialMessages,
  pinnedEntityId,
  pinnedEntityName,
  compact = false,
  dashboardContext,
  contextTrail,
  emptyHint,
  initialPrompt = null,
  suggestionPrompts,
  emptyTitle = null,
  onSessionIdChange,
  updateUrlOnSessionCreate = false,
  consumeHandoff = true,
}: Props & {
  compact?: boolean;
  dashboardContext?: DashboardChatContext | null;
  contextTrail?: ChatContextRef[];
  emptyHint?: string | null;
  onSessionIdChange?: (sessionId: string) => void;
  updateUrlOnSessionCreate?: boolean;
  consumeHandoff?: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const chatHandoffRef = useRef<ChatHandoff | null>(null);
  const [consumedHandoff, setConsumedHandoff] = useState<ChatHandoff | null>(null);
  const visibleTrail = mergeChatContextTrail(
    contextTrail ?? [],
    consumedHandoff?.contextTrail ?? [],
  );
  const { sessionId, transport } = useChatSessionTransport({
    initialSessionId,
    initialPinnedEntityId: pinnedEntityId,
    chatHandoffRef,
    search,
    dashboardContext,
    contextTrail: visibleTrail,
    onSessionIdChange,
    updateUrlOnSessionCreate,
  });
  const { messages, sendMessage, status, error, addToolApprovalResponse } = useChat({
    transport,
    messages: initialMessages,
    onFinish: ({ message }) => {
      if (
        message.parts.some(
          (part) =>
            isToolUIPart(part) &&
            getToolName(part).startsWith('execute_') &&
            part.state === 'output-available',
        )
      )
        router.refresh();
    },
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  const [input, setInput] = useState(initialPrompt ?? '');
  const scrollRef = useRef<HTMLDivElement>(null);
  const handoffConsumedRef = useRef(false);

  const isStreaming = status === 'streaming' || status === 'submitted';
  const handoffPin = initialSessionId === null ? consumedHandoff : null;
  const visiblePinnedEntity = handoffPin?.pinnedEntityId
    ? { id: handoffPin.pinnedEntityId, name: handoffPin.pinnedEntityName ?? null }
    : pinnedEntityId
      ? { id: pinnedEntityId, name: pinnedEntityName }
      : null;

  // react-doctor-disable-next-line react-doctor/no-event-handler -- One-time sessionStorage handoff can only run after mount; sending a Home prompt is that hydration, not a click handler.
  useEffect(() => {
    if (!consumeHandoff) return;
    // The SDK stops its chat during Strict Mode's effect cleanup. Consume and
    // send only after that setup/cleanup cycle, otherwise it cancels the prompt
    // before the request starts and the one-time handoff is already gone.
    let active = true;
    queueMicrotask(() => {
      if (!active || handoffConsumedRef.current) return;
      handoffConsumedRef.current = true;
      let handoff: ChatHandoff | null = null;
      try {
        handoff = consumeChatHandoffEntry(window.sessionStorage, teamId);
      } catch {
        return;
      }
      if (!handoff) return;
      chatHandoffRef.current = handoff;
      // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change, react-doctor/no-chain-state-updates -- This hydrates a consumed one-time sessionStorage message after SSR; it does not mirror a prop or chain derived state.
      setConsumedHandoff(handoff);
      // react-doctor-disable-next-line react-doctor/no-event-handler -- Home Ask stores the prompt in sessionStorage; sending it after mount is hydration, not a click handler.
      if (!initialSessionId && handoff.prompt) void sendMessage({ text: handoff.prompt });
    });
    return () => {
      active = false;
    };
  }, [consumeHandoff, initialMessages.length, initialSessionId, sendMessage, teamId]);

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
    <div className={cn('flex h-full min-h-0 flex-col', compact ? 'gap-3' : 'gap-4')}>
      <PinnedEntityBanner
        pinnedEntityId={visiblePinnedEntity?.id ?? null}
        pinnedEntityName={visiblePinnedEntity?.name ?? null}
        sessionId={sessionId}
        onUnpinned={() => {
          setConsumedHandoff(null);
          router.refresh();
        }}
      />
      <ChatContextBadges refs={visibleTrail} compact={compact} />
      <ChatTranscript
        compact={compact}
        emptyHint={emptyHint}
        emptyTitle={emptyTitle}
        suggestionPrompts={suggestionPrompts}
        isStreaming={isStreaming}
        messages={messages}
        onToolApprovalResponse={addToolApprovalResponse}
        onSuggestion={submit}
        scrollRef={scrollRef}
        teamName={teamName}
      />
      <ChatError error={error} />
      {sessionId && !isStreaming && messages.length > 0 && (
        <Link
          href={`/app/diagnostics?session=${encodeURIComponent(sessionId)}`}
          prefetch={false}
          className="inline-flex min-h-11 items-center text-sm text-fg-muted underline underline-offset-4"
        >
          Report an issue
        </Link>
      )}
      <ChatComposer input={input} isStreaming={isStreaming} onChange={setInput} onSubmit={submit} />
    </div>
  );
}

function useChatSessionTransport({
  initialSessionId,
  initialPinnedEntityId,
  chatHandoffRef,
  search,
  dashboardContext,
  contextTrail,
  onSessionIdChange,
  updateUrlOnSessionCreate,
}: {
  initialSessionId: string | null;
  initialPinnedEntityId: string | null;
  chatHandoffRef: RefObject<ChatHandoff | null>;
  search: URLSearchParams;
  dashboardContext?: DashboardChatContext | null;
  contextTrail?: ChatContextRef[];
  onSessionIdChange?: (sessionId: string) => void;
  updateUrlOnSessionCreate: boolean;
}) {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const sessionIdRef = useRef<string | null>(initialSessionId);
  const searchRef = useRef(search);
  const dashboardContextRef = useRef<DashboardChatContext | null | undefined>(dashboardContext);
  const contextTrailRef = useRef<ChatContextRef[] | undefined>(contextTrail);
  const pinnedEntityIdRef = useRef<string | null>(initialPinnedEntityId);
  const onSessionIdChangeRef = useRef(onSessionIdChange);
  const sessionCreateAttempted = useRef(initialSessionId !== null);
  const requestAskedForNewSession = useRef(false);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  useEffect(() => {
    dashboardContextRef.current = dashboardContext;
  }, [dashboardContext]);

  useEffect(() => {
    contextTrailRef.current = contextTrail;
  }, [contextTrail]);

  useEffect(() => {
    pinnedEntityIdRef.current = initialPinnedEntityId;
  }, [initialPinnedEntityId]);

  useEffect(() => {
    onSessionIdChangeRef.current = onSessionIdChange;
  }, [onSessionIdChange]);

  // Keep transport state aligned when the host page swaps `session=` in response
  // to navigation (for example opening a historical thread). -- event logic is
  // a prop-driven sync that must run outside interaction handlers.
  // react-doctor-disable-next-line react-doctor/no-event-handler
  useEffect(() => {
    sessionIdRef.current = initialSessionId;
    setSessionId(initialSessionId);
    // react-doctor-disable-next-line react-doctor/no-event-handler
    if (initialSessionId === null) {
      sessionCreateAttempted.current = false;
    }
  }, [initialSessionId]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        prepareSendMessagesRequest: ({ id, messages, body, trigger, messageId }) => ({
          body: { ...body, id, trigger, messageId, messages: chatRequestMessages(messages) },
        }),
        body: () => {
          const askForNew = sessionIdRef.current === null && !sessionCreateAttempted.current;
          if (askForNew) sessionCreateAttempted.current = true;
          requestAskedForNewSession.current = askForNew;
          const handoff = askForNew ? chatHandoffRef.current : null;
          return {
            sessionId: sessionIdRef.current ?? undefined,
            startNewSession: askForNew,
            pinnedEntityId: askForNew
              ? (handoff?.pinnedEntityId ?? pinnedEntityIdRef.current ?? undefined)
              : undefined,
            dashboardContext:
              chatHandoffRef.current?.context ?? dashboardContextRef.current ?? undefined,
            contextTrail: contextTrailRef.current,
          };
        },
        fetch: Object.assign(
          async (url: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
            try {
              const res = await fetch(url, init);
              if (!res.ok) {
                const data = (await res
                  .clone()
                  .json()
                  .catch(() => null)) as { error?: string } | null;
                throw new Error(chatErrorMessage(data?.error, res.status));
              }
              const id = res.headers.get('x-tl-session-id');
              if (id) {
                if (requestAskedForNewSession.current) chatHandoffRef.current = null;
                if (id !== sessionIdRef.current) {
                  sessionIdRef.current = id;
                  setSessionId(id);
                  onSessionIdChangeRef.current?.(id);
                  if (updateUrlOnSessionCreate && typeof window !== 'undefined') {
                    window.history.replaceState(
                      null,
                      '',
                      `/app/chat?session=${encodeURIComponent(id)}`,
                    );
                  }
                }
              } else if (requestAskedForNewSession.current && sessionIdRef.current === null) {
                sessionCreateAttempted.current = false;
              }
              requestAskedForNewSession.current = false;
              return res;
            } catch (error) {
              if (requestAskedForNewSession.current && sessionIdRef.current === null) {
                sessionCreateAttempted.current = false;
              }
              requestAskedForNewSession.current = false;
              throw error;
            }
          },
          { preconnect: globalThis.fetch.preconnect },
        ),
      }),
    [chatHandoffRef, updateUrlOnSessionCreate],
  );

  return { sessionId, transport };
}

function PinnedEntityBanner({
  pinnedEntityId,
  pinnedEntityName,
  sessionId,
  onUnpinned,
}: {
  pinnedEntityId: string | null;
  pinnedEntityName: string | null;
  sessionId: string | null;
  onUnpinned: () => void;
}) {
  if (!pinnedEntityId) return null;
  const displayLabel = displayObjectLabel(
    pinnedEntityName ? { canonicalName: pinnedEntityName } : null,
  );
  const label = displayLabel === 'Untitled object' ? 'Unavailable object' : displayLabel;
  return (
    <div className="flex shrink-0 items-center gap-2 self-start rounded-full border border-signal/30 bg-signal-soft py-1 pl-3 pr-1 text-xs">
      <Link
        href={`/app/objects/${pinnedEntityId}`}
        className="text-signal underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        About {label}
      </Link>
      {sessionId && (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={() => {
            void unpinChatSessionAction({ sessionId })
              .then(onUnpinned)
              .catch(() => {
                notifyError('chat:unpin', 'Couldn’t remove the pinned chat');
              });
          }}
          className="flex size-6 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-signal-soft hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <X aria-hidden="true" className="size-3" />
        </button>
      )}
    </div>
  );
}

function ChatContextBadges({ refs, compact }: { refs: ChatContextRef[]; compact: boolean }) {
  if (refs.length === 0) return null;
  return (
    <div
      className={cn('flex flex-wrap gap-1.5', compact && 'max-h-16 overflow-y-auto')}
      aria-label="Conversation context"
    >
      {refs.map((ref, index) => (
        <Link
          key={chatContextKey(ref)}
          href={ref.href}
          className={cn(
            'max-w-full truncate rounded-sm border px-2 py-0.5 text-xs no-underline',
            index === 0
              ? 'border-signal/30 bg-signal-soft text-signal'
              : 'border-border bg-surface text-fg-muted hover:text-fg',
          )}
          title={ref.label}
        >
          {ref.label}
        </Link>
      ))}
    </div>
  );
}

function ChatTranscript({
  compact,
  emptyHint,
  emptyTitle,
  suggestionPrompts,
  isStreaming,
  messages,
  onToolApprovalResponse,
  onSuggestion,
  scrollRef,
  teamName,
}: {
  compact: boolean;
  emptyHint?: string | null;
  emptyTitle?: string | null;
  suggestionPrompts?: readonly string[];
  isStreaming: boolean;
  messages: UIMessage[];
  onToolApprovalResponse: (input: { id: string; approved: boolean; reason?: string }) => void;
  onSuggestion: (text: string) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  teamName: string;
}) {
  return (
    <div
      ref={scrollRef}
      className={cn(
        'min-h-0 flex-1 overflow-y-auto',
        messages.length === 0 && !compact && 'flex flex-col justify-end',
      )}
    >
      {messages.length === 0 ? (
        <ChatEmptyState
          compact={compact}
          emptyHint={emptyHint}
          emptyTitle={emptyTitle}
          suggestionPrompts={suggestionPrompts}
          onSuggestion={onSuggestion}
          teamName={teamName}
        />
      ) : (
        <MessageList
          compact={compact}
          isStreaming={isStreaming}
          messages={messages}
          onToolApprovalResponse={onToolApprovalResponse}
        />
      )}
    </div>
  );
}

function ChatEmptyState({
  compact,
  emptyHint,
  emptyTitle,
  suggestionPrompts,
  onSuggestion,
  teamName,
}: {
  compact: boolean;
  emptyHint?: string | null;
  emptyTitle?: string | null;
  suggestionPrompts?: readonly string[];
  onSuggestion: (text: string) => void;
  teamName: string;
}) {
  const prompts = suggestionPrompts ?? SUGGESTIONS;
  if (compact) {
    return (
      <p className="pt-1 text-sm text-fg-muted">
        {emptyHint ?? `Ask about ${teamName}'s timeline`}
      </p>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-8 sm:py-12">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-fg">
          {emptyTitle ?? `Ask anything about ${teamName}'s timeline`}
        </h2>
        {emptyHint ? <p className="mt-2 text-sm leading-6 text-fg-muted">{emptyHint}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {prompts.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => {
              onSuggestion(suggestion);
            }}
            className="rounded-sm border border-border bg-surface px-3 py-2.5 text-left text-sm text-fg-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-fg"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageList({
  compact,
  isStreaming,
  messages,
  onToolApprovalResponse,
}: {
  compact: boolean;
  isStreaming: boolean;
  messages: UIMessage[];
  onToolApprovalResponse: (input: { id: string; approved: boolean; reason?: string }) => void;
}) {
  return (
    <ol className={cn('flex flex-col', compact ? 'gap-4' : 'gap-6')}>
      {messages.map((message) => (
        <ChatMessage
          key={message.id}
          message={message}
          isActive={isStreaming && message.id === messages.at(-1)?.id}
          canApprove={message.id === messages.at(-1)?.id}
          onToolApprovalResponse={onToolApprovalResponse}
        />
      ))}
      {isStreaming && (
        <li>
          <InlineSpinner label="Thinking…" />
        </li>
      )}
    </ol>
  );
}

function ChatMessage({
  message,
  isActive,
  canApprove,
  onToolApprovalResponse,
}: {
  message: UIMessage;
  isActive: boolean;
  canApprove: boolean;
  onToolApprovalResponse: (input: { id: string; approved: boolean; reason?: string }) => void;
}) {
  const isUser = message.role === 'user';
  const citationNumbers = useMemo(
    () =>
      numberCitations(
        message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n'),
      ),
    [message.parts],
  );
  return (
    <li className={cn('flex flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}>
      <span className="px-1 text-xs text-fg-dim">{isUser ? 'You' : 'Agent'}</span>
      <div
        className={cn(
          'max-w-[90%] text-sm leading-relaxed',
          isUser
            ? 'rounded-sm bg-surface-2 px-4 py-2.5 text-fg'
            : 'border-l-2 border-signal bg-transparent py-1 pl-4 pr-1 text-fg',
        )}
      >
        <div className="space-y-2">
          {message.parts.map((part, idx) => (
            <ChatMessagePart
              key={`${message.id}-${String(idx)}`}
              citationNumbers={citationNumbers}
              part={part}
              isActive={isActive}
              canApprove={canApprove}
              onToolApprovalResponse={onToolApprovalResponse}
            />
          ))}
        </div>
      </div>
    </li>
  );
}

function ChatMessagePart({
  citationNumbers,
  isActive,
  canApprove,
  part,
  onToolApprovalResponse,
}: {
  citationNumbers: Map<string, number>;
  part: UIMessage['parts'][number];
  isActive: boolean;
  canApprove: boolean;
  onToolApprovalResponse: (input: { id: string; approved: boolean; reason?: string }) => void;
}) {
  if (part.type === 'text') {
    return <CitationText numbers={citationNumbers} text={part.text} />;
  }
  if (part.type === 'data-tool-history') {
    const data = part.data as { name: string; state: string; input?: unknown };
    return <ToolStep name={data.name} state={data.state} input={data.input} />;
  }
  if (!isToolUIPart(part)) return null;
  return (
    <ToolStep
      name={getToolName(part)}
      state={
        part.state === 'approval-requested' && !canApprove ? 'approval-unavailable' : part.state
      }
      input={part.input}
      output={part.output}
      errorText={part.errorText}
      isActive={isActive}
      approval={part.approval}
      onApprovalResponse={onToolApprovalResponse}
    />
  );
}

function ChatError({ error }: { error: Error | undefined }) {
  if (!error) return null;
  return (
    <div role="alert" className="shrink-0 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2">
      <p className="text-sm text-danger">{error.message || 'Unable to answer right now.'}</p>
      <p className="mt-1 text-xs text-fg-muted">
        Check your connection and send your question again. Timeline history is still available.
      </p>
    </div>
  );
}

function ChatComposer({
  input,
  isStreaming,
  onChange,
  onSubmit,
}: {
  input: string;
  isStreaming: boolean;
  onChange: (value: string) => void;
  onSubmit: (text: string) => void;
}) {
  return (
    <div className="shrink-0">
      <div className="relative rounded-sm border border-border bg-surface focus-within:border-border-strong focus-within:ring-2 focus-within:ring-signal/40 focus-within:ring-offset-2 focus-within:ring-offset-bg">
        <label htmlFor="chat-composer" className="sr-only">
          Ask the timeline
        </label>
        <input
          id="chat-composer"
          name="message"
          type="text"
          maxLength={4000}
          value={input}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSubmit(input);
          }}
          placeholder="Ask the timeline…"
          disabled={isStreaming}
          className="h-10 w-full truncate rounded-sm bg-transparent pl-3 pr-12 text-base focus:outline-none sm:text-sm"
        />
        <button
          type="button"
          onClick={() => {
            onSubmit(input);
          }}
          disabled={isStreaming || !input.trim()}
          aria-label="Send"
          className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-sm bg-signal text-signal-fg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-30"
        >
          <Send aria-hidden="true" className="size-4" />
        </button>
      </div>
    </div>
  );
}
