'use client';

import Link from 'next/link';

import type * as objects from '@timeline/shared/objects/types';

import { displayText } from '@/lib/display-dates';
import { objectDetailHref } from '@/lib/object-links';
import { relationshipDisplayLabel } from '@/lib/relationship-display-label';
import { statusLabel } from '@/lib/status-labels';

export function ObjectCompactRelationships({
  entityId,
  sourceType,
  relationships,
}: {
  entityId: string;
  sourceType: objects.ObjectType;
  relationships: objects.ObjectDetail['relationships'];
}) {
  return (
    <section className="px-3 py-1.5">
      <h3 className="text-xs font-normal text-fg-dim">Related</h3>
      {relationships.length === 0 ? (
        <p className="mt-1 text-xs text-fg-muted">
          No explicit links yet.{' '}
          <Link href={objectDetailHref(entityId)} className="hover:text-fg hover:underline">
            Open object
          </Link>{' '}
          to link people or companies.
        </p>
      ) : (
        <ul className="mt-1 space-y-1">
          {relationships.map((relationship) => (
            <li key={relationship.id} className="grid gap-0.5">
              <Link
                href={objectDetailHref(relationship.otherId)}
                className="text-sm text-fg hover:underline"
              >
                {displayText(relationship.otherName)}
              </Link>
              <span className="text-xs text-fg-dim">
                {relationshipDisplayLabel({
                  kind: relationship.kind,
                  sourceType,
                  otherType: relationship.otherType,
                  direction: relationship.direction,
                })}{' '}
                · {statusLabel(relationship.otherType)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
