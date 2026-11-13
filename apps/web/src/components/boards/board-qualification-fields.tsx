'use client';

import { OBJECT_TYPES } from '@timeline/shared/objects/types';

import type { BoardQualificationDraft } from '@/lib/board-qualification';

const EXAMPLES = [
  {
    label: 'Prospects',
    text: 'People who make purchasing decisions at companies considering our product. Exclude vendors. Suggest removal when they leave the company.',
  },
  {
    label: 'Client projects',
    text: 'Active projects for Acme. Exclude internal projects. Keep completed projects until the client has signed off.',
  },
  {
    label: 'Vendors',
    text: 'Vendors we are actively evaluating. Exclude rejected vendors. Keep selected vendors while their contract is active.',
  },
];
export function BoardQualificationFields({
  value,
  onChange,
  disabled,
}: {
  value: BoardQualificationDraft;
  onChange: (value: BoardQualificationDraft) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="space-y-3 rounded-sm border border-border p-3">
      <legend className="px-1 text-sm font-medium">Board membership</legend>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.strictObjectTypes}
          onChange={(e) => {
            onChange({ ...value, strictObjectTypes: e.target.checked });
          }}
        />
        Restrict allowed object types
      </label>
      <p className="text-xs text-fg-muted">
        By default, all object types are allowed. Restrictions also apply when adding items
        manually.
      </p>
      {value.strictObjectTypes ? (
        <div className="flex flex-wrap gap-3">
          {OBJECT_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={value.recommendedObjectTypes.includes(type)}
                onChange={(e) => {
                  onChange({
                    ...value,
                    recommendedObjectTypes: e.target.checked
                      ? [...value.recommendedObjectTypes, type]
                      : value.recommendedObjectTypes.filter((t) => t !== type),
                  });
                }}
              />
              {type.replaceAll('_', ' ')}
            </label>
          ))}
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.qualificationEnabled}
          onChange={(e) => {
            onChange({ ...value, qualificationEnabled: e.target.checked });
          }}
        />
        Suggest board changes
      </label>
      <p className="text-xs text-fg-muted">
        Find matching objects and suggest when items no longer belong. You review every addition and
        removal separately from object changes.
      </p>
      {value.qualificationEnabled ? (
        <>
          <label className="block space-y-1 text-sm">
            <span>What belongs here?</span>
            <textarea
              value={value.qualificationInstructions}
              onChange={(e) => {
                onChange({ ...value, qualificationInstructions: e.target.value });
              }}
              maxLength={2000}
              rows={4}
              placeholder="Describe who or what belongs, what to exclude, and when an item should leave."
              className="w-full rounded-sm border border-border bg-bg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span>Try an example:</span>
            {EXAMPLES.map((example) => (
              <button
                key={example.label}
                type="button"
                className="rounded-sm border border-border px-2 py-1 hover:bg-surface"
                onClick={() => {
                  onChange({ ...value, qualificationInstructions: example.text });
                }}
              >
                {example.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-fg-muted">
            Stages describe progress after an item joins. These criteria decide whether it belongs
            at all. Turning suggestions off keeps existing items.
          </p>
        </>
      ) : null}
    </fieldset>
  );
}
