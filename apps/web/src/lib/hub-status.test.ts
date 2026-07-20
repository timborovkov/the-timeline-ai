import { describe, expect, it, vi } from 'vitest';

import {
  attentionCount,
  countDismissibleMeetingFailures,
  countMeetingFailuresForSources,
  displayInboundEmail,
  getNavWorkAttention,
  getWorkAttentionSummary,
  homeWorkNeedingAttentionCount,
  workAttentionCount,
} from '@/lib/hub-status';

describe('hub status helpers', () => {
  it('aggregates only positive attention counts', () => {
    expect(attentionCount(2, 0, -1, 3)).toBe(5);
  });

  it('keeps inbox notifications out of work attention', () => {
    expect(
      workAttentionCount({
        pendingApprovals: 3,
        overdueTasks: 2,
      }),
    ).toBe(5);
  });

  it('counts only overdue tasks for Home work needing attention', () => {
    expect(
      homeWorkNeedingAttentionCount({
        attention: 5,
        pendingApprovals: 3,
        overdueTasks: 2,
      }),
    ).toBe(2);
  });

  it('ignores negative work attention inputs', () => {
    expect(
      workAttentionCount({
        pendingApprovals: 3,
        overdueTasks: -2,
      }),
    ).toBe(3);
  });

  it('uses pending approval items and overdue tasks while excluding failed approvals', async () => {
    const countObjects = vi.fn().mockResolvedValue(1);
    const summary = await getWorkAttentionSummary(
      {
        objects: { countObjects },
        suggestions: {
          getApprovalItemCounts: vi.fn().mockResolvedValue({ failed: 4, pending: 0 }),
        },
      } as never,
      new Date('2026-07-16T12:00:00.000Z'),
      'America/Los_Angeles',
    );

    expect(summary).toEqual({ attention: 1, overdueTasks: 1, pendingApprovals: 0 });
    expect(countObjects).toHaveBeenCalledWith({
      archived: false,
      dueDateRange: { timezone: 'America/Los_Angeles', to: '2026-07-16' },
      statusNotCaseInsensitive: ['done', 'cancelled', 'canceled', 'shipped'],
      type: 'task',
    });
  });

  it('uses the same work attention provider for the navigation badge', async () => {
    const scope = {
      objects: { countObjects: vi.fn().mockResolvedValue(2) },
      suggestions: {
        getApprovalItemCounts: vi.fn().mockResolvedValue({ failed: 4, pending: 3 }),
      },
      calendar: {
        getCalendarSettings: vi.fn().mockResolvedValue({ defaultTimezone: 'Europe/Madrid' }),
      },
    } as never;
    const now = new Date('2026-07-16T12:00:00.000Z');

    const work = await getWorkAttentionSummary(scope, now, 'Europe/Madrid');
    const navWork = await getNavWorkAttention(scope, now);

    expect(work).toEqual({ attention: 5, overdueTasks: 2, pendingApprovals: 3 });
    expect(navWork).toBe(work.attention);
  });

  it('counts only failed meeting recovery jobs as dismissible meeting attention', () => {
    expect(
      countDismissibleMeetingFailures([
        { kind: 'meeting_finalization', status: 'failed' },
        { kind: 'meeting_finalization', status: 'stuck' },
        { kind: 'embedding', status: 'failed' },
      ] as Parameters<typeof countDismissibleMeetingFailures>[0]),
    ).toBe(1);
  });

  it('omits meeting failures from lightweight source attention', () => {
    expect(
      countMeetingFailuresForSources({
        includeRecoverableJobs: false,
        recoverableJobs: [
          { kind: 'meeting_finalization', status: 'failed' },
          { kind: 'meeting_finalization', status: 'failed' },
        ] as Parameters<typeof countMeetingFailuresForSources>[0]['recoverableJobs'],
      }),
    ).toBe(0);
  });

  it('uses recovery jobs for the full sources summary', () => {
    expect(
      countMeetingFailuresForSources({
        includeRecoverableJobs: true,
        recoverableJobs: [{ kind: 'meeting_finalization', status: 'failed' }] as Parameters<
          typeof countMeetingFailuresForSources
        >[0]['recoverableJobs'],
      }),
    ).toBe(1);
  });

  it('never exposes an inbound.invalid placeholder as a usable address', () => {
    expect(
      displayInboundEmail(
        { slug: 'acme', inboundEmail: 'acme@inbound.invalid' },
        'mailbox@inbound.postmarkapp.com',
      ),
    ).toBe('mailbox+acme@inbound.postmarkapp.com');
    expect(
      displayInboundEmail({ slug: 'acme', inboundEmail: 'acme@inbound.invalid' }, undefined),
    ).toBeNull();
  });

  it('prefers a configured team inbound domain', () => {
    expect(
      displayInboundEmail(
        { slug: 'acme', inboundEmail: 'acme@inbound.timeline.test' },
        'mailbox@inbound.postmarkapp.com',
      ),
    ).toBe('acme@inbound.timeline.test');
  });
});
