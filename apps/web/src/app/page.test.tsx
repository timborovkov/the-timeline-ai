import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));

const { default: LandingPage } = await import('@/app/page');

describe('LandingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.auth.mockResolvedValue(null);
  });

  it('uses the shared public navigation and footer', async () => {
    const html = renderToStaticMarkup(await LandingPage());

    expect(html.match(/<header\b/g)).toHaveLength(1);
    expect(html.match(/<footer\b/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Public"');
    expect(html).toContain('aria-label="The Timeline home"');
    expect(html).toContain('href="/help/support"');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<h2[^>]*>How it works · Capture → evidence → operational memory<\/h2>/);
  });
});
