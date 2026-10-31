import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { BillingCompNotice } from '@/components/billing-comp-notice';

describe('BillingCompNotice', () => {
  it('states that a comp has no charge', () => {
    const html = renderToStaticMarkup(
      <BillingCompNotice
        planName="Team"
        expired={false}
        reason="Tim internal"
        expiresOn="2026-12-31"
      />,
    );
    expect(html).toContain('Comped through 2026-12-31. No charge.');
    expect(html).not.toContain('Tim internal');
    expect(html).not.toContain('Polar');
  });

  it('states when a comp has expired', () => {
    const html = renderToStaticMarkup(
      <BillingCompNotice planName="Free" expired reason={null} expiresOn="2026-01-01" />,
    );
    expect(html).toContain('Comp ended. This workspace is on Free.');
    expect(html).not.toContain('2026-01-01');
  });
});
