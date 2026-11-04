import { cleanup, fireEvent, render } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PricingCalculator } from '@/components/marketing/pricing-calculator';

afterEach(cleanup);
describe('pricing calculator', () => {
  it('server renders the example and closed advanced usage', () => {
    const html = renderToStaticMarkup(<PricingCalculator />);
    expect(html).toContain('€37.18');
    expect(html).toContain('2,000 accepted sources');
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });
  it('keeps exact fields and sliders synchronized without truncating larger values', () => {
    const view = render(<PricingCalculator />);
    const ai = view.getByLabelText('Assumed AI usage') as HTMLInputElement;
    const slider = view.getByLabelText('Assumed AI usage slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '30' } });
    expect(ai.value).toBe('30');
    fireEvent.change(ai, { target: { value: '650.25' } });
    expect(slider.value).toBe('500');
    expect(ai.value).toBe('650.25');
    fireEvent.click(view.getByRole('radio', { name: 'Team' }));
    fireEvent.change(ai, { target: { value: '40' } });
    expect(view.getByRole('heading', { name: 'Team breakdown' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Reset example' }));
    expect(ai.value).toBe('20');
    expect(view.getByRole('heading', { name: 'Team breakdown' })).toBeTruthy();
  });
  it('shows zero credit without a negative-zero amount', () => {
    const view = render(<PricingCalculator />);
    for (const label of [
      'Assumed AI usage',
      'Meeting hours',
      'Email units',
      'Storage',
      'Accepted sources',
    ]) {
      fireEvent.change(view.getByLabelText(label), { target: { value: '0' } });
    }
    fireEvent.click(view.getByRole('radio', { name: 'Team' }));
    expect(view.container.textContent).not.toContain('-€0');
  });

  it('suspends totals until invalid fields are corrected and flags capacity', () => {
    const view = render(<PricingCalculator />);
    const members = view.getByLabelText('Active members');
    fireEvent.change(members, { target: { value: '' } });
    expect(view.getByRole('status').textContent).toContain('Complete all usage fields');
    expect(members.getAttribute('aria-invalid')).toBe('true');
    expect(view.queryByText('PAYG breakdown')).toBeNull();
    fireEvent.change(members, { target: { value: '501' } });
    expect(view.getByRole('link', { name: 'Contact sales' })).toBeTruthy();
    expect(view.queryByText('Lowest estimated cost')).toBeNull();
  });
});
