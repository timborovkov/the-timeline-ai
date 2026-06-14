'use client';

import { GitMerge, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import type * as objects from '@timeline/shared/objects';

import { mergeObjectsAction } from '@/app/actions/objects';
import { Button } from '@/components/ui/button';

interface Props {
  objects: objects.ObjectRow[];
  initialSurvivorId: string;
  countsBySurvivorId: Record<
    string,
    {
      facts: number;
      notes: number;
      relationships: number;
      openTasks: number;
    }
  >;
  factSamplesByObjectId?: objects.ObjectMergePreview['factSamplesByObjectId'];
  suggestionItemId?: string;
  onCancel?: () => void;
  onReject?: () => void;
  onMerged?: (survivorId: string) => void;
}

const emptyCounts = {
  facts: 0,
  notes: 0,
  relationships: 0,
  openTasks: 0,
};
const emptyFactSamplesByObjectId: NonNullable<Props['factSamplesByObjectId']> = {};

function aliasAdditions(rows: objects.ObjectRow[], survivorId: string): string[] {
  const survivor = rows.find((row) => row.id === survivorId);
  if (!survivor) return [];
  const seen = new Set<string>();
  const aliases: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (key === survivor.canonicalName.toLowerCase() || seen.has(key)) return;
    seen.add(key);
    aliases.push(trimmed);
  };
  for (const alias of survivor.aliases) push(alias);
  for (const row of rows) {
    if (row.id === survivorId) continue;
    push(row.canonicalName);
    for (const alias of row.aliases) push(alias);
  }
  return aliases.filter(
    (alias) => !survivor.aliases.some((existing) => existing.toLowerCase() === alias.toLowerCase()),
  );
}

export function ObjectMergeForm({
  objects,
  initialSurvivorId,
  countsBySurvivorId,
  factSamplesByObjectId = emptyFactSamplesByObjectId,
  suggestionItemId,
  onCancel,
  onReject,
  onMerged,
}: Props) {
  const router = useRouter();
  const [survivorId, setSurvivorId] = useState(initialSurvivorId);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const aliases = useMemo(() => aliasAdditions(objects, survivorId), [objects, survivorId]);
  const survivor = objects.find((row) => row.id === survivorId);
  const counts = countsBySurvivorId[survivorId] ?? emptyCounts;

  function confirmMerge() {
    if (!survivor || isPending) return;
    setError(null);
    startTransition(async () => {
      const mergedIds: string[] = [];
      for (const row of objects) {
        if (row.id !== survivorId) mergedIds.push(row.id);
      }
      const result = await mergeObjectsAction({
        survivorId,
        mergedIds,
        suggestionItemId,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (onMerged) {
        onMerged(result.id ?? survivorId);
        return;
      }
      router.push('/app/objects');
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-px overflow-hidden border border-border">
        {objects.map((object) => {
          const factSamples = factSamplesByObjectId[object.id] ?? [];
          return (
            <div key={object.id} className={survivorId === object.id ? 'bg-signal-soft' : 'bg-bg'}>
              <label
                className={`flex min-h-12 items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
                  survivorId === object.id ? '' : 'hover:bg-surface'
                }`}
              >
                <input
                  type="radio"
                  name="survivor"
                  checked={survivorId === object.id}
                  onChange={() => {
                    setSurvivorId(object.id);
                  }}
                  className="size-4 accent-[var(--signal)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-fg">{object.canonicalName}</span>
                  <span className="block font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                    {object.type} · {object.status}
                  </span>
                </span>
                {survivorId === object.id ? (
                  <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-signal">
                    Keep
                  </span>
                ) : null}
              </label>
              <details className="border-t border-border/70 px-3 py-2 text-sm">
                <summary className="cursor-pointer select-none font-mono text-[11px] uppercase tracking-[0.1em] text-fg-muted hover:text-fg">
                  Related facts ({factSamples.length})
                </summary>
                {factSamples.length > 0 ? (
                  <ul className="mt-2 space-y-2 text-fg-muted">
                    {factSamples.map((fact) => (
                      <li key={fact.id} className="border-l border-border pl-3">
                        <p>{fact.statement}</p>
                        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-fg-dim">
                          Confidence {Math.round(fact.confidence * 100)}%
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-fg-dim">
                    No visible facts are linked to this object yet.
                  </p>
                )}
              </details>
            </div>
          );
        })}
      </div>

      <section className="space-y-3 border-y border-border py-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg">Merge Preview</h2>
        <div className="grid gap-px overflow-hidden border border-border sm:grid-cols-4">
          {[
            ['Facts', counts.facts],
            ['Notes', counts.notes],
            ['Links', counts.relationships],
            ['Open tasks', counts.openTasks],
          ].map(([label, value]) => (
            <div key={label} className="bg-bg px-3 py-2">
              <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-fg-dim">
                {label}
              </div>
              <div className="text-lg font-semibold text-fg">{value}</div>
            </div>
          ))}
        </div>
        <div className="text-sm text-fg-muted">
          {aliases.length > 0 ? (
            <>
              <span className="text-fg">Aliases added:</span> {aliases.join(', ')}
            </>
          ) : (
            'No new aliases will be added.'
          )}
        </div>
        <p className="text-sm text-fg-muted">
          Merged objects leave active lists. Old object links redirect to the kept object.
        </p>
      </section>

      {error ? (
        <p className="border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        {onReject ? (
          <Button type="button" size="sm" variant="outline" onClick={onReject} disabled={isPending}>
            <X className="size-4" />
            Reject
          </Button>
        ) : null}
        {onCancel ? (
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            <X className="size-4" />
            Close
          </Button>
        ) : (
          <Link
            href="/app/objects"
            className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-border px-3 font-mono text-[11px] uppercase tracking-[0.1em] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-3.5" aria-hidden />
            Cancel
          </Link>
        )}
        <Button
          type="button"
          size="sm"
          onClick={confirmMerge}
          disabled={isPending}
          className="border border-signal/40 bg-signal-soft font-mono text-[11px] uppercase tracking-[0.1em] text-signal hover:bg-signal-soft/80"
        >
          <GitMerge className="size-4" />
          {isPending ? 'Merging' : 'Merge'}
        </Button>
      </div>
    </div>
  );
}
