import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  props: vi.fn(),
}));

vi.mock('@/components/global-search-page', () => ({
  GlobalSearchPage: (props: {
    initialQuery: string;
    initialSource?: string;
    initialFrom?: string;
    initialTo?: string;
  }) => {
    fakes.props(props);
    return <div data-testid="global-search-page">{props.initialQuery}</div>;
  },
}));

const { default: SearchPage } = await import('./page.js');

describe('SearchPage', () => {
  it('normalizes duplicate URL params before rendering the client page', async () => {
    const html = renderToStaticMarkup(
      await SearchPage({
        searchParams: Promise.resolve({
          q: ['github docs', 'ignored'],
          source: ['slack', 'telegram'],
          from: ['2026-06-01', '2026-05-01'],
          to: ['2026-06-30', '2026-07-31'],
        }),
      }),
    );

    expect(html).toContain('github docs');
    expect(fakes.props).toHaveBeenCalledWith({
      initialQuery: 'github docs',
      initialSource: 'slack',
      initialFrom: '2026-06-01',
      initialTo: '2026-06-30',
    });
  });
});
