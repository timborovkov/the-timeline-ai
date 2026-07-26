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
            items: ['Send pilot recap.'],
          },
          {
            title: 'Highlights',
            items: ['The team should keep the pilot recap moving.'],
          },
          {
            title: 'Product status',
            items: ['Pilot invite flow is close to launch.'],
          },
          {
            title: 'Completed',
            items: ['Removed the lock feature from incomplete-step progression.'],
          },
          {
            title: 'In progress',
            items: ['Automated testing agent is being created.'],
          },
          {
            title: 'Decisions',
            items: ['Launch timing still needs a decision.'],
          },
        ],
        pendingApprovals: 4,
        eventCount: 12,
        momentCount: 5,
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
    expect(message.textBody).toContain('4 pending approvals');
    expect(message.textBody).toContain('5 work moments');
    expect(message.textBody).not.toContain('from 12 source events');
    expect(message.textBody).toContain('slack: 8');
    expect(message.textBody).toContain(
      'Highlights\n- The team should keep the pilot recap moving.',
    );
    expect(message.textBody).toContain('Product status\n- Pilot invite flow is close to launch.');
    expect(message.textBody).toContain(
      'Completed\n- Removed the lock feature from incomplete-step progression.',
    );
    expect(message.textBody).toContain('In progress\n- Automated testing agent is being created.');
    expect(message.textBody).toContain('Decisions\n- Launch timing still needs a decision.');
    expect(message.textBody).toContain('Send pilot recap (todo, Due soon · Jun 17, 2026)');
    expect(message.textBody.indexOf('Product status')).toBeLessThan(
      message.textBody.indexOf('Completed'),
    );
    expect(message.textBody.indexOf('Completed')).toBeLessThan(
      message.textBody.indexOf('In progress'),
    );
    expect(message.textBody).toContain('Pilot planning (Jun 17, 2026');
    expect(message.textBody).not.toContain('2026-06-17T14:00:00.000Z');
    expect(message.htmlBody).toContain('Highlights');
    expect(message.htmlBody).toContain('Send pilot recap.');
    expect(message.htmlBody).toContain('Send pilot recap (todo, Due soon · Jun 17, 2026)');
    expect(message.htmlBody).toContain('Digest date: Jun 14, 2026');
    expect(message.htmlBody).toContain('5 work moments');
    expect(message.htmlBody).not.toContain('from 12 source events');
    expect(message.htmlBody).toContain('The team should keep the pilot recap moving.');
    expect(message.htmlBody).toContain('Open digest');
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
    expect(message.htmlBody).toContain('Open digest');
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
});
