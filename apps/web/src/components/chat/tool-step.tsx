'use client';

import { Check, CircleAlert, CircleCheck, CirclePause, LoaderCircle, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState, useTransition } from 'react';

import { acceptSuggestionItemAction, rejectSuggestionItemAction } from '@/app/actions/suggestions';
import { SuggestionChangeDialog } from '@/components/approvals/suggestion-change-dialog';
import { ArtifactReferenceChip } from '@/components/artifact-reference-chip';
import { DueDateDisplay } from '@/components/due-date-display';
import { EvidenceLink } from '@/components/evidence-link';
import { useWorkspaceTimezone } from '@/components/workspace-timezone-context';
import { evidenceSourceContextLabel } from '@/lib/evidence-source-label';
import { notifyAction } from '@/lib/notify';
import { statusLabel } from '@/lib/status-labels';

interface Props {
  name: string;
  state: string;
  input?: unknown;
  output?: unknown;
  approval?: { id: string; approved?: boolean; reason?: string };
  onApprovalResponse?: (input: { id: string; approved: boolean; reason?: string }) => void;
}

function isMcpTool(name: string): { serverIdCompact: string; tool: string } | null {
  // mcp__<serverIdCompact>__<toolName> (see packages/shared/src/mcp/tool-namespace.ts).
  if (!name.startsWith('mcp__')) return null;
  const rest = name.slice('mcp__'.length);
  const sep = rest.indexOf('__');
  if (sep === -1) return null;
  return { serverIdCompact: rest.slice(0, sep), tool: rest.slice(sep + 2) };
}

function inputRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

function recordValue(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function stringValue(record: Record<string, unknown>, key: string): string | null {
  const value = recordValue(record, key);
  return typeof value === 'string' && value.trim() ? value : null;
}

function nestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = recordValue(record, key);
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function shortDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function calendarToolRange(record: Record<string, unknown>): string | null {
  const start = shortDateTime(stringValue(record, 'startAt'));
  const end = shortDateTime(stringValue(record, 'endAt'));
  if (!start || !end) return null;
  return `${start} -> ${end}`;
}

function calendarToolSummary(name: string, input: unknown): string | null {
  const record = inputRecord(input);
  if (name === 'execute_calendar_create') {
    const title = stringValue(record, 'title') ?? 'calendar event';
    const range = calendarToolRange(record);
    return range ? `Create ${title} (${range})` : `Create ${title}`;
  }
  if (name === 'execute_calendar_update') {
    const patch = nestedRecord(record, 'patch');
    const expected = nestedRecord(record, 'expectedCurrent');
    const title = stringValue(patch, 'title') ?? stringValue(expected, 'title') ?? 'calendar event';
    const before = calendarToolRange(expected);
    const after = calendarToolRange({ ...expected, ...patch });
    const hasMove = stringValue(patch, 'startAt') ?? stringValue(patch, 'endAt');
    if (before && after && before !== after) return `Move ${title} (from ${before}; to ${after})`;
    return `${hasMove ? 'Move' : 'Update'} ${title}`;
  }
  if (name === 'execute_calendar_cancel') {
    const expected = nestedRecord(record, 'expectedCurrent');
    const title = stringValue(expected, 'title') ?? 'calendar event';
    const range = calendarToolRange(expected);
    return range ? `Cancel ${title} (${range})` : `Cancel ${title}`;
  }
  return null;
}

function summarize(name: string, input: unknown, output: unknown, state: string): string {
  const inp = (input ?? {}) as Record<string, unknown>;
  if (name === 'search_timeline') {
    const q = typeof inp.query === 'string' ? inp.query : '';
    const out = output as { count?: number } | undefined;
    const count = out?.count;
    return count === undefined
      ? `Searched timeline for "${q}"`
      : `Searched timeline for "${q}" — ${String(count)} result${count === 1 ? '' : 's'}`;
  }
  if (name === 'search_timeline_moments') {
    const q = typeof inp.query === 'string' ? inp.query : '';
    const out = output as { count?: number } | undefined;
    const count = out?.count;
    return count === undefined
      ? `Searched timeline moments for "${q}"`
      : `Searched timeline moments for "${q}" — ${String(count)} moment${count === 1 ? '' : 's'}`;
  }
  if (name === 'get_timeline_moment') {
    const out = output as { found?: boolean; moment?: { title?: string } } | undefined;
    if (out?.found === false) return 'Expanded timeline moment — not found';
    return out?.moment?.title
      ? `Expanded timeline moment "${out.moment.title}"`
      : 'Expanded timeline moment evidence';
  }
  if (name === 'get_entity') {
    const idOrName = typeof inp.idOrName === 'string' ? inp.idOrName : '';
    const out = output as { found?: boolean } | undefined;
    if (out?.found === false) return `Looked up entity "${idOrName}" — not found`;
    return `Looked up entity "${idOrName}"`;
  }
  if (name === 'search_objects') {
    const q = typeof inp.query === 'string' ? inp.query : '';
    const out = output as { count?: number } | undefined;
    const count = out?.count;
    return count === undefined
      ? `Searched objects for "${q}"`
      : `Searched objects for "${q}" — ${String(count)} result${count === 1 ? '' : 's'}`;
  }
  if (name === 'retrieve_workspace_context') {
    const q = typeof inp.query === 'string' ? inp.query : '';
    const out = output as { recipe?: string; refs?: unknown[] } | undefined;
    const count = Array.isArray(out?.refs) ? out.refs.length : undefined;
    const recipe = out?.recipe ? ` (${out.recipe.replaceAll('_', ' ')})` : '';
    return count === undefined
      ? `Retrieved workspace context${recipe} for "${q}"`
      : `Retrieved workspace context${recipe} for "${q}" — ${String(count)} ref${
          count === 1 ? '' : 's'
        }`;
  }
  if (name === 'execute_object_update') {
    const field = typeof inp.field === 'string' ? inp.field : 'field';
    const out = output as { ok?: boolean; message?: string } | undefined;
    if (out?.message) return out.message;
    if (state === 'approval-requested') return `Approval needed to update object ${field}`;
    if (state === 'output-denied') return `Denied object ${field} update`;
    return `Update object ${field}`;
  }
  if (name === 'execute_object_create') {
    const out = output as { ok?: boolean; message?: string } | undefined;
    if (out?.message) return out.message;
    const type = typeof inp.type === 'string' ? inp.type : 'object';
    const nameValue = typeof inp.canonicalName === 'string' ? inp.canonicalName : '';
    if (state === 'approval-requested') return `Approval needed to create ${type} ${nameValue}`;
    if (state === 'output-denied') return `Denied ${type} create`;
    return `Create ${type} ${nameValue}`;
  }
  if (name === 'execute_object_archive') {
    const out = output as { ok?: boolean; message?: string } | undefined;
    if (out?.message) return out.message;
    if (state === 'approval-requested') return 'Approval needed to archive object';
    if (state === 'output-denied') return 'Denied object archive';
    return 'Archive object';
  }
  if (name === 'execute_object_merge') {
    const out = output as { ok?: boolean; message?: string } | undefined;
    if (out?.message) return out.message;
    const ids = Array.isArray(inp.objectIds) ? inp.objectIds.length : 0;
    if (state === 'approval-requested') return `Approval needed to merge ${String(ids)} objects`;
    if (state === 'output-denied') return 'Denied object merge';
    return `Merge ${String(ids)} objects`;
  }
  if (name === 'execute_calendar_create') {
    const out = output as { ok?: boolean; message?: string } | undefined;
    const summary = calendarToolSummary(name, input);
    if (summary && state === 'approval-requested')
      return `Approval needed to ${summary.toLowerCase()}`;
    if (out?.message) return out.message;
    const title = typeof inp.title === 'string' ? inp.title : 'calendar event';
    if (state === 'output-denied') return `Denied calendar event create`;
    return summary ?? `Create ${title}`;
  }
  if (name === 'execute_calendar_update') {
    const out = output as { ok?: boolean; message?: string } | undefined;
    const summary = calendarToolSummary(name, input);
    if (summary && state === 'approval-requested')
      return `Approval needed to ${summary.toLowerCase()}`;
    if (out?.message) return out.message;
    if (state === 'output-denied') return 'Denied calendar event update';
    return summary ?? 'Update calendar event';
  }
  if (name === 'execute_calendar_cancel') {
    const out = output as { ok?: boolean; message?: string } | undefined;
    const summary = calendarToolSummary(name, input);
    if (summary && state === 'approval-requested')
      return `Approval needed to ${summary.toLowerCase()}`;
    if (out?.message) return out.message;
    if (state === 'output-denied') return 'Denied calendar event cancellation';
    return summary ?? 'Cancel calendar event';
  }
  if (name === 'search_boards') {
    const q = typeof inp.query === 'string' ? inp.query : '';
    const out = output as { count?: number } | undefined;
    const count = out?.count;
    const target = q ? ` for "${q}"` : '';
    return count === undefined
      ? `Searched boards${target}`
      : `Searched boards${target} — ${String(count)} result${count === 1 ? '' : 's'}`;
  }
  if (name === 'search_documents_structured') {
    const q = typeof inp.name === 'string' ? inp.name : '';
    const out = output as { count?: number } | undefined;
    const count = out?.count;
    const target = q ? ` for "${q}"` : '';
    return count === undefined
      ? `Searched documents${target}`
      : `Searched documents${target} — ${String(count)} result${count === 1 ? '' : 's'}`;
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
  if (name === 'search_app_guide') {
    const q = typeof inp.query === 'string' ? inp.query : '';
    const out = output as { count?: number } | undefined;
    const count = out?.count;
    return count === undefined
      ? `Searched app guide for "${q}"`
      : `Searched app guide for "${q}" — ${String(count)} result${count === 1 ? '' : 's'}`;
  }
  if (name === 'get_app_route') {
    const id = typeof inp.routeId === 'string' ? inp.routeId : '';
    const out = output as { title?: string; found?: boolean } | undefined;
    if (out?.found === false) return `Looked up route "${id}" — not found`;
    return out?.title ? `Looked up route ${out.title}` : `Looked up route "${id}"`;
  }
  if (name === 'get_event') {
    return 'Fetched timeline event';
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
  targetKind?: string;
  title: string;
  description?: string | null;
}

interface SuggestionEvidence {
  rawEventId: string;
  quote?: string | null;
  source?: string | null;
  senderName?: string | null;
  senderHandle?: string | null;
  senderTimelineName?: string | null;
  conversationName?: string | null;
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
        targetKind: typeof itemRecord.targetKind === 'string' ? itemRecord.targetKind : undefined,
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
        senderName: typeof itemRecord.senderName === 'string' ? itemRecord.senderName : null,
        senderHandle: typeof itemRecord.senderHandle === 'string' ? itemRecord.senderHandle : null,
        senderTimelineName:
          typeof itemRecord.senderTimelineName === 'string' ? itemRecord.senderTimelineName : null,
        conversationName:
          typeof itemRecord.conversationName === 'string' ? itemRecord.conversationName : null,
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
  const [localStatuses, setLocalStatuses] = useState<Record<string, string>>({});
  const [localItems, setLocalItems] = useState<Record<string, Partial<SuggestionItem>>>({});

  function run(
    itemId: string,
    resolvedStatus: string,
    action: () => Promise<{ ok?: boolean; error?: string }>,
  ) {
    startTransition(async () => {
      const result = await notifyAction({
        id: `approval:${itemId}`,
        loading: 'Updating approval…',
        success: 'Approval updated',
        error: 'Couldn’t update approval',
        run: action,
      });
      if (!result.error && 'ok' in result && result.ok) {
        setLocalStatuses((current) => ({ ...current, [itemId]: resolvedStatus }));
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-2 rounded-md border border-border bg-surface p-3">
      <div className="text-xs font-medium text-fg">Approval queued</div>
      <div className="mt-1 break-words text-sm font-medium text-fg">{suggestion.title}</div>
      {suggestion.summary ? (
        <p className="mt-1 text-xs text-fg-muted">{suggestion.summary}</p>
      ) : null}
      {suggestion.evidence.length ? (
        <div className="mt-2 space-y-1 border-t border-border pt-2">
          {suggestion.evidence.slice(0, 3).map((evidence) => (
            <div key={evidence.rawEventId} className="text-xs text-fg-muted">
              {evidence.quote ? (
                <span className="text-fg">&quot;{evidence.quote}&quot;</span>
              ) : null}
              <EvidenceLink
                eventId={evidence.rawEventId}
                className="ml-1 text-signal underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg-muted focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                previewText={evidence.quote}
                source={evidence.source}
                title="Approval evidence"
              >
                {evidenceSourceContextLabel(evidence)}
              </EvidenceLink>
            </div>
          ))}
        </div>
      ) : null}
      <ul className="mt-2 space-y-2">
        {suggestion.items.map((item) => {
          const displayedItem = { ...item, ...localItems[item.id] };
          const status = localStatuses[item.id] ?? displayedItem.status;
          return (
            <li
              key={item.id}
              className="flex flex-col gap-2 border-t pt-2 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <div className="break-words text-xs font-medium">{displayedItem.title}</div>
                <div className="text-xs text-fg-muted">{statusLabel(status)}</div>
              </div>
              {status === 'pending' || status === 'failed' ? (
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    disabled={pending}
                    className="inline-flex size-8 items-center justify-center rounded-sm border border-signal/40 text-signal hover:bg-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg-muted focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
                    onClick={() => {
                      run(item.id, 'accepted', () =>
                        acceptSuggestionItemAction({ itemId: item.id }),
                      );
                    }}
                    aria-label={`Accept ${displayedItem.title}`}
                  >
                    <Check aria-hidden="true" className="size-3.5" />
                  </button>
                  {displayedItem.targetKind !== 'object_merge' ? (
                    <SuggestionChangeDialog
                      itemId={item.id}
                      title={displayedItem.title}
                      disabled={pending}
                      compact
                      onRevised={(revisedItem) => {
                        setLocalItems((current) => ({
                          ...current,
                          [item.id]: revisedItem,
                        }));
                      }}
                    />
                  ) : null}
                  <button
                    type="button"
                    disabled={pending}
                    className="inline-flex size-8 items-center justify-center rounded-sm border border-border text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg-muted focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
                    onClick={() => {
                      run(item.id, 'rejected', () =>
                        rejectSuggestionItemAction({ itemId: item.id }),
                      );
                    }}
                    aria-label={`Reject ${displayedItem.title}`}
                  >
                    <X aria-hidden="true" className="size-3.5" />
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
      <p className="mt-1 text-xs text-fg-muted">
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
      className="mt-1 rounded-sm border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger hover:bg-danger/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg-muted focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
    >
      {busy ? 'Opening…' : `Reconnect ${serverName}`}
    </button>
  );
}

function formatApprovalValue(value: unknown): string {
  if (value === null || value === undefined) return 'empty';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

function ApprovalRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] gap-2">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="break-words text-fg">{children}</dd>
    </div>
  );
}

function ToolApprovalCard({
  name,
  approval,
  input,
  onApprovalResponse,
}: {
  name: string;
  approval: { id: string };
  input: unknown;
  onApprovalResponse: NonNullable<Props['onApprovalResponse']>;
}) {
  const timezone = useWorkspaceTimezone();
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const objectIds = Array.isArray(record.objectIds)
    ? record.objectIds.filter((id): id is string => typeof id === 'string')
    : [];
  const survivorId = typeof record.survivorId === 'string' ? record.survivorId : null;
  const entityId = typeof record.entityId === 'string' ? record.entityId : null;
  const calendarEventId = typeof record.id === 'string' ? record.id : null;
  const patch = record.patch && typeof record.patch === 'object' ? record.patch : null;
  const field = typeof record.field === 'string' ? record.field : 'field';
  const reason = typeof record.reason === 'string' ? record.reason : null;
  const mergedIds = survivorId ? objectIds.filter((id) => id !== survivorId) : [];
  return (
    <div className="mt-2 rounded-md border border-signal/40 bg-signal-soft p-3">
      <p className="text-xs font-medium text-fg">Approval needed</p>
      {name === 'execute_object_create' ? (
        <dl className="mt-2 grid gap-2 text-xs text-fg-muted">
          <ApprovalRow label="Type">{formatApprovalValue(record.type ?? 'other')}</ApprovalRow>
          <ApprovalRow label="Name">{formatApprovalValue(record.canonicalName)}</ApprovalRow>
          {record.status !== undefined ? (
            <ApprovalRow label="Status">{formatApprovalValue(record.status)}</ApprovalRow>
          ) : null}
          {record.stage !== undefined ? (
            <ApprovalRow label="Stage">{formatApprovalValue(record.stage)}</ApprovalRow>
          ) : null}
          {record.priority !== undefined ? (
            <ApprovalRow label="Priority">{formatApprovalValue(record.priority)}</ApprovalRow>
          ) : null}
          {record.dueAt !== undefined ? (
            <ApprovalRow label="Due">
              <DueDateDisplay
                value={record.dueAt as string | null}
                timezone={timezone}
                variant="inline"
              />
            </ApprovalRow>
          ) : null}
          {Array.isArray(record.aliases) && record.aliases.length > 0 ? (
            <ApprovalRow label="Aliases">{record.aliases.join(', ')}</ApprovalRow>
          ) : null}
          {typeof record.parentObjectId === 'string' ? (
            <ApprovalRow label="Parent">
              <ArtifactReferenceChip refValue={{ kind: 'object', id: record.parentObjectId }} />
            </ApprovalRow>
          ) : null}
          {reason ? <ApprovalRow label="Reason">{reason}</ApprovalRow> : null}
        </dl>
      ) : name === 'execute_calendar_create' ? (
        <dl className="mt-2 grid gap-2 text-xs text-fg-muted">
          <ApprovalRow label="Title">{formatApprovalValue(record.title)}</ApprovalRow>
          {calendarToolRange(record) ? (
            <ApprovalRow label="When">{calendarToolRange(record)}</ApprovalRow>
          ) : (
            <>
              <ApprovalRow label="Start">{formatApprovalValue(record.startAt)}</ApprovalRow>
              <ApprovalRow label="End">{formatApprovalValue(record.endAt)}</ApprovalRow>
            </>
          )}
          {record.timezone !== undefined ? (
            <ApprovalRow label="Timezone">{formatApprovalValue(record.timezone)}</ApprovalRow>
          ) : null}
          {record.allDay !== undefined ? (
            <ApprovalRow label="All day">{formatApprovalValue(record.allDay)}</ApprovalRow>
          ) : null}
          {record.location !== undefined ? (
            <ApprovalRow label="Location">{formatApprovalValue(record.location)}</ApprovalRow>
          ) : null}
          {record.rrule !== undefined ? (
            <ApprovalRow label="Repeat">{formatApprovalValue(record.rrule)}</ApprovalRow>
          ) : null}
          {reason ? <ApprovalRow label="Reason">{reason}</ApprovalRow> : null}
        </dl>
      ) : name === 'execute_calendar_update' ? (
        <dl className="mt-2 grid gap-2 text-xs text-fg-muted">
          {calendarEventId ? (
            <ApprovalRow label="Event">
              <ArtifactReferenceChip refValue={{ kind: 'calendar_event', id: calendarEventId }} />
            </ApprovalRow>
          ) : null}
          {patch ? (
            <>
              {calendarToolRange(nestedRecord(record, 'expectedCurrent')) ? (
                <ApprovalRow label="Current">
                  {calendarToolRange(nestedRecord(record, 'expectedCurrent'))}
                </ApprovalRow>
              ) : null}
              {calendarToolRange({
                ...nestedRecord(record, 'expectedCurrent'),
                ...(patch as Record<string, unknown>),
              }) ? (
                <ApprovalRow label="Proposed">
                  {calendarToolRange({
                    ...nestedRecord(record, 'expectedCurrent'),
                    ...(patch as Record<string, unknown>),
                  })}
                </ApprovalRow>
              ) : null}
              <ApprovalRow label="Change">
                {Object.entries(patch)
                  .map(([key, value]) => `${key}: ${formatApprovalValue(value)}`)
                  .join(', ')}
              </ApprovalRow>
            </>
          ) : null}
          {reason ? <ApprovalRow label="Reason">{reason}</ApprovalRow> : null}
        </dl>
      ) : name === 'execute_calendar_cancel' ? (
        <dl className="mt-2 grid gap-2 text-xs text-fg-muted">
          {calendarEventId ? (
            <ApprovalRow label="Event">
              <ArtifactReferenceChip refValue={{ kind: 'calendar_event', id: calendarEventId }} />
            </ApprovalRow>
          ) : null}
          {calendarToolRange(nestedRecord(record, 'expectedCurrent')) ? (
            <ApprovalRow label="When">
              {calendarToolRange(nestedRecord(record, 'expectedCurrent'))}
            </ApprovalRow>
          ) : null}
          {record.recurrenceEditMode !== undefined ? (
            <ApprovalRow label="Scope">
              {formatApprovalValue(record.recurrenceEditMode)}
            </ApprovalRow>
          ) : null}
          {reason ? <ApprovalRow label="Reason">{reason}</ApprovalRow> : null}
        </dl>
      ) : name === 'execute_object_archive' ? (
        <dl className="mt-2 grid gap-2 text-xs text-fg-muted">
          {entityId ? (
            <ApprovalRow label="Object">
              <ArtifactReferenceChip refValue={{ kind: 'object', id: entityId }} />
            </ApprovalRow>
          ) : null}
          {reason ? <ApprovalRow label="Reason">{reason}</ApprovalRow> : null}
        </dl>
      ) : name === 'execute_object_merge' ? (
        <dl className="mt-2 grid gap-2 text-[11px] text-fg-muted">
          {survivorId ? (
            <ApprovalRow label="Keep">
              <ArtifactReferenceChip refValue={{ kind: 'object', id: survivorId }} />
            </ApprovalRow>
          ) : null}
          {mergedIds.length > 0 ? (
            <ApprovalRow label="Merge">
              <span className="flex flex-wrap gap-1">
                {mergedIds.map((id) => (
                  <ArtifactReferenceChip key={id} refValue={{ kind: 'object', id }} />
                ))}
              </span>
            </ApprovalRow>
          ) : null}
          {reason ? <ApprovalRow label="Reason">{reason}</ApprovalRow> : null}
        </dl>
      ) : (
        <dl className="mt-2 grid gap-1 text-xs text-fg-muted">
          <ApprovalRow label="Field">{field}</ApprovalRow>
          <ApprovalRow label="Current">
            {field === 'dueAt' ? (
              <DueDateDisplay
                value={record.expectedCurrentValue as string | null}
                timezone={timezone}
                variant="inline"
              />
            ) : (
              formatApprovalValue(record.expectedCurrentValue)
            )}
          </ApprovalRow>
          <ApprovalRow label="Proposed">
            {field === 'dueAt' ? (
              <DueDateDisplay
                value={record.newValue as string | null}
                timezone={timezone}
                variant="inline"
              />
            ) : (
              formatApprovalValue(record.newValue)
            )}
          </ApprovalRow>
          {reason ? <ApprovalRow label="Reason">{reason}</ApprovalRow> : null}
        </dl>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            onApprovalResponse({ id: approval.id, approved: true });
          }}
          className="h-9 rounded-sm bg-signal px-3 text-xs font-medium text-signal-fg hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg-muted focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => {
            onApprovalResponse({
              id: approval.id,
              approved: false,
              reason: 'User denied in chat',
            });
          }}
          className="h-9 rounded-sm border border-border px-3 text-xs font-medium text-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg-muted focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          Deny
        </button>
      </div>
    </div>
  );
}

function ToolDetails({
  name,
  state,
  input,
  output,
}: Pick<Props, 'name' | 'state' | 'input' | 'output'>) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <details
      className="group mt-2 border-t border-border pt-2 text-sm"
      onToggle={(event) => {
        setIsOpen(event.currentTarget.open);
      }}
    >
      <summary className="flex min-h-6 cursor-pointer list-none items-center text-sm font-medium text-fg-muted marker:hidden hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg-muted focus-visible:ring-offset-2">
        <span aria-hidden="true" className="mr-2 inline-block text-fg-dim group-open:rotate-90">
          ›
        </span>
        Technical details
      </summary>
      {isOpen ? (
        <pre className="mt-3 max-h-60 overflow-auto rounded-sm bg-surface-2 p-2 text-[11px] leading-[1.35] text-fg">
          {JSON.stringify({ name, state, input, output }, null, 2)}
        </pre>
      ) : null}
    </details>
  );
}

export function ToolStep({ name, state, input, output, approval, onApprovalResponse }: Props) {
  const isRunning =
    state === 'input-streaming' || state === 'input-available' || state === 'partial-call';
  const isApprovalPending = state === 'approval-requested';
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
  const summary = summarize(name, input, output, state);
  const reauthServerId = out && typeof out.mcp_server_id === 'string' ? out.mcp_server_id : null;
  const reauthServerName =
    out && typeof out.mcp_server_name === 'string' ? out.mcp_server_name : 'MCP server';
  const suggestion = name === 'suggest_object_memory' ? suggestionFromOutput(output) : null;
  const needsApproval =
    state === 'approval-requested' && approval && onApprovalResponse ? approval : null;
  const approvalResponse = needsApproval && onApprovalResponse ? onApprovalResponse : null;
  const toolStateLabel = isApprovalPending
    ? 'Approval needed'
    : isRunning
      ? 'Running'
      : isError
        ? 'Unable to complete'
        : 'Completed';
  const StateIcon = isApprovalPending
    ? CirclePause
    : isRunning
      ? LoaderCircle
      : isError
        ? CircleAlert
        : CircleCheck;
  const stateClassName = isError ? 'text-danger' : 'text-fg-muted';
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="flex min-w-0 items-start gap-2 text-fg">
          <StateIcon
            aria-hidden="true"
            className={
              isRunning
                ? 'mt-0.5 size-3.5 shrink-0 animate-spin text-fg-muted motion-reduce:animate-none'
                : `mt-0.5 size-3.5 shrink-0 ${stateClassName}`
            }
          />
          <span className="min-w-0 break-words text-sm leading-[1.35]">{summary}</span>
        </div>
        <output aria-atomic="true" className={`shrink-0 text-xs sm:text-right ${stateClassName}`}>
          <span aria-hidden="true">{toolStateLabel}</span>
          <span className="sr-only">{`${summary}: ${toolStateLabel}`}</span>
        </output>
      </div>
      {reauthServerId ? (
        <ReconnectButton serverId={reauthServerId} serverName={reauthServerName} />
      ) : null}
      {needsApproval && approvalResponse ? (
        <ToolApprovalCard
          name={name}
          approval={needsApproval}
          input={input}
          onApprovalResponse={approvalResponse}
        />
      ) : null}
      {suggestion ? <InlineApprovalCard suggestion={suggestion} /> : null}
      <ToolDetails name={name} state={state} input={input} output={output} />
    </div>
  );
}
