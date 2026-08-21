import { describe, expect, it } from 'vitest';

import { renderMessage } from '#src/messaging/templates.js';

describe('messaging templates', () => {
  it('renders invite HTML and text with escaped user content', () => {
    const message = renderMessage('team_invite', {
      to: 'new@example.test',
      inviterName: 'Tim <script>',
      teamName: 'Audit & AI',
      role: 'member',
      inviteUrl: 'https://timeline.test/accept',
      expiresAt: new Date('2026-06-20T00:00:00Z'),
    });

    expect(message.subject).toBe("You're invited to join Audit & AI on The Timeline");
    expect(message.textBody).toContain('https://timeline.test/accept');
    expect(message.htmlBody).toContain('Tim &lt;script&gt;');
    expect(message.htmlBody).toContain('Audit &amp; AI');
    expect(message.htmlBody).not.toContain('Tim <script>');
  });

  it('renders the daily digest from the stored payload shape', () => {
    const message = renderMessage('daily_digest', {
      to: 'tim@example.test',
      digestUrl: 'https://timeline.test/app',
      payload: {
        teamName: 'AuditAI',
        userName: 'Tim',
        timezone: 'Europe/Helsinki',
        windowStart: '2026-06-13T08:00:00.000Z',
        windowEnd: '2026-06-14T08:00:00.000Z',
        summary: 'Slack produced new follow-ups and one calendar item moved.',
        sections: [
          {
            title: 'Follow-ups',
            body: 'Send the pilot recap before the next planning review.',
            items: [],
          },
          {
            title: 'Highlights',
            body: 'The team kept the pilot recap moving after new Slack follow-ups arrived.',
            items: [],
          },
          {
            title: 'Status',
            body: 'The pilot invite flow is close to launch.',
            items: [],
          },
          {
            title: 'Completed',
            body: 'The lock feature was removed from incomplete-step progression.',
            items: [],
          },
          {
            title: 'In progress',
            body: 'An automated testing agent is being created.',
            items: [],
          },
          {
            title: 'Decisions',
            body: 'Launch timing still needs a decision.',
            items: [],
          },
        ],
        pendingApprovals: 4,
        eventCount: 12,
        momentCount: 5,
        activity: {
          newMoments: 5,
          newProposals: 2,
          pendingApprovals: 4,
          newTasks: 1,
          completedTasks: 0,
          newProjects: 0,
          newObjectsByType: { task: 1 },
        },
        sourceDistribution: { slack: 8, calendar: 4 },
        objectChangesByType: { task: 3 },
        newTeamMembers: [],
        tasks: [
          {
            id: 'task-id',
            title: 'Send pilot recap',
            status: 'todo',
            dueAt: '2026-06-16T21:30:00.000Z',
            href: '/app/objects/task-id',
          },
        ],
        newObjects: [
          {
            id: 'person-id',
            title: 'Ada Lovelace',
            type: 'person',
            href: '/app/objects/person-id',
          },
        ],
        windowCalendar: [
          {
            id: 'standup-id',
            title: 'Morning standup',
            startAt: '2026-06-14T07:00:00.000Z',
            endAt: '2026-06-14T07:15:00.000Z',
            href: '/app/calendar?view=day&date=2026-06-14&event=standup-id',
          },
        ],
        upcomingCalendar: [
          {
            id: 'calendar-id',
            title: 'Pilot planning',
            startAt: '2026-06-17T14:00:00.000Z',
            endAt: '2026-06-17T15:00:00.000Z',
            href: '/app/calendar',
          },
        ],
        links: [{ label: 'Dashboard', href: '/app' }],
      },
    });

    expect(message.subject).toBe('Daily digest for AuditAI');
    expect(message.textBody).toMatch(/^Daily digest for AuditAI\nJun 14, 2026/);
    expect(message.textBody).toContain('Covering');
    expect(message.textBody.indexOf('Open on the dashboard:')).toBeLessThan(
      message.textBody.indexOf('Covering'),
    );
    expect(message.textBody).toContain('Activity');
    expect(message.textBody).not.toContain('Activity over the past day');
    expect(message.textBody).toContain('5 new moments');
    expect(message.textBody).toContain('2 new proposals');
    expect(message.textBody).toContain('4 pending approvals');
    expect(message.textBody).toContain('1 new task');
    expect(message.textBody).not.toContain('from 12 source events');
    expect(message.textBody).toContain(
      'Highlights\nThe team kept the pilot recap moving after new Slack follow-ups arrived.',
    );
    expect(message.textBody).toContain('Status\nThe pilot invite flow is close to launch.');
    expect(message.textBody).toContain(
      'Completed\nThe lock feature was removed from incomplete-step progression.',
    );
    expect(message.textBody).toContain('In progress\nAn automated testing agent is being created.');
    expect(message.textBody).toContain('Decisions\nLaunch timing still needs a decision.');
    expect(message.textBody).toContain('New tasks:');
    expect(message.textBody).toContain('New objects:');
    expect(message.textBody).toContain('Ada Lovelace (person)');
    expect(message.textBody).toContain('https://timeline.test/app/objects/person-id');
    expect(message.textBody).toContain('Calendar this window:');
    expect(message.textBody).toContain('Morning standup');
    expect(message.textBody).toContain(
      'https://timeline.test/app/calendar?view=day&date=2026-06-14&event=standup-id',
    );
    expect(message.textBody).not.toContain('Sources in this window');
    expect(message.textBody).toContain('Send pilot recap (todo, Due soon · Jun 17, 2026)');
    expect(message.textBody).toContain('https://timeline.test/app/objects/task-id');
    expect(message.textBody).toContain('https://timeline.test/app/calendar');
    expect(message.textBody).toContain('Open on the dashboard:');
    expect(message.textBody).toContain('Dashboard: https://timeline.test/app');
    expect(message.textBody.indexOf('Status')).toBeLessThan(message.textBody.indexOf('Completed'));
    expect(message.textBody.indexOf('Completed')).toBeLessThan(
      message.textBody.indexOf('In progress'),
    );
    expect(message.textBody).toContain('Pilot planning (Jun 17, 2026');
    expect(message.textBody).not.toContain('2026-06-17T14:00:00.000Z');
    expect(message.htmlBody).toContain('Highlights');
    expect(message.htmlBody).toContain('Send the pilot recap before the next planning review.');
    expect(message.htmlBody).toContain('href="https://timeline.test/app/objects/person-id"');
    expect(message.htmlBody).toContain('Ada Lovelace');
    expect(message.htmlBody).toContain(
      'href="https://timeline.test/app/calendar?view=day&amp;date=2026-06-14&amp;event=standup-id"',
    );
    expect(message.htmlBody).toContain('Send pilot recap');
    expect(message.htmlBody).toContain('(todo, Due soon · Jun 17, 2026)');
    expect(message.htmlBody).toContain(
      '<a href="https://timeline.test/app/objects/task-id" style="color: #68a500; text-decoration: underline;">Send pilot recap</a> (todo, Due soon · Jun 17, 2026)',
    );
    expect(message.htmlBody).not.toContain('text-decoration-color');
    expect(message.htmlBody).not.toContain('letter-spacing: 0.02em');
    expect(message.htmlBody).not.toContain('color: #171717; font-weight: 600');
    expect(message.htmlBody).toContain('<ul style="font-size: 14px; line-height: 1.55;');
    expect(message.htmlBody).toContain('href="https://timeline.test/app/calendar"');
    expect(message.htmlBody).toContain('href="https://timeline.test/app"');
    expect(message.htmlBody).toContain('Open on the dashboard:');
    expect(message.htmlBody).toContain(
      '<p style="font-size: 14px; margin: 0 0 16px">Jun 14, 2026</p>',
    );
    expect(message.htmlBody).toContain('Covering');
    expect(message.htmlBody.indexOf('Open on the dashboard:')).toBeLessThan(
      message.htmlBody.indexOf('Covering'),
    );
    expect(message.htmlBody).toContain('5 new moments');
    expect(message.htmlBody).toContain('Activity');
    expect(message.htmlBody).not.toContain('Activity over the past day');
    expect(message.htmlBody).not.toContain('Digest date:');
    expect(message.htmlBody).not.toContain('from 12 source events');
    expect(message.htmlBody).toContain(
      'The team kept the pilot recap moving after new Slack follow-ups arrived.',
    );
    expect(message.htmlBody).toContain('<meta charset="utf-8" />');
    expect(message.htmlBody).toContain('Open this digest');
  });

  it('renders older daily digest payloads without structured sections', () => {
    const message = renderMessage('daily_digest', {
      to: 'tim@example.test',
      digestUrl: 'https://timeline.test/app',
      payload: {
        teamName: 'AuditAI',
        userName: 'Tim',
        timezone: 'Europe/Helsinki',
        windowStart: '2026-06-13T08:00:00.000Z',
        windowEnd: '2026-06-14T08:00:00.000Z',
        summary: 'Older digest payload without structured sections.',
        pendingApprovals: 0,
        eventCount: 1,
        sourceDistribution: {},
        objectChangesByType: {},
        newTeamMembers: [],
        tasks: [],
        upcomingCalendar: [],
        links: [{ label: 'Dashboard', href: '/app' }],
      },
    });

    expect(message.textBody).toContain('Older digest payload without structured sections.');
    expect(message.htmlBody).toContain('Older digest payload without structured sections.');
    expect(message.htmlBody).toContain('Open this digest');
  });

  it('renders email verification with the verification CTA in text and HTML', () => {
    const message = renderMessage('email_verification', {
      to: 'tim@example.test',
      verificationUrl: 'https://timeline.test/verify-email/token?email=tim%40example.test',
      expiresAt: new Date('2026-06-15T12:00:00Z'),
    });

    expect(message.subject).toBe('Verify your email for The Timeline');
    expect(message.textBody).toContain('https://timeline.test/verify-email/token');
    expect(message.htmlBody).toContain('Verify email');
    expect(message.metadata).toMatchObject({ message_intent: 'email_verification' });
  });

  it('renders connection attention without exposing raw HTML', () => {
    const message = renderMessage('connection_attention', {
      to: 'owner@example.test',
      teamName: 'Audit & AI',
      summary: 'Reconnect GitHub <now>',
      actionUrl: 'https://timeline.test/app/team/integrations',
    });

    expect(message.subject).toBe('Timeline integration needs attention for Audit & AI');
    expect(message.textBody).toContain('Open integrations: https://timeline.test/app/team');
    expect(message.htmlBody).toContain('Reconnect GitHub &lt;now&gt;');
    expect(message.htmlBody).not.toContain('Reconnect GitHub <now>');
    expect(message.metadata).toMatchObject({ message_intent: 'connection_attention' });
  });

  it('renders billing usage alerts with escaped detail and threshold metadata', () => {
    const message = renderMessage('billing_usage_alert', {
      to: 'owner@example.test',
      ownerName: 'Alex <ops>',
      teamName: 'Acme & Co',
      kind: 'spend_cap_90',
      periodYm: '2026-08',
      planName: 'Pay as you go',
      detailLine: 'Metered this period: €90 of €100.',
      usageUrl: 'https://timeline.test/app/usage',
      billingUrl: 'https://timeline.test/app/team?section=billing',
    });

    expect(message.subject).toBe('Acme & Co: 90% of spend cap used');
    expect(message.textBody).toContain('Hi Alex <ops>,');
    expect(message.textBody).toContain(
      'Manage billing: https://timeline.test/app/team?section=billing',
    );
    expect(message.htmlBody).toContain('Hi Alex &lt;ops&gt;,');
    expect(message.htmlBody).toContain('Acme &amp; Co');
    expect(message.htmlBody).not.toContain('Alex <ops>');
    expect(message.metadata).toMatchObject({
      message_intent: 'billing_usage_alert',
      billing_alert_kind: 'spend_cap_90',
      period_ym: '2026-08',
    });
  });

  it('routes Free exhaustion alerts to billing management', () => {
    const message = renderMessage('billing_usage_alert', {
      to: 'owner@example.test',
      ownerName: null,
      teamName: 'Free Workspace',
      kind: 'free_exhausted',
      periodYm: '2026-08',
      planName: 'Free',
      detailLine: 'Remaining Free floor — AI €0.',
      usageUrl: 'https://timeline.test/app/usage',
      billingUrl: 'https://timeline.test/app/team?section=billing',
    });

    expect(message.subject).toBe('Free Workspace: Free allowance used up');
    expect(message.textBody).toContain('Hi there,');
    expect(message.textBody).toContain(
      'Add payment method: https://timeline.test/app/team?section=billing',
    );
    expect(message.metadata).toMatchObject({ billing_alert_kind: 'free_exhausted' });
  });
});
