'use client';

import { objectSupportsIdentityFacets } from '@timeline/shared/objects/identity-facets';
import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import type * as objects from '@timeline/shared/objects/types';

import { archiveIdentityFacetAction, createIdentityFacetAction } from '@/app/actions/objects';
import {
  ObjectRailRow,
  ObjectRailSection,
  RAIL_GHOST_ICON_BUTTON,
  RAIL_QUIET_ACTION,
  RAIL_UNDERLINE_CONTROL,
} from '@/components/objects/object-rail-chrome';
import { notifyAction } from '@/lib/notify';
import { statusLabel } from '@/lib/status-labels';
import { cn } from '@/lib/utils';

const FACET_KINDS = [
  'email',
  'phone',
  'telegram',
  'slack',
  'github',
  'timeline_user',
  'other',
] as const;

export function ObjectContactFields({
  detail,
  disabled = false,
}: {
  detail: objects.ObjectDetail;
  disabled?: boolean;
}) {
  const router = useRouter();
  const formId = useId();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<(typeof FACET_KINDS)[number]>('email');
  const [value, setValue] = useState('');

  if (!objectSupportsIdentityFacets(detail.type)) return null;

  const contacts = detail.identityFacets;
  const busy = disabled || pending;

  function addContact(): void {
    const trimmed = value.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await notifyAction({
        id: `object:${detail.id}:contact:add`,
        loading: 'Adding contact…',
        success: 'Contact added',
        error: 'Couldn’t add contact',
        run: () =>
          createIdentityFacetAction({
            entityId: detail.id,
            kind,
            value: trimmed,
          }),
      });
      if (!result.error) {
        setAdding(false);
        setValue('');
        router.refresh();
      }
    });
  }

  function removeContact(facetId: string): void {
    startTransition(async () => {
      const result = await notifyAction({
        id: `object:${detail.id}:contact:${facetId}`,
        loading: 'Removing contact…',
        success: 'Contact removed',
        error: 'Couldn’t remove contact',
        run: () => archiveIdentityFacetAction({ facetId, entityId: detail.id }),
      });
      if (!result.error) router.refresh();
    });
  }

  return (
    <ObjectRailSection label="Contact" aria-label="Contact">
      {contacts.map((facet) => {
        const href =
          facet.kind === 'email'
            ? `mailto:${facet.normalizedValue}`
            : facet.kind === 'phone'
              ? `tel:${facet.normalizedValue}`
              : null;
        return (
          <ObjectRailRow
            key={facet.id}
            label={statusLabel(facet.kind)}
            action={
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  removeContact(facet.id);
                }}
                aria-label={`Remove ${facet.value}`}
                className={RAIL_GHOST_ICON_BUTTON}
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            }
          >
            {href ? (
              <a
                href={href}
                title={facet.value}
                className="min-w-0 flex-1 truncate text-sm font-normal leading-5 text-fg hover:underline"
              >
                {facet.value}
              </a>
            ) : (
              <span
                title={facet.value}
                className="min-w-0 flex-1 truncate text-sm font-normal leading-5 text-fg"
              >
                {facet.value}
              </span>
            )}
          </ObjectRailRow>
        );
      })}
      {adding ? (
        <div className="grid gap-2 px-2 py-1">
          <select
            id={`${formId}-kind`}
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as (typeof FACET_KINDS)[number]);
            }}
            className={RAIL_UNDERLINE_CONTROL}
            aria-label="Contact kind"
          >
            {FACET_KINDS.map((option) => (
              <option key={option} value={option}>
                {statusLabel(option)}
              </option>
            ))}
          </select>
          <input
            id={`${formId}-value`}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addContact();
              }
              if (event.key === 'Escape') {
                setAdding(false);
                setValue('');
              }
            }}
            placeholder="name@company.com"
            className={RAIL_UNDERLINE_CONTROL}
            aria-label="Contact value"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy || !value.trim()}
              onClick={addContact}
              className="text-xs font-normal text-fg-muted hover:text-fg disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setValue('');
              }}
              className="text-xs font-normal text-fg-muted hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setAdding(true);
          }}
          className={cn(RAIL_QUIET_ACTION, contacts.length === 0 && 'text-fg-dim')}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          Add contact
        </button>
      )}
    </ObjectRailSection>
  );
}
