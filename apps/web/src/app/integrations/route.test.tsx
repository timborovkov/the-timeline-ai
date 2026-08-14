// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CONNECTOR_SLUGS } from '@/components/marketing/integrations/connector-content';

function visibleText(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gu, '').replace(/<[^>]+>/gu, '');
}

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
    const text = visibleText(html);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(text).toContain('Connect the places where the work already happens');
    expect(html).toContain('Start where the conversation already happens');
    expect(text).toContain('Bring selected tool history into Timeline');
    expect(text).toContain('Send work in');
    expect(text).toContain('Connect your tools');
    expect(text).toContain('Look up live tools');
    expect(text).toContain('Coming later');
    expect(text).not.toMatch(
      /Last reviewed|capability directory|Capability tiers|Implemented|First-party capture|Provider record sync|MCP access|Planned native support/u,
    );
    expect(html).not.toContain('<time');
    expect(html).not.toContain('Indexable');
    expect(html).not.toContain('Noindex');
    expect(html).not.toContain('Shared structure keeps the experience coherent');
    expect(html).toContain('Slack example shows that journey from conversation to chronology');
    expect(html.match(/Fictional Acme example, not customer data\./g)).toHaveLength(1);
    expect(html).toContain('href="/integrations/slack"');
    expect(text).toContain('Telegram');
    expect(text).toContain('Slack conversations');
    expect(text).toContain('Forward, CC, or BCC');
    expect(text).toContain('Google Meet · Microsoft Teams · Zoom');
    expect(text).toContain('Ingest webhooks');
    expect(text).toContain('cannot update or control records in the sending tool');
    expect(text).toContain('separate from the Slack history connector below');
    expect(text).toContain('Start with Telegram');
    expect(text).toContain('Start with Meeting transcripts');
    expect(html).toMatch(/aria-current="page"[^>]*href="\/integrations"/u);
    expect(html).toContain('href="/how-it-works"');
    expect(html).not.toContain('href="/integrations/notion"');
    expect(html).toContain('compact');
    expect(html).toContain('dark:bg-white');
    expect(html).toContain('text-[3rem]');
    expect(html).toContain('sm:text-[clamp(3.5rem,5vw,5.5rem)]');
    expect(html).not.toContain('7.5vw');
    expect(text).toContain('Send work in');
    expect(text).toContain('02/Connect your tools');
    expect(text).toContain('04/More connections');
    expect(text).toContain('03/Proof');
    expect(html).not.toMatch(/font-mono[^>]*>Integrations \/ capability directory/u);
    expect(html).not.toContain('Available now');
    expect(html).toContain('motion-safe:group-hover:translate-x-1');
    expect(html).toContain('max-w-[82rem]');
    expect(html).toContain('lg:grid-cols-[13rem_minmax(0,1fr)]');
    expect(html).toContain('xl:grid-cols-[15rem_minmax(0,1fr)]');
    expect(html).not.toContain('01 / Native');
    expect(html).not.toContain('03 / Tiers');
    expect(html.match(/dark:bg-white/g)).toHaveLength(5);
  });

  it('routes signed-in visitors to each implemented capture setup', async () => {
    fakes.auth.mockResolvedValue({ user: { id: 'user-1' } });

    const html = renderToStaticMarkup(await IntegrationsPage());

    expect(html).toContain('href="/app/sources"');
    expect(html).toContain('href="/app/team/telegram"');
    expect(html).toContain('href="/app/team/slack"');
    expect(html).toContain('href="/app/team?section=email"');
    expect(html).toContain('href="/app/meetings"');
    expect(html).toContain('Link Telegram');
    expect(html).toContain('Install Slack');
    expect(html).toContain('Create a webhook');
  });

  it.each(['slack', 'sentry'])('renders a light dark-mode logo tile for %s', async (slug) => {
    const html = renderToStaticMarkup(
      await connectorRoute.default({ params: Promise.resolve({ slug }) }),
    );

    expect(html).toContain('dark:bg-white');
    expect(html.match(/Fictional Acme example, not customer data\./g)).toHaveLength(2);
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
    expect(html.match(/Fictional Acme example, not customer data\./g)).toHaveLength(2);
    expect(html).toContain('Acme');
    expect(html).not.toMatch(/Northline|Project Atlas|API-91|WEB-913/u);
  });

  it('renders provider-specific truth, evidence, limitations, FAQs, and a single h1', async () => {
    const html = renderToStaticMarkup(
      await connectorRoute.default({ params: Promise.resolve({ slug: 'github' }) }),
    );
    const text = visibleText(html);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(text).toContain('All integrations');
    expect(text).toContain('What gets captured');
    expect(text).toContain('What Timeline keeps—and what stays in GitHub');
    expect(text).not.toMatch(/Last reviewed|Native integration|Capability truth/u);
    expect(html).not.toContain('<time');
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
    expect(metadata.title).toBe('Integrations and capture surfaces');
  });
});
