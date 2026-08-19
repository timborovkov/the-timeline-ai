'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { PinnedItem } from '@timeline/shared/pins';

import { PinnedItemRow } from '@/components/pins/pinned-item-row';
import { SectionHeading } from '@/components/section-heading';

export function PinnedWorkspacePreview({
  initialItems,
  heading = 'Pinned work',
}: {
  initialItems: PinnedItem[];
  heading?: string;
}) {
  return (
    <PinnedWorkspacePreviewList
      key={initialItems.map((item) => item.pinId).join('|') || 'empty'}
      initialItems={initialItems}
      heading={heading}
    />
  );
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- keyed inner list remounts when the server pin set changes
function PinnedWorkspacePreviewList({
  initialItems,
  heading,
}: {
  initialItems: PinnedItem[];
  heading: string;
}) {
  const [items, setItems] = useState(initialItems);
  if (items.length === 0) return null;
  return (
    <section className="space-y-3" aria-label={heading}>
      <SectionHeading
        actions={
          <Link
            href="/app/work?view=pinned"
            className="text-sm text-fg-muted transition-colors hover:text-fg"
          >
            Manage
          </Link>
        }
      >
        {heading}
      </SectionHeading>
      <div>
        {items.map((item) => (
          <PinnedItemRow
            key={item.pinId}
            item={item}
            onRemoved={() => {
              setItems((current) => current.filter((candidate) => candidate.pinId !== item.pinId));
            }}
          />
        ))}
      </div>
    </section>
  );
}
