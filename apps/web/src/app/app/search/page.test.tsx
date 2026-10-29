import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { describe, it } from 'bun:test';
const fakes = vi.hoisted(() => ({
  props: vi.fn(),
}));

await vi.mock(
  import.meta.resolve('@/components/global-search-page'),
  () => ({
    GlobalSearchPage: (props: {
      initialQuery: string;
      initialType?: string;
      initialSource?: string;
      initialFrom?: string;
      initialTo?: string;
    }) => {
      fakes.props(props);
      return <div data-testid="global-search-page">{props.initialQuery}</div>;
    },
  }),
  () => import('@/components/global-search-page'),
);

const { renderToStaticMarkup } = await import('react-dom/server');

const { default: SearchPage } = await import('./page.js');

describe('SearchPage', () => {
  it('normalizes duplicate URL params before rendering the client page', async () => {
    const html = renderToStaticMarkup(
      await SearchPage({
        searchParams: Promise.resolve({
          q: ['github docs', 'ignored'],
          type: ['documents', 'tasks'],
          source: ['slack', 'telegram'],
          from: ['2026-06-01', '2026-05-01'],
          to: ['2026-06-30', '2026-07-31'],
        }),
      }),
    );

    expect(html).toContain('github docs');
    expect(fakes.props).toHaveBeenCalledWith({
      initialQuery: 'github docs',
      initialType: 'documents',
      initialSource: 'slack',
      initialFrom: '2026-06-01',
      initialTo: '2026-06-30',
    });
  });
});
