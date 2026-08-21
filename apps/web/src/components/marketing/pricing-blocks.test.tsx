import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  PricingComparisonTable,
  PricingMetersExplainer,
  PricingPlanGrid,
} from '@/components/marketing/pricing-blocks';

describe('pricing blocks', () => {
  it('renders Free, PAYG, Team, Business, and Enterprise plans', () => {
    const html = renderToStaticMarkup(<PricingPlanGrid />);
    expect(html).toContain('data-pricing-plan="free"');
    expect(html).toContain('data-pricing-plan="payg"');
    expect(html).toContain('data-pricing-plan="team"');
    expect(html).toContain('data-pricing-plan="business"');
    expect(html).toContain('data-pricing-plan="enterprise"');
    expect(html).toContain('Pay as you go');
  });

  it('explains native meters without opaque credits', () => {
    const html = renderToStaticMarkup(<PricingMetersExplainer />);
    expect(html).toContain('AI');
    expect(html).toContain('Meetings');
    expect(html).toMatch(/provider token cost/i);
  });

  it('compares platform fees across plans', () => {
    const html = renderToStaticMarkup(<PricingComparisonTable />);
    expect(html).toContain('€49/mo');
    expect(html).toContain('€199/mo');
  });
});
