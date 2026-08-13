// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock('@/lib/auth', () => ({ auth: fakes.auth }));

const { default: IntegrationsPage, metadata } = await import('@/app/integrations/page');
const connectorRoute = await import('@/app/integrations/[slug]/page');

describe('public integration routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.auth.mockResolvedValue(null);
  });

  it('renders the directory with one heading and an accurate capability tier boundary', async () => {
    const html = renderToStaticMarkup(await IntegrationsPage());

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Six first-party ingestion paths');
    expect(html).toContain('Native ingestion');
    expect(html).toContain('MCP access');
    expect(html).toContain('Planned connectors');
    expect(html).toContain('Noindex');
    expect(html).toContain('href="/integrations/slack"');
    expect(html).not.toContain('href="/integrations/notion"');
    expect(html).toContain('compact');
    expect(html).toContain('dark:bg-white');
    expect(html).toContain('Native integrations');
    expect(html).toContain('Capability tiers');
    expect(html).toContain('02 / Proof');
    expect(html).not.toContain('01 / Native');
    expect(html).not.toContain('03 / Tiers');
    expect(html.match(/dark:bg-white/g)).toHaveLength(3);
  });

  it.each(['slack', 'sentry'])('renders a light dark-mode logo tile for %s', async (slug) => {
    const html = renderToStaticMarkup(
      await connectorRoute.default({ params: Promise.resolve({ slug }) }),
    );

    expect(html).toContain('dark:bg-white');
  });

  it('renders provider-specific truth, evidence, limitations, FAQs, and a single h1', async () => {
    const html = renderToStaticMarkup(
      await connectorRoute.default({ params: Promise.resolve({ slug: 'github' }) }),
    );

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Native integration');
    expect(html).toContain('Last reviewed');
    expect(html).toContain('Timeline captures');
    expect(html).toContain('GitHub remains');
    expect(html).toContain('What enters the Timeline');
    expect(html).toContain('Honest limitations');
    expect(html).toContain('Questions, answered');
    expect(html).not.toContain('02 / Questions');
    expect(html).not.toContain('09 / Related');
    expect(html).toContain('10 / Start');
    expect(html).toContain('dark:bg-white');
    expect(html).toContain('PR #482');
    expect(html).toContain('application/ld+json');
  });

  it('generates static parameters and provider metadata from the manifest', async () => {
    expect(connectorRoute.generateStaticParams()).toHaveLength(6);
    expect(connectorRoute.dynamicParams).toBe(false);

    const github = await connectorRoute.generateMetadata({
      params: Promise.resolve({ slug: 'github' }),
    });
    expect(github.title).toBe('GitHub integration for cited release history');
    expect(github.alternates).toEqual({ canonical: '/integrations/github' });
    expect(github.robots).toEqual({ index: true, follow: true });

    expect(metadata.alternates).toEqual({ canonical: '/integrations' });
    expect(metadata.title).toBe('Native integrations');
  });
});
