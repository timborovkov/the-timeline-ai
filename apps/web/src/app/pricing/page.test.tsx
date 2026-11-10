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
    expect(html).toContain('1,000 accepted sources');
    expect(html).toContain('timeline.remember notes count toward that meter');
    expect(html).toContain('10,000 documents');
    expect(html).toContain('20,000 indexed chunks');
    expect(html).toContain('100 MB of file storage');
    expect(html).not.toContain('0.097');
    expect(html).not.toContain('1 GB of file storage');
  });

  it('makes Free the no-card entry and treats the estimator as optional planning', () => {
    const html = renderToStaticMarkup(<PricingPage />);

    expect(html).toContain('Start Free, no card.');
    expect(html).toContain('Start Free to try your first source.');
    expect(html).toContain('href="#estimate-usage"');
    expect(html).toContain('Estimate paid usage');
    expect(html).toContain('id="estimate-usage"');
    expect(html).toContain('Estimate paid usage when you need it.');
    expect(html).toContain('You do not need these numbers to start Free.');
    expect(html).toContain('All prices are in euros and exclude VAT.');
    expect(html).toContain('€37.18');
  });
});
