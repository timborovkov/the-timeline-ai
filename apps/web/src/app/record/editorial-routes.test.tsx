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
  it('renders the publication index with one h1 and all content forms', () => {
    const html = renderToStaticMarkup(<RecordPage />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('The Record');
    expect(html).toMatch(/<h2[^>]*>The review date moved; pricing is still unresolved\.<\/h2>/);
    expect(html).toContain('a provisional public name');
    expect(html).toContain('Essays');
    expect(html).toContain('Playbooks');
    expect(html).toContain('Dossiers');
    expect(html).toContain('Product notes');
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
      expect(html).toContain('The direct answer');
      expect(html).toContain('Build the answer in inspectable stages.');
      expect(html).toContain('Provenance map');
      expect(html).toContain(`>${guide.diagram.answerTitle}</h3>`);
      expect(html).toContain('Source boundaries');
      expect(html).toContain('Limitations to keep visible');
      expect(html).toContain('Example / not customer data');
      expect(html).toContain('application/ld+json');
      expect(html).toContain('href="/sign-in"');
      expect(html).toContain('aria-label="Breadcrumb"');
      expect(html).not.toMatch(/\b(?:statistic|testimonial)\b/i);
    },
  );

  it('marks the publication navigation for index and guide contexts', () => {
    const recordShell = renderToStaticMarkup(
      <EditorialShell currentSection="record">
        <main id="main" />
      </EditorialShell>,
    );
    const guideShell = renderToStaticMarkup(
      <EditorialShell currentSection="guides">
        <main id="main" />
      </EditorialShell>,
    );

    expect(recordShell).toContain('aria-current="page"');
    expect(guideShell).toContain('aria-current="location"');
  });
});
