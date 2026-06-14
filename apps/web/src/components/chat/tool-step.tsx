'use client';

import { Check, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { acceptSuggestionItemAction, rejectSuggestionItemAction } from '@/app/actions/suggestions';
import { EvidenceLink } from '@/components/evidence-link';

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
  if (name === 'list_workspace_state') {
    const out = output as { count?: number } | undefined;
    const count = out?.count;
    return count === undefined
      ? 'Listed workspace state'
      : `Listed workspace state — ${String(count)} result${count === 1 ? '' : 's'}`;
  }
  if (name === 'get_event') {
    const id = typeof inp.id === 'string' ? inp.id.slice(0, 8) : '';
    return `Fetched event ${id}…`;
  }
  if (name === 'suggest_object_memory') {
    const out = output as { suggestion?: { items?: unknown[] } } | undefined;
    const count = Array.isArray(out?.suggestion?.items) ? out.suggestion.items.length : undefined;
    return count === undefined
      ? 'Queued object-memory approval'
      : `Queued object-memory approval — ${String(count)} item${count === 1 ? '' : 's'}`;
  }
  if (name === 'list_pending_approvals') {
    const out = output as { count?: number } | undefined;
    const count = out?.count;
    return count === undefined
      ? 'Checked pending approvals'
      : `Checked pending approvals — ${String(count)} found`;
  }
  const mcp = isMcpTool(name);
  if (mcp) {
    return `MCP · ${mcp.tool}`;
  }
  return `Called ${name}`;
}

interface SuggestionItem {
  id: string;
  status: string;
  title: string;
  description?: string | null;
}

interface SuggestionEvidence {
  rawEventId: string;
  quote?: string | null;
  source?: string | null;
}

interface SuggestionBundle {
  id: string;
  title: string;
  summary?: string | null;
  evidence: SuggestionEvidence[];
  items: SuggestionItem[];
}

function suggestionFromOutput(output: unknown): SuggestionBundle | null {
  if (!output || typeof output !== 'object') return null;
  const suggestion = (output as Record<string, unknown>).suggestion;
  if (!suggestion || typeof suggestion !== 'object') return null;
  const record = suggestion as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.title !== 'string') return null;
  const items: SuggestionItem[] = [];
  if (Array.isArray(record.items)) {
    for (const item of record.items) {
      if (!item || typeof item !== 'object') continue;
      const itemRecord = item as Record<string, unknown>;
      const id = typeof itemRecord.id === 'string' ? itemRecord.id : '';
      if (!id) continue;
      items.push({
        id,
        status: typeof itemRecord.status === 'string' ? itemRecord.status : 'pending',
        title: typeof itemRecord.title === 'string' ? itemRecord.title : 'Approval item',
        description: typeof itemRecord.description === 'string' ? itemRecord.description : null,
      });
    }
  }
  const evidence: SuggestionEvidence[] = [];
  if (Array.isArray(record.evidence)) {
    for (const item of record.evidence) {
      if (!item || typeof item !== 'object') continue;
      const itemRecord = item as Record<string, unknown>;
      const rawEventId = typeof itemRecord.rawEventId === 'string' ? itemRecord.rawEventId : '';
      if (!rawEventId) continue;
      evidence.push({
        rawEventId,
        quote: typeof itemRecord.quote === 'string' ? itemRecord.quote : null,
        source: typeof itemRecord.source === 'string' ? itemRecord.source : null,
      });
    }
  }
  return {
    id: record.id,
    title: record.title,
    summary: typeof record.summary === 'string' ? record.summary : null,
    evidence,
    items,
  };
}

function InlineApprovalCard({ suggestion }: { suggestion: SuggestionBundle }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [localStatuses, setLocalStatuses] = useState<Record<string, string>>({});

  function run(
    itemId: string,
    resolvedStatus: string,
    action: () => Promise<{ ok?: boolean; error?: string }>,
  ) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else if (result.ok) setLocalStatuses((current) => ({ ...current, [itemId]: resolvedStatus }));
      router.refresh();
    });
  }

  return (
    <div className="mt-2 border border-border bg-background p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Approval queued
      </div>
      <div className="mt-1 font-medium">{suggestion.title}</div>
      {suggestion.summary ? (
        <p className="mt-1 text-xs text-muted-foreground">{suggestion.summary}</p>
      ) : null}
      {suggestion.evidence.length ? (
        <div className="mt-2 space-y-1 border-t pt-2">
          {suggestion.evidence.slice(0, 3).map((evidence) => (
            <div key={evidence.rawEventId} className="text-[11px] text-muted-foreground">
              {evidence.quote ? <span className="text-foreground">"{evidence.quote}"</span> : null}
              <EvidenceLink
                eventId={evidence.rawEventId}
                className="ml-1 font-mono uppercase tracking-[0.12em] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                previewText={evidence.quote}
                source={evidence.source}
                title="Approval evidence"
              >
                {evidence.source ?? 'event'} {evidence.rawEventId.slice(0, 8)}
              </EvidenceLink>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      <ul className="mt-2 space-y-2">
        {suggestion.items.map((item) => {
          const status = localStatuses[item.id] ?? item.status;
          return (
            <li key={item.id} className="flex items-start justify-between gap-2 border-t pt-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">{item.title}</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {status}
                </div>
              </div>
              {status === 'pending' || status === 'failed' ? (
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    disabled={pending}
                    className="rounded-sm border border-signal/40 px-2 py-1 text-signal disabled:opacity-50"
                    onClick={() => {
                      run(item.id, 'accepted', () =>
                        acceptSuggestionItemAction({ itemId: item.id }),
                      );
                    }}
                    aria-label={`Accept ${item.title}`}
                  >
                    <Check className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    className="rounded-sm border border-border px-2 py-1 text-muted-foreground disabled:opacity-50"
                    onClick={() => {
                      run(item.id, 'rejected', () =>
                        rejectSuggestionItemAction({ itemId: item.id }),
                      );
                    }}
                    aria-label={`Reject ${item.title}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Reconnect button rendered when an MCP tool call returns `needs_reauth`.
 * Kicks /api/mcp/oauth/start which redirects through the MCP server's
 * authorize endpoint; the callback flips the server back to enabled and
 * the cache invalidates so the next agent turn picks up fresh tokens.
 */
function ReconnectButton({ serverId, serverName }: { serverId: string; serverName: string }) {
  const [busy, setBusy] = useState(false);
  // Non-admin path: /api/mcp/oauth/start requires admin; surface that
  // inline rather than letting the user click into a generic failure
  // toast. Re-renders the row with an "ask an admin" hint.
  const [forbidden, setForbidden] = useState(false);
  if (forbidden) {
    return (
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">
        {serverName} needs reconnecting. Ask a team admin to visit /app/team/mcp-servers
      </p>
    );
  }
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
            if (r.status === 403) {
              setForbidden(true);
              setBusy(false);
              return;
            }
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
    output &&
    typeof output === 'object' &&
    (output as Record<string, unknown>).error === 'needs_reauth'
      ? (output as Record<string, unknown>)
      : null;
  const isError =
    state === 'output-error' ||
    state === 'error' ||
    (typeof output === 'object' &&
      output !== null &&
      'error' in (output as Record<string, unknown>));
  const summary = summarize(name, input, output);
  const reauthServerId = out && typeof out.mcp_server_id === 'string' ? out.mcp_server_id : null;
  const reauthServerName =
    out && typeof out.mcp_server_name === 'string' ? out.mcp_server_name : 'MCP server';
  const suggestion = name === 'suggest_object_memory' ? suggestionFromOutput(output) : null;
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
      {suggestion ? <InlineApprovalCard suggestion={suggestion} /> : null}
      {open && (
        <pre className="mt-2 max-h-60 overflow-auto rounded bg-background p-2 text-[10px] leading-snug">
          {JSON.stringify({ name, state, input, output }, null, 2)}
        </pre>
      )}
    </div>
  );
}
