'use client';

import { objectSupportsIdentityFacets } from '@timeline/shared/objects/identity-facets';
import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type * as objects from '@timeline/shared/objects/types';

import { archiveIdentityFacetAction, createIdentityFacetAction } from '@/app/actions/objects';
import { notifyAction } from '@/lib/notify';
import { statusLabel } from '@/lib/status-labels';
import { cn } from '@/lib/utils';

const SECTION_LABEL = 'px-1.5 text-xs font-normal text-fg-dim';
const FIELD_LABEL = 'w-24 shrink-0 truncate text-xs font-normal text-fg-dim';
const FIELD_VALUE = 'min-w-0 flex-1 truncate text-sm font-normal leading-5 text-fg';
const QUIET_ACTION =
  'inline-flex min-h-8 items-center gap-1.5 px-1.5 text-xs font-normal text-fg-muted transition-colors hover:text-fg disabled:opacity-50';

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
    <section aria-label="Contact" className="flex flex-col">
      <h2 className={SECTION_LABEL}>Contact</h2>
      <div className="mt-0.5 flex flex-col">
        {contacts.length === 0 && !adding ? (
          <p className="px-1.5 py-1 text-sm font-normal leading-5 text-fg-dim">
            No contact info yet.
          </p>
        ) : null}
        {contacts.map((facet) => {
          const href =
            facet.kind === 'email'
              ? `mailto:${facet.normalizedValue}`
              : facet.kind === 'phone'
                ? `tel:${facet.normalizedValue}`
                : null;
          return (
            <div key={facet.id} className="group flex min-h-8 items-center gap-2 px-1.5">
              <span className={FIELD_LABEL}>{statusLabel(facet.kind)}</span>
              {href ? (
                <a href={href} className={cn(FIELD_VALUE, 'hover:underline')}>
                  {facet.value}
                </a>
              ) : (
                <span className={FIELD_VALUE}>{facet.value}</span>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  removeContact(facet.id);
                }}
                aria-label={`Remove ${facet.value}`}
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-sm text-fg-muted transition-colors',
                  'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100',
                  'hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/50 disabled:opacity-50',
                )}
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </div>
          );
        })}
        {adding ? (
          <div className="grid gap-1.5 px-1.5 py-1.5">
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as (typeof FACET_KINDS)[number]);
              }}
              className="h-8 rounded-sm border border-border bg-bg px-2 text-sm"
              aria-label="Contact kind"
            >
              {FACET_KINDS.map((option) => (
                <option key={option} value={option}>
                  {statusLabel(option)}
                </option>
              ))}
            </select>
            <input
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
              }}
              placeholder="Contact value"
              className="h-8 rounded-sm border border-border bg-bg px-2 text-sm"
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
            className={QUIET_ACTION}
          >
            <Plus aria-hidden="true" className="size-3.5" />
            Add contact
          </button>
        )}
      </div>
    </section>
  );
}
