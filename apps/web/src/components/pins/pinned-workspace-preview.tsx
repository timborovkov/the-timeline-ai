'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { PinnedItem } from '@timeline/shared/pins';

import { PinnedItemRow } from '@/components/pins/pinned-item-row';
import { SectionHeading } from '@/components/section-heading';

export function PinnedWorkspacePreview({ initialItems }: { initialItems: PinnedItem[] }) {
  const [items, setItems] = useState(initialItems);
  if (items.length === 0) return null;
  return (
    <section className="space-y-3" aria-label="Pinned work">
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
        Pinned work
      </SectionHeading>
      <div className="border-y border-border">
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
