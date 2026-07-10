'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

import type { ReactNode, SyntheticEvent } from 'react';

const FILTER_DEBOUNCE_MS = 300;

interface Props {
  basePath: string;
  children: ReactNode;
  className?: string;
  preservedParams?: Record<string, string>;
}

const EMPTY_PARAMS: Record<string, string> = {};
interface TimerRef {
  current: ReturnType<typeof setTimeout> | null;
}

function clearPendingTimer(timerRef: TimerRef): void {
  if (!timerRef.current) return;
  clearTimeout(timerRef.current);
  timerRef.current = null;
}

export function DebouncedFilterForm({
  basePath,
  children,
  className,
  preservedParams = EMPTY_PARAMS,
}: Props) {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navigate = useCallback(
    (form: HTMLFormElement) => {
      const params = new URLSearchParams(preservedParams);
      for (const [key, raw] of new FormData(form).entries()) {
        if (key.startsWith('__')) continue;
        const value = typeof raw === 'string' ? raw.trim() : '';
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const query = params.toString();
      const href = query ? `${basePath}?${query}` : basePath;
      router.replace(href, { scroll: false });
    },
    [basePath, preservedParams, router],
  );

  const scheduleNavigation = useCallback(
    (form: HTMLFormElement) => {
      clearPendingTimer(timerRef);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        navigate(form);
      }, FILTER_DEBOUNCE_MS);
    },
    [navigate],
  );

  useEffect(() => {
    const cancelForHistoryNavigation = () => {
      clearPendingTimer(timerRef);
    };
    const cancelForLinkNavigation = (event: globalThis.MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const target = event.target;
      if (target instanceof Element && target.closest('a[href]')) clearPendingTimer(timerRef);
    };
    window.addEventListener('popstate', cancelForHistoryNavigation);
    document.addEventListener('click', cancelForLinkNavigation, true);
    return () => {
      window.removeEventListener('popstate', cancelForHistoryNavigation);
      document.removeEventListener('click', cancelForLinkNavigation, true);
      clearPendingTimer(timerRef);
    };
  }, []);

  function onSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    clearPendingTimer(timerRef);
    navigate(event.currentTarget);
  }

  return (
    <form
      onSubmit={onSubmit}
      onChange={(event) => {
        scheduleNavigation(event.currentTarget);
      }}
      onInput={(event) => {
        scheduleNavigation(event.currentTarget);
      }}
      className={className}
    >
      {children}
    </form>
  );
}
