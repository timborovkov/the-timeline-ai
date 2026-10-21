// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { ShowMoreList } from '@/components/ui/show-more-list';

afterEach(() => {
  cleanup();
});

function Row({ item }: { item: string; index: number }) {
  return <span>{item}</span>;
}

describe('ShowMoreList', () => {
  it('renders every item when the list fits the preview', () => {
    const html = renderToStaticMarkup(
      <ShowMoreList items={['a', 'b']} previewCount={3} getKey={(item) => item} Item={Row} />,
    );

    expect(html).toContain('>a<');
    expect(html).toContain('>b<');
    expect(html).not.toContain('Show');
    expect(html).not.toContain('<details');
  });

  it('folds overflow behind a Show N more disclosure', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ShowMoreList
        items={['one', 'two', 'three', 'four', 'five']}
        previewCount={3}
        getKey={(item) => item}
        Item={Row}
      />,
    );

    expect(screen.getByText('one')).toBeTruthy();
    expect(screen.getByText('three')).toBeTruthy();
    expect(screen.getByText('Show 2 more')).toBeTruthy();
    const fold = container.querySelector('details');
    expect(fold).toBeTruthy();
    expect(fold?.open).toBe(false);

    await user.click(screen.getByText('Show 2 more'));
    expect(fold?.open).toBe(true);
    expect(screen.getByText('four')).toBeTruthy();
    expect(screen.getByText('five')).toBeTruthy();
  });

  it('keeps a fold control when hasMore is true even if preview fits', () => {
    const html = renderToStaticMarkup(
      <ShowMoreList
        items={['a', 'b', 'c']}
        previewCount={3}
        hasMore
        getKey={(item) => item}
        Item={Row}
        moreLabel={(hidden, { hasMore }) =>
          hidden > 0 ? `Show ${hidden}${hasMore ? '+' : ''} more` : 'Show more'
        }
      />,
    );

    expect(html).toContain('Show more');
    expect(html).toContain('<details');
  });
});
