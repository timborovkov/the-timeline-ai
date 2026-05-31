'use client';

import { type objects } from '@timeline/shared';
import { useRouter } from 'next/navigation';
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';

import type { SaveState } from '@/lib/utils';

import {
  acceptObjectChangeAction,
  addRelationshipAction,
  archiveObjectAction,
  createNoteAction,
  deleteNoteAction,
  rejectObjectChangeAction,
  removeRelationshipAction,
  updateNoteAction,
  updateObjectAction,
} from '@/app/actions/objects';
import { ApprovalsClient } from '@/components/approvals/approvals-client';
import { ObjectSectionFeed } from '@/components/objects/object-section-feed';
import { errorMessage } from '@/lib/utils';

const RELATIONSHIP_KINDS = [
  'related',
  'parent',
  'child',
  'blocks',
  'blocked_by',
  'duplicate_of',
  'linked',
] as const;

type ObjectDetail = objects.ObjectDetail;
type LocalSuggestion = ComponentProps<typeof ApprovalsClient>['suggestions'][number];
type EditableField = 'status' | 'stage' | 'priority' | 'dueAt';
type EditableValue = string | number | Date | null;
type DraftField = 'stage' | 'dueAt';

const EDITABLE_FIELDS: EditableField[] = ['status', 'stage', 'priority', 'dueAt'];

interface Props {
  detail: ObjectDetail;
  userId: string;
  suggestions: LocalSuggestion[];
}

// Per-type status vocabulary. Free-form text in the DB so callers can extend
// without a migration; the dropdown lives in the UI.
const STATUS_BY_TYPE: Record<string, string[]> = {
  deal: ['open', 'qualified', 'proposal', 'won', 'lost'],
  task: ['suggested', 'todo', 'doing', 'done', 'blocked', 'cancelled'],
  follow_up: ['todo', 'doing', 'done', 'cancelled'],
  project: ['planning', 'active', 'on_hold', 'shipped', 'cancelled'],
  incident: ['open', 'mitigated', 'resolved', 'postmortem'],
  hiring_loop: ['sourcing', 'interviewing', 'offer', 'hired', 'closed'],
  decision: ['draft', 'proposed', 'accepted', 'rejected'],
};

function statusOptions(type: string): string[] {
  return STATUS_BY_TYPE[type] ?? ['open', 'active', 'archived'];
}

export function ObjectDetailClient({ detail, userId, suggestions }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [localDetail, setLocalDetail] = useState(detail);
  const [stageDraft, setStageDraft] = useState(detail.stage ?? '');
  const [dueDraft, setDueDraft] = useState(toLocalInputValue(detail.dueAt));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savingCount, setSavingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [linkId, setLinkId] = useState('');
  const [linkKind, setLinkKind] = useState<(typeof RELATIONSHIP_KINDS)[number]>('related');
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localDetailRef = useRef(detail);
  const serverDetailRef = useRef(detail);
  const queuedFieldValuesRef = useRef<Record<EditableField, EditableValue | undefined>>({
    status: undefined,
    stage: undefined,
    priority: undefined,
    dueAt: undefined,
  });
  const savingCountRef = useRef(0);
  const batchHadFailureRef = useRef(false);
  const focusedDraftsRef = useRef<Record<DraftField, boolean>>({ stage: false, dueAt: false });
  const savingDraftsRef = useRef<Record<DraftField, number>>({ stage: 0, dueAt: 0 });
  const savingFieldsRef = useRef<Record<EditableField, number>>({
    status: 0,
    stage: 0,
    priority: 0,
    dueAt: 0,
  });

  function updateLocalDetail(updater: (current: ObjectDetail) => ObjectDetail): void {
    const next = updater(localDetailRef.current);
    localDetailRef.current = next;
    setLocalDetail(next);
  }

  function isDraftField(field: EditableField): field is DraftField {
    return field === 'stage' || field === 'dueAt';
  }

  function draftIsProtected(field: DraftField): boolean {
    return focusedDraftsRef.current[field] || savingDraftsRef.current[field] > 0;
  }

  function fieldIsProtected(field: EditableField): boolean {
    return savingFieldsRef.current[field] > 0 || (isDraftField(field) && draftIsProtected(field));
  }

  useEffect(() => {
    serverDetailRef.current = detail;
    setLocalDetail((current) => {
      const next = { ...detail };
      for (const field of EDITABLE_FIELDS) {
        if (fieldIsProtected(field)) {
          next[field] = current[field] as never;
        }
      }
      localDetailRef.current = next;
      return next;
    });
    if (!draftIsProtected('stage')) setStageDraft(detail.stage ?? '');
    if (!draftIsProtected('dueAt')) setDueDraft(toLocalInputValue(detail.dueAt));
  }, [detail]);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  function patch(field: EditableField, value: EditableValue): void {
    const currentValue = localDetailRef.current[field];
    if (sameEditableValue(field, currentValue, value)) return;
    setError(null);
    updateLocalDetail((current) => ({ ...current, [field]: value }));
    if (savingFieldsRef.current[field] > 0) {
      queuedFieldValuesRef.current[field] = value;
      return;
    }
    beginFieldSave(field, value);
  }

  function beginFieldSave(field: EditableField, value: EditableValue): void {
    savingFieldsRef.current[field] += 1;
    if (isDraftField(field)) savingDraftsRef.current[field] += 1;
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setSaveState('saving');
    if (savingCountRef.current === 0) batchHadFailureRef.current = false;
    savingCountRef.current += 1;
    setSavingCount(savingCountRef.current);
    startTransition(async () => {
      try {
        const actionValue = value instanceof Date ? value.toISOString() : value;
        const result = await updateObjectAction({ id: detail.id, [field]: actionValue });
        const failed = 'error' in result && result.error;
        if (failed) {
          handleFieldSaveFailure(field, value, result.error ?? 'Update failed');
        } else if (!batchHadFailureRef.current) {
          setError(null);
        }
        router.refresh();
      } catch (err) {
        handleFieldSaveFailure(field, value, errorMessage(err, 'Update failed'));
        router.refresh();
      } finally {
        finishFieldSave(field);
      }
    });
  }

  function handleFieldSaveFailure(field: EditableField, value: EditableValue, message: string) {
    batchHadFailureRef.current = true;
    setError(message);
    const rollbackValue = serverDetailRef.current[field];
    if (
      queuedFieldValuesRef.current[field] === undefined &&
      sameEditableValue(field, localDetailRef.current[field], value)
    ) {
      updateLocalDetail((current) => ({
        ...current,
        [field]: field === 'dueAt' ? toDateOrNull(rollbackValue) : rollbackValue,
      }));
      if (field === 'stage') {
        setStageDraft(rollbackValue === null ? '' : String(rollbackValue));
      }
      if (field === 'dueAt') {
        setDueDraft(toLocalInputValue(rollbackValue));
      }
    }
  }

  function finishFieldSave(field: EditableField): void {
    savingCountRef.current = Math.max(0, savingCountRef.current - 1);
    if (isDraftField(field)) {
      savingDraftsRef.current[field] = Math.max(0, savingDraftsRef.current[field] - 1);
    }
    savingFieldsRef.current[field] = Math.max(0, savingFieldsRef.current[field] - 1);

    const queuedValue = queuedFieldValuesRef.current[field];
    queuedFieldValuesRef.current[field] = undefined;
    if (queuedValue !== undefined) {
      beginFieldSave(field, queuedValue);
      return;
    }

    setSavingCount(savingCountRef.current);
    if (savingCountRef.current === 0) {
      if (batchHadFailureRef.current) {
        setSaveState('idle');
      } else {
        setSaveState('saved');
        savedTimer.current = setTimeout(() => {
          setSaveState('idle');
        }, 1600);
      }
    }
  }

  function addNote(): void {
    if (!noteBody.trim()) return;
    setError(null);
    const body = noteBody;
    startTransition(async () => {
      const result = await createNoteAction({ entityId: detail.id, body });
      if ('error' in result && result.error) {
        // Keep the textarea contents so the user can retry without
        // re-typing — mirrors the edit-note flow.
        setError(result.error);
      } else {
        setNoteBody('');
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-8">
      <header>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-y border-border py-3 font-mono text-xs uppercase tracking-[0.12em] text-fg-muted">
          <span className="text-fg">{detail.type}</span>
          <span className="text-fg-dim">·</span>
          <span className="text-signal">{detail.canonicalName}</span>
          <span className="ml-auto text-fg-dim">id&nbsp;{detail.id.slice(0, 8)}</span>
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{detail.canonicalName}</h1>
        {detail.aliases.length > 0 && (
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim">
            aka {detail.aliases.join(' · ')}
          </p>
        )}
        {detail.newSinceLastVisit > 0 && (
          <div
            role="status"
            className="mt-4 rounded-sm border border-signal/40 bg-signal-soft px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-signal"
          >
            {detail.newSinceLastVisit} new change
            {detail.newSinceLastVisit === 1 ? '' : 's'} since your last visit
          </div>
        )}
        {(() => {
          // Local name avoids shadowing the outer `pending` from
          // useTransition, so future edits inside this IIFE that reach
          // for `pending` get the transition state instead of silently
          // grabbing the count.
          const pendingCount = detail.recentChanges.filter((c) => c.status === 'suggested').length;
          if (pendingCount === 0) return null;
          return (
            <div
              role="status"
              className="mt-3 rounded-sm border border-signal/40 bg-signal-soft px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-signal"
            >
              {pendingCount} agent suggestion
              {pendingCount === 1 ? '' : 's'} awaiting review below
            </div>
          );
        })()}
        {error && (
          <div
            role="alert"
            className="mt-4 rounded-sm border border-danger/40 bg-bg px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-danger"
          >
            {error}
          </div>
        )}
        {saveState !== 'idle' && (
          <div
            role="status"
            aria-live="polite"
            className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-dim"
          >
            {saveState === 'saving'
              ? `Saving${savingCount > 1 ? ` ${savingCount} changes` : ''}...`
              : 'Saved'}
          </div>
        )}
      </header>

      {suggestions.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium tracking-tight">Pending approvals</h2>
          <ApprovalsClient suggestions={suggestions} />
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Field label="Status">
          <select
            value={localDetail.status}
            onChange={(e) => {
              patch('status', e.target.value);
            }}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            {statusOptions(localDetail.type).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {!statusOptions(localDetail.type).includes(localDetail.status) && (
              <option value={localDetail.status}>{localDetail.status}</option>
            )}
          </select>
        </Field>
        <Field label="Stage">
          <input
            value={stageDraft}
            onFocus={() => {
              focusedDraftsRef.current.stage = true;
            }}
            onChange={(e) => {
              setStageDraft(e.target.value);
            }}
            onBlur={(e) => {
              focusedDraftsRef.current.stage = false;
              const v = e.target.value.trim();
              setStageDraft(v);
              patch('stage', v === '' ? null : v);
            }}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="e.g. discovery"
          />
        </Field>
        <Field label="Priority">
          <select
            value={localDetail.priority ?? ''}
            onChange={(e) => {
              patch('priority', e.target.value === '' ? null : Number(e.target.value));
            }}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">—</option>
            <option value="1">1 (urgent)</option>
            <option value="2">2 (high)</option>
            <option value="3">3 (normal)</option>
            <option value="4">4 (low)</option>
          </select>
        </Field>
        <Field label="Due date">
          <input
            type="datetime-local"
            value={dueDraft}
            onFocus={() => {
              focusedDraftsRef.current.dueAt = true;
            }}
            onChange={(e) => {
              setDueDraft(e.target.value);
            }}
            onBlur={(e) => {
              focusedDraftsRef.current.dueAt = false;
              const v = e.target.value;
              patch('dueAt', v === '' ? null : new Date(v));
            }}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </Field>
      </section>

      <ObjectSectionFeed objectId={detail.id} section="events" title="Timeline events" />
      <ObjectSectionFeed objectId={detail.id} section="facts" title="Facts" />
      <ObjectSectionFeed objectId={detail.id} section="tasks" title="Open tasks" />
      <ObjectSectionFeed objectId={detail.id} section="relationships" title="Related" />
      <ObjectSectionFeed objectId={detail.id} section="changes" title="Recent changes" />

      <section>
        <h2 className="mb-3 text-sm font-medium tracking-tight">Notes</h2>
        <div className="mb-4 space-y-2">
          <textarea
            value={noteBody}
            onChange={(e) => {
              setNoteBody(e.target.value);
            }}
            placeholder="Add a note. Each note also lands on the timeline."
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            rows={3}
          />
          <button
            type="button"
            onClick={addNote}
            disabled={pending || !noteBody.trim()}
            className="rounded-md border border-signal/40 bg-signal-soft px-3 py-1.5 text-sm text-signal hover:bg-signal/25 disabled:opacity-50"
          >
            Add note
          </button>
        </div>
        {detail.notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        ) : (
          <ul className="space-y-3">
            {detail.notes.map((n) => {
              const isEditing = editingNoteId === n.id;
              const isOwner = n.authorUserId === userId;
              return (
                <li
                  key={n.id}
                  className="rounded-sm border border-border bg-surface px-4 py-3 text-sm"
                >
                  {isEditing ? (
                    <div className="space-y-2">
                      <textarea
                        value={editingBody}
                        onChange={(e) => {
                          setEditingBody(e.target.value);
                        }}
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        rows={3}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={pending || !editingBody.trim()}
                          onClick={() => {
                            const body = editingBody;
                            setError(null);
                            startTransition(async () => {
                              const result = await updateNoteAction({
                                noteId: n.id,
                                entityId: detail.id,
                                body,
                              });
                              if ('error' in result && result.error) {
                                // Keep the editor open so the user can fix
                                // their input rather than losing the draft.
                                setError(result.error);
                              } else {
                                setEditingNoteId(null);
                                router.refresh();
                              }
                            });
                          }}
                          className="rounded-md border border-signal/40 bg-signal-soft px-3 py-1 text-xs text-signal hover:bg-signal/25 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingNoteId(null);
                          }}
                          className="rounded-md border px-3 py-1 text-xs text-muted-foreground hover:bg-accent"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap">{n.body}</div>
                  )}
                  <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{new Date(n.createdAt).toLocaleString()}</span>
                    {isOwner && !isEditing && (
                      <div className="flex gap-3">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            setEditingNoteId(n.id);
                            setEditingBody(n.body);
                          }}
                          className="hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            setError(null);
                            startTransition(async () => {
                              const result = await deleteNoteAction({
                                noteId: n.id,
                                entityId: detail.id,
                              });
                              if ('error' in result && result.error) setError(result.error);
                              else router.refresh();
                            });
                          }}
                          className="text-destructive hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium tracking-tight">Open tasks</h2>
        {detail.openTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open tasks linked to this object.</p>
        ) : (
          <ul className="space-y-2">
            {detail.openTasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between rounded-sm border border-border bg-surface px-4 py-2 text-sm"
              >
                <a href={`/app/objects/${t.id}`} className="font-medium hover:underline">
                  {t.canonicalName}
                </a>
                <span className="text-xs text-muted-foreground">
                  {t.status}
                  {t.dueAt ? ` · due ${new Date(t.dueAt).toLocaleDateString()}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium tracking-tight">Related</h2>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
              Link to object id
            </span>
            <input
              value={linkId}
              onChange={(e) => {
                setLinkId(e.target.value);
              }}
              placeholder="paste object UUID"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
            />
          </label>
          <label>
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
              Kind
            </span>
            <select
              value={linkKind}
              onChange={(e) => {
                setLinkKind(e.target.value as (typeof RELATIONSHIP_KINDS)[number]);
              }}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            >
              {RELATIONSHIP_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pending || !linkId.trim()}
            onClick={() => {
              const toId = linkId.trim();
              setError(null);
              startTransition(async () => {
                const result = await addRelationshipAction({
                  fromEntityId: detail.id,
                  toEntityId: toId,
                  kind: linkKind,
                });
                if ('error' in result && result.error) setError(result.error);
                else {
                  setLinkId('');
                  router.refresh();
                }
              });
            }}
            className="rounded-md border border-signal/40 bg-signal-soft px-3 py-2 text-sm text-signal hover:bg-signal/25 disabled:opacity-50"
          >
            Link
          </button>
        </div>
        {detail.relationships.length === 0 ? (
          <p className="text-sm text-muted-foreground">No relationships yet.</p>
        ) : (
          <ul className="space-y-2">
            {detail.relationships.map((r) => (
              <li
                key={`${r.direction}-${r.id}`}
                className="flex items-center justify-between rounded-sm border border-border bg-surface px-4 py-2 text-sm"
              >
                <a href={`/app/objects/${r.otherId}`} className="font-medium hover:underline">
                  {r.otherName}
                </a>
                <div className="flex items-center gap-3">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {r.direction === 'out' ? r.kind : `← ${r.kind}`} · {r.otherType}
                  </span>
                  {r.direction === 'out' && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setError(null);
                        startTransition(async () => {
                          const result = await removeRelationshipAction({
                            id: r.id,
                            entityId: detail.id,
                            otherEntityId: r.otherId,
                          });
                          if ('error' in result && result.error) setError(result.error);
                          else router.refresh();
                        });
                      }}
                      className="text-xs text-destructive hover:underline"
                    >
                      Unlink
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium tracking-tight">Recent changes</h2>
        {detail.recentChanges.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes recorded.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {detail.recentChanges.slice(0, 20).map((c) => {
              const isSuggested = c.status === 'suggested';
              const isRejected = c.status === 'rejected';
              return (
                <li
                  key={c.id}
                  className={`rounded-sm border border-border bg-surface px-4 py-2 ${isSuggested ? 'border-signal/40 bg-signal-soft' : ''} ${isRejected ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{c.field}</span>
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {c.actorKind} · {c.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatValue(c.previousValue)} → {formatValue(c.newValue)}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{new Date(c.changedAt).toLocaleString()}</span>
                    {isSuggested && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            setError(null);
                            startTransition(async () => {
                              const result = await acceptObjectChangeAction({
                                changeId: c.id,
                                entityId: detail.id,
                              });
                              if ('error' in result && result.error) setError(result.error);
                              else router.refresh();
                            });
                          }}
                          className="rounded-md border border-signal/40 bg-signal-soft px-2 py-0.5 text-signal hover:bg-signal/25 disabled:opacity-50"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            setError(null);
                            startTransition(async () => {
                              const result = await rejectObjectChangeAction({
                                changeId: c.id,
                                entityId: detail.id,
                              });
                              if ('error' in result && result.error) setError(result.error);
                              else router.refresh();
                            });
                          }}
                          className="rounded-md border px-2 py-0.5 text-muted-foreground hover:bg-accent disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="border-t pt-6">
        <button
          type="button"
          disabled={pending || detail.archivedAt !== null}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await archiveObjectAction({ id: detail.id });
              if ('error' in result && result.error) setError(result.error);
              else router.refresh();
            });
          }}
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
        >
          {detail.archivedAt ? 'Archived' : 'Archive object'}
        </button>
      </footer>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function sameEditableValue(field: EditableField, a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return Object.is(a, b);
  if (field !== 'dueAt') return Object.is(a, b);
  const aDate = toDateOrNull(a);
  const bDate = toDateOrNull(b);
  if (aDate !== null || bDate !== null) {
    return aDate !== null && bDate !== null && aDate.getTime() === bDate.getTime();
  }
  return Object.is(a, b);
}

function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toLocalInputValue(value: unknown): string {
  const d = toDateOrNull(value);
  return d ? toLocalInput(d) : '';
}

function toLocalInput(d: Date): string {
  // <input type="datetime-local"> expects YYYY-MM-DDTHH:mm in *local* time
  // (no Z). Convert manually rather than slicing toISOString — that returns
  // UTC and the picker would show the wrong wall-clock time for any user
  // not on UTC.
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}
