import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import SentryIncidentGuidePage from '@/app/guides/connect-sentry-incidents-to-releases-discussions-and-fixes/page';
import SlackAndDriveGuidePage from '@/app/guides/search-slack-and-google-drive-together/page';
import WeeklyEngineeringUpdatesGuidePage from '@/app/guides/weekly-engineering-updates-from-slack-linear-and-github/page';
import RecordPage from '@/app/record/page';
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

describe('editorial routes', () => {
  it('renders one plain-language how-it-works index without publication taxonomy', () => {
    const html = renderToStaticMarkup(<RecordPage />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('How Timeline turns scattered work into a cited answer.');
    expect(html).toMatch(
      /<h2[^>]*>The review date and owner are set; pricing is still unresolved\.<\/h2>/,
    );
    expect(html).toContain('Start with the answer');
    expect(html).not.toMatch(/Publication|Edition 00|Playbooks|Dossiers|field guide/u);
    for (const guide of EDITORIAL_GUIDES) {
      expect(html).toContain(`href="${guide.route}"`);
      expect(html).toContain(guide.title);
    }
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
      expect(html).toContain('Illustrative example / not customer data');
      expect(html).toContain('application/ld+json');
      expect(html).toContain('href="/sign-in"');
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
    expect(recordShell.match(/aria-current="page"[^>]*href="\/record"/g)).not.toBeNull();
    expect(guideShell.match(/aria-current="page"[^>]*href="\/record"/g)).not.toBeNull();
  });

  it('routes signed-in editorial readers directly to the dashboard', () => {
    const html = renderToStaticMarkup(
      <EditorialShell isSignedIn>
        <main id="main" />
      </EditorialShell>,
    );

    expect(html).toContain('href="/app"');
    expect(html.match(/href="\/app"/g)).toHaveLength(2);
    expect(html).toContain('Dashboard');
    expect(html).not.toContain('href="/sign-in"');
  });
});
