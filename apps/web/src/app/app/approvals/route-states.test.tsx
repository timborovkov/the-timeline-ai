import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import ApprovalsError from '@/app/app/approvals/error';
import ApprovalsLoading from '@/app/app/approvals/loading';

describe('Approvals route states', () => {
  it('keeps one page heading and a retry action when loading approvals fails', () => {
    const html = renderToStaticMarkup(
      <ApprovalsError error={new Error('route failed')} reset={vi.fn()} />,
    );

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Couldn’t load approvals');
    expect(html).toContain('Try again');
  });

  it('announces the route loading state without introducing another heading', () => {
    const html = renderToStaticMarkup(<ApprovalsLoading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Loading page"');
    expect(html).not.toContain('<h1');
  });
});
