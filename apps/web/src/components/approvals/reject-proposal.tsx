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
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="ghost" disabled={disabled}>
          <X className="size-4" />
          Reject
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Reject proposals" className="w-64 p-3">
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const reason = suggestionRejectionReason.safeParse(
              new FormData(event.currentTarget).get('reason'),
            );
            setOpen(false);
            onReject(reason.success ? reason.data : undefined);
          }}
        >
          <label htmlFor={labelId} className="text-sm font-medium">
            Rejection reason (optional)
          </label>
          <select
            id={labelId}
            name="reason"
            className="min-h-10 rounded-sm border border-border bg-surface px-2 text-sm"
          >
            <option value="">Choose a reason</option>
            {suggestionRejectionReason.options.map((reason) => (
              <option key={reason} value={reason}>
                {suggestionRejectionLabels[reason]}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" disabled={disabled}>
            {count === 1 ? 'Reject proposal' : `Reject ${count} proposals`}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
