'use client';

import { Check, GitMerge, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { ApprovalPreviewTimestamps } from '@/lib/approval-preview';
import type { ComponentProps } from 'react';

import { getApprovalTargetSnapshotAction } from '@/app/actions/approval-preview';
import { SuggestionChangeDialog } from '@/components/approvals/suggestion-change-dialog';
import { EvidenceLink } from '@/components/evidence-link';
import { RelativeTimestamp } from '@/components/relative-timestamp';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ItemActionGroup } from '@/components/ui/item-actions';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  buildApprovalPreviewFields,
  type ApprovalPreviewField,
  type ApprovalTargetSnapshot,
} from '@/lib/approval-preview';
import { displayText } from '@/lib/display-dates';
import { evidenceSourceContextLabel } from '@/lib/evidence-source-label';
import { isActionableSuggestionStatus } from '@/lib/suggestion-status';
import { cn } from '@/lib/utils';

interface PreviewEvidence {
  rawEventId: string;
  quote: string | null;
  occurredAt: string | null;
  source: string | null;
  senderName?: string | null;
  senderHandle?: string | null;
  senderTimelineName?: string | null;
  conversationName?: string | null;
}

export function ApprovalPreviewDialog({
  returnFocusTo,
  presentation = 'dialog',
  reason,
  open,
  onOpenChange,
  item,
  timezone,
  actionLabel,
  acceptDisabled,
  busy,
  pending,
  mergeHref,
  onAccept,
  onReject,
}: {
  returnFocusTo?: HTMLElement | null;
  presentation?: 'dialog' | 'panel' | 'sheet';
  reason?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: {
    id: string;
    status: string;
    operation: string;
    targetKind: string;
    targetId: string | null;
    title: string;
    description: string | null;
    proposedPayload: Record<string, unknown>;
    evidence?: PreviewEvidence[];
  };
  timezone: string;
  actionLabel: string;
  acceptDisabled: boolean;
  busy: boolean;
  pending: boolean;
  mergeHref?: string | null;
  onAccept: () => void;
  onReject: () => void;
}) {
  const requestKey = `${item.id}:${item.targetKind}:${item.targetId ?? ''}:${open ? 'open' : 'closed'}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    snapshot: ApprovalTargetSnapshot;
    members: Record<string, string>;
    currentEvidence: PreviewEvidence[];
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const objectIds = Array.isArray(item.proposedPayload.objectIds)
      ? item.proposedPayload.objectIds.filter((value): value is string => typeof value === 'string')
      : undefined;
    void getApprovalTargetSnapshotAction({
      targetKind: item.targetKind,
      targetId: item.targetId,
      objectIds,
    }).then((result) => {
      if (cancelled) return;
      setLoaded({
        key: requestKey,
        snapshot: result.snapshot ?? { kind: 'none' },
        members: result.members ?? {},
        currentEvidence: result.currentEvidence ?? [],
      });
    });
    return () => {
      cancelled = true;
    };
  }, [item.id, item.proposedPayload.objectIds, item.targetId, item.targetKind, open, requestKey]);

  const snapshot = loaded?.key === requestKey ? loaded.snapshot : null;
  const members = loaded?.key === requestKey ? loaded.members : {};
  const loadingSnapshot = open && loaded?.key !== requestKey;

  const { fields, timestamps } = buildApprovalPreviewFields({
    operation: item.operation,
    targetKind: item.targetKind,
    title: item.title,
    proposedPayload: item.proposedPayload,
    snapshot,
    members,
    timezone,
  });
  const evidence = item.evidence ?? [];

  const actions = (
    <PreviewDecisionActions
      item={item}
      mergeHref={mergeHref}
      pending={pending}
      busy={busy}
      acceptDisabled={acceptDisabled}
      presentation={presentation}
      onAccept={onAccept}
      onReject={onReject}
    />
  );
  const content = (
    <>
      <div className="space-y-3">
        {acceptDisabled ? (
          <p role="status" className="text-sm text-danger">
            Source evidence has changed. Regenerate this proposal before accepting.
          </p>
        ) : null}
        {reason ? (
          <section>
            <h3 className="text-sm font-semibold">Why this change</h3>
            <p className="mt-2 text-sm leading-6 text-fg-muted">
              {displayText(reason, { timezone })}
            </p>
          </section>
        ) : null}
        <ApprovalPreviewContent
          bounded={presentation === 'dialog'}
          loadingSnapshot={loadingSnapshot}
          fields={fields}
          timestamps={timestamps}
          item={item.description?.trim() === reason?.trim() ? { ...item, description: null } : item}
          timezone={timezone}
          evidence={evidence}
          currentEvidence={loaded?.key === requestKey ? loaded.currentEvidence : []}
        />
      </div>
    </>
  );
  const description = `${actionLabel} · ${item.operation === 'create' ? 'Proposed record' : 'Current record with highlighted changes'}`;
  const restoreFocus = (event: Event) => {
    if (returnFocusTo?.isConnected) {
      event.preventDefault();
      returnFocusTo.focus();
    }
  };
  if (presentation === 'panel')
    return (
      <section
        aria-label="Review proposal"
        className="sticky top-4 flex max-h-[calc(100dvh-10rem)] flex-col overflow-hidden rounded-sm border border-border bg-surface"
      >
        <header className="border-b border-border p-5">
          <p className="mb-2 text-xs text-fg-muted">{description}</p>
          <h2 className="text-xl font-semibold leading-7">
            {displayText(item.title, { timezone })}
          </h2>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{content}</div>
        <footer className="border-t border-border bg-surface p-4">{actions}</footer>
      </section>
    );
  if (presentation === 'sheet')
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent onCloseAutoFocus={restoreFocus} className="max-w-xl">
          <SheetHeader>
            <SheetTitle className="pr-8">{displayText(item.title, { timezone })}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{content}</div>
          <footer className="border-t border-border p-4">{actions}</footer>
        </SheetContent>
      </Sheet>
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-bg sm:max-w-2xl" onCloseAutoFocus={restoreFocus}>
        <DialogHeader>
          <DialogTitle className="pr-8">{displayText(item.title, { timezone })}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {content}
        <DialogFooter className="sm:justify-between">{actions}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewDecisionActions({
  item,
  mergeHref,
  pending,
  busy,
  acceptDisabled,
  presentation,
  onAccept,
  onReject,
}: Pick<
  ComponentProps<typeof ApprovalPreviewDialog>,
  | 'item'
  | 'mergeHref'
  | 'pending'
  | 'busy'
  | 'acceptDisabled'
  | 'presentation'
  | 'onAccept'
  | 'onReject'
>) {
  return isActionableSuggestionStatus(item.status) ? (
    <ItemActionGroup label={`Decision actions for ${displayText(item.title)}`}>
      {mergeHref ? (
        <Button asChild size="sm" variant="ghost" disabled={pending}>
          <Link href={mergeHref}>
            <GitMerge className="size-4" />
            Review merge
          </Link>
        </Button>
      ) : (
        <>
          <Button
            type="button"
            size="sm"
            variant={presentation === 'dialog' ? 'ghost' : 'default'}
            disabled={pending || busy || acceptDisabled}
            onClick={onAccept}
          >
            <Check className="size-4" />
            Accept
          </Button>
          <SuggestionChangeDialog
            itemId={item.id}
            title={displayText(item.title)}
            disabled={pending || busy || acceptDisabled}
          />
        </>
      )}
      <Button type="button" size="sm" variant="ghost" disabled={pending || busy} onClick={onReject}>
        <X className="size-4" />
        Reject
      </Button>
    </ItemActionGroup>
  ) : (
    <p className="text-sm capitalize text-fg-muted">
      {item.status.replaceAll('_', ' ')} · Read-only
    </p>
  );
}

function ApprovalPreviewContent({
  bounded = true,
  loadingSnapshot,
  fields,
  timestamps,
  item,
  timezone,
  evidence,
  currentEvidence,
}: {
  bounded?: boolean;
  loadingSnapshot: boolean;
  fields: ApprovalPreviewField[];
  timestamps: ApprovalPreviewTimestamps;
  item: {
    id: string;
    status: string;
    operation: string;
    targetKind: string;
    targetId: string | null;
    title: string;
    description: string | null;
    proposedPayload: Record<string, unknown>;
    evidence?: PreviewEvidence[];
  };
  timezone: string;
  evidence: PreviewEvidence[];
  currentEvidence: PreviewEvidence[];
}) {
  return (
    <div
      className={bounded ? 'max-h-[min(28rem,60dvh)] space-y-4 overflow-y-auto pr-1' : 'space-y-4'}
    >
      {loadingSnapshot ? <p className="text-xs text-fg-dim">Loading current record…</p> : null}
      <dl className="grid gap-1.5">
        {fields.map((field) => (
          <PreviewFieldRow field={field} key={field.key} />
        ))}
      </dl>
      <PreviewTimestamps timestamps={timestamps} />
      {item.description ? (
        <p className="text-sm text-fg-muted">{displayText(item.description, { timezone })}</p>
      ) : null}
      {currentEvidence.length > 0 ? (
        <section className="space-y-2 border-t border-border pt-3">
          <h3 className="text-xs font-medium text-fg">Evidence for the current record</h3>
          {[
            ...new Map(
              currentEvidence.map((entry) => [
                JSON.stringify([entry.rawEventId, entry.quote]),
                entry,
              ]),
            ).entries(),
          ].map(([key, entry]) => (
            <EvidenceLink
              key={key}
              eventId={entry.rawEventId}
              previewText={entry.quote}
              source={entry.source}
              occurredAt={entry.occurredAt}
              className="grid gap-1 text-xs text-fg-dim hover:text-fg"
            >
              <span>
                {evidenceSourceContextLabel(entry)}
                {entry.occurredAt ? (
                  <>
                    {' '}
                    · <RelativeTimestamp value={entry.occurredAt} />
                  </>
                ) : null}
              </span>
              {entry.quote ? <span className="line-clamp-3">{entry.quote}</span> : null}
            </EvidenceLink>
          ))}
        </section>
      ) : null}
      {evidence.length > 0 ? (
        <section className="space-y-2 border-t border-border pt-3">
          <h3 className="text-xs font-medium text-fg">
            Why this was suggested · {evidence.length}{' '}
            {evidence.length === 1 ? 'source' : 'sources'}
          </h3>
          {evidence.map((entry) => (
            <EvidenceLink
              key={entry.rawEventId}
              eventId={entry.rawEventId}
              previewText={entry.quote}
              source={entry.source}
              occurredAt={entry.occurredAt}
              className="grid gap-1 text-xs text-fg-dim hover:text-fg"
            >
              <span>
                Evidence from {evidenceSourceContextLabel(entry)}
                {entry.occurredAt ? (
                  <>
                    {' '}
                    · <RelativeTimestamp value={entry.occurredAt} />
                  </>
                ) : null}
              </span>
              {entry.quote ? (
                <span className="line-clamp-3 text-fg-muted">
                  {displayText(entry.quote, { timezone })}
                </span>
              ) : null}
            </EvidenceLink>
          ))}
        </section>
      ) : null}
    </div>
  );
}
function PreviewTimestamps({ timestamps }: { timestamps: ApprovalPreviewTimestamps }) {
  return (
    <>
      {' '}
      {timestamps.createdAt || timestamps.updatedAt ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-fg-dim">
          {timestamps.createdAt ? (
            <RelativeTimestamp prefix="Created" value={timestamps.createdAt} />
          ) : null}
          {timestamps.createdAt && timestamps.updatedAt ? <span>·</span> : null}
          {timestamps.updatedAt ? (
            <RelativeTimestamp prefix="Updated" value={timestamps.updatedAt} />
          ) : null}
        </p>
      ) : null}
    </>
  );
}

function PreviewFieldRow({ field }: { field: ApprovalPreviewField }) {
  const proposed = field.proposed ?? '—';
  return (
    <div
      className={cn(
        'grid grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-x-3 rounded-sm px-2 py-1 text-sm',
        field.changed && 'bg-signal-soft',
      )}
    >
      <dt className="text-xs text-fg-dim">{field.label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-fg">
        {field.changed && field.current && field.current !== proposed ? (
          <>
            <span className="text-fg-dim line-through">{field.current}</span>
            <span className="text-fg-dim"> → </span>
            <span>{proposed}</span>
          </>
        ) : (
          proposed
        )}
      </dd>
    </div>
  );
}
