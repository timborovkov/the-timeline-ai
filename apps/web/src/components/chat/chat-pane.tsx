'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useState } from 'react';

import { CitationText } from './citation';
import { ToolStep } from './tool-step';

import { Button } from '@/components/ui/button';

interface Props {
  teamName: string;
}

/**
 * Streaming chat UI for the Phase 6 agent. Uses @ai-sdk/react's useChat with
 * a DefaultChatTransport pointed at /api/chat. Tool calls render as
 * collapsible steps inline; the assistant's text is post-processed to turn
 * [ev:<uuid>] and [ent:<uuid>] tokens into clickable citation chips.
 *
 * In-tab session only — message history isn't persisted (Phase 6 carryover).
 */
export function ChatPane({ teamName }: Props) {
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const [input, setInput] = useState('');

  const isStreaming = status === 'streaming' || status === 'submitted';

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border bg-card">
        <ol className="divide-y">
          {messages.length === 0 && (
            <li className="px-4 py-6 text-sm text-muted-foreground">
              Try: <em>What did the team work on yesterday?</em> ·{' '}
              <em>What was discussed with [person] last time?</em> ·{' '}
              <em>What's outstanding for [account]?</em>
            </li>
          )}
          {messages.map((m: UIMessage) => (
            <li key={m.id} className="px-4 py-4">
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                {m.role === 'user' ? 'You' : teamName}
              </p>
              <div className="space-y-2 text-sm">
                {m.parts.map((part, idx) => {
                  const key = `${m.id}-${String(idx)}`;
                  if (part.type === 'text') {
                    return <CitationText key={key} text={part.text} />;
                  }
                  if (part.type.startsWith('tool-')) {
                    // Tool UI parts have shape { type: 'tool-<name>',
                    // toolCallId, state, input?, output? }. Render via a
                    // dedicated component so the audit trail is visible.
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
            </li>
          ))}
          {isStreaming && <li className="px-4 py-3 text-xs text-muted-foreground">Thinking…</li>}
        </ol>
      </div>
      {error && (
        <p className="text-sm text-destructive">
          {error.message || 'Chat failed. Make sure OPENROUTER_API_KEY is configured.'}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = input.trim();
          if (!text || isStreaming) return;
          setInput('');
          void sendMessage({ text });
        }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
          }}
          placeholder="Ask anything about your team's timeline…"
          disabled={isStreaming}
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button type="submit" disabled={isStreaming || !input.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
