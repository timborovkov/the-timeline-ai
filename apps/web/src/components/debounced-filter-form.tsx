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
  id?: string;
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
  id,
}: Props) {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navigate = useCallback(
    (values: FormData) => {
      const params = new URLSearchParams(preservedParams);
      for (const [key, raw] of values.entries()) {
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
      // Popover controls may unmount before the debounce expires. Preserve the
      // values from this change instead of reading an emptied form later.
      const values = new FormData(form);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        navigate(values);
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
    navigate(new FormData(event.currentTarget));
  }

  return (
    <form
      id={id}
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
