'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type * as objects from '@timeline/shared/objects/types';

import { archiveIdentityFacetAction, createIdentityFacetAction } from '@/app/actions/objects';
import { notifyAction } from '@/lib/notify';
import { statusLabel } from '@/lib/status-labels';

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

  if (detail.type !== 'person') return null;

  const contacts = detail.identityFacets;

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
    <section>
      <h2 className="text-xs font-normal text-fg-dim">Contact</h2>
      <div className="mt-1 space-y-1">
        {contacts.length === 0 && !adding ? (
          <p className="text-xs text-fg-muted">No contact info yet.</p>
        ) : null}
        {contacts.map((facet) => {
          const href =
            facet.kind === 'email'
              ? `mailto:${facet.normalizedValue}`
              : facet.kind === 'phone'
                ? `tel:${facet.normalizedValue}`
                : null;
          return (
            <div
              key={facet.id}
              className="flex min-w-0 items-center justify-between gap-2 text-sm text-fg"
            >
              {href ? (
                <a href={href} className="min-w-0 truncate hover:underline">
                  {facet.value}
                </a>
              ) : (
                <span className="min-w-0 truncate">{facet.value}</span>
              )}
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-fg-dim">{statusLabel(facet.kind)}</span>
                <button
                  type="button"
                  disabled={disabled || pending}
                  onClick={() => {
                    removeContact(facet.id);
                  }}
                  className="text-xs text-fg-muted hover:text-fg hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
        {adding ? (
          <div className="grid gap-1.5 pt-1">
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as (typeof FACET_KINDS)[number]);
              }}
              className="h-8 rounded-sm border border-border bg-bg px-2 text-xs"
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
              className="h-8 rounded-sm border border-border bg-bg px-2 text-xs"
              aria-label="Contact value"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={disabled || pending}
                onClick={addContact}
                className="text-xs text-fg-muted hover:text-fg hover:underline disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setValue('');
                }}
                className="text-xs text-fg-muted hover:text-fg hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled || pending}
            onClick={() => {
              setAdding(true);
            }}
            className="text-xs text-fg-muted hover:text-fg hover:underline disabled:opacity-50"
          >
            Add contact
          </button>
        )}
      </div>
    </section>
  );
}
