import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import DocumentsLoading from '@/app/app/documents/loading';

describe('DocumentsLoading', () => {
  it('keeps document loading rows usable at narrow widths', () => {
    const html = renderToStaticMarkup(<DocumentsLoading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Loading documents"');
    expect(html).toContain('flex-col gap-3 sm:flex-row');
    expect(html).toContain('h-4 w-full max-w-64');
    expect(html).toContain('sm:grid-cols-[minmax(0,1fr)_4rem]');
    expect(html).not.toContain('h-4 w-64');
  });
});
