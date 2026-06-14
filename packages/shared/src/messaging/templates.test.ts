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
        windowStart: '2026-06-13T08:00:00.000Z',
        windowEnd: '2026-06-14T08:00:00.000Z',
        summary: 'Slack produced a few new follow-ups and one calendar item moved.',
        pendingApprovals: 4,
        eventCount: 12,
        sourceDistribution: { slack: 8, calendar: 4 },
        objectChangesByType: { task: 3 },
        newTeamMembers: [],
        tasks: [
          {
            id: 'task-id',
            title: 'Send pilot recap',
            status: 'todo',
            dueAt: null,
            href: '/app/objects/task-id',
          },
        ],
        upcomingCalendar: [],
        links: [{ label: 'Dashboard', href: '/app' }],
      },
    });

    expect(message.subject).toBe('Daily digest for AuditAI');
    expect(message.textBody).toContain('4 pending approvals');
    expect(message.textBody).toContain('slack: 8');
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
