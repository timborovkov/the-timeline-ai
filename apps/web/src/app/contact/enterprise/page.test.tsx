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
      }),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('Enterprise enquiry');
    expect(html).toContain('We reply within two business days.');
    expect(html).toContain('data-testid="enterprise-enquiry-form"');
    expect(html).toContain(
      'data-prefill="{&quot;plan&quot;:&quot;business&quot;,&quot;from&quot;:&quot;pricing&quot;,&quot;members&quot;:&quot;25&quot;}"',
    );
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="/help/support"');
    expect(metadata).toMatchObject({
      title: 'Enterprise enquiry',
      alternates: { canonical: '/contact/enterprise' },
    });
  });
});
