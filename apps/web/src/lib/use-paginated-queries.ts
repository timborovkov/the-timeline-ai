'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { readJson } from '@/lib/paginated-api';
import { queryKeys } from '@/lib/query-keys';

export function useTimelineInfiniteQuery(
  filters: {
    author?: string | null;
    from?: string | null;
    to?: string | null;
  },
  initialPage?: {
    items: TimelineEvent[];
    nextCursor: string | null;
    authors: Record<string, { id: string; name: string | null; email: string }>;
    audioUrls: Record<string, string>;
  },
) {
  return useInfiniteQuery({
    queryKey: queryKeys.timeline(filters),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filters.author) params.set('author', filters.author);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      if (pageParam) params.set('cursor', pageParam);
      return readJson<{
        items: TimelineEvent[];
        nextCursor: string | null;
        authors: Record<string, { id: string; name: string | null; email: string }>;
        audioUrls: Record<string, string>;
      }>(await fetch(`/api/timeline?${params.toString()}`));
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    ...(initialPage
      ? { initialData: { pages: [initialPage], pageParams: [null] as (string | null)[] } }
      : {}),
  });
}

export function useObjectSectionQuery(objectId: string, section: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.objectSection(objectId, section),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ section });
      if (pageParam) params.set('cursor', pageParam);
      return readJson<{ items: unknown[]; nextCursor: string | null }>(
        await fetch(`/api/objects/${objectId}/sections?${params.toString()}`),
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

export function useDocumentSearchQuery(query: string, filters: Record<string, string | null> = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.documentSearch(query, filters),
    enabled: query.trim().length > 0,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      readJson<{ items: DocumentSearchHit[]; nextOffset: number | null }>(
        await fetch('/api/documents/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query, offset: pageParam, ...filters }),
        }),
      ),
    getNextPageParam: (lastPage) => lastPage.nextOffset,
  });
}

export function useDocumentListQuery(
  folderId: string | null,
  initialPage?: {
    items: {
      id: string;
      name: string;
      visibility: string;
      updatedAt: string;
      ownerUserId: string | null;
    }[];
    nextCursor: string | null;
  },
) {
  return useInfiniteQuery({
    queryKey: queryKeys.documentList(folderId),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (folderId) params.set('folder', folderId);
      if (pageParam) params.set('cursor', pageParam);
      return readJson<{
        items: {
          id: string;
          name: string;
          visibility: string;
          updatedAt: string;
          ownerUserId: string | null;
        }[];
        nextCursor: string | null;
      }>(await fetch(`/api/documents/list?${params.toString()}`));
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    ...(initialPage
      ? { initialData: { pages: [initialPage], pageParams: [null] as (string | null)[] } }
      : {}),
  });
}

export function useJobDashboardQuery() {
  return useQuery({
    queryKey: queryKeys.jobDashboard(),
    queryFn: async () =>
      readJson<{
        updatedAt: string;
        summaries: { kind: string; label: string; needsAttention: number }[];
      }>(await fetch('/api/jobs/dashboard')),
    refetchInterval: 30_000,
  });
}

export function useOnboardingChecklistQuery() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.onboarding(),
    queryFn: async () =>
      readJson<{
        dismissed: boolean;
        items: { key: string; label: string; completed: boolean }[];
      }>(await fetch('/api/onboarding/checklist')),
  });
  const mutation = useMutation({
    mutationFn: async (input: { action: 'dismiss' | 'reopen' | 'complete'; key?: string }) =>
      readJson(
        await fetch('/api/onboarding/checklist', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.onboarding() });
    },
  });
  return { ...query, mutateChecklist: mutation.mutate, checklistPending: mutation.isPending };
}

export interface TimelineEvent {
  id: string;
  teamId: string;
  authorUserId: string | null;
  source:
    | 'web'
    | 'telegram'
    | 'email'
    | 'system'
    | 'document'
    | 'meeting'
    | 'integration'
    | 'calendar';
  contentText: string | null;
  contentAudioUrl: string | null;
  occurredAt: string;
  createdAt: string;
  visibility: 'private' | 'team' | 'specific_users';
  visibilityUserIds: string[] | null;
  sourceMetadata: unknown;
}

interface DocumentSearchHit {
  documentId: string;
  documentVersionId: string;
  documentChunkId: string;
  version: number;
  chunkIndex: number;
  pageNumber: number | null;
  text: string;
  summary: string | null;
  documentName: string;
  folderId: string | null;
  score: number;
}
