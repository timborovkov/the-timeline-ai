'use client';

import {
  artifactRefLabel,
  type ArtifactPreview,
  type ArtifactRef,
} from '@timeline/shared/citation';
import { useCallback, useMemo, useRef, useState } from 'react';

interface PreviewState {
  loading: boolean;
  error: string | null;
  preview: ArtifactPreview | null;
  cacheKey: string | null;
  fetched: boolean;
}

export function useArtifactPreview(
  refValue: ArtifactRef,
  initialPreview?: Partial<ArtifactPreview> | null,
) {
  const [state, setState] = useState<PreviewState>({
    loading: false,
    error: null,
    preview: null,
    cacheKey: null,
    fetched: false,
  });
  const requestRef = useRef<AbortController | null>(null);
  const cacheKey = useMemo(() => JSON.stringify(refValue), [refValue]);
  const fallbackPreview = useMemo<ArtifactPreview | null>(
    () => (initialPreview ? ({ ...initialPreview, ref: refValue } as ArtifactPreview) : null),
    [initialPreview, refValue],
  );
  const isForCurrentRef = state.cacheKey === cacheKey;
  const preview = isForCurrentRef ? (state.preview ?? fallbackPreview) : fallbackPreview;

  const loadPreview = useCallback(() => {
    if (state.cacheKey === cacheKey && (state.loading || state.fetched)) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState({
      loading: true,
      error: null,
      preview,
      cacheKey,
      fetched: false,
    });
    fetch('/api/artifacts/preview', {
      body: JSON.stringify({ ref: refValue }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 404) throw new Error('This reference is not available.');
        if (!response.ok) throw new Error('Could not load this reference.');
        return (await response.json()) as { preview?: ArtifactPreview };
      })
      .then((data) => {
        setState({
          loading: false,
          error: data.preview || fallbackPreview ? null : 'This reference is not available.',
          preview: data.preview ?? null,
          cacheKey,
          fetched: true,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          setState({
            loading: false,
            error: null,
            preview: null,
            cacheKey: null,
            fetched: false,
          });
          return;
        }
        setState({
          loading: false,
          error: fallbackPreview
            ? null
            : error instanceof Error
              ? error.message
              : 'Could not load this reference.',
          preview: fallbackPreview ?? null,
          cacheKey,
          fetched: true,
        });
      });
  }, [cacheKey, fallbackPreview, preview, refValue, state.cacheKey, state.fetched, state.loading]);

  return {
    error: isForCurrentRef ? state.error : null,
    label: artifactRefLabel(refValue),
    loadPreview,
    loading: isForCurrentRef ? state.loading : false,
    preview,
  };
}
