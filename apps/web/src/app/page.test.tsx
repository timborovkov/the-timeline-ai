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

  it('keeps the archive marketing structure with problem, principles, and cited evidence', async () => {
    const html = renderToStaticMarkup(await LandingPage());

    expect(html.match(/<header\b/g)).toHaveLength(1);
    expect(html.match(/<footer\b/g)).toHaveLength(1);
    expect(html).toContain('aria-label="The Timeline — home"');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Ask what changed.');
    expect(html).toContain('Teams do the work, then separately report that the work happened.');
    expect(html).toContain('CONCEPTS · CAPTURE → EVIDENCE → OPERATIONAL MEMORY');
    expect(html).toContain('PRINCIPLES · BUILT FOR THE WORK');
    expect(html).toContain('WITHOUT TIMELINE');
    expect(html).toContain('WITH TIMELINE');
    expect(html).toContain('linear-gradient');
    expect(html).not.toContain('aria-label="Public"');
  });
});
