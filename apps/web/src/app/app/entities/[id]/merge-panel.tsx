'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { mergeEntityAction, searchEntitiesAction } from '@/app/actions/entities';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Props {
  entityId: string;
  entityName: string;
}

interface Candidate {
  id: string;
  canonicalName: string;
  type: string;
}

export function MergeEntityPanel({ entityId, entityName }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [target, setTarget] = useState<Candidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (target) return; // a target is picked; stop searching
    if (query.trim().length === 0) {
      setCandidates([]);
      return;
    }
    const state = { cancelled: false };
    void (async () => {
      try {
        const rows = await searchEntitiesAction({ query, excludeId: entityId, limit: 8 });
        if (!state.cancelled) setCandidates(rows);
      } catch (err) {
        if (!state.cancelled) {
          console.error('[merge-panel] search failed', err);
          setCandidates([]);
        }
      }
    })();
    return () => {
      state.cancelled = true;
    };
  }, [query, entityId, target]);

  const performMerge = (): void => {
    if (!target || pending) return;
    setError(null);
    setConfirmOpen(false);
    const formData = new FormData();
    formData.set('loserId', entityId);
    formData.set('winnerId', target.id);
    startTransition(async () => {
      const result = await mergeEntityAction({}, formData);
      if (result.error) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(`Merged "${entityName}" into "${target.canonicalName}"`);
      router.push(`/app/entities/${target.id}`);
    });
  };

  if (target) {
    return (
      <div className="space-y-3">
        <p className="text-sm">
          Merge into <strong>{target.canonicalName}</strong>{' '}
          <span className="text-xs text-muted-foreground">({target.type})</span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setConfirmOpen(true);
            }}
            disabled={pending}
            className="h-9 rounded-md bg-foreground px-3 text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? 'Merging…' : 'Confirm merge'}
          </button>
          <button
            type="button"
            onClick={() => {
              setTarget(null);
              setQuery('');
            }}
            disabled={pending}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm transition-colors hover:bg-accent"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Merge entities?</AlertDialogTitle>
              <AlertDialogDescription>
                Merge &ldquo;{entityName}&rdquo; into &ldquo;{target.canonicalName}&rdquo;. Facts
                and aliases move to the survivor. This cannot be automatically undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={pending}
                onClick={performMerge}
              >
                {pending ? 'Merging…' : 'Merge'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
        }}
        placeholder="Search entities…"
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
      />
      {candidates.length > 0 && (
        <ul className="space-y-1 rounded-md border">
          {candidates.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  setTarget(c);
                }}
                className="block w-full px-2 py-1 text-left text-sm transition-colors hover:bg-accent"
              >
                {c.canonicalName} <span className="text-xs text-muted-foreground">({c.type})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
