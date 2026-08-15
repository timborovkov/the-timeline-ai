import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import SentryIncidentGuidePage from '@/app/guides/connect-sentry-incidents-to-releases-discussions-and-fixes/page';
import SlackAndDriveGuidePage from '@/app/guides/search-slack-and-google-drive-together/page';
import WeeklyEngineeringUpdatesGuidePage from '@/app/guides/weekly-engineering-updates-from-slack-linear-and-github/page';
import HowItWorksPage from '@/app/how-it-works/page';
import {
  EDITORIAL_GUIDES,
  findEditorialGuideByRoute,
  GUIDE_ROUTES,
} from '@/components/marketing/editorial/content';
import { EditorialShell } from '@/components/marketing/editorial/editorial-shell';

const GUIDE_PAGES = [
  {
    guide: findEditorialGuideByRoute(GUIDE_ROUTES.slackAndDrive),
    Page: SlackAndDriveGuidePage,
  },
  {
    guide: findEditorialGuideByRoute(GUIDE_ROUTES.weeklyEngineeringUpdates),
    Page: WeeklyEngineeringUpdatesGuidePage,
  },
  {
    guide: findEditorialGuideByRoute(GUIDE_ROUTES.sentryReleaseIncidents),
    Page: SentryIncidentGuidePage,
  },
] as const;

describe('how-it-works and guide routes', () => {
  it('renders one plain-language how-it-works index without publication taxonomy', () => {
    const html = renderToStaticMarkup(<HowItWorksPage />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('From scattered work to a cited answer.');
    expect(html).toContain('data-how-it-works-hero="true"');
    expect(html).toContain('data-how-it-works-steps="true"');
    expect(html).toContain('data-how-it-works-evidence="true"');
    expect(html.indexOf('data-how-it-works-hero="true"')).toBeLessThan(
      html.indexOf('data-how-it-works-evidence="true"'),
    );
    expect(html.indexOf('data-how-it-works-steps="true"')).toBeLessThan(
      html.indexOf('data-how-it-works-evidence="true"'),
    );
    expect(html).toContain('max-w-[82rem]');
    expect(html).toContain('lg:grid-cols-[13rem_minmax(0,1fr)]');
    expect(html).toContain('xl:grid-cols-[15rem_minmax(0,1fr)]');
    expect(html).not.toContain('lg:grid-cols-[0.45fr_1fr]');
    expect(html).toContain('How Timeline works');
    expect(html).not.toContain('Last reviewed');
    expect(html).not.toContain('product overview');
    for (const label of ['Choose what enters', 'Preserve the chronology', 'Ask and inspect']) {
      expect(html).toMatch(new RegExp(`<h2[^>]*>${label}<\\/h2>`));
    }
    expect(html).toContain('Telegram, Slack, meetings, documents, tickets, code, and');
    expect(html).toContain('status, handoffs, commitments, and decisions slow to rebuild');
    expect(html).toContain('Teams keep using those tools');
    expect(html).toContain('data-how-it-works-trust="true"');
    expect(html).toContain('Connected does not mean cited.');
    expect(html).toContain('does not give Timeline its whole history by default');
    expect(html).toContain('People approve durable changes.');
    expect(html).toContain('waits for a person to approve, change, or reject it');
    expect(html).toMatch(
      /<h2[^>]*>The review date and owner are set; pricing is still unresolved\.<\/h2>/,
    );
    expect(html).toContain('Start with one project and one question.');
    expect(html).toContain('href="/sign-up"');
    expect(html).toContain('Try one real project');
    expect(html).toContain('Read the first walkthrough');
    expect(html).not.toContain('<video');
    expect(html).not.toMatch(/watch (?:the )?demo|interactive demo/iu);
    expect(html).not.toMatch(/href="(?:\/(?:app\/)?demo|\/workspace\/demo|https?:\/\/t\.me\/)/u);
    expect(html).not.toMatch(/Publication|Edition 00|Playbooks|Dossiers|field guide/u);
    for (const guide of EDITORIAL_GUIDES) {
      expect(html).toContain(`href="${guide.route}"`);
      expect(html).toContain(guide.title);
    }
  });

  it('keeps the old record URL as a permanent redirect only', () => {
    const legacyRoute = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

    expect(legacyRoute).toContain('permanentRedirect(HOW_IT_WORKS_ROUTE)');
    expect(legacyRoute).not.toContain('<main');
  });

  it('uses the shared tactile public canvas without decorative background motion', () => {
    const styles = readFileSync(
      new URL('../../components/public-site.module.css', import.meta.url),
      'utf8',
    );

    expect(styles).toMatch(/\.canvas::before\s*\{[^}]*fractalNoise/s);
    expect(styles).toMatch(/\.canvas::before\s*\{[^}]*mix-blend-mode:\s*multiply;/s);
    expect(styles).toMatch(
      /:global\(\.dark\) \.canvas::before\s*\{[^}]*mix-blend-mode:\s*normal;/s,
    );
    expect(styles).not.toMatch(/animation:/);
  });

  it.each(GUIDE_PAGES)(
    'renders $guide.route as a substantial answer-first article',
    ({ guide, Page }) => {
      const html = renderToStaticMarkup(<Page />);

      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(html).toContain(guide.title);
      expect(html).toContain('Start with the answer');
      expect(html).toContain('Build the answer step by step.');
      expect(html).toContain('See the evidence path');
      expect(html).toContain(`>${guide.diagram.answerTitle}</h3>`);
      expect(html).toContain('What each source contributes');
      expect(html).toContain('What this cannot prove');
      expect(html).toContain('Fictional Acme example, not customer data.');
      expect(html).toContain('Try this question');
      expect(html).toContain('Source roles');
      expect(html).not.toMatch(/Native \/|Prompt pattern|Source boundaries/u);
      expect(html).toContain('application/ld+json');
      expect(html).toContain('href="/sign-up"');
      expect(html).toContain('aria-label="Breadcrumb"');
      expect(html).not.toMatch(/Publication|Edition 00|field notes|field guide/u);
      for (const connector of guide.nativeConnectors) {
        const slug = connector
          .toLowerCase()
          .replace('google drive', 'google-drive')
          .replace('.com', '');
        expect(html).toContain(`href="/integrations/${slug}"`);
      }
      expect(html).not.toMatch(/\b(?:statistic|testimonial)\b/i);
    },
  );

  it('marks the publication navigation for index and guide contexts', () => {
    const recordShell = renderToStaticMarkup(
      <EditorialShell>
        <main id="main" />
      </EditorialShell>,
    );
    const guideShell = renderToStaticMarkup(
      <EditorialShell>
        <main id="main" />
      </EditorialShell>,
    );

    expect(recordShell).toContain('aria-label="Public navigation"');
    expect(guideShell).toContain('aria-label="Public navigation menu"');
    expect(recordShell).toContain('href="/integrations"');
    expect(guideShell).toContain('href="/help"');
    expect(recordShell).toContain('data-public-header="true"');
    expect(recordShell).toContain('How it works');
    expect(guideShell).toContain('>Try one project</a>');
    expect(guideShell).not.toMatch(
      /href="(?:\/(?:app\/)?demo|\/workspace\/demo|https?:\/\/t\.me\/)/u,
    );
    expect(recordShell.match(/aria-current="page"[^>]*href="\/how-it-works"/g)).not.toBeNull();
    expect(guideShell.match(/aria-current="page"[^>]*href="\/how-it-works"/g)).not.toBeNull();
    expect(recordShell).toContain('aria-label="Support and legal"');
    expect(recordShell).toContain('href="/help/support"');
    expect(recordShell).toContain('href="/terms"');
  });

  it('routes signed-in editorial readers directly to the dashboard', () => {
    const html = renderToStaticMarkup(
      <EditorialShell isSignedIn>
        <main id="main" />
      </EditorialShell>,
    );

    expect(html).toContain('href="/app"');
    expect(html).toContain('href="/app"');
    expect(html).toContain('Dashboard');
    expect(html).not.toContain('href="/sign-in"');
  });
});
