import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  PricingComparisonTable,
  PricingMetersExplainer,
  PricingPlanGrid,
} from '@/components/marketing/pricing-blocks';

describe('pricing blocks', () => {
  it('renders Free, PAYG, Team, Business, and Enterprise plans', () => {
    render(<PricingPlanGrid />);
    expect(screen.getByRole('heading', { name: 'Free' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Pay as you go' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Team' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Business' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Enterprise' })).toBeTruthy();
    expect(document.querySelector('[data-pricing-plan="payg"]')).toBeTruthy();
  });

  it('explains native meters without opaque credits', () => {
    render(<PricingMetersExplainer />);
    expect(screen.getByRole('heading', { name: 'AI' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Meetings' })).toBeTruthy();
    expect(screen.getByText(/provider token cost/i)).toBeTruthy();
  });

  it('compares platform fees across plans', () => {
    render(<PricingComparisonTable />);
    expect(screen.getByRole('columnheader', { name: 'Team' })).toBeTruthy();
    expect(screen.getAllByText('€49/mo').length).toBeGreaterThan(0);
  });
});
