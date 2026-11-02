import { expect } from '@timeline/test-support';
import { vi } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

await vi.mock(
  import.meta.resolve('next/navigation'),
  async () => ({
    ...(await import('next/navigation')),
    usePathname: () => null,
  }),
  () => import('next/navigation'),
);

const { SupportEmailProvider, SupportMailto, useSupportEmail } =
  await import('@/components/support-email-provider');
const { getLegalContactEmail } = await import('@/lib/legal-versions');
const { getSupportEmail } = await import('@/lib/support-email');

function ContactLink() {
  const email = useSupportEmail();
  return createElement('a', { href: `mailto:${email}` }, email);
}

describe('support contact address', () => {
  it('shares the configured address with legal pages and client links', () => {
    const previous = process.env.SUPPORT_EMAIL;
    try {
      process.env.SUPPORT_EMAIL = ' help@example.test ';
      expect(getSupportEmail()).toBe('help@example.test');
      expect(getLegalContactEmail()).toBe('help@example.test');
      const html = renderToStaticMarkup(
        createElement(SupportEmailProvider, {
          email: getSupportEmail(),
          children: createElement(ContactLink),
        }),
      );
      expect(html).toContain('href="mailto:help@example.test"');
      expect(html).not.toContain('contact@thetimeline.cc');
      process.env.SUPPORT_EMAIL = ' ';
      expect(getSupportEmail()).toBe('contact@thetimeline.cc');
      expect(renderToStaticMarkup(createElement(SupportMailto))).toContain(
        'href="mailto:contact@thetimeline.cc"',
      );
    } finally {
      if (previous === undefined) delete process.env.SUPPORT_EMAIL;
      else process.env.SUPPORT_EMAIL = previous;
    }
  });
});
