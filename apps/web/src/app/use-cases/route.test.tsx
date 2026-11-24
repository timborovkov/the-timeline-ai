import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import UseCaseRoutePage from '@/app/use-cases/[slug]/page';
import UseCasesHubPage from '@/app/use-cases/page';
import { USE_CASES } from '@/components/marketing/use-cases/content';

describe('use-case routes', () => {
  it('renders the hub with five jobs grouped by the reader’s goal', () => {
    const html = renderToStaticMarkup(<UseCasesHubPage />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('Keep up with the work that matters.');
    expect(html).toContain('data-use-cases-hub');
    expect(html).not.toContain('data-record-jobs');
    expect(html).toContain('Understand what happened');
    expect(html).toContain('Keep work moving');
    expect(html).toContain('Share the context');
    expect(html).toContain('Start free');
    for (const useCase of USE_CASES) {
      expect(html).toContain(`href="${useCase.route}"`);
      expect(html).toContain(useCase.cardTitle);
    }
  });

  it.each(USE_CASES)(
    'renders $route with named screenshot slots and Start free',
    async (useCase) => {
      const html = renderToStaticMarkup(
        await UseCaseRoutePage({ params: Promise.resolve({ slug: useCase.slug }) }),
      );

      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(html).toContain(useCase.title);
      expect(html).toContain('Start free');
      expect(html).toContain('data-use-case-route');
      expect(html).not.toMatch(/WhatsApp|Slack Connect|Teams chat/iu);
      for (const shot of useCase.screenshots) {
        expect(html).toContain(`data-screenshot-file="${shot.file}"`);
        expect(html).toContain(`data-screenshot-present="true"`);
        expect(html).toContain(shot.file);
      }
      expect(html).not.toContain('Screenshot placeholder');
    },
  );

  it('keeps the daily log CTA compact and preserves digest callouts', async () => {
    const html = renderToStaticMarkup(
      await UseCaseRoutePage({ params: Promise.resolve({ slug: 'team-daily-log' }) }),
    );

    expect(html).not.toContain('data-first-run="full"');
    expect(html).toContain('data-screenshot-callouts');
    expect(html).toContain('What changed');
    expect(html).toContain('Open linked work');
    expect(html).toContain('Tasks and calendar items open from the digest.');
    expect(html).toContain('daily brief or weekly overview');
    expect(html).toContain('A workspace admin manages delivery');
    expect(html).not.toContain('Who owns the next step');
    expect(html).not.toContain('find captured sources in Timeline');
  });
});
