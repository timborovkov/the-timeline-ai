'use client';

import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from 'ai';
import { Send, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { unpinChatSessionAction } from '@/app/actions/chat';
import { CitationText } from '@/components/chat/citation';
import { ToolStep } from '@/components/chat/tool-step';
import { InlineSpinner } from '@/components/loading-states';
import { cn } from '@/lib/utils';
import { chatErrorMessage } from '@/lib/ux-errors';

interface Props {
  teamName: string;
  sessionId: string | null;
  initialMessages: UIMessage[];
  pinnedEntityId: string | null;
  pinnedEntityName: string | null;
}

export interface DashboardChatContext {
  pathname: string;
  routeKind: string;
  search?: Record<string, string>;
  objectId?: string;
  boardId?: string;
  boardItemId?: string;
  calendarDate?: string;
  calendarView?: string;
  calendarEventId?: string;
  documentId?: string;
  taskId?: string;
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
    onSessionIdChange?: (sessionId: string) => void;
    updateUrlOnSessionCreate?: boolean;
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
  teamName,
  sessionId: initialSessionId,
  initialMessages,
  pinnedEntityId,
  pinnedEntityName,
  compact = false,
  dashboardContext,
  onSessionIdChange,
  updateUrlOnSessionCreate = false,
}: Props & {
  compact?: boolean;
  dashboardContext?: DashboardChatContext | null;
  onSessionIdChange?: (sessionId: string) => void;
  updateUrlOnSessionCreate?: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const { sessionId, transport } = useChatSessionTransport({
    initialSessionId,
    search,
    dashboardContext,
    onSessionIdChange,
    updateUrlOnSessionCreate,
  });
  const { messages, sendMessage, status, error, addToolApprovalResponse } = useChat({
    transport,
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
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
    <div className={cn('flex h-full min-h-0 flex-col', compact ? 'gap-3' : 'gap-4')}>
      <PinnedEntityBanner
        pinnedEntityId={pinnedEntityId}
        pinnedEntityName={pinnedEntityName}
        sessionId={sessionId}
        onUnpinned={() => {
          router.refresh();
        }}
      />
      <ChatTranscript
        compact={compact}
        isStreaming={isStreaming}
        messages={messages}
        onToolApprovalResponse={addToolApprovalResponse}
        onSuggestion={submit}
        scrollRef={scrollRef}
        teamName={teamName}
      />
      <ChatError error={error} />
      <ChatComposer input={input} isStreaming={isStreaming} onChange={setInput} onSubmit={submit} />
    </div>
  );
}

function useChatSessionTransport({
  initialSessionId,
  search,
  dashboardContext,
  onSessionIdChange,
  updateUrlOnSessionCreate,
}: {
  initialSessionId: string | null;
  search: URLSearchParams;
  dashboardContext?: DashboardChatContext | null;
  onSessionIdChange?: (sessionId: string) => void;
  updateUrlOnSessionCreate: boolean;
}) {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const sessionIdRef = useRef<string | null>(initialSessionId);
  const searchRef = useRef(search);
  const dashboardContextRef = useRef<DashboardChatContext | null | undefined>(dashboardContext);
  const onSessionIdChangeRef = useRef(onSessionIdChange);
  const sessionCreateAttempted = useRef(initialSessionId !== null);

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
        body: () => {
          const askForNew = sessionIdRef.current === null && !sessionCreateAttempted.current;
          if (askForNew) sessionCreateAttempted.current = true;
          return {
            sessionId: sessionIdRef.current ?? undefined,
            startNewSession: askForNew,
            dashboardContext: dashboardContextRef.current ?? undefined,
          };
        },
        fetch: async (url, init) => {
          const res = await fetch(url, init);
          if (!res.ok) {
            const data = (await res
              .clone()
              .json()
              .catch(() => null)) as { error?: string } | null;
            throw new Error(chatErrorMessage(data?.error, res.status));
          }
          const id = res.headers.get('x-tl-session-id');
          if (id && id !== sessionIdRef.current) {
            sessionIdRef.current = id;
            setSessionId(id);
            onSessionIdChangeRef.current?.(id);
            if (updateUrlOnSessionCreate && typeof window !== 'undefined') {
              const params = new URLSearchParams(searchRef.current.toString());
              params.set('session', id);
              window.history.replaceState(null, '', `/app/chat?${params.toString()}`);
            }
          }
          return res;
        },
      }),
    [updateUrlOnSessionCreate],
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
  return (
    <div className="flex shrink-0 items-center gap-2 self-start rounded-full border border-primary/30 bg-primary/5 py-1 pl-3 pr-1 text-xs">
      <Link href={`/app/objects/${pinnedEntityId}`} className="text-primary hover:underline">
        pinned · {pinnedEntityName ?? pinnedEntityId}
      </Link>
      {sessionId && (
        <button
          type="button"
          aria-label="Unpin"
          onClick={() => {
            void unpinChatSessionAction({ sessionId }).then(onUnpinned);
          }}
          className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

function ChatTranscript({
  compact,
  isStreaming,
  messages,
  onToolApprovalResponse,
  onSuggestion,
  scrollRef,
  teamName,
}: {
  compact: boolean;
  isStreaming: boolean;
  messages: UIMessage[];
  onToolApprovalResponse: (input: { id: string; approved: boolean; reason?: string }) => void;
  onSuggestion: (text: string) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  teamName: string;
}) {
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      {messages.length === 0 ? (
        <ChatEmptyState compact={compact} onSuggestion={onSuggestion} teamName={teamName} />
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
  onSuggestion,
  teamName,
}: {
  compact: boolean;
  onSuggestion: (text: string) => void;
  teamName: string;
}) {
  return (
    <div className={cn('flex flex-col gap-6', compact ? 'pt-2' : 'pt-8')}>
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">TRY ASKING</p>
        <h2
          className={cn(
            'mt-2 font-medium tracking-tight text-fg',
            compact ? 'text-base' : 'text-xl',
          )}
        >
          Ask anything about {teamName}&apos;s timeline
        </h2>
      </div>
      <div className={cn('flex flex-wrap gap-2', compact && 'hidden sm:flex')}>
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => {
              onSuggestion(suggestion);
            }}
            className="rounded-sm border border-border bg-surface px-3 py-1.5 text-left text-sm text-fg-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-fg"
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
  onToolApprovalResponse,
}: {
  message: UIMessage;
  onToolApprovalResponse: (input: { id: string; approved: boolean; reason?: string }) => void;
}) {
  const isUser = message.role === 'user';
  return (
    <li className={cn('flex flex-col gap-1.5', isUser ? 'items-end' : 'items-start')}>
      <span className="px-1 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-dim">
        {isUser ? 'You' : 'Agent'}
      </span>
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
              part={part}
              onToolApprovalResponse={onToolApprovalResponse}
            />
          ))}
        </div>
      </div>
    </li>
  );
}

function ChatMessagePart({
  part,
  onToolApprovalResponse,
}: {
  part: UIMessage['parts'][number];
  onToolApprovalResponse: (input: { id: string; approved: boolean; reason?: string }) => void;
}) {
  if (part.type === 'text') {
    return <CitationText text={part.text} />;
  }
  if (!part.type.startsWith('tool-')) return null;
  const toolPart = part as unknown as {
    type: string;
    toolCallId: string;
    state: string;
    input?: unknown;
    output?: unknown;
    approval?: { id: string; approved?: boolean; reason?: string };
  };
  return (
    <ToolStep
      name={toolPart.type.slice('tool-'.length)}
      state={toolPart.state}
      input={toolPart.input}
      output={toolPart.output}
      approval={toolPart.approval}
      onApprovalResponse={onToolApprovalResponse}
    />
  );
}

function ChatError({ error }: { error: Error | undefined }) {
  if (!error) return null;
  return (
    <div role="alert" className="shrink-0 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2">
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-danger">
        {error.message || 'Chat is unavailable right now.'}
      </p>
      <p className="mt-1 text-xs text-fg-muted">
        Saved timeline events are still available from Home and Timeline.
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
          type="text"
          value={input}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit(input);
          }}
          placeholder="Ask anything about your team's timeline…"
          disabled={isStreaming}
          className="h-12 w-full rounded-sm bg-transparent pl-4 pr-12 text-sm focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            onSubmit(input);
          }}
          disabled={isStreaming || !input.trim()}
          aria-label="Send"
          className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-sm bg-signal text-signal-fg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2 disabled:opacity-30"
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  );
}
