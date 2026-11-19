'use client';

import {
  suggestionRejectionLabels,
  suggestionRejectionReason,
  type SuggestionRejectionReason,
} from '@timeline/shared/suggestions/rejection';
import { X } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function RejectProposal({
  count = 1,
  disabled,
  onReject,
}: {
  count?: number;
  disabled: boolean;
  onReject: (reason?: SuggestionRejectionReason) => void;
}) {
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<SuggestionRejectionReason>();
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setReason(undefined);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="ghost" disabled={disabled}>
          <X className="size-4" />
          Reject
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Reject proposals" className="w-64 p-3">
        <div className="grid gap-3">
          <label htmlFor={labelId} className="text-sm font-medium">
            Rejection reason (optional)
          </label>
          <select
            id={labelId}
            value={reason ?? ''}
            onChange={(event) => {
              const parsed = suggestionRejectionReason.safeParse(event.currentTarget.value);
              setReason(parsed.success ? parsed.data : undefined);
            }}
            className="min-h-10 rounded-sm border border-border bg-surface px-2 text-sm"
          >
            <option value="">Choose a reason</option>
            {suggestionRejectionReason.options.map((reason) => (
              <option key={reason} value={reason}>
                {suggestionRejectionLabels[reason]}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onReject(reason);
            }}
          >
            {count === 1 ? 'Reject proposal' : `Reject ${count} proposals`}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function RejectionReason({
  metadata,
  status,
  className,
}: {
  metadata: Record<string, unknown> | undefined;
  status: string;
  className: string;
}) {
  if (status !== 'rejected') return null;
  const reason = suggestionRejectionReason.safeParse(metadata?.rejection_reason);
  return reason.success ? (
    <p className={className}>Rejected · {suggestionRejectionLabels[reason.data]}</p>
  ) : null;
}
