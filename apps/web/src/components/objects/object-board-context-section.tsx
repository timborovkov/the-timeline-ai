'use client';

import { objectSupportsIdentityFacets } from '@timeline/shared/objects/identity-facets';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import type * as boards from '@timeline/shared/boards';
import type * as objects from '@timeline/shared/objects/types';

import { structureContactFromBoardNotesAction } from '@/app/actions/objects';
import { DueDateDisplay } from '@/components/due-date-display';
import {
  ObjectRailSection,
  RAIL_QUIET_ACTION,
} from '@/components/objects/object-rail-chrome';
import { displayText } from '@/lib/display-dates';
import { notifyAction } from '@/lib/notify';

const EMPTY_MEMBERS: { id: string; label: string }[] = [];

function textHasContacts(text: string | null | undefined): boolean {
  if (!text) return false;
  return (
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text) || /\d{3}[-.]\d{3}[-.]\d{4}/.test(text)
  );
}

export function ObjectBoardContextSection({
  rows,
  entityId,
  objectType,
  members = EMPTY_MEMBERS,
  disabled = false,
}: {
  rows: boards.ObjectBoardContextRow[];
  entityId: string;
  objectType: objects.ObjectType;
  members?: { id: string; label: string }[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (rows.length === 0) return null;
  const canStructureContacts = objectSupportsIdentityFacets(objectType);

  return (
    <ObjectRailSection label="Board context" aria-label="Board context">
      <ul className="flex flex-col gap-2 px-2">
        {rows.map((row) => {
          const responsible = members.find((member) => member.id === row.responsibleUserId)?.label;
          const canStructure =
            canStructureContacts && row.notes ? textHasContacts(row.notes) : false;
          const meta = [
            row.laneName ? displayText(row.laneName) : null,
            responsible ? displayText(responsible) : null,
          ].filter(Boolean);
          return (
            <li key={row.itemId} className="grid gap-0.5">
              <Link
                href={`/app/boards/${row.boardId}?item=${row.itemId}`}
                className="truncate text-sm font-normal leading-5 text-fg hover:underline"
              >
                {displayText(row.boardName)}
              </Link>
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs font-normal leading-4 text-fg-dim">
                {meta.map((part, index) => (
                  <span key={`${row.itemId}-meta-${index}`} className="truncate">
                    {index > 0 ? <span aria-hidden="true">· </span> : null}
                    {part}
                  </span>
                ))}
                <DueDateDisplay value={row.dueAt} variant="compact" />
              </div>
              {row.nextStep ? (
                <p className="truncate text-xs font-normal leading-4 text-fg-muted" title={row.nextStep}>
                  {displayText(row.nextStep)}
                </p>
              ) : null}
              {row.notes ? (
                <p className="truncate text-xs font-normal leading-4 text-fg-dim" title={row.notes}>
                  {displayText(row.notes)}
                </p>
              ) : null}
              {canStructure ? (
                <button
                  type="button"
                  disabled={disabled || pending}
                  onClick={() => {
                    startTransition(async () => {
                      const result = await notifyAction({
                        id: `object:${entityId}:structure-contact`,
                        loading: 'Structuring contact info…',
                        success: 'Contact info structured',
                        error: 'Couldn’t structure contact info',
                        run: () =>
                          structureContactFromBoardNotesAction({
                            entityId,
                            notes: row.notes ?? '',
                          }),
                      });
                      if (!result.error) router.refresh();
                    });
                  }}
                  className={`${RAIL_QUIET_ACTION} px-0`}
                >
                  Structure contact info
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </ObjectRailSection>
  );
}
