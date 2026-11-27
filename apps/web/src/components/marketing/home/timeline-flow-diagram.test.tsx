import { cleanup, render, screen, within } from '@testing-library/react';
import { expect } from '@timeline/test-support';
import { afterEach, describe, it } from 'bun:test';

import { TimelineFlowDiagram } from '@/components/marketing/home/timeline-flow-diagram';
// Test environment: happy-dom

// Guards the public explanation from regressing into decorative motion without a complete static story.

describe('TimelineFlowDiagram', () => {
  afterEach(cleanup);

  it('restores the compact observatory and keeps every packet on its visible path', () => {
    const { container } = render(<TimelineFlowDiagram variant="hero" />);

    const figure = screen.getByRole('figure');
    expect(figure.getAttribute('aria-label')).toBe(
      'Work events stream from nine sources into The Timeline, where the work record keeps decisions, promises and next steps connected to their sources.',
    );
    expect(within(figure).queryByText('The Timeline')).toBeNull();
    expect(within(figure).queryByText('Work record')).toBeNull();
    expect(within(figure).queryByText('one timeline')).toBeNull();
    expect(within(figure).getByText('What changed & what’s next')).toBeTruthy();
    expect(within(figure).getByText('Sources attached')).toBeTruthy();
    expect(within(figure).queryByText(/Fictional Acme example/i)).toBeNull();
    expect(within(figure).queryByText(/not used in this answer/i)).toBeNull();

    const sourceList = within(figure).getByRole('list', {
      name: 'Example sources entering The Timeline',
    });
    expect(within(sourceList).getAllByRole('listitem')).toHaveLength(9);
    for (const source of [
      'Telegram',
      'Slack',
      'Meeting',
      'GitHub',
      'Documents',
      'Sentry',
      'Email',
      'Google Drive',
      'Linear',
    ]) {
      expect(within(sourceList).getByText(source)).toBeTruthy();
    }

    expect(figure.querySelector('[data-hero-record-mesh]')).not.toBeNull();

    const ingestPaths = [...container.querySelectorAll('[data-hero-flow-path="ingest"]')].map(
      (path) => path.getAttribute('d'),
    );
    const ingestMotions = [
      ...container.querySelectorAll('[data-hero-flow-packet="ingest"] animateMotion'),
    ].map((motion) => motion.getAttribute('path'));
    expect(ingestPaths).toHaveLength(9);
    expect(ingestMotions).toEqual(ingestPaths);
    expect(within(figure).queryByText('Person')).toBeNull();
    expect(within(figure).queryByText('Claude / Codex')).toBeNull();
    expect(within(figure).queryByText('via MCP')).toBeNull();
    expect(container.querySelector('[data-hero-flow-path="write"]')).toBeNull();
    expect(container.querySelector('[data-hero-flow-path="read"]')).toBeNull();

    const outcomePath = container
      .querySelector('[data-hero-flow-path="outcome"]')
      ?.getAttribute('d');
    const outcomeMotion = container
      .querySelector('[data-hero-flow-packet="outcome"] animateMotion')
      ?.getAttribute('path');
    expect(outcomeMotion).toBe(outcomePath);
    expect(container.querySelectorAll('animateMotion')).toHaveLength(10);
    expect(container.querySelector('[data-flow-motion]')).not.toBeNull();
  });

  it('server-renders the complete evidence, history, workspace, and assistant loop', () => {
    const { container } = render(
      <TimelineFlowDiagram variant="expanded" id="test-platform-flow" />,
    );

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'How scattered work becomes useful context.',
      }),
    ).toBeTruthy();

    expect(screen.getByRole('heading', { level: 3, name: 'Connect' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Capture' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Connect related work' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Stay current and ask' })).toBeTruthy();

    const steps = [...container.querySelectorAll('[data-flow-step]')].map((step) =>
      step.getAttribute('data-flow-step'),
    );
    expect(steps).toEqual([
      'evidence',
      'connector-preserve',
      'timeline',
      'connector-organize',
      'workspace',
      'connector-assist',
      'assistant',
    ]);

    const evidenceSources = screen.getByRole('list', {
      name: 'Grouped Timeline evidence sources',
    });
    expect(within(evidenceSources).getAllByRole('listitem')).toHaveLength(3);
    expect(within(evidenceSources).getByText('Conversations')).toBeTruthy();
    expect(
      within(evidenceSources).getByText('Telegram groups · Slack channels · forwarded email'),
    ).toBeTruthy();
    expect(within(evidenceSources).getByText('Meetings & documents')).toBeTruthy();
    expect(
      within(evidenceSources).getByText('Optional call capture · Uploaded reference files'),
    ).toBeTruthy();
    expect(within(evidenceSources).getByText('Delivery & incidents')).toBeTruthy();
    expect(within(evidenceSources).getByText('GitHub changes · Sentry issues')).toBeTruthy();
    expect(within(evidenceSources).queryByText(/Linear/)).toBeNull();
    expect(
      screen.getByText('More sources are available through supported integrations and webhooks.'),
    ).toBeTruthy();

    const timelineHeading = screen.getByRole('heading', { name: 'Capture' });
    const timelineStage = timelineHeading.closest('article');
    if (!timelineStage) throw new Error('The timeline heading must belong to a stage');
    expect(within(timelineStage).getAllByRole('listitem')).toHaveLength(3);
    for (const eventId of ['[01]', '[02]', '[03]']) {
      expect(within(timelineStage).getByText(eventId)).toBeTruthy();
    }
    const timelineStamps = [...timelineStage.querySelectorAll('time')];
    expect(timelineStamps).toHaveLength(3);
    expect(timelineStamps.every((stamp) => stamp.hasAttribute('datetime'))).toBe(true);
    expect(within(timelineStage).getByText('Login page reported broken')).toBeTruthy();
    expect(within(timelineStage).getByText('Change linked to the login issue merges')).toBeTruthy();

    const workspaceRecords = screen.getByRole('list', {
      name: 'Example Timeline working context',
    });
    expect(within(workspaceRecords).getAllByRole('listitem')).toHaveLength(1);
    expect(within(workspaceRecords).getByText('Investigate the login issue')).toBeTruthy();
    expect(screen.getByText('Task boards · Customer context · Calendar · Files')).toBeTruthy();

    const assistantSurfaces = screen.getByRole('list', { name: 'Timeline assistant surfaces' });
    for (const surface of ['Web', 'Slack', 'Telegram', 'Own agent via MCP']) {
      expect(within(assistantSurfaces).getByText(surface)).toBeTruthy();
    }
    expect(
      screen.getByText('Compatible agent clients · Claude · Codex · Any MCP client'),
    ).toBeTruthy();
    expect(screen.getByText(/A linked change merged/)).toBeTruthy();
    expect(container.querySelectorAll('[data-flow-citation]')).toHaveLength(2);
    expect(screen.getByText('Sources stay attached.')).toBeTruthy();
    expect(
      screen.getByText('History records applied changes. Exceptions go to review.'),
    ).toBeTruthy();
    expect(screen.getByText('Enabled external tools have their own permissions.')).toBeTruthy();
    expect(container.querySelectorAll('[data-flow-packet]')).toHaveLength(5);
  });
});
