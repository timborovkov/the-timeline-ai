'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import type { ReactNode } from 'react';

interface BulkRead {
  token: number;
  snapshot: object | null;
}

interface InboxReadState {
  bulkPending: boolean;
  isRead(id: string, initiallyRead: boolean): boolean;
  beginRead(id: string): boolean;
  finishRead(id: string, succeeded: boolean): void;
  beginBulkRead(): number;
  finishBulkRead(token: number, succeeded: boolean): void;
}

const InboxReadContext = createContext<InboxReadState | null>(null);

export function InboxReadProvider({
  children,
  snapshot = null,
}: {
  children: ReactNode;
  snapshot?: object | null;
}) {
  const [individualReads, setIndividualReads] = useState<ReadonlySet<string>>(() => new Set());
  const [bulk, setBulk] = useState<BulkRead | null>(null);
  const [committedSnapshot, setCommittedSnapshot] = useState<object | null | undefined>(undefined);
  const individualRequests = useRef(new Set<string>());
  const bulkRequest = useRef<BulkRead | null>(null);
  const generation = useRef(0);

  const beginRead = useCallback((id: string) => {
    if (individualRequests.current.has(id)) return false;
    individualRequests.current.add(id);
    setIndividualReads((previous) => new Set(previous).add(id));
    return true;
  }, []);

  const finishRead = useCallback((id: string, succeeded: boolean) => {
    if (succeeded) return;
    individualRequests.current.delete(id);
    setIndividualReads((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  }, []);

  const beginBulkRead = useCallback(() => {
    const next = { token: ++generation.current, snapshot };
    bulkRequest.current = next;
    setBulk(next);
    return next.token;
  }, [snapshot]);

  const finishBulkRead = useCallback((token: number, succeeded: boolean) => {
    const request = bulkRequest.current;
    if (request?.token !== token) return;
    if (succeeded) setCommittedSnapshot(request.snapshot);
    bulkRequest.current = null;
    setBulk(null);
  }, []);

  const value = useMemo<InboxReadState>(
    () => ({
      bulkPending: bulk !== null,
      isRead(id, initiallyRead) {
        return (
          initiallyRead ||
          individualReads.has(id) ||
          bulk?.snapshot === snapshot ||
          committedSnapshot === snapshot
        );
      },
      beginRead,
      finishRead,
      beginBulkRead,
      finishBulkRead,
    }),
    [
      bulk,
      committedSnapshot,
      snapshot,
      individualReads,
      beginRead,
      finishRead,
      beginBulkRead,
      finishBulkRead,
    ],
  );

  return <InboxReadContext value={value}>{children}</InboxReadContext>;
}

export function useInboxReadState(): InboxReadState {
  const value = useContext(InboxReadContext);
  if (!value) throw new Error('Inbox controls require an InboxReadProvider');
  return value;
}
