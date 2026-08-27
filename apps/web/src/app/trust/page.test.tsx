import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));

import TrustPage from '@/app/trust/page';

afterEach(() => {
  vi.clearAllMocks();
});

describe('Trust page', () => {
  it('states the enforceable AI boundary and current assurance status', async () => {
    fakes.auth.mockResolvedValue(null);

    const html = renderToStaticMarkup(await TrustPage());

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Your work should not become someone else');
    expect(html).toContain('ZDR by role');
    expect(html).toContain('ZDR-required roles reject endpoints with weaker retention terms');
    expect(html).toContain('data_collection: deny');
    expect(html).toContain('zdr: true');
    expect(html).toContain('cache-disable control');
    expect(html).toContain('openai/gpt-4o-transcribe');
    expect(html).toContain('Retained, no-training quality exception');
    expect(html).toContain('up to 30 days');
    expect(html).toContain('Not claimed today');
    expect(html).toContain('SOC 2, ISO 27001, or HIPAA compliance');
    expect(html).toContain('Browser analytics is confined to');
    expect(html).toContain('protected workspace');
    expect(html).toContain('Personless surface streams');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/cookies"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="https://github.com/timborovkov/the-timeline-ai"');
  });

  it('routes signed-in readers back to their dashboard', async () => {
    fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });

    const html = renderToStaticMarkup(await TrustPage());

    expect(html).toContain('>Dashboard<');
    expect(html).not.toContain('>Sign in<');
  });
});
