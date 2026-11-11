'use client';

import { X } from 'lucide-react';
import { useId, useState } from 'react';

import { CollectionRow } from '@/components/collections/collection-row';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ItemActionGroup } from '@/components/ui/item-actions';
import { ItemIconButton } from '@/components/ui/item-icon-button';
import { Label } from '@/components/ui/label';
import { normalizeAllowedSender, parseAllowedSender } from '@/lib/allowed-senders';

export function AllowedSendersEditor({ senders }: { senders: string[] }) {
  const inputId = useId();
  const errorId = useId();
  const [items, setItems] = useState(() => senders.map(normalizeAllowedSender));
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  function addDraft() {
    const parsed = parseAllowedSender(draft);
    if (!parsed.ok) {
      setError(draft.trim() ? 'Enter a valid email address' : null);
      return;
    }
    if (items.includes(parsed.value)) {
      setError('That address is already on the list');
      return;
    }
    setItems((current) => [...current, parsed.value]);
    setDraft('');
    setError(null);
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId} size="sm">
        Additional senders
      </Label>
      <input type="hidden" name="senders" value={items.join('\n')} />
      {items.length > 0 ? (
        <ul>
          {items.map((sender) => (
            <li key={sender}>
              <CollectionRow>
                <CollectionRow.Title>
                  <span className="font-mono text-sm">{sender}</span>
                </CollectionRow.Title>
                <CollectionRow.Actions>
                  <ItemActionGroup label={`Actions for ${sender}`}>
                    <ItemIconButton
                      label={`Remove ${sender}`}
                      onClick={() => {
                        setItems((current) => current.filter((item) => item !== sender));
                        setError(null);
                      }}
                    >
                      <X aria-hidden="true" />
                    </ItemIconButton>
                  </ItemActionGroup>
                </CollectionRow.Actions>
              </CollectionRow>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Input
          id={inputId}
          type="email"
          autoComplete="off"
          placeholder="name@example.com"
          value={draft}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1"
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addDraft();
            }
          }}
        />
        <Button type="button" size="sm" variant="outline" onClick={addDraft}>
          Add
        </Button>
      </div>
      <p
        id={errorId}
        aria-atomic="true"
        aria-live="assertive"
        className="text-sm text-destructive"
        role={error ? 'alert' : undefined}
      >
        {error ?? ''}
      </p>
    </div>
  );
}
