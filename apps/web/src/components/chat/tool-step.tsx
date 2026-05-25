'use client';

import { useState } from 'react';

interface Props {
  name: string;
  state: string;
  input?: unknown;
  output?: unknown;
}

function isMcpTool(name: string): { serverIdCompact: string; tool: string } | null {
  // mcp__<serverIdCompact>__<toolName> (see packages/shared/src/mcp/tool-namespace.ts).
  if (!name.startsWith('mcp__')) return null;
  const rest = name.slice('mcp__'.length);
  const sep = rest.indexOf('__');
  if (sep === -1) return null;
  return { serverIdCompact: rest.slice(0, sep), tool: rest.slice(sep + 2) };
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
  const mcp = isMcpTool(name);
  if (mcp) {
    return `MCP · ${mcp.tool}`;
  }
  return `Called ${name}`;
}

/**
 * Reconnect button rendered when an MCP tool call returns `needs_reauth`.
 * Kicks /api/mcp/oauth/start which redirects through the MCP server's
 * authorize endpoint; the callback flips the server back to enabled and
 * the cache invalidates so the next agent turn picks up fresh tokens.
 */
function ReconnectButton({ serverId, serverName }: { serverId: string; serverName: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void fetch('/api/mcp/oauth/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mcpServerId: serverId }),
        })
          .then(async (r) => {
            if (!r.ok) {
              setBusy(false);
              return;
            }
            const data = (await r.json()) as { url?: string };
            if (data.url) window.location.href = data.url;
            else setBusy(false);
          })
          .catch(() => {
            setBusy(false);
          });
      }}
      className="mt-1 rounded-sm border border-danger/40 bg-danger/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-danger hover:bg-danger/20 disabled:opacity-50"
    >
      {busy ? 'Opening…' : `Reconnect ${serverName}`}
    </button>
  );
}

export function ToolStep({ name, state, input, output }: Props) {
  const [open, setOpen] = useState(false);
  const isRunning =
    state === 'input-streaming' || state === 'input-available' || state === 'partial-call';
  const out =
    output && typeof output === 'object' && (output as Record<string, unknown>).error === 'needs_reauth'
      ? (output as Record<string, unknown>)
      : null;
  const isError =
    state === 'output-error' ||
    state === 'error' ||
    (typeof output === 'object' &&
      output !== null &&
      'error' in (output as Record<string, unknown>));
  const summary = summarize(name, input, output);
  const reauthServerId =
    out && typeof out.mcp_server_id === 'string' ? out.mcp_server_id : null;
  const reauthServerName =
    out && typeof out.mcp_server_name === 'string' ? out.mcp_server_name : 'MCP server';
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
      {reauthServerId ? (
        <ReconnectButton serverId={reauthServerId} serverName={reauthServerName} />
      ) : null}
      {open && (
        <pre className="mt-2 max-h-60 overflow-auto rounded bg-background p-2 text-[10px] leading-snug">
          {JSON.stringify({ name, state, input, output }, null, 2)}
        </pre>
      )}
    </div>
  );
}
