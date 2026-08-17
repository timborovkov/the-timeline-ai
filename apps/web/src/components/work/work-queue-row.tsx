'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { updateObjectAction } from '@/app/actions/objects';
import { CollectionRow } from '@/components/collections/collection-row';
import {
  CollectionStatus,
  priorityTone,
  statusTone,
} from '@/components/collections/collection-status';
import { EditableMetadata } from '@/components/collections/editable-metadata';
import { MetadataDateEditor } from '@/components/collections/metadata-date-editor';
import { DueDateDisplay } from '@/components/due-date-display';
import { LiveTaskCategoryBadge } from '@/components/tasks/task-category-badge';
import { displayText } from '@/lib/display-dates';
import { isSchedulableObjectType } from '@/lib/due-dates';
import { dateInputValue, isoTimestamp, toDateOrNull } from '@/lib/iso-timestamp';
import { statusOptionsForType } from '@/lib/object-status-options';
import { statusLabel } from '@/lib/status-labels';
import { TASK_STATUS_COLUMNS, taskDisplayStatus } from '@/lib/task-statuses';
import { errorMessage } from '@/lib/utils';
import {
  reasonLabel,
  reasonTone,
  type WorkQueueItem,
  type WorkQueueReason,
} from '@/lib/work-queue';

export interface WorkQueueMemberOption {
  id: string;
  label: string;
}

type EditableKey = 'status' | 'assigneeUserId' | 'dueAt' | 'priority';
type EditableValue = string | number | Date | null;

export function WorkQueueRow({
  item,
  members,
  timezone,
}: {
  item: Omit<WorkQueueItem, 'dueAt' | 'updatedAt'> & {
    dueAt: Date | string | null;
    updatedAt: Date | string;
  };
  members: WorkQueueMemberOption[];
  timezone: string;
}) {
  const router = useRouter();
  const [overlays, setOverlays] = useState<Partial<Record<EditableKey, EditableValue>>>({});
  const [saving, setSaving] = useState<EditableKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const objectId = item.entityId;
  const editable = item.source !== 'approval' && Boolean(objectId);
  const status = String(overlays.status ?? item.status ?? '');
  const assigneeUserId =
    overlays.assigneeUserId === undefined
      ? (item.assigneeUserId ?? null)
      : (overlays.assigneeUserId as string | null);
  const dueAt = toDateOrNull(
    overlays.dueAt === undefined ? item.dueAt : (overlays.dueAt as Date | string | null),
  );
  const priority =
    overlays.priority === undefined ? item.priority : (overlays.priority as number | null);
  const assignee = members.find((member) => member.id === assigneeUserId);
  const displayStatus = item.objectType === 'task' ? taskDisplayStatus(status) : status;
  const statusOptions =
    item.objectType === 'task'
      ? uniqueStatuses([...TASK_STATUS_COLUMNS, displayStatus])
      : statusOptionsForType(item.objectType ?? '', status);
  const contextReasons = item.reasons.filter(
    (reason) => reason !== 'overdue' && reason !== 'due_soon',
  );
  const context = saving ? (
    <span>Saving {fieldLabel(saving)}…</span>
  ) : item.subtitle ? (
    displayText(item.subtitle)
  ) : undefined;

  function save(key: EditableKey, value: EditableValue): void {
    if (!objectId) return;
    const current = effectiveValue(key);
    if (sameValue(current, value)) return;
    const previous = overlays[key];
    setError(null);
    setSaving(key);
    setOverlays((existing) => ({ ...existing, [key]: value }));
    void updateObjectAction({
      id: objectId,
      [key]: value instanceof Date ? value.toISOString() : value,
    })
      .then((result) => {
        if (result.error) {
          setOverlays((existing) => ({ ...existing, [key]: previous }));
          setError(result.error);
          return;
        }
        router.refresh();
      })
      .catch((cause: unknown) => {
        setOverlays((existing) => ({ ...existing, [key]: previous }));
        setError(errorMessage(cause, 'Update failed'));
      })
      .finally(() => {
        setSaving(null);
      });
  }

  function effectiveValue(key: EditableKey): EditableValue {
    if (key === 'status') return status;
    if (key === 'assigneeUserId') return assigneeUserId;
    if (key === 'dueAt') return dueAt;
    return priority;
  }

  return (
    <CollectionRow
      title={
        <Link href={item.href} className="block truncate hover:underline">
          {displayText(item.title)}
        </Link>
      }
      context={context}
      metadata={
        <>
          {error ? (
            <span className="px-2 text-xs text-danger" role="alert">
              {error}
            </span>
          ) : null}
          {item.source === 'approval' ? (
            <span className="px-2 text-xs text-fg-dim">{item.sourceLabel}</span>
          ) : null}
          {contextReasons.map((reason) => (
            <ReasonBadge key={reason} reason={reason} />
          ))}
          {editable ? (
            <>
              <EditableMetadata
                label={`Status for ${displayText(item.title)}`}
                pending={saving === 'status'}
                value={() => (
                  <CollectionStatus
                    value={displayStatus}
                    label={statusLabel(displayStatus)}
                    tone={statusTone(displayStatus)}
                  />
                )}
                editor={() => (
                  <select
                    aria-label="Status"
                    value={displayStatus}
                    onChange={(event) => {
                      save('status', event.currentTarget.value);
                    }}
                    className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs"
                  >
                    {statusOptions.map((option) => (
                      <option key={option} value={option}>
                        {statusLabel(option)}
                      </option>
                    ))}
                  </select>
                )}
              />
              <EditableMetadata
                label={`Assignee for ${displayText(item.title)}`}
                pending={saving === 'assigneeUserId'}
                value={assignee?.label ?? 'Unassigned'}
                editor={() => (
                  <select
                    aria-label="Assignee"
                    value={assigneeUserId ?? ''}
                    onChange={(event) => {
                      save('assigneeUserId', event.currentTarget.value || null);
                    }}
                    className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs"
                  >
                    <option value="">Unassigned</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.label}
                      </option>
                    ))}
                  </select>
                )}
              />
              {isSchedulableObjectType(item.objectType ?? '') || item.dueAt ? (
                <EditableMetadata
                  label={`Due date for ${displayText(item.title)}`}
                  pending={saving === 'dueAt'}
                  value={() => (
                    <DueDateDisplay value={dueAt} timezone={timezone} variant="compact" />
                  )}
                  editor={() => (
                    <MetadataDateEditor
                      defaultValue={dateInputValue(dueAt)}
                      onApply={(value) => {
                        save('dueAt', value ? new Date(`${value}T00:00:00.000Z`) : null);
                      }}
                    />
                  )}
                />
              ) : null}
              <EditableMetadata
                label={`Priority for ${displayText(item.title)}`}
                pending={saving === 'priority'}
                value={() => (
                  <CollectionStatus
                    value={priority ? `p${priority}` : 'none'}
                    tone={priorityTone(priority)}
                    label={priority ? `P${priority}` : 'No priority'}
                  />
                )}
                editor={() => (
                  <select
                    aria-label="Priority"
                    value={priority ?? ''}
                    onChange={(event) => {
                      save(
                        'priority',
                        event.currentTarget.value ? Number(event.currentTarget.value) : null,
                      );
                    }}
                    className="h-10 w-full rounded-sm border border-border bg-bg px-2 text-xs"
                  >
                    <option value="">None</option>
                    {[1, 2, 3, 4].map((value) => (
                      <option key={value} value={value}>
                        P{value}
                      </option>
                    ))}
                  </select>
                )}
              />
            </>
          ) : item.source !== 'approval' ? (
            <DueDateDisplay value={item.dueAt} timezone={timezone} variant="compact" />
          ) : null}
          {item.objectType === 'task' ? (
            <LiveTaskCategoryBadge
              taskId={objectId ?? item.id}
              category={item.taskCategory ?? null}
              status={item.taskCategoryStatus ?? null}
              updatedAt={isoTimestamp(item.updatedAt) ?? null}
            />
          ) : null}
        </>
      }
    />
  );
}

function ReasonBadge({ reason }: { reason: WorkQueueReason }) {
  const tone = reasonTone(reason);
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-sm border px-2 text-xs ${
        tone === 'danger'
          ? 'border-danger/40 text-danger'
          : tone === 'signal'
            ? 'border-signal/40 bg-signal-soft text-signal'
            : 'border-border text-fg-muted'
      }`}
    >
      {reasonLabel(reason)}
    </span>
  );
}

function fieldLabel(key: EditableKey): string {
  if (key === 'assigneeUserId') return 'assignee';
  if (key === 'dueAt') return 'due date';
  return key;
}

function uniqueStatuses(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function sameValue(left: EditableValue, right: EditableValue): boolean {
  if (left instanceof Date || right instanceof Date) {
    const leftDate = typeof left === 'number' ? null : toDateOrNull(left);
    const rightDate = typeof right === 'number' ? null : toDateOrNull(right);
    return leftDate?.getTime() === rightDate?.getTime();
  }
  return left === right;
}
