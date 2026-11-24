'use client';

import type { PersonalDigestRecipient } from '@timeline/shared/messaging';
import Link from 'next/link';
import { startTransition, useActionState, useState, type SubmitEvent } from 'react';

import { updateSchedule, type UpdateFormState } from '@/app/app/updates/actions';
import { Button } from '@/components/ui/button';

type Options = NonNullable<UpdateFormState['preview']>['options'];
interface Preference {
  enabled: boolean;
  hour: number;
  timezone: string;
  options?: Options;
}
type PersonalDestinations = PersonalDigestRecipient['kind'][];

const labels = {
  cadence: { daily: 'Daily brief', weekly: 'Weekly overview' },
  scope: { workspace: 'Workspace activity', saved_views: 'Followed saved views only' },
  focus: {
    balanced: 'Material changes',
    progress: 'Progress',
    decisions: 'Decisions',
    blockers: 'Blockers and follow-ups',
  },
  destination: { app: 'Home only', personal: 'Home and personal workspace destinations' },
};
const personalDestinationLabels = {
  email_members: 'Email',
  slack_dm_members: 'Slack DM',
  telegram_dm_members: 'Telegram DM',
};

const selectClass = 'min-h-11 w-full rounded-sm border border-border bg-surface px-3 text-sm';

function UpdateScheduleSummary({
  preference,
  options,
  personalDestinations,
}: {
  preference: Preference;
  options: Options;
  personalDestinations: PersonalDestinations;
}) {
  const personalLabel =
    personalDestinations.length > 0
      ? `Home and ${personalDestinations.map((kind) => personalDestinationLabels[kind]).join(', ')}`
      : preference.options
        ? labels.destination.app
        : 'Existing digest delivery';
  const deliveryLabel = options.destination === 'app' ? labels.destination.app : personalLabel;
  return (
    <div className="space-y-1">
      <h2 id="update-schedule-heading" className="font-semibold">
        {preference.enabled ? 'Active schedule' : 'Updates paused'}
      </h2>
      <p className="text-sm text-fg-muted">
        {labels.cadence[options.cadence]} · {labels.scope[options.scope]} · {deliveryLabel}
      </p>
      <p className="text-sm text-fg-muted">
        {options.cadence === 'weekly' ? 'Monday · ' : ''}
        {String(preference.hour).padStart(2, '0')}:00 · {preference.timezone}
      </p>
    </div>
  );
}

export function UpdateScheduleForm({
  preference,
  personalDestinations,
  teamId,
}: {
  teamId: string;
  personalDestinations: PersonalDestinations;
  preference: Preference;
}) {
  const [state, action, pending] = useActionState(updateSchedule, {});
  const options = preference.options ?? {
    cadence: 'daily',
    scope: 'workspace',
    focus: 'balanced',
    destination: 'personal',
  };

  const personalAvailable = personalDestinations.length > 0;
  const [draft, setDraft] = useState<Options>(
    personalAvailable ? options : { ...options, destination: 'app' },
  );
  const previewCurrent =
    state.preview &&
    Object.keys(draft).every(
      (key) => draft[key as keyof Options] === state.preview?.options[key as keyof Options],
    );

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget, event.nativeEvent.submitter);
    for (const [name, value] of Object.entries(draft)) form.set(name, value);
    // Dispatch explicitly so React's automatic form reset cannot undo the previewed selections.
    startTransition(() => {
      action(form);
    });
  }

  return (
    <section aria-labelledby="update-schedule-heading" className="max-w-xl space-y-5">
      <UpdateScheduleSummary
        preference={preference}
        options={options}
        personalDestinations={personalDestinations}
      />
      <form action={action} onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="teamId" value={teamId} />
        <fieldset disabled={pending} className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span>What to follow</span>
            <select
              name="scope"
              className={selectClass}
              value={draft.scope}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  scope: event.target.value as Options['scope'],
                  focus: event.target.value === 'saved_views' ? 'balanced' : draft.focus,
                });
              }}
            >
              <option value="workspace">{labels.scope.workspace}</option>
              <option value="saved_views">{labels.scope.saved_views}</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>Cadence</span>
            <select
              name="cadence"
              className={selectClass}
              value={draft.cadence}
              onChange={(event) => {
                setDraft({ ...draft, cadence: event.target.value as Options['cadence'] });
              }}
            >
              <option value="daily">{labels.cadence.daily}</option>
              <option value="weekly">{labels.cadence.weekly}</option>
            </select>
          </label>
          {draft.scope === 'saved_views' ? (
            <input type="hidden" name="focus" value="balanced" />
          ) : (
            <label className="space-y-1 text-sm">
              <span>Workspace briefing emphasis</span>
              <select
                name="focus"
                className={selectClass}
                value={draft.focus}
                onChange={(event) => {
                  setDraft({ ...draft, focus: event.target.value as Options['focus'] });
                }}
              >
                {Object.entries(labels.focus).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="space-y-1 text-sm">
            <span>Delivery</span>
            <select
              name="destination"
              className={selectClass}
              value={draft.destination}
              onChange={(event) => {
                setDraft({ ...draft, destination: event.target.value as Options['destination'] });
              }}
            >
              <option value="personal" disabled={!personalAvailable}>
                {labels.destination.personal}
              </option>
              <option value="app">{labels.destination.app}</option>
            </select>
          </label>
        </fieldset>
        <p className="text-sm text-fg-muted">
          Choose which views to follow in{' '}
          <Link href="/app/work/views" className="underline underline-offset-4">
            Saved views
          </Link>
          .
          {personalAvailable
            ? ' Personal delivery uses your available email and direct-message destinations.'
            : ' Personal delivery needs a verified email or linked chat enabled for updates.'}
        </p>
        {previewCurrent && state.preview ? (
          <div role="status" className="space-y-1 rounded-sm border border-border p-4 text-sm">
            <p className="font-medium">{labels.cadence[state.preview.options.cadence]} preview</p>
            <p>{state.preview.detail}</p>
            {state.preview.links?.length ? (
              <ul className="space-y-1">
                {state.preview.links.map(({ id, label, href }) => (
                  <li key={id ?? href}>
                    <Link href={href} className="underline underline-offset-4">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {state.error ? (
          <p role="alert" className="text-sm text-fg">
            {state.error}
          </p>
        ) : null}
        {state.saved ? (
          <p role="status" className="text-sm text-fg-muted">
            Schedule saved.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="intent" value="preview" variant="outline" disabled={pending}>
            Preview
          </Button>
          {previewCurrent ? (
            <Button type="submit" name="intent" value="save" disabled={pending}>
              Save and enable
            </Button>
          ) : null}
          {state.retryScheduling ? (
            <Button type="submit" name="intent" value="retry" variant="outline" disabled={pending}>
              Retry scheduling
            </Button>
          ) : null}
          <Button
            type="submit"
            name="intent"
            value={preference.enabled ? 'pause' : 'resume'}
            variant="ghost"
            disabled={pending}
          >
            {preference.enabled ? 'Pause updates' : 'Resume updates'}
          </Button>
        </div>
      </form>
    </section>
  );
}
