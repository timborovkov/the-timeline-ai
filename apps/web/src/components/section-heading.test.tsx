// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SectionHeading, SettingsSection } from '@/components/section-heading';

describe('SectionHeading', () => {
  it('renders the title as an h2 in sentence case', () => {
    render(<SectionHeading>Quick actions</SectionHeading>);
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe('Quick actions');
    expect(headings[0]?.className).toContain('text-base');
  });

  it('renders right-aligned actions when provided', () => {
    render(
      <SectionHeading actions={<a href="/app/timeline">Open timeline</a>}>
        Recent moments
      </SectionHeading>,
    );
    expect(screen.getByRole('link', { name: 'Open timeline' })).toBeTruthy();
    expect(screen.getByText('Recent moments')).toBeTruthy();
  });

  it('does not render an actions slot when omitted', () => {
    const { container } = render(<SectionHeading>Native integrations</SectionHeading>);
    expect(container.querySelector('h2')?.textContent).toBe('Native integrations');
  });
});

describe('SettingsSection', () => {
  it('renders a sentence-case section heading without a nested card', () => {
    const { container } = render(
      <SettingsSection title="Team identity">
        <p>Rename this team</p>
      </SettingsSection>,
    );
    expect(screen.getByRole('heading', { name: 'Team identity', level: 2 })).toBeTruthy();
    expect(container.querySelector('[class*="rounded-md border"]')).toBeNull();
    expect(screen.getByText('Rename this team')).toBeTruthy();
  });
});
