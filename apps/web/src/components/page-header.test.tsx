// @vitest-environment happy-dom

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageHeader } from '@/components/page-header';

describe('PageHeader', () => {
  it('renders the title as the only h1 in sentence case', () => {
    render(<PageHeader title="Team" />);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe('Team');
  });

  it('renders the subtitle below the title', () => {
    render(<PageHeader title="Sources" subtitle="Capture surfaces that feed the timeline." />);
    expect(screen.getByText('Capture surfaces that feed the timeline.')).toBeTruthy();
  });

  it('renders quiet metadata and only opts selected values into mono', () => {
    const { container } = render(
      <PageHeader
        title="Team"
        metadata={[
          { label: 'members', value: 5, mono: true },
          { label: 'role', value: 'admin', signal: true },
        ]}
      />,
    );
    const strip = container.querySelector('dl');
    expect(strip).not.toBeNull();
    expect(strip?.textContent).toContain('members');
    expect(strip?.textContent).toContain('5');
    expect(strip?.textContent).toContain('admin');
    expect(strip?.className).not.toContain('uppercase');
    expect(strip?.querySelector('dd')?.className).toContain('font-mono');
  });

  it('keeps metadata accessible when no alternate screen-reader summary is provided', () => {
    const { container } = render(
      <PageHeader
        title="Meeting"
        metadata={[
          { label: 'Status', value: 'Completed' },
          { label: 'Captured', value: 'Jul 1, 2026, 8:00 AM', mono: true },
        ]}
      />,
    );

    const definitions = within(container).getAllByRole('definition');
    expect(definitions).toHaveLength(2);
    expect(definitions[0]?.textContent).toBe('Completed');
  });

  it('hides the mono metadata from screen readers and exposes srLabel instead', () => {
    render(
      <PageHeader
        title="Team"
        srLabel="Team acme, your role admin, 5 members."
        metadata={[{ label: 'members', value: 5 }]}
      />,
    );
    expect(screen.getByText('Team acme, your role admin, 5 members.')).toBeTruthy();
  });

  it('renders leading navigation before the title and trailing actions after', () => {
    const { container } = render(
      <PageHeader
        title="Calendar"
        leading={<a href="/app/work">Back to Work</a>}
        trailing={<button type="button">New event</button>}
      />,
    );
    const header = container.querySelector('header');
    const headerText = header?.textContent ?? '';
    expect(headerText.indexOf('Back to Work')).toBeLessThan(headerText.indexOf('Calendar'));
    expect(headerText.indexOf('New event')).toBeGreaterThan(headerText.indexOf('Calendar'));
  });

  it('makes linked metadata a named 40px target', () => {
    const { container } = render(
      <PageHeader
        title="Work"
        metadata={[
          {
            label: 'Overdue',
            value: 2,
            href: '/app/tasks?due=overdue',
            ariaLabel: '2 overdue tasks',
          },
        ]}
      />,
    );

    const link = screen.getByRole('link', { name: '2 overdue tasks' });
    expect(link.getAttribute('href')).toBe('/app/tasks?due=overdue');
    expect(link.parentElement?.className).toContain('min-h-10');
    expect(link.parentElement?.className).toContain('min-w-10');
    expect(container.textContent).toContain('Overdue2');
  });
});
