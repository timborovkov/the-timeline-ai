'use client';

import { useActionState } from 'react';

import { saveDisplayRegion } from '@/app/app/team/display-region-action';
import { FormActionToast } from '@/components/form-action-toast';
import { NativeSelect } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRegionalChoices } from '@/components/workspace-timezone-context';

export function DisplayRegionForm({ timezones }: { timezones: string[] }) {
  const choices = useRegionalChoices();
  const [state, action, pending] = useActionState(saveDisplayRegion, {});
  const options =
    choices.timezone && !timezones.includes(choices.timezone)
      ? [choices.timezone, ...timezones]
      : timezones;

  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-fg-muted">
        Choose how dates, times, and numbers appear in this browser.
      </p>
      <div className="grid max-w-lg gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="display-locale">Locale</Label>
          <Input
            id="display-locale"
            name="locale"
            defaultValue={choices.locale}
            placeholder="Browser default (e.g. en-GB)"
            maxLength={80}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="display-timezone">Display time zone</Label>
          <NativeSelect id="display-timezone" name="timezone" defaultValue={choices.timezone ?? ''}>
            <option value="">Browser default</option>
            {options.map((timezone) => (
              <option key={timezone} value={timezone}>
                {timezone}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? 'Saving…' : 'Save display preferences'}
        </Button>
        <FormActionToast
          id="display-region"
          loading="Saving display preferences…"
          success={state.saved ? 'Display preferences saved' : undefined}
          error={state.error}
          fieldError={Boolean(state.error)}
        />
      </div>
    </form>
  );
}
