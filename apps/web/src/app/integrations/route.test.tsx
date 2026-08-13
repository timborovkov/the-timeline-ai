// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CONNECTOR_SLUGS } from '@/components/marketing/integrations/connector-content';

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
    const text = html.replace(/<[^>]+>/gu, '');

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Six first-party ingestion paths');
    expect(html).toContain('Native ingestion');
    expect(html).toContain('MCP access');
    expect(html).toContain('Planned native support');
    expect(html).toContain('Native ingestion implemented');
    expect(html).toContain('selection and webhook boundaries');
    expect(html).toContain('Live access');
    expect(html).toContain('Not available yet');
    expect(html).not.toContain('Indexable');
    expect(html).not.toContain('Noindex');
    expect(html).not.toContain('Shared structure keeps the experience coherent');
    expect(html).toContain('Slack example shows that journey from conversation to chronology');
    expect(html.match(/Illustrative example — not customer data/g)).toHaveLength(1);
    expect(html).toContain('href="/integrations/slack"');
    expect(html).toMatch(/aria-current="page"[^>]*href="\/integrations"/u);
    expect(html).toContain('href="/record"');
    expect(html).not.toContain('href="/integrations/notion"');
    expect(html).toContain('compact');
    expect(html).toContain('dark:bg-white');
    expect(html).toContain('text-[3rem]');
    expect(html).toContain('sm:text-[clamp(3.5rem,5vw,5.5rem)]');
    expect(html).not.toContain('7.5vw');
    expect(html).toContain('Native integrations');
    expect(html).toContain('Capability tiers');
    expect(text).toContain('02/Proof');
    expect(html).not.toMatch(/font-mono[^>]*>Integrations \/ capability directory/u);
    expect(html).not.toContain('Available now');
    expect(html).toContain('motion-safe:group-hover:translate-x-1');
    expect(html).not.toContain('01 / Native');
    expect(html).not.toContain('03 / Tiers');
    expect(html.match(/dark:bg-white/g)).toHaveLength(3);
  });

  it.each(['slack', 'sentry'])('renders a light dark-mode logo tile for %s', async (slug) => {
    const html = renderToStaticMarkup(
      await connectorRoute.default({ params: Promise.resolve({ slug }) }),
    );

    expect(html).toContain('dark:bg-white');
    expect(html.match(/Illustrative example — not customer data/g)).toHaveLength(2);
    expect(html).toContain('scroll-mt-12');
    expect(html).toContain('text-[3rem]');
    expect(html).toContain('sm:text-[clamp(3.5rem,5vw,5.5rem)]');
    expect(html).not.toContain('7.5vw');
    expect(html).not.toContain('--record-index');
    expect(html).not.toContain('--marker-index');
  });

  it.each(CONNECTOR_SLUGS)('discloses the canonical fictional example on %s', async (slug) => {
    const html = renderToStaticMarkup(
      await connectorRoute.default({ params: Promise.resolve({ slug }) }),
    );

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html.match(/Illustrative example — not customer data/g)).toHaveLength(2);
    expect(html).toContain('Acme');
    expect(html).not.toMatch(/Northline|Project Atlas|API-91|WEB-913/u);
  });

  it('renders provider-specific truth, evidence, limitations, FAQs, and a single h1', async () => {
    const html = renderToStaticMarkup(
      await connectorRoute.default({ params: Promise.resolve({ slug: 'github' }) }),
    );
    const text = html.replace(/<[^>]+>/gu, '');

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Native integration');
    expect(html).toContain('Last reviewed');
    expect(html).not.toMatch(/font-mono[^>]*>06 native integrations/u);
    expect(html).not.toMatch(/font-mono[^>]*>Last reviewed/u);
    expect(html).toContain('Timeline captures');
    expect(html).toContain('GitHub remains');
    expect(html).toContain('What enters the Timeline');
    expect(html).toContain('Honest limitations');
    expect(html).toContain('Questions, answered');
    expect(html).not.toContain('02 / Questions');
    expect(html).not.toContain('09 / Related');
    expect(text).toContain('10/Start');
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
    expect(github.robots).toBeUndefined();

    expect(metadata.alternates).toEqual({ canonical: '/integrations' });
    expect(metadata.title).toBe('Native integrations');
  });
});
