import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import ProductTourRoutePage from '@/app/product-tour/page';
import { PRODUCT_TOUR } from '@/components/marketing/product-tour/content';

describe('product tour route', () => {
  it('renders every drafted step with a named screenshot slot', () => {
    const html = renderToStaticMarkup(<ProductTourRoutePage />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(PRODUCT_TOUR.title);
    expect(html).toContain('data-product-tour');
    expect(html).toContain('Start free');
    expect(html).toContain('See pricing');
    expect(PRODUCT_TOUR.steps).toHaveLength(8);

    for (const step of PRODUCT_TOUR.steps) {
      expect(html).toContain(`data-tour-step="${step.index}"`);
      expect(html).toContain(step.headline);
      expect(html).toContain(`data-screenshot-file="${step.file}"`);
      expect(html).toContain(step.file);
      if (step.mobileFile) expect(html).toContain(step.mobileFile);
    }
  });
});
