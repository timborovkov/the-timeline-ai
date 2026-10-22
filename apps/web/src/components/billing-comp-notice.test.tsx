import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BillingCompNotice } from '@/components/billing-comp-notice';

describe('BillingCompNotice', () => {
  it('states that a comp has no Polar charges and still meters usage', () => {
    const html = renderToStaticMarkup(
      <BillingCompNotice
        planName="Team"
        expired={false}
        reason="Tim internal"
        expiresOn="2026-12-31"
      />,
    );
    expect(html).toContain('Comped internal plan (Team)');
    expect(html).toContain('No Polar charges');
    expect(html).toContain('spend cap still pauses');
    expect(html).toContain('Tim internal');
    expect(html).toContain('2026-12-31');
  });

  it('states when a comp has expired', () => {
    const html = renderToStaticMarkup(
      <BillingCompNotice planName="Free" expired reason={null} expiresOn="2026-01-01" />,
    );
    expect(html).toContain('Comped internal plan expired');
    expect(html).toContain('fell back to Free');
    expect(html).not.toContain('2026-01-01');
  });
});
