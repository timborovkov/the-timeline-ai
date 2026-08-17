import { describe, expect, it } from 'vitest';

import {
  classifyCapturedEvent,
  isMachineIdentityLabel,
  promotesWorkspaceObject,
  visualWeightForEventClass,
} from '#src/event-class.js';

describe('timeline event class', () => {
  it('maps native sources to families', () => {
    expect(classifyCapturedEvent({ source: 'telegram' })).toBe('communication');
    expect(classifyCapturedEvent({ source: 'slack' })).toBe('communication');
    expect(classifyCapturedEvent({ source: 'meeting' })).toBe('communication');
    expect(classifyCapturedEvent({ source: 'document' })).toBe('artifact');
    expect(classifyCapturedEvent({ source: 'calendar' })).toBe('schedule');
    expect(classifyCapturedEvent({ source: 'system' })).toBe('pulse');
  });

  it('classifies GitHub Actions, merge requests, and Sentry issues without provider-specific branches in callers', () => {
    expect(
      classifyCapturedEvent({
        source: 'integration',
        metadata: {
          provider: 'github',
          event_type: 'workflow_run.in_progress',
          github: { type: 'workflow_run' },
        },
      }),
    ).toBe('pulse');
    expect(
      classifyCapturedEvent({
        source: 'integration',
        metadata: {
          provider: 'gitlab',
          event_type: 'pipeline.failed',
        },
      }),
    ).toBe('pulse');
    expect(
      classifyCapturedEvent({
        source: 'integration',
        metadata: {
          provider: 'github',
          event_type: 'pr.merged',
          github: { type: 'pull_request', number: 88 },
        },
      }),
    ).toBe('work_record');
    expect(
      classifyCapturedEvent({
        source: 'integration',
        metadata: {
          provider: 'sentry',
          event_type: 'issue.resolved',
          sentry_issue_id: 'abc',
        },
      }),
    ).toBe('incident');
    expect(
      classifyCapturedEvent({
        source: 'integration',
        metadata: {
          provider: 'posthog',
          event_type: 'insight.updated',
        },
      }),
    ).toBe('pulse');
    expect(
      classifyCapturedEvent({
        source: 'integration',
        metadata: {
          provider: 'hubspot',
          event_type: 'deal.updated',
        },
      }),
    ).toBe('work_record');
  });

  it('lets ingest webhooks keep the configured class and defaults unknown webhooks to pulse', () => {
    expect(classifyCapturedEvent({ source: 'ingest_webhook' })).toBe('pulse');
    expect(
      classifyCapturedEvent({
        source: 'ingest_webhook',
        metadata: { event_class: 'work_record', ingest_webhook_name: 'Pipedrive' },
      }),
    ).toBe('work_record');
    expect(
      classifyCapturedEvent({
        source: 'ingest_webhook',
        metadata: { event_class: 'not-a-class' },
      }),
    ).toBe('pulse');
  });

  it('honors a stamped event_class for any source and infers nested provider types without named branches', () => {
    expect(
      classifyCapturedEvent({
        source: 'integration',
        metadata: { event_class: 'work_record', event_type: 'insight.updated' },
      }),
    ).toBe('work_record');
    expect(
      classifyCapturedEvent({
        source: 'integration',
        metadata: { provider: 'gitlab', gitlab: { type: 'merge_request' } },
      }),
    ).toBe('work_record');
    expect(
      classifyCapturedEvent({
        source: 'integration',
        metadata: { provider: 'monday', event_type: 'update.created' },
      }),
    ).toBe('communication');
    expect(
      classifyCapturedEvent({
        source: 'integration',
        metadata: { provider: 'monday', event_type: 'item.status_changed' },
      }),
    ).toBe('work_record');
    expect(
      classifyCapturedEvent({
        source: 'integration',
        metadata: { provider: 'gitlab', gitlab: { type: 'pipeline' } },
      }),
    ).toBe('pulse');
  });

  it('uses story weight for conversations, record weight for PRs, and pulse weight for CI', () => {
    expect(visualWeightForEventClass('communication')).toBe('story');
    expect(visualWeightForEventClass('work_record')).toBe('record');
    expect(visualWeightForEventClass('incident')).toBe('record');
    expect(visualWeightForEventClass('pulse')).toBe('pulse');
    expect(visualWeightForEventClass('communication', 'events')).toBe('pulse');
  });

  it('promotes only durable records to workspace object identity', () => {
    expect(promotesWorkspaceObject('work_record')).toBe(true);
    expect(promotesWorkspaceObject('incident')).toBe(true);
    expect(promotesWorkspaceObject('artifact')).toBe(true);
    expect(promotesWorkspaceObject('pulse')).toBe(false);
    expect(promotesWorkspaceObject('communication')).toBe(false);
  });

  it('treats provider sync keys as machine identity and keeps human work-record labels', () => {
    expect(isMachineIdentityLabel('timborovkov/audit-ai#workflow_run:32010065994')).toBe(true);
    expect(isMachineIdentityLabel('32010065994')).toBe(true);
    expect(isMachineIdentityLabel('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBe(true);
    expect(isMachineIdentityLabel('PR #88')).toBe(false);
    expect(isMachineIdentityLabel('timborovkov/audit-ai#292')).toBe(false);
    expect(isMachineIdentityLabel('LOGIN-500 on checkout')).toBe(false);
  });
});
