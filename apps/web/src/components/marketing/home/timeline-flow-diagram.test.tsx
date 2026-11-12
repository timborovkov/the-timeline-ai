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
      'A person and an agent write into the work record and read context back. Six sources stream in. The record becomes a daily update and linked answers.',
    );
    expect(within(figure).getByText('The Timeline')).toBeTruthy();
    expect(within(figure).getByText('Work record')).toBeTruthy();
    expect(within(figure).getByText('one timeline')).toBeTruthy();
    expect(within(figure).getByText('Daily update')).toBeTruthy();
    expect(within(figure).getByText('Linked answers')).toBeTruthy();
    expect(within(figure).queryByText(/Fictional Acme example/i)).toBeNull();
    expect(within(figure).queryByText(/not used in this answer/i)).toBeNull();

    const sourceList = within(figure).getByRole('list', {
      name: 'Example sources entering The Timeline',
    });
    expect(within(sourceList).getAllByRole('listitem')).toHaveLength(6);
    for (const source of ['Telegram', 'Slack', 'Meeting', 'GitHub', 'Documents', 'Sentry']) {
      expect(within(sourceList).getByText(source)).toBeTruthy();
    }

    const mark = figure.querySelector('svg[viewBox="0 0 48 48"]');
    expect(mark).not.toBeNull();
    expect(mark?.getAttribute('aria-hidden')).toBe('true');

    const ingestPaths = [...container.querySelectorAll('[data-hero-flow-path="ingest"]')].map(
      (path) => path.getAttribute('d'),
    );
    const ingestMotions = [
      ...container.querySelectorAll('[data-hero-flow-packet="ingest"] animateMotion'),
    ].map((motion) => motion.getAttribute('path'));
    expect(ingestPaths).toHaveLength(6);
    expect(ingestMotions).toEqual(ingestPaths);
    expect(within(figure).getByText('Person')).toBeTruthy();
    expect(within(figure).getByText('Claude / Codex')).toBeTruthy();
    expect(within(figure).getByText('via MCP')).toBeTruthy();

    const writePaths = [...container.querySelectorAll('[data-hero-flow-path="write"]')].map(
      (path) => path.getAttribute('d'),
    );
    const writeMotions = [
      ...container.querySelectorAll('[data-hero-flow-packet="write"] animateMotion'),
    ].map((motion) => motion.getAttribute('path'));
    const readPaths = [...container.querySelectorAll('[data-hero-flow-path="read"]')].map((path) =>
      path.getAttribute('d'),
    );
    const readMotions = [
      ...container.querySelectorAll('[data-hero-flow-packet="read"] animateMotion'),
    ].map((motion) => motion.getAttribute('path'));
    expect(writePaths).toHaveLength(2);
    expect(readPaths).toHaveLength(2);
    expect(writeMotions).toEqual(writePaths);
    expect(readMotions).toEqual(readPaths);

    const outcomePath = container
      .querySelector('[data-hero-flow-path="outcome"]')
      ?.getAttribute('d');
    const outcomeMotion = container
      .querySelector('[data-hero-flow-packet="outcome"] animateMotion')
      ?.getAttribute('path');
    expect(outcomeMotion).toBe(outcomePath);
    expect(container.querySelectorAll('animateMotion')).toHaveLength(11);
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
    expect(screen.getByRole('heading', { level: 3, name: 'Approve' })).toBeTruthy();
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
      within(evidenceSources).getByText('Launch review · Document Drive baseline'),
    ).toBeTruthy();
    expect(within(evidenceSources).getByText('Delivery & incidents')).toBeTruthy();
    expect(within(evidenceSources).getByText('GitHub changes · Sentry issues')).toBeTruthy();
    expect(within(evidenceSources).queryByText(/Linear/)).toBeNull();
    expect(screen.getByText('+ Any source via a pre-built integration or webhook')).toBeTruthy();

    const timelineHeading = screen.getByRole('heading', { name: 'Capture' });
    const timelineStage = timelineHeading.closest('article');
    if (!timelineStage) throw new Error('The timeline heading must belong to a stage');
    expect(within(timelineStage).getAllByRole('listitem')).toHaveLength(5);
    for (const eventId of ['[01]', '[03]', '[04]', '[06]', '[07]']) {
      expect(within(timelineStage).getByText(eventId)).toBeTruthy();
    }
    const timelineStamps = [...timelineStage.querySelectorAll('time')];
    expect(timelineStamps).toHaveLength(5);
    expect(timelineStamps.every((stamp) => stamp.hasAttribute('datetime'))).toBe(true);
    expect(within(timelineStage).getByText('Staged rollout plan added')).toBeTruthy();
    expect(within(timelineStage).getByText('Login issue regressed in staging')).toBeTruthy();

    const workspaceRecords = screen.getByRole('list', {
      name: 'Example Timeline working context',
    });
    expect(within(workspaceRecords).getAllByRole('listitem')).toHaveLength(4);
    for (const type of ['Project', 'Task', 'CRM', 'Decision']) {
      expect(within(workspaceRecords).getByText(type, { selector: 'span' })).toBeTruthy();
    }
    expect(
      screen.getByText('CRM · Task boards · Issue tracking · Calendar · Document Drive'),
    ).toBeTruthy();

    const assistantSurfaces = screen.getByRole('list', { name: 'Timeline assistant surfaces' });
    for (const surface of ['Web', 'Slack', 'Telegram', 'Own agent via MCP']) {
      expect(within(assistantSurfaces).getByText(surface)).toBeTruthy();
    }
    expect(screen.getByText('Live CRM via MCP · Claude · Codex · Any MCP client')).toBeTruthy();
    expect(screen.getByText(/SSO still blocks launch/)).toBeTruthy();
    expect(container.querySelectorAll('[data-flow-citation]')).toHaveLength(3);
    expect(screen.getByText('Sources stay attached.')).toBeTruthy();
    expect(screen.getByText('Timeline record changes need approval.')).toBeTruthy();
    expect(
      screen.getByText('Enabled MCP tools can read or update connected systems such as your CRM.'),
    ).toBeTruthy();
    expect(container.querySelectorAll('[data-flow-packet]')).toHaveLength(5);
  });
});
