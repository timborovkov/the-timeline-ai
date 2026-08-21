import { describe, expect, it } from 'vitest';

import {
  findSolution,
  findSolutionByRoute,
  SOLUTION_AUDIENCE_LINKS,
  SOLUTION_CANONICAL_ROUTES,
  SOLUTION_ROUTES,
  SOLUTIONS,
} from '@/components/marketing/solutions/content';

describe('solution content', () => {
  it('exports the three audience routes for reuse without adding a navigation taxonomy', () => {
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

  it('keeps every page substantive, distinct, and cross-linked to the other solutions', () => {
    expect(SOLUTIONS).toHaveLength(3);
    expect(new Set(SOLUTIONS.map((solution) => solution.seoTitle)).size).toBe(3);
    expect(new Set(SOLUTIONS.map((solution) => solution.summary)).size).toBe(3);

    for (const solution of SOLUTIONS) {
      expect(solution.workflow.length).toBeGreaterThanOrEqual(4);
      expect(solution.evidenceRoles.length).toBeGreaterThanOrEqual(3);
      expect(solution.questions.length).toBeGreaterThanOrEqual(4);
      expect(solution.limitations.length).toBeGreaterThanOrEqual(5);
      expect(solution.faqs.length).toBeGreaterThanOrEqual(3);
      expect(solution.relatedRoutes).toEqual(
        SOLUTION_CANONICAL_ROUTES.filter((route) => route !== solution.route),
      );
    }
  });

  it('states capture, evidence, and approval boundaries without automatic-update claims', () => {
    const copy = JSON.stringify(SOLUTIONS);

    expect(copy).toContain('selected');
    expect(copy).toContain('citations');
    expect(copy).toContain('human approval');
    expect(copy).toContain('does not promise a native CRM data sync');
    expect(copy).not.toMatch(/updates itself|captures everything|always current|real[- ]time/iu);
  });

  it('keeps weekly-update claims within the current Linear and GitHub connectors', () => {
    const weekly = findSolution('weekly-project-updates');
    const handoff = findSolution('client-project-handoffs');
    if (!weekly) throw new Error('Weekly project update solution is missing');
    if (!handoff) throw new Error('Client project handoff solution is missing');

    const linear = weekly.evidenceRoles.find((source) => source.label === 'Linear');
    const github = weekly.evidenceRoles.find((source) => source.label === 'GitHub');
    const handoffTasks = handoff.evidenceRoles.find((source) => source.label === 'Tasks and code');

    expect(weekly.answer.body).toContain('Linear teams');
    expect(weekly.answer.body).not.toContain('Linear teams or projects');
    expect(linear?.includes).toContain(
      'title, description, status, priority, assignee, and project association',
    );
    expect(linear?.includes).not.toMatch(/labels|cycles/iu);
    expect(linear?.boundary).toContain('Only teams are activated');
    expect(linear?.boundary).toContain('not selected as separate sources');
    expect(github?.includes).not.toContain('deployment records');
    expect(github?.includes).toContain(
      'Pull requests, reviews, commits, workflow runs, and releases',
    );
    expect(github?.includes).toContain('release tag names');
    expect(github?.boundary).toContain('they do not establish deployment');
    expect(github?.boundary).toMatch(/deployment and environment records are not ingested/iu);
    expect(handoffTasks?.includes).toContain(
      'GitHub pull requests, reviews, commits, workflow runs, and releases',
    );
    expect(handoffTasks?.boundary).toContain('does not by itself prove deployment');

    const shippedFaq = weekly.faqs.find((faq) => faq.question.includes('Linear issue'));
    expect(shippedFaq?.answer).toContain('Deployment needs explicit evidence');
    expect(shippedFaq?.answer).toContain('does not ingest deployments');
  });
});
