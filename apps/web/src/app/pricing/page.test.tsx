import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import PricingPage from '@/app/pricing/page';
import { PRICING_FAQS } from '@/components/marketing/pricing-faq-content';

describe('pricing page FAQ', () => {
  it('renders catalog and legal FAQ answers', () => {
    const html = renderToStaticMarkup(<PricingPage />);

    expect(html).toContain('data-pricing-faq');
    expect(html).toContain('"@type":"FAQPage"');
    for (const faq of PRICING_FAQS) {
      expect(html).toContain(faq.question);
      expect(html).toContain(faq.answer);
    }
    expect(html).toContain('you may not need one');
    expect(html).toContain('Linear already syncs');
    expect(html).toContain('Atlassian MCP');
    expect(html).toContain('HubSpot, Attio and Pipedrive');
    expect(html).toContain('does not train or fine-tune models on Customer Content');
    expect(html).toContain('€0 spend cap');
    expect(html).toContain('100 Ask turns');
  });
});
