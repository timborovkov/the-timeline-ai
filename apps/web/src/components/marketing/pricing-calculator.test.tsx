import { cleanup, fireEvent, render } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PricingCalculator } from '@/components/marketing/pricing-calculator';
import { CALCULATOR_ACTIVITY_ASSUMPTIONS } from '@/lib/pricing-calculator';

afterEach(cleanup);
describe('pricing calculator', () => {
  it('server renders the example and closed advanced usage', () => {
    const html = renderToStaticMarkup(<PricingCalculator />);
    expect(html).toContain('€40.18');
    expect(html).toContain('2,000 accepted sources');
    expect(html).toContain('Example starting points');
    expect(html).toContain('Five-person client team');
    expect(html).toContain('Slack-heavy engineering team');
    expect(html).toContain('Meeting-heavy delivery team');
    expect(html).toContain('example, not a quote');
    expect(html).toContain('Ask questions');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).not.toMatch(/text-\[[0-9.]+(?:px|rem)\]/);
  });
  it('applies editable presets and keeps activity translations catalog-backed', () => {
    const view = render(<PricingCalculator />);
    expect(view.getByText('What this usage looks like')).toBeTruthy();
    expect(view.container.textContent).toContain('Ask questions at €0.04 each');
    expect(CALCULATOR_ACTIVITY_ASSUMPTIONS.illustrativeAskTurnCustomerCents).toBe(4);
    expect(view.container.textContent).toContain('800 chat messages');
    fireEvent.click(view.getByRole('button', { name: /Slack-heavy engineering team/ }));
    expect((view.getByLabelText('Assumed AI usage') as HTMLInputElement).value).toBe('45');
    expect((view.getByLabelText('Active members') as HTMLInputElement).value).toBe('12');
    expect(view.container.textContent).toContain('22,000 chat messages');
    expect(view.container.textContent).toContain('example, not a quote');
    fireEvent.change(view.getByLabelText('Assumed AI usage'), { target: { value: '50' } });
    expect(
      view
        .getByRole('button', { name: /Slack-heavy engineering team/ })
        .getAttribute('aria-pressed'),
    ).toBe('false');
    expect((view.getByLabelText('Assumed AI usage') as HTMLInputElement).value).toBe('50');
    fireEvent.click(view.getByRole('button', { name: /Meeting-heavy delivery team/ }));
    expect(view.container.textContent).toContain('25 pages');
    expect(view.container.textContent).toContain('500 source units');
    expect((view.getByLabelText('Websites') as HTMLInputElement).value).toBe('1');
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
    expect(view.getByRole('heading', { name: 'Pay as you go breakdown' })).toBeTruthy();
    expect(
      view.getByRole('button', { name: /Five-person client team/ }).getAttribute('aria-pressed'),
    ).toBe('true');
  });
  it('includes optional website usage once and resets it with the example', () => {
    const view = render(<PricingCalculator />);
    const websites = view.getByLabelText('Websites');
    fireEvent.change(websites, { target: { value: '3' } });
    fireEvent.change(view.getByLabelText('Scan frequency'), { target: { value: 'daily' } });
    expect(view.container.textContent).toContain('450 pages / month');
    expect(view.container.textContent).toContain('9,000 source units');
    expect(view.container.textContent).toContain('€44.68');
    expect(view.queryByLabelText('Scans / month')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Reset example' }));
    expect((websites as HTMLInputElement).value).toBe('0');
    expect(view.container.textContent).toContain('€40.18');
    expect(view.container.textContent).not.toContain('9,000 source units');
  });
  it('resets the selected plan and keeps the mobile estimate in sync', () => {
    const view = render(<PricingCalculator />);
    fireEvent.click(view.getByRole('radio', { name: 'Team' }));
    expect(view.getByText('Team estimate')).toBeTruthy();
    fireEvent.change(view.getByLabelText('Active members'), { target: { value: '' } });
    expect(view.getByText('Check your usage fields to see an estimate.')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Reset example' }));
    expect((view.getByRole('radio', { name: 'Pay as you go' }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(view.getByText('Pay as you go estimate')).toBeTruthy();
    expect((view.getByLabelText('Active members') as HTMLInputElement).value).toBe('5');
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
