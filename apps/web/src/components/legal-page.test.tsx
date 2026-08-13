import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));

const { LegalPage } = await import('@/components/legal-page');

describe('LegalPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers signed-in visitors a route back to the app', async () => {
    fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });

    const html = renderToStaticMarkup(
      await LegalPage({
        eyebrow: 'Version 1',
        title: 'Terms',
        description: 'Terms description',
        children: <p>Legal copy</p>,
      }),
    );

    expect(html).toContain('Dashboard');
    expect(html).not.toContain('>Sign in<');
  });
});
