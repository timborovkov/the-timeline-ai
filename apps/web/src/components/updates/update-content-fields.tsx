import { UPDATE_SECTIONS, type UpdateSettings } from '@timeline/shared/messaging/format';

import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

const field = 'grid gap-1.5 text-sm font-medium text-fg';
const hint = 'text-xs leading-relaxed font-normal text-fg-muted';

export function UpdateContentFields({
  draft,
  includeSavedViews,
  change,
}: {
  draft: UpdateSettings;
  includeSavedViews: boolean;
  change: <K extends keyof UpdateSettings>(key: K, value: UpdateSettings[K]) => void;
}) {
  const selected = new Set(draft.sections);
  const horizon = selected.has('due') || selected.has('calendar');
  return (
    <fieldset className="space-y-4 border-t border-border pt-4">
      <legend className="pr-3 text-sm font-semibold text-fg">Content</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {UPDATE_SECTIONS.filter(({ value }) => value !== 'savedViews' || includeSavedViews).map(
          (section) => (
            <label
              key={section.value}
              className="flex cursor-pointer items-start gap-3 rounded-sm border border-border bg-bg p-3 text-sm hover:border-border-strong"
            >
              <input
                className="size-4 shrink-0 accent-signal"
                type="checkbox"
                name="sections"
                value={section.value}
                checked={selected.has(section.value)}
                onChange={(event) => {
                  change(
                    'sections',
                    event.currentTarget.checked
                      ? [...draft.sections, section.value]
                      : draft.sections.filter((value) => value !== section.value),
                  );
                }}
              />
              <span className="grid gap-0.5">
                <span className="font-medium text-fg">{section.label}</span>
                <span className={hint}>{section.description}</span>
              </span>
            </label>
          ),
        )}
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-3">
        <label className={field}>
          Level of detail
          <NativeSelect
            name="detail"
            value={draft.detail}
            onChange={(event) => {
              change('detail', event.currentTarget.value as UpdateSettings['detail']);
            }}
          >
            <option value="brief">Quick scan</option>
            <option value="detailed">More context</option>
          </NativeSelect>
          <span className={hint}>
            {draft.detail === 'brief'
              ? 'A few highlights per section.'
              : 'More highlights and supporting context in email.'}
          </span>
        </label>
        {selected.has('activity') ? (
          <label className={field}>
            Look back (days)
            <Input
              type="number"
              name="lookbackDays"
              min={1}
              max={14}
              required
              value={draft.lookbackDays || ''}
              onChange={(event) => {
                change('lookbackDays', event.currentTarget.valueAsNumber || 0);
              }}
            />
            <span className={hint}>Timeline activity before each send.</span>
          </label>
        ) : (
          <input type="hidden" name="lookbackDays" value={draft.lookbackDays} />
        )}
        {horizon ? (
          <label className={field}>
            Look ahead (days)
            <Input
              type="number"
              name="upcomingDays"
              min={1}
              max={14}
              required
              value={draft.upcomingDays || ''}
              onChange={(event) => {
                change('upcomingDays', event.currentTarget.valueAsNumber || 0);
              }}
            />
            <span className={hint}>Starts on the day the update is sent.</span>
          </label>
        ) : (
          <input type="hidden" name="upcomingDays" value={draft.upcomingDays} />
        )}
      </div>
    </fieldset>
  );
}
