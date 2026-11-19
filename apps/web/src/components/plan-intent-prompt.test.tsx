import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import { PlanIntentPrompt } from '@/components/plan-intent-prompt';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('PlanIntentPrompt', () => {
  it('renders the finish-setup CTA and dismisses without granting a plan', () => {
    render(
      <PlanIntentPrompt
        teamId="team-1"
        planId="team"
        title="Finish setting up Acme Labs"
        body="Choose your Team plan when you’re ready."
        ctaLabel="Choose Team"
        href="/app/team?section=billing&plan=team#change-plan"
      />,
    );

    const prompt = screen.getByRole('complementary', { name: 'Finish setting up Acme Labs' });
    expect(prompt.getAttribute('data-plan-intent-prompt')).toBe('team');
    expect(screen.getByRole('link', { name: 'Choose Team' }).getAttribute('href')).toBe(
      '/app/team?section=billing&plan=team#change-plan',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('complementary', { name: 'Finish setting up Acme Labs' })).toBeNull();
    expect(localStorage.getItem('tl_plan_intent_dismissed:team-1:team')).toBe('dismissed');
  });
});
