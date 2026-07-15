// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { IntegrationsCatalog } from '@/components/integrations/catalog';

afterEach(() => {
  cleanup();
});

describe('IntegrationsCatalog', () => {
  it('keeps unavailable providers inside a closed More providers disclosure', () => {
    render(
      <IntegrationsCatalog
        catalog={[
          {
            id: 'linear',
            label: 'Linear',
            description: 'Sync issues.',
            logo: '/integrations/linear.svg',
            available: true,
          },
          {
            id: 'sentry',
            label: 'Sentry',
            description: 'Sync errors.',
            logo: '/integrations/sentry.svg',
            available: false,
          },
        ]}
      />,
    );

    expect(screen.getByText('Linear').closest('details')).toBeNull();
    const disclosure = screen.getByText('Sentry').closest('details');
    expect(disclosure).toBeTruthy();
    expect(disclosure?.hasAttribute('open')).toBe(false);
    expect(screen.getByText(/More providers/)).toBeTruthy();
  });
});
