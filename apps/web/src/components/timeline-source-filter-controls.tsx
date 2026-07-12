'use client';

import { useState } from 'react';

import { FilterMultiSelect } from '@/components/filter-multi-select';
import {
  TIMELINE_SOURCES,
  type TimelineOriginOption,
  updateTimelineSourceSelection,
} from '@/lib/timeline-controls';

interface Props {
  source: string;
  origin: string;
  originOptions: readonly TimelineOriginOption[];
}

export function TimelineSourceFilterControls({ source, origin, originOptions }: Props) {
  const [selection, setSelection] = useState({ source, origin });

  function update(update: Partial<typeof selection>): void {
    setSelection((current) => updateTimelineSourceSelection(current, update));
  }

  return (
    <>
      <FilterMultiSelect
        name="source"
        label="Source"
        value={selection.source}
        onValueChange={(value) => {
          update({ source: value });
        }}
        placeholder="All sources"
        options={TIMELINE_SOURCES.map(([value, label]) => ({ value, label }))}
      />
      {originOptions.length > 0 ? (
        <FilterMultiSelect
          name="origin"
          label="Specific source"
          value={selection.origin}
          onValueChange={(value) => {
            update({ origin: value });
          }}
          placeholder="Any integration or channel"
          options={originOptions}
          className="min-w-56"
          triggerClassName="max-w-72"
        />
      ) : null}
    </>
  );
}
