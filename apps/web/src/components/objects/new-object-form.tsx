'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { createObjectAction } from '@/app/actions/objects';
import { OBJECT_TYPES as TYPES } from '@/lib/object-types';

export function NewObjectForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<(typeof TYPES)[number]>('task');
  const [name, setName] = useState('');
  const [dueAt, setDueAt] = useState('');

  function submit(): void {
    if (!name.trim()) {
      setError('Name required');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createObjectAction({
        type,
        canonicalName: name.trim(),
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
      });
      if ('error' in result && result.error) {
        setError(result.error);
        return;
      }
      if ('id' in result && result.id) router.push(`/app/objects/${result.id}`);
    });
  }

  return (
    <div className="max-w-xl space-y-5">
      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
          Type
        </span>
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value as (typeof TYPES)[number]);
          }}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
          Name
        </span>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="e.g. Acme deal, Q2 OKRs, post-mortem 2026-05-15"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
          Due (optional)
        </span>
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => {
            setDueAt(e.target.value);
          }}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
      </label>
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={pending || !name.trim()}
        className="rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create object'}
      </button>
    </div>
  );
}
