import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { describe, it } from 'bun:test';

await vi.mock(
  import.meta.resolve('@/components/help/support-request-form'),
  () => ({
    SupportRequestForm: () => <div data-testid="support-request-form" />,
  }),
  () => import('@/components/help/support-request-form'),
);

const { renderToStaticMarkup } = await import('react-dom/server');
const { default: SupportPage } = await import('./page.js');

describe('support page', () => {
  it('routes private support, public bugs, security reports, and contributions', () => {
    const html = renderToStaticMarkup(<SupportPage />);

    expect(html).toContain('mailto:contact@thetimeline.cc');
    expect(html).toContain('issues/new?template=bug_report.yml');
    expect(html).toContain('/security/policy');
    expect(html).toContain('/blob/main/CONTRIBUTING.md');
    expect(html).toContain('Never disclose an unpatched vulnerability in a public issue.');
    expect(html).toContain('without customer data, personal data, or secrets');
    expect(html).toContain('data-testid="support-request-form"');
  });
});
