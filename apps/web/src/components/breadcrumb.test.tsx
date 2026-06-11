import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn() }) }));

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
