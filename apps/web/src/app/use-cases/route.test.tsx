import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import UseCaseRoutePage from '@/app/use-cases/[slug]/page';
import UseCasesHubPage from '@/app/use-cases/page';
import { USE_CASES } from '@/components/marketing/use-cases/content';

describe('use-case routes', () => {
  it('renders the hub with one heading and six job cards', () => {
    const html = renderToStaticMarkup(<UseCasesHubPage />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('One record. Six ways teams use it.');
    expect(html).toContain('data-use-cases-hub');
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
      expect(html).not.toMatch(/\bweekly\b/iu);
      for (const shot of useCase.screenshots) {
        expect(html).toContain(`data-screenshot-file="${shot.file}"`);
        expect(html).toContain(shot.file);
      }
    },
  );
});
