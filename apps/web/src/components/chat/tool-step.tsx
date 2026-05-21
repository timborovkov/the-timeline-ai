'use client';

import { useState } from 'react';

interface Props {
  name: string;
  state: string;
  input?: unknown;
  output?: unknown;
}

function summarize(name: string, input: unknown, output: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  if (name === 'search_timeline') {
    const q = typeof inp.query === 'string' ? inp.query : '';
    const out = output as { count?: number } | undefined;
    const count = out?.count;
    return count === undefined
      ? `Searched timeline for "${q}"`
      : `Searched timeline for "${q}" — ${String(count)} result${count === 1 ? '' : 's'}`;
  }
  if (name === 'get_entity') {
    const idOrName = typeof inp.idOrName === 'string' ? inp.idOrName : '';
    const out = output as { found?: boolean } | undefined;
    if (out?.found === false) return `Looked up entity "${idOrName}" — not found`;
    return `Looked up entity "${idOrName}"`;
  }
  if (name === 'list_events') {
    const out = output as { count?: number } | undefined;
    const count = out?.count;
    return count === undefined ? 'Listed events' : `Listed events — ${String(count)} found`;
  }
  if (name === 'get_event') {
    const id = typeof inp.id === 'string' ? inp.id.slice(0, 8) : '';
    return `Fetched event ${id}…`;
  }
  return `Called ${name}`;
}

/**
 * Renders one tool-call step. Click to expand the raw input/output JSON —
 * makes the agent's audit trail visible without a debugger.
 */
export function ToolStep({ name, state, input, output }: Props) {
  const [open, setOpen] = useState(false);
  const isRunning =
    state === 'input-streaming' || state === 'input-available' || state === 'partial-call';
  const isError =
    state === 'output-error' ||
    state === 'error' ||
    (typeof output === 'object' &&
      output !== null &&
      'error' in (output as Record<string, unknown>));
  const summary = summarize(name, input, output);
  return (
    <div className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left font-mono"
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        <span className="truncate">
          {isRunning ? '⏳ ' : isError ? '⚠ ' : '✓ '}
          {summary}
        </span>
        <span className="text-muted-foreground">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <pre className="mt-2 max-h-60 overflow-auto rounded bg-background p-2 text-[10px] leading-snug">
          {JSON.stringify({ name, state, input, output }, null, 2)}
        </pre>
      )}
    </div>
  );
}
