import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

await vi.mock(
  import.meta.resolve('@/components/marketing/enterprise-enquiry-form'),
  () => ({
    EnterpriseEnquiryForm: ({ prefill }: { prefill?: Record<string, string> }) => (
      <div data-testid="enterprise-enquiry-form" data-prefill={JSON.stringify(prefill ?? {})} />
    ),
  }),
  () => import('@/components/marketing/enterprise-enquiry-form'),
);
await vi.mock(
  import.meta.resolve('@/components/support-email-provider'),
  () => ({
    SupportMailto: ({ children }: { children?: ReactNode }) => (
      <a href="mailto:contact@thetimeline.cc">{children ?? 'contact@thetimeline.cc'}</a>
    ),
  }),
  () => import('@/components/support-email-provider'),
);

const { default: EnterpriseContactPage, metadata } = await import('./page.js');

describe('enterprise contact page', () => {
  it('renders the dedicated enquiry path with response expectation and prefill', async () => {
    const element = await EnterpriseContactPage({
      searchParams: Promise.resolve({
        from: 'pricing',
        plan: 'business',
        members: '25',
        topics: 'on_premise_deployment',
      }),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('Enterprise enquiry');
    expect(html).toContain('We reply within one business day.');
    expect(html).toContain('data-testid="enterprise-enquiry-form"');
    expect(html).toContain('data-enterprise-deployment');
    expect(html).toContain('managed on-premise / private-cloud');
    expect(html).toContain('source-available');
    expect(html).toContain('Elastic License 2.0');
    expect(html).toContain('OpenAI-compatible');
    expect(html).toContain(
      'href="https://github.com/timborovkov/the-timeline-ai/blob/main/docs/self-hosting.md"',
    );
    expect(html).not.toMatch(/\bopen source\b/i);
    expect(html).toContain('data-prefill=');
    expect(html).toContain('on_premise_deployment');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="/help/support"');
    expect(metadata).toMatchObject({
      title: 'Enterprise enquiry',
      alternates: { canonical: '/contact/enterprise' },
    });
  });
});
