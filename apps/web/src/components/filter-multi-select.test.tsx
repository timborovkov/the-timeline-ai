// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FilterMultiSelect } from '@/components/filter-multi-select';

const options = [
  { value: 'engineering', label: 'Engineering' },
  { value: 'research', label: 'Research' },
];

afterEach(cleanup);

describe('FilterMultiSelect', () => {
  it('describes the current selection from its closed trigger', async () => {
    const user = userEvent.setup();
    render(<FilterMultiSelect label="Source" options={options} placeholder="All sources" />);

    const trigger = screen.getByRole('button', { name: 'Source' });
    const descriptionId = trigger.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId ?? '')?.textContent).toBe(
      'No selection. All sources.',
    );

    await user.click(trigger);
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Engineering' }));

    expect(document.getElementById(descriptionId ?? '')?.textContent).toBe(
      'Selected: Engineering.',
    );
  });

  it('keeps its trigger at the shared 36px control size with a forced-colors focus indicator', () => {
    render(<FilterMultiSelect label="Source" options={options} placeholder="All sources" />);

    const trigger = screen.getByRole('button', { name: 'Source' });
    expect(trigger.className).toContain('h-9');
    expect(trigger.className).toContain('forced-colors:focus-visible:outline');
    expect(trigger.className).toContain('forced-colors:focus-visible:outline-2');
  });

  it('moves from the searchable filter input into full-size keyboard-operable options', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <FilterMultiSelect
        label="Source"
        options={options}
        placeholder="All sources"
        onValueChange={onValueChange}
        search={{
          value: '',
          onValueChange: vi.fn(),
          placeholder: 'Search sources',
          ariaLabel: 'Search sources',
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Source' }));

    expect(screen.getByRole('dialog', { name: 'Source filter' })).toBeTruthy();
    const search = screen.getByRole('searchbox', { name: 'Search sources' });
    expect(search.className).toContain('h-9');
    expect(search.className).toContain('text-base');
    expect(search.className).toContain('forced-colors:focus-visible:outline-2');

    await user.keyboard('{ArrowDown}');

    const clear = screen.getByRole('button', { name: 'All sources' });
    expect(document.activeElement).toBe(clear);
    expect(clear.className).toContain('min-h-9');
    expect(clear.className).toContain('forced-colors:focus-visible:outline');

    await user.keyboard('{ArrowDown}');
    const engineering = screen.getByRole('button', { name: 'Engineering' });
    expect(document.activeElement).toBe(engineering);
    expect(engineering.className).toContain('min-h-9');
    expect(engineering.className).toContain('forced-colors:focus-visible:outline-2');

    await user.keyboard('{Enter}');
    expect(onValueChange).toHaveBeenCalledWith('engineering');
    expect(engineering.getAttribute('aria-pressed')).toBe('true');
  });
});
