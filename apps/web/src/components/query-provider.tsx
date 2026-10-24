'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import { recoverFromStaleServerAction } from '@/lib/stale-server-action';

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
          },
        },
        queryCache: new QueryCache({
          onError: (error) => {
            recoverFromStaleServerAction(error);
          },
        }),
        mutationCache: new MutationCache({
          onError: (error) => {
            recoverFromStaleServerAction(error);
          },
        }),
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
