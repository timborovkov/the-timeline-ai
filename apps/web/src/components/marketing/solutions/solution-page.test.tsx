import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SOLUTIONS } from '@/components/marketing/solutions/content';
import { SolutionPage } from '@/components/marketing/solutions/solution-page';

describe('solution page template', () => {
  it.each(SOLUTIONS)('renders $route as a substantive, answer-first page', (solution) => {
    const html = renderToStaticMarkup(<SolutionPage solution={solution} />);

    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(solution.title);
    expect(html).toContain('Start with the answer');
    expect(html).toContain('Turn selected work into a reviewable answer.');
    expect(html).toContain('Give each source one honest job.');
    expect(html).toContain('What this cannot prove.');
    expect(html).toContain('application/ld+json');
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain(`href="${solution.cta.href}"`);
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('Free to start · no card required');
    expect(html).toContain('motion-safe:group-hover:translate-x-1');

    for (const relatedRoute of solution.relatedRoutes) {
      expect(html).toContain(`href="${relatedRoute}"`);
    }
    for (const faq of solution.faqs) {
      expect(html).toContain(faq.question);
      expect(html).toContain(faq.answer);
    }

    expect(html).not.toMatch(/testimonial|customer data|updates itself/iu);
  });
});
