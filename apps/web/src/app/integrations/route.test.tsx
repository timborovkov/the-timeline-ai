import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
// Test environment: happy-dom

function visibleText(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gu, '').replace(/<[^>]+>/gu, '');
}

const { cleanup, render, screen } = await import('@testing-library/react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { CONNECTOR_SLUGS, findConnector } =
  await import('@/components/marketing/integrations/connector-content');
const { ConnectorPage } = await import('@/components/marketing/integrations/connector-page');
const { WORKS_WITH_PAGE_TOOLS, findWorksWithTool } =
  await import('@/components/marketing/integrations/works-with-content');
const { resetPublicSessionCache, setPublicSessionCache } = await import('@/lib/public-session');

const { default: IntegrationsPage, metadata } = await import('@/app/integrations/page');
const connectorRoute = await import('@/app/integrations/[slug]/page');

describe('public integration routes', () => {
  afterEach(() => {
    cleanup();
    resetPublicSessionCache();
  });

  it('renders the directory with one heading and an accurate capability tier boundary', () => {
    const html = renderToStaticMarkup(<IntegrationsPage />);
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
    expect(html).toContain('href="/integrations/telegram"');
    expect(text).toContain('Telegram');
    expect(text).toContain('Plain text in a direct chat asks the agent');
    expect(text).toContain('does not silently become team evidence');
    expect(text).toContain('Telegram is not a passive account-history sync');
    expect(text).toContain('Slack conversations');
    expect(text).toContain('Forward, CC, or BCC');
    expect(text).toContain('Google Meet · Microsoft Teams calls · Zoom');
    expect(text).toContain('Ingest webhooks');
    expect(text).toContain('cannot update or control records in the sending tool');
    expect(text).toContain('separate from the Slack history connector below');
    expect(text).toContain('Start with Telegram');
    expect(text).toContain('Start with Meeting transcripts');
    expect(html).toMatch(/aria-current="page"[^>]*href="\/integrations"/u);
    expect(html).toContain('href="/how-it-works"');
    expect(html).toContain('href="/integrations/notion"');
    expect(html).toContain('href="/integrations/jira"');
    expect(html).toContain('href="/integrations/hubspot"');
    expect(html).toContain('href="/integrations/attio"');
    expect(html).toContain('href="/integrations/pipedrive"');
    expect(html).not.toMatch(/href="(?:\/(?:app\/)?demo|\/workspace\/demo|https?:\/\/t\.me\/)/u);
    expect(text).not.toMatch(/captures? (?:all|every) (?:chat|conversation|message)/iu);
    expect(html).toContain('compact');
    expect(html).toContain('bg-white');
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
    expect(html.match(/bg-white/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it('routes signed-in visitors to each implemented capture setup', () => {
    setPublicSessionCache({ status: 'signed-in' });
    render(<IntegrationsPage />);

    expect(screen.getByRole('link', { name: 'Link Telegram' }).getAttribute('href')).toBe(
      '/app/connections/sources#telegram',
    );
    expect(screen.getByRole('link', { name: 'Install Slack' }).getAttribute('href')).toBe(
      '/app/team/slack',
    );
    expect(screen.getByRole('link', { name: 'Set up email' }).getAttribute('href')).toBe(
      '/app/connections/sources#email',
    );
    expect(screen.getByRole('link', { name: 'Open meetings' }).getAttribute('href')).toBe(
      '/app/meetings',
    );
    expect(screen.getByRole('link', { name: 'Create a webhook' }).getAttribute('href')).toBe(
      '/app/connections/developer#webhooks',
    );
    expect(screen.getByRole('link', { name: 'Open connections' }).getAttribute('href')).toBe(
      '/app/connections',
    );
  });

  it('routes signed-in visitors from a connector page to Connections', () => {
    const connector = findConnector('github');
    if (!connector) throw new Error('GitHub connector content is required');

    setPublicSessionCache({ status: 'signed-in' });
    render(<ConnectorPage connector={connector} />);

    for (const link of screen.getAllByRole('link', { name: 'Connect GitHub' })) {
      expect(link.getAttribute('href')).toBe('/app/connections');
    }
  });

  it.each(['slack', 'sentry'])('renders a light dark-mode logo tile for %s', async (slug) => {
    const html = renderToStaticMarkup(
      await connectorRoute.default({ params: Promise.resolve({ slug }) }),
    );

    expect(html).toContain('bg-white');
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
    expect(text).toContain('What Timeline keeps, and what stays in GitHub');
    expect(text).not.toMatch(/Last reviewed|Native integration|Capability truth/u);
    expect(html).not.toContain('<time');
    expect(html).not.toMatch(/font-mono[^>]*>06 native integrations/u);
    expect(html).not.toMatch(/font-mono[^>]*>Last reviewed/u);
    expect(html).toContain('Timeline captures');
    expect(html).toContain('GitHub remains');
    expect(html).toContain('What enters the Timeline');
    expect(html).toContain('Read capture limits, history coverage and recovery behaviour');
    expect(html).toContain('Questions, answered');
    expect(html).not.toContain('02 / Questions');
    expect(html).not.toContain('09 / Related');
    expect(text).toContain('10/Start');
    expect(html).toContain('bg-white');
    expect(html).toContain('PR #482');
    expect(html).toContain('application/ld+json');
  });

  it('generates static parameters and provider metadata from the manifest', async () => {
    expect(connectorRoute.generateStaticParams()).toHaveLength(11);
    expect(connectorRoute.dynamicParams).toBe(false);

    const github = await connectorRoute.generateMetadata({
      params: Promise.resolve({ slug: 'github' }),
    });
    expect(github.title).toBe('GitHub integration for cited release history');
    expect(github.alternates).toEqual({ canonical: '/integrations/github' });
    expect(github.robots).toBeUndefined();

    expect(metadata.alternates).toEqual({ canonical: '/integrations' });
    expect(metadata.title).toBe('Integrations and capture surfaces');

    const hubspot = await connectorRoute.generateMetadata({
      params: Promise.resolve({ slug: 'hubspot' }),
    });
    expect(hubspot.title).toBe('HubSpot and The Timeline');
    expect(hubspot.alternates).toEqual({ canonical: '/integrations/hubspot' });
  });

  it.each(WORKS_WITH_PAGE_TOOLS)('renders $route with honest status and guidance', async (tool) => {
    const html = renderToStaticMarkup(
      await connectorRoute.default({ params: Promise.resolve({ slug: tool.slug }) }),
    );
    const text = visibleText(html);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(`data-works-with-route="${tool.route}"`);
    expect(html).toContain(tool.title);
    expect(text).toContain(tool.statusLabel);
    expect(text).toContain('Just getting started? You may not need one yet');
    expect(text).toContain(`When ${tool.name} alone is the better pick`);
    expect(html).toContain('Start free');
  });

  it('keeps Google Drive on the native connector route without a works-with overlay', async () => {
    const html = renderToStaticMarkup(
      await connectorRoute.default({ params: Promise.resolve({ slug: 'google-drive' }) }),
    );
    const text = visibleText(html);
    const metadata = await connectorRoute.generateMetadata({
      params: Promise.resolve({ slug: 'google-drive' }),
    });

    expect(metadata.alternates).toEqual({ canonical: '/integrations/google-drive' });
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(text).toContain('Stay in Drive alone');
    expect(text).toContain('changes.watch');
    expect(text).toContain('remaining selections no longer cover it');
    expect(text).toContain('Pending suggested inserts');
    expect(text).not.toContain('When Google Drive alone is the better pick');
    expect(html).not.toContain('data-works-with-route');
  });

  it('extends the native Linear page with works-with guidance', async () => {
    const linear = findWorksWithTool('linear');
    if (!linear) throw new Error('Linear works-with content is required');

    const html = renderToStaticMarkup(
      await connectorRoute.default({ params: Promise.resolve({ slug: 'linear' }) }),
    );
    const text = visibleText(html);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(text).toContain('Just getting started? You may not need one yet');
    expect(text).toContain('When Linear alone is the better pick');
    expect(text).toContain(linear.gettingStarted);
  });
});
