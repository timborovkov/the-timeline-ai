'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { PinnedItem } from '@timeline/shared/pins';

import { PinnedItemRow } from '@/components/pins/pinned-item-row';
import { SectionHeading } from '@/components/section-heading';

export function PinnedWorkspacePreview({
  initialItems,
  heading = 'Pinned work',
  showEmpty = false,
}: {
  initialItems: PinnedItem[];
  heading?: string;
  showEmpty?: boolean;
}) {
  return (
    <PinnedWorkspacePreviewList
      key={initialItems.map((item) => item.pinId).join('|') || 'empty'}
      initialItems={initialItems}
      heading={heading}
      showEmpty={showEmpty}
    />
  );
}

// react-doctor-disable-next-line react-doctor/no-multi-comp -- keyed inner list remounts when the server pin set changes
function PinnedWorkspacePreviewList({
  initialItems,
  heading,
  showEmpty,
}: {
  initialItems: PinnedItem[];
  heading: string;
  showEmpty: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  if (items.length === 0 && !showEmpty) return null;
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
      {items.length === 0 ? (
        <p className="text-sm leading-6 text-fg-muted">
          Pin an object, document, or meeting from its menu to keep it here.
        </p>
      ) : null}
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
