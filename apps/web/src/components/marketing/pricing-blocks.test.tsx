import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  PricingComparisonTable,
  PricingEnterpriseNudge,
  PricingMetersExplainer,
  PricingPlanGrid,
} from '@/components/marketing/pricing-blocks';

describe('pricing blocks', () => {
  it('renders self-serve plans and an enterprise contact nudge', () => {
    const html = renderToStaticMarkup(
      <>
        <PricingPlanGrid />
        <PricingEnterpriseNudge />
      </>,
    );
    expect(html).toContain('data-pricing-plan="free"');
    expect(html).toContain('data-pricing-plan="payg"');
    expect(html).toContain('data-pricing-plan="team"');
    expect(html).toContain('data-pricing-plan="business"');
    expect(html).not.toContain('data-pricing-plan="enterprise"');
    expect(html).toContain('data-pricing-enterprise-nudge');
    expect(html).toContain('Pay as you go');
  });

  it('explains native meters without opaque credits', () => {
    const html = renderToStaticMarkup(<PricingMetersExplainer />);
    expect(html).toContain('AI');
    expect(html).toContain('Meetings');
    expect(html).toMatch(/provider token cost/i);
    expect(html).toMatch(/one owned workspace/i);
    expect(html).toMatch(/restricted until you add a payment method/i);
  });

  it('folds infrastructure ceilings behind a closed disclosure', () => {
    const html = renderToStaticMarkup(<PricingComparisonTable />);
    expect(html).toContain('€49/mo');
    expect(html).toContain('€199/mo');
    expect(html).toContain('data-pricing-infrastructure');
    expect(html).toContain('Infrastructure limits');
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).toContain('Ask turns / month');
    expect(html).toContain('Concurrent meeting notetakers');
    expect(html).toContain('Custom MCP servers');
    expect(html).toContain('Not included');
    expect(html).toContain('1 GB');
  });
});
