// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OnboardingChecklistView } from '@/lib/onboarding-checklist';
import type { PropsWithChildren, ReactElement } from 'react';

import { queryKeys } from '@/lib/query-keys';
import { useOnboardingChecklistQuery } from '@/lib/use-paginated-queries';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const dismissed: OnboardingChecklistView = { dismissed: true, items: [] };
const open: OnboardingChecklistView = {
  dismissed: false,
  items: [{ key: 'telegram', label: 'Link Telegram', completed: false }],
};

function Probe({ initialData }: { initialData?: OnboardingChecklistView }) {
  const { data } = useOnboardingChecklistQuery(initialData);
  return <span>{data?.dismissed ? 'dismissed' : 'open'}</span>;
}

function renderProbe(client: QueryClient, ui: ReactElement) {
  return render(ui, {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

describe('useOnboardingChecklistQuery', () => {
  it('replaces a warm cache with the server snapshot once on mount', () => {
    vi.stubGlobal('fetch', vi.fn());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.onboarding(), dismissed);

    renderProbe(client, <Probe initialData={open} />);

    expect(screen.getByText('open')).toBeTruthy();
    expect(client.getQueryData(queryKeys.onboarding())).toEqual(open);
  });

  it('does not overwrite an optimistic update after the first seed', () => {
    vi.stubGlobal('fetch', vi.fn());
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderProbe(client, <Probe initialData={open} />);
    expect(screen.getByText('open')).toBeTruthy();

    client.setQueryData(queryKeys.onboarding(), dismissed);
    view.rerender(<Probe initialData={open} />);

    expect(screen.getByText('dismissed')).toBeTruthy();
  });
});
