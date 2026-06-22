'use client';

import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import type { TimelineCapturedFile } from '@/lib/timeline-captured-files';
import type { ImpactItem } from '@/lib/timeline-moments';

import { readJson } from '@/lib/paginated-api';
import { queryKeys } from '@/lib/query-keys';

export interface TimelinePage {
  items: TimelineEvent[];
  nextCursor: string | null;
  authors: Record<string, { id: string; name: string | null; email: string }>;
  audioUrls: Record<string, string>;
  impactItems: Record<string, ImpactItem[]>;
  capturedFiles: Record<string, TimelineCapturedFile[]>;
}

export interface DocumentListPage {
  items: {
    id: string;
    fileKind: 'captured' | 'document';
    name: string;
    metadata: Record<string, unknown>;
    visibility: string;
    updatedAt: string;
    ownerUserId: string | null;
    currentVersion: {
      id: string;
      version: number;
      byteSize: number | null;
      contentType: string | null;
      processingStatus: string;
      sourceEventId: string | null;
      createdAt: string;
    } | null;
    provenance: {
      source: string;
      sourceEventId: string | null;
      parentEventId: string | null;
      occurredAt: string | null;
      summary: string | null;
    };
    description: string | null;
    presentation: {
      displayTitle: string;
      storedName: string;
      suggestedTitle: string | null;
      isGeneratedName: boolean;
      fallbackTitle: string;
    };
    optimistic?: boolean;
  }[];
  nextCursor: string | null;
}

function replaceFirstPage<TPage>(
  previous: InfiniteData<TPage, string | number | null> | undefined,
  initialPage: TPage,
): InfiniteData<TPage, string | number | null> {
  return {
    pages: previous ? [initialPage, ...previous.pages.slice(1)] : [initialPage],
    pageParams: previous ? [null, ...previous.pageParams.slice(1)] : [null],
  };
}

function initialInfiniteData<TPage, TParam extends string | number | null>(
  initialPage: TPage,
  initialPageParam: TParam,
): InfiniteData<TPage, TParam> {
  return { pages: [initialPage], pageParams: [initialPageParam] };
}

export function useTimelineInfiniteQuery(
  filters: {
    author?: string | null;
    from?: string | null;
    to?: string | null;
    source?: string | null;
    impact?: string | null;
    event?: string | null;
  },
  initialPage: TimelinePage,
  options: { enabled?: boolean; timezone?: string } = {},
) {
  const queryClient = useQueryClient();
  const mounted = useRef(false);
  const stableFilters = useMemo(
    () => ({
      author: filters.author,
      from: filters.from,
      to: filters.to,
      source: filters.source,
      impact: filters.impact,
      event: filters.event,
    }),
    [filters.author, filters.from, filters.to, filters.source, filters.impact, filters.event],
  );
  const queryKey = useMemo(
    () => queryKeys.timeline(stableFilters, options.timezone),
    [options.timezone, stableFilters],
  );
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    queryClient.setQueryData<InfiniteData<TimelinePage, string | null> | undefined>(
      queryKey,
      (previous) =>
        replaceFirstPage(previous, initialPage) as InfiniteData<TimelinePage, string | null>,
    );
  }, [initialPage, queryClient, queryKey]);
  return useInfiniteQuery({
    queryKey,
    enabled: options.enabled ?? true,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (stableFilters.author) params.set('author', stableFilters.author);
      if (stableFilters.from) params.set('from', stableFilters.from);
      if (stableFilters.to) params.set('to', stableFilters.to);
      if (stableFilters.source) params.set('source', stableFilters.source);
      if (stableFilters.impact) params.set('impact', stableFilters.impact);
      if (stableFilters.event) params.set('event', stableFilters.event);
      if (pageParam) params.set('cursor', pageParam);
      return readJson<{
        items: TimelineEvent[];
        nextCursor: string | null;
        authors: Record<string, { id: string; name: string | null; email: string }>;
        audioUrls: Record<string, string>;
        impactItems: Record<string, ImpactItem[]>;
        capturedFiles: Record<string, TimelineCapturedFile[]>;
      }>(await fetch(`/api/timeline?${params.toString()}`));
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialData: initialInfiniteData(initialPage, null as string | null),
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

export function useDocumentListQuery(folderId: string | null, initialPage: DocumentListPage) {
  const queryClient = useQueryClient();
  const mounted = useRef(false);
  const queryKey = useMemo(() => queryKeys.documentList(folderId), [folderId]);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    queryClient.setQueryData<InfiniteData<DocumentListPage, string | null> | undefined>(
      queryKey,
      (previous) =>
        replaceFirstPage(previous, initialPage) as InfiniteData<DocumentListPage, string | null>,
    );
  }, [initialPage, queryClient, queryKey]);
  return useInfiniteQuery({
    queryKey,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (folderId) params.set('folder', folderId);
      if (pageParam) params.set('cursor', pageParam);
      return readJson<{
        items: {
          id: string;
          fileKind: 'captured' | 'document';
          name: string;
          metadata: Record<string, unknown>;
          visibility: string;
          updatedAt: string;
          ownerUserId: string | null;
          currentVersion: {
            id: string;
            version: number;
            byteSize: number | null;
            contentType: string | null;
            processingStatus: string;
            sourceEventId: string | null;
            createdAt: string;
          } | null;
          provenance: {
            source: string;
            sourceEventId: string | null;
            parentEventId: string | null;
            occurredAt: string | null;
            summary: string | null;
          };
          description: string | null;
          presentation: {
            displayTitle: string;
            storedName: string;
            suggestedTitle: string | null;
            isGeneratedName: boolean;
            fallbackTitle: string;
          };
          optimistic?: boolean;
        }[];
        nextCursor: string | null;
      }>(await fetch(`/api/documents/list?${params.toString()}`));
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialData: initialInfiniteData(initialPage, null as string | null),
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

export interface FinishedJobArchivePage {
  items: {
    id: string;
    queue: string;
    name: string;
    kind: string;
    artifactKind: string | null;
    artifactId: string | null;
    label: string;
    status: 'completed' | 'failed';
    attemptsMade: number;
    processedAt: string | null;
    finishedAt: string;
    error: string | null;
    syncKind?: 'backfill' | 'incremental';
  }[];
  nextOffset: number | null;
}

export function useFinishedJobsInfiniteQuery() {
  return useInfiniteQuery({
    queryKey: queryKeys.finishedJobs(),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ offset: String(pageParam), limit: '20' });
      return readJson<FinishedJobArchivePage>(
        await fetch(`/api/team/job-recovery/finished?${params.toString()}`),
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    refetchInterval: 5_000,
  });
}

export function useOnboardingChecklistQuery() {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
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
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.onboarding() });
      const previous = queryClient.getQueryData<{
        dismissed: boolean;
        items: { key: string; label: string; completed: boolean }[];
      }>(queryKeys.onboarding());
      if (previous) {
        queryClient.setQueryData<typeof previous>(queryKeys.onboarding(), {
          ...previous,
          dismissed:
            input.action === 'dismiss'
              ? true
              : input.action === 'reopen'
                ? false
                : previous.dismissed,
          items:
            input.action === 'complete' && input.key
              ? previous.items.map((item) =>
                  item.key === input.key ? { ...item, completed: true } : item,
                )
              : previous.items,
        });
      }
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.onboarding(), context.previous);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.onboarding() });
    },
  });
  return {
    data,
    isPending,
    mutateChecklist: mutation.mutate,
    checklistPending: mutation.isPending,
  };
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
    | 'calendar'
    | 'slack'
    | 'ingest_webhook';
  contentText: string | null;
  contentAudioUrl: string | null;
  occurredAt: string;
  createdAt: string;
  visibility: 'private' | 'team' | 'specific_users';
  visibilityUserIds: string[] | null;
  visibilityOwnerUserId: string | null;
  sourceMetadata: unknown;
}

interface DocumentSearchHit {
  documentId: string;
  documentVersionId: string;
  documentChunkId: string;
  fileKind: 'captured' | 'document';
  representationKind: 'source_text' | 'transcript' | 'visual_description' | 'metadata_preview';
  version: number;
  chunkIndex: number;
  pageNumber: number | null;
  text: string;
  summary: string | null;
  documentDisplayTitle: string;
  documentName: string;
  folderId: string | null;
  sourceRawEventId: string | null;
  score: number;
}
