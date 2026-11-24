'use client';

import { useActionState } from 'react';

import { setRecordMaintenancePolicyAction } from '@/app/actions/suggestions';
import { Button } from '@/components/ui/button';
import type { SuggestionActionState } from '@/lib/suggestion-action-result';

interface Policy {
  reviewManualValues: boolean;
  approveRemovals: boolean;
  approveMerges: boolean;
}

const SETTINGS = [
  { name: 'reviewManualValues', label: 'Require review to replace a manually set record value' },
  { name: 'approveRemovals', label: 'Automatically apply explicit archive requests' },
  {
    name: 'approveMerges',
    label: 'Automatically apply explicit merge requests with verified provider identity',
  },
] as const;

export function RecordMaintenanceForm({ policy }: { policy: Policy }) {
  const [state, save, pending] = useActionState(
    async (_state: SuggestionActionState & { policy: Policy }, input: FormData) => {
      const next = {
        reviewManualValues: input.has('reviewManualValues'),
        approveRemovals: input.has('approveRemovals'),
        approveMerges: input.has('approveMerges'),
      };
      const result = await setRecordMaintenancePolicyAction(next);
      return { ...result, policy: next };
    },
    { policy },
  );
  return (
    <form action={save} className="space-y-4">
      {SETTINGS.map((setting) => (
        <label key={setting.name} className="flex items-start gap-2 text-sm">
          <input name={setting.name} type="checkbox" defaultChecked={state.policy[setting.name]} />
          {setting.label}
        </label>
      ))}
      <Button type="submit" disabled={pending}>
        Save settings
      </Button>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="text-sm text-fg-muted">
          Settings saved.
        </p>
      ) : null}
    </form>
  );
}
