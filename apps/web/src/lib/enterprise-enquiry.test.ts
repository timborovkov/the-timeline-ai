import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  ENTERPRISE_ENQUIRY_PATH,
  ENTERPRISE_RESPONSE_EXPECTATION,
  buildEnterpriseEnquiryHref,
  formatEnterprisePricingContext,
  parseEnterpriseEnquiryPrefill,
  parseEnterpriseTopicPrefill,
} from '@/lib/enterprise-enquiry';

describe('enterprise enquiry helpers', () => {
  it('builds a stable enquiry path with allowed pricing context', () => {
    expect(buildEnterpriseEnquiryHref()).toBe(ENTERPRISE_ENQUIRY_PATH);
    expect(
      buildEnterpriseEnquiryHref({
        from: 'pricing',
        plan: 'business',
        members: '12',
        ai: '40',
      }),
    ).toBe('/contact/enterprise?plan=business&from=pricing&members=12&ai=40');
  });

  it('preselects on-premise topic when CTAs request it', () => {
    expect(
      buildEnterpriseEnquiryHref({
        from: 'trust',
        selectedTopics: ['on_premise_deployment'],
      }),
    ).toBe('/contact/enterprise?from=trust&topics=on_premise_deployment');
    expect(
      parseEnterpriseTopicPrefill({
        topics: 'on_premise_deployment,sso,not-a-topic',
      }),
    ).toEqual(['on_premise_deployment', 'sso']);
  });

  it('parses and formats bounded query-param context', () => {
    const prefill = parseEnterpriseEnquiryPrefill(
      new URLSearchParams(
        'from=pricing-calculator&plan=team&members=8&ai=25&meetings=12&websites=2&pages=5&frequency=weekly&topics=on_premise_deployment',
      ),
    );
    expect(prefill).toEqual({
      from: 'pricing-calculator',
      plan: 'team',
      members: '8',
      ai: '25',
      meetings: '12',
      websites: '2',
      pages: '5',
      frequency: 'weekly',
      topics: 'on_premise_deployment',
    });
    expect(formatEnterprisePricingContext(prefill)).toBe(
      'plan=team, from=pricing-calculator, members=8, ai=25, meetings=12, websites=2, pages=5, frequency=weekly, topics=on_premise_deployment',
    );
  });

  it('drops unsafe or oversized query values', () => {
    expect(
      parseEnterpriseEnquiryPrefill({
        plan: '<script>',
        members: '12',
        from: 'x'.repeat(80),
      }),
    ).toEqual({
      members: '12',
      from: 'x'.repeat(64),
    });
  });

  it('keeps the public response-expectation copy stable', () => {
    expect(ENTERPRISE_RESPONSE_EXPECTATION).toBe('We reply within two business days.');
  });
});
