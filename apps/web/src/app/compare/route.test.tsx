import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import CompareToolPage from '@/app/compare/[slug]/page';
import CompareHubPage from '@/app/compare/page';
import { COMPARE_TOOLS } from '@/components/marketing/compare/content';

describe('compare routes', () => {
  it('renders the hub with one heading and four works-with cards', () => {
    const html = renderToStaticMarkup(<CompareHubPage />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Keep the tools you already use.');
    expect(html).toContain('data-compare-hub');
    expect(html).toContain('Start free');
    expect(html).not.toMatch(/\bvs\.?\b|switch from/iu);
    for (const tool of COMPARE_TOOLS) {
      expect(html).toContain(`href="${tool.route}"`);
      expect(html).toContain(tool.name);
    }
  });

  it.each(COMPARE_TOOLS)('renders $route without vs or switch language', async (tool) => {
    const html = renderToStaticMarkup(
      await CompareToolPage({ params: Promise.resolve({ slug: tool.slug }) }),
    );

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(tool.title);
    expect(html).toContain('Start free');
    expect(html).toContain(`data-compare-route="${tool.route}"`);
    expect(html).not.toMatch(/\bvs\.?\b|switch from/iu);
  });
});
