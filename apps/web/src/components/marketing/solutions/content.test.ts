import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  findSolution,
  findSolutionByRoute,
  SOLUTION_AUDIENCE_LINKS,
  SOLUTION_CANONICAL_ROUTES,
  SOLUTION_ROUTES,
  SOLUTIONS,
} from '@/components/marketing/solutions/content';

describe('solution content', () => {
  it('exports the remaining client-handoff route without adding a navigation taxonomy', () => {
    expect(SOLUTION_CANONICAL_ROUTES).toEqual(Object.values(SOLUTION_ROUTES));
    expect(SOLUTION_AUDIENCE_LINKS).toEqual(
      SOLUTIONS.map((solution) => ({
        label: solution.audienceLabel,
        title: solution.shortTitle,
        href: solution.route,
      })),
    );

    for (const solution of SOLUTIONS) {
      expect(findSolution(solution.slug)).toBe(solution);
      expect(findSolutionByRoute(solution.route)).toBe(solution);
    }
  });

  it('keeps the remaining solution page substantive and linked to use cases', () => {
    expect(SOLUTIONS).toHaveLength(1);
    expect(SOLUTIONS[0]?.slug).toBe('client-project-handoffs');

    for (const solution of SOLUTIONS) {
      expect(solution.workflow.length).toBeGreaterThanOrEqual(4);
      expect(solution.evidenceRoles.length).toBeGreaterThanOrEqual(3);
      expect(solution.questions.length).toBeGreaterThanOrEqual(4);
      expect(solution.limitations.length).toBeGreaterThanOrEqual(5);
      expect(solution.faqs.length).toBeGreaterThanOrEqual(3);
      expect(solution.related.map((item) => item.href)).toEqual(
        expect.arrayContaining([
          '/use-cases/onboarding-and-repeat-questions',
          '/use-cases/team-daily-log',
        ]),
      );
    }
  });

  it('states capture, evidence, and approval boundaries without automatic-update claims', () => {
    const copy = JSON.stringify(SOLUTIONS);

    expect(copy).toContain('selected');
    expect(copy).toContain('citations');
    expect(copy).toContain('a person approves them');
    expect(copy).not.toMatch(/updates itself|captures everything|always current|real[- ]time/iu);
  });

  it('keeps handoff code claims within the current Linear and GitHub connectors', () => {
    const handoff = findSolution('client-project-handoffs');
    if (!handoff) throw new Error('Client project handoff solution is missing');

    const handoffTasks = handoff.evidenceRoles.find((source) => source.label === 'Tasks and code');

    expect(handoffTasks?.includes).toContain(
      'GitHub pull requests, reviews, commits, workflow runs, and releases',
    );
    expect(handoffTasks?.boundary).toContain('does not by itself prove deployment');
  });
});
