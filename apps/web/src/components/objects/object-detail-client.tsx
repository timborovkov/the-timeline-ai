'use client';

import { type objects } from '@timeline/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

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

interface Props {
  detail: ObjectDetail;
  userId: string;
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

export function ObjectDetailClient({ detail, userId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [noteBody, setNoteBody] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');
  const [linkId, setLinkId] = useState('');
  const [linkKind, setLinkKind] = useState<(typeof RELATIONSHIP_KINDS)[number]>('related');

  function patch(field: string, value: unknown): void {
    setError(null);
    startTransition(async () => {
      const result = await updateObjectAction({ id: detail.id, [field]: value });
      if ('error' in result && result.error) setError(result.error);
      else router.refresh();
    });
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
    <div className="space-y-10">
      <header>
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{detail.type}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{detail.canonicalName}</h1>
        {detail.aliases.length > 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            Also known as: {detail.aliases.join(', ')}
          </p>
        )}
        {detail.newSinceLastVisit > 0 && (
          <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm text-primary">
            {detail.newSinceLastVisit} new change{detail.newSinceLastVisit === 1 ? '' : 's'} since
            your last visit.
          </div>
        )}
        {(() => {
          // Local name avoids shadowing the outer `pending` from useTransition,
          // so future edits inside this IIFE that reach for `pending` get the
          // transition state instead of silently grabbing the count.
          const pendingCount = detail.recentChanges.filter((c) => c.status === 'suggested').length;
          if (pendingCount === 0) return null;
          return (
            <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-2 text-sm text-amber-700">
              {pendingCount} agent suggestion{pendingCount === 1 ? '' : 's'} awaiting review below.
            </div>
          );
        })()}
        {error && (
          <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
      </header>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Field label="Status">
          <select
            value={detail.status}
            disabled={pending}
            onChange={(e) => {
              patch('status', e.target.value);
            }}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            {statusOptions(detail.type).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {!statusOptions(detail.type).includes(detail.status) && (
              <option value={detail.status}>{detail.status}</option>
            )}
          </select>
        </Field>
        <Field label="Stage">
          <input
            defaultValue={detail.stage ?? ''}
            disabled={pending}
            onBlur={(e) => {
              const v = e.target.value.trim();
              patch('stage', v === '' ? null : v);
            }}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="e.g. discovery"
          />
        </Field>
        <Field label="Priority">
          <select
            value={detail.priority ?? ''}
            disabled={pending}
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
            defaultValue={detail.dueAt ? toLocalInput(detail.dueAt) : ''}
            disabled={pending}
            onBlur={(e) => {
              const v = e.target.value;
              patch('dueAt', v === '' ? null : new Date(v).toISOString());
            }}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </Field>
      </section>

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
            className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm text-primary hover:bg-primary/20 disabled:opacity-50"
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
                <li key={n.id} className="rounded-lg border bg-card px-4 py-3 text-sm">
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
                          className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1 text-xs text-primary hover:bg-primary/20 disabled:opacity-50"
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
                className="flex items-center justify-between rounded-lg border bg-card px-4 py-2 text-sm"
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
            className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary hover:bg-primary/20 disabled:opacity-50"
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
                className="flex items-center justify-between rounded-lg border bg-card px-4 py-2 text-sm"
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
                  className={`rounded-lg border bg-card px-4 py-2 ${isSuggested ? 'border-amber-500/40 bg-amber-500/5' : ''} ${isRejected ? 'opacity-60' : ''}`}
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
                          className="rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-primary hover:bg-primary/20 disabled:opacity-50"
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
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
