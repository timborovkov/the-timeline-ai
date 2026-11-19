import { cleanup, fireEvent, render } from '@testing-library/react';
import { WEBSITE_SOURCE_UNITS_PER_PAGE } from '@timeline/shared/websites/usage';
import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PricingCalculator } from '@/components/marketing/pricing-calculator';
import { formatUnitAssumption } from '@/lib/pricing-calculator';

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
    expect(html).toContain('illustrations, not quotes');
    expect(html).toContain(formatUnitAssumption());
    expect(html).not.toContain('What this usage looks like');
    expect(html).not.toContain('Ask questions at');
    expect(html).not.toContain('/question');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).not.toMatch(/text-\[[0-9.]+(?:px|rem)\]/);
  });
  it('applies editable presets without repeating activity breakdown copy', () => {
    const view = render(<PricingCalculator />);
    expect(view.queryByText('What this usage looks like')).toBeNull();
    expect(view.container.textContent).toContain(
      `Website pages count as ${WEBSITE_SOURCE_UNITS_PER_PAGE} source units; each email message or recipient as 1.`,
    );
    expect(view.container.textContent).not.toMatch(/Ask questions at €/);
    fireEvent.click(view.getByRole('button', { name: /Slack-heavy engineering team/ }));
    expect((view.getByLabelText('Assumed AI usage') as HTMLInputElement).value).toBe('45');
    expect((view.getByLabelText('Active members') as HTMLInputElement).value).toBe('12');
    expect(
      view
        .getByRole('button', { name: /Slack-heavy engineering team/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.change(view.getByLabelText('Assumed AI usage'), { target: { value: '50' } });
    expect(
      view
        .getByRole('button', { name: /Slack-heavy engineering team/ })
        .getAttribute('aria-pressed'),
    ).toBe('false');
    expect((view.getByLabelText('Assumed AI usage') as HTMLInputElement).value).toBe('50');
    fireEvent.click(view.getByRole('button', { name: /Meeting-heavy delivery team/ }));
    expect((view.getByLabelText('Websites') as HTMLInputElement).value).toBe('1');
    expect((view.getByLabelText('Assumed AI usage') as HTMLInputElement).value).toBe('35');
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
    const enterpriseLink = view.getByRole('link', { name: 'Contact us about Enterprise' });
    expect(enterpriseLink.getAttribute('href')).toContain('/contact/enterprise?');
    expect(enterpriseLink.getAttribute('href')).toContain('from=pricing-calculator');
    expect(enterpriseLink.getAttribute('href')).toContain('members=501');
    expect(enterpriseLink.getAttribute('data-public-analytics-cta')).toBe('contact_enterprise');
    expect(view.queryByText('Lowest estimated cost')).toBeNull();
  });
});
