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
  });

  it('shows the three launch offers and explains the allowance without an estimator', () => {
    const html = renderToStaticMarkup(<PricingPage />);

    expect(html.match(/data-pricing-plan="[^"]+"/g)).toEqual([
      'data-pricing-plan="free"',
      'data-pricing-plan="team"',
      'data-pricing-plan="enterprise"',
    ]);
    expect(html).toContain('$10');
    expect(html).toContain('per member / month');
    expect(html).toContain('exclude applicable taxes calculated at checkout');
    expect(html).toContain('href="/contact/enterprise"');
    expect(html).toContain('background record maintenance');
    expect(html).not.toContain('data-pricing-calculator');
  });
});
