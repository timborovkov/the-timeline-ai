'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import type * as boards from '@timeline/shared/boards';

import { structureContactFromBoardNotesAction } from '@/app/actions/objects';
import { DueDateDisplay } from '@/components/due-date-display';
import { displayText } from '@/lib/display-dates';
import { notifyAction } from '@/lib/notify';

const EMPTY_MEMBERS: { id: string; label: string }[] = [];

// Simple client-safe contact detection (email or phone patterns)
function textHasContacts(text: string | null | undefined): boolean {
  if (!text) return false;
  return (
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text) || /\d{3}[-.]\d{3}[-.]\d{4}/.test(text)
  );
}

export function ObjectBoardContextSection({
  rows,
  entityId,
  members = EMPTY_MEMBERS,
  disabled = false,
}: {
  rows: boards.ObjectBoardContextRow[];
  entityId: string;
  members?: { id: string; label: string }[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (rows.length === 0) return null;

  return (
    <section aria-label="Board context" className="flex flex-col">
      <h2 className="px-1.5 text-xs font-normal text-fg-dim">Board context</h2>
      <ul className="mt-0.5 space-y-2 px-1.5">
        {rows.map((row) => {
          const responsible = members.find((member) => member.id === row.responsibleUserId)?.label;
          const canStructure = row.notes ? textHasContacts(row.notes) : false;
          return (
            <li key={row.itemId} className="grid gap-0.5">
              <Link
                href={`/app/boards/${row.boardId}?item=${row.itemId}`}
                className="text-sm font-normal leading-5 text-fg hover:underline"
              >
                {displayText(row.boardName)}
              </Link>
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-normal text-fg-dim">
                {row.laneName ? <span>{displayText(row.laneName)}</span> : null}
                {responsible ? <span>· {displayText(responsible)}</span> : null}
                <DueDateDisplay value={row.dueAt} variant="compact" />
              </div>
              {row.nextStep ? (
                <p className="text-sm font-normal leading-5 text-fg-muted">
                  {displayText(row.nextStep)}
                </p>
              ) : null}
              {row.notes ? (
                <p className="text-sm font-normal leading-5 text-fg">{displayText(row.notes)}</p>
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
                  className="text-left text-xs font-normal text-fg-muted hover:text-fg hover:underline disabled:opacity-50"
                >
                  Structure contact info
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
