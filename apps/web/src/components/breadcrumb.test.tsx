import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { describe, it } from 'bun:test';
await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    useRouter: () => ({ back: vi.fn() }),
  }),
  () => import('next/navigation'),
);

const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');

const { Breadcrumb } = await import('./breadcrumb.js');

describe('Breadcrumb', () => {
  it('renders a history-aware back link to the nearest parent fallback', () => {
    const html = renderToStaticMarkup(
      createElement(Breadcrumb, {
        items: [
          { label: 'Team', href: '/app/team' },
          { label: 'Integrations', href: '/app/team/integrations' },
          { label: 'Audit log' },
        ],
      }),
    );

    expect(html).toContain('href="/app/team/integrations"');
    expect(html).toContain('Back');
    expect(html).toContain('Audit log');
  });
});
