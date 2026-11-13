import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import {
  buildTimelineMoments,
  timelineMomentDiagnostics,
  timelineMomentLookupPlan,
  type TimelineMomentEvent,
} from '#src/timeline-moments/index.js';
function event(input: Partial<TimelineMomentEvent> & Pick<TimelineMomentEvent, 'id' | 'source'>) {
  return {
    id: input.id,
    teamId: 'team-a',
    authorUserId: null,
    contentText: input.contentText ?? 'hello',
    contentAudioUrl: null,
    occurredAt: input.occurredAt ?? '2026-06-27T18:00:00.000Z',
    createdAt: input.createdAt ?? '2026-06-27T18:00:01.000Z',
    visibility: 'team',
    visibilityUserIds: null,
    visibilityOwnerUserId: null,
    sourceMetadata: input.sourceMetadata ?? {},
    source: input.source,
  } satisfies TimelineMomentEvent;
}

describe('shared timeline moments projection', () => {
  // Recurrence materialization can emit many identical scheduling notices at once.
  // Keep their evidence, but show a single moment rather than flooding the feed.
  it('merges fifty identical calendar scheduling notices into one moment', () => {
    const notices = Array.from({ length: 50 }, (_, index) =>
      event({
        id: `notice-${index}`,
        source: 'calendar',
        contentText: 'Scheduled: Daily digest',
        occurredAt: `2026-06-27T18:00:${String(index).padStart(2, '0')}.000Z`,
        sourceMetadata: { action: 'scheduled', calendar_event_id: `occurrence-${index}` },
      }),
    );
    const moments = buildTimelineMoments(notices, new Map());
    expect(moments).toHaveLength(1);
    expect(moments[0]?.rawEvents).toHaveLength(50);
    expect(buildTimelineMoments(notices, new Map(), { groupingMode: 'events' })).toHaveLength(50);
  });

  it('keeps different notices, actors, access scopes, minutes and occurrences separate', () => {
    const base = event({
      id: 'notice',
      source: 'calendar',
      contentText: 'Scheduled: Daily digest',
      sourceMetadata: { action: 'scheduled', calendar_event_id: 'calendar-a' },
    });
    const variants: TimelineMomentEvent[] = [
      { ...base, id: 'title', contentText: 'Scheduled: Weekly digest' },
      { ...base, id: 'actor', authorUserId: 'other-user' },
      { ...base, id: 'team', teamId: 'team-b' },
      { ...base, id: 'private', visibility: 'private' },
      { ...base, id: 'owner', visibilityOwnerUserId: 'other-owner' },
      { ...base, id: 'recipient', visibilityUserIds: ['other-user'] },
      { ...base, id: 'later', occurredAt: '2026-06-27T18:01:00.000Z' },
      {
        ...base,
        id: 'occurrence-a',
        sourceMetadata: { action: 'event', calendar_event_id: 'calendar-a' },
      },
      {
        ...base,
        id: 'occurrence-b',
        sourceMetadata: { action: 'event', calendar_event_id: 'calendar-b' },
      },
    ];
    expect(buildTimelineMoments([base, ...variants], new Map())).toHaveLength(10);
    const moment = buildTimelineMoments([base], new Map())[0];
    if (!moment) throw new Error('Expected a scheduling moment');
    expect(moment.id).not.toContain('Daily');
    expect(buildTimelineMoments([base], new Map())[0]?.id).toBe(moment.id);
    expect(timelineMomentLookupPlan(moment.id)).toMatchObject({
      source: 'calendar',
      from: new Date('2026-06-27T18:00:00.000Z'),
      to: new Date('2026-06-27T18:01:00.000Z'),
    });
  });

  it('groups repeated system operations without merging different records or changes', () => {
    const base = event({
      id: 'system-a',
      source: 'system',
      contentText: 'Updated task',
      sourceMetadata: {
        kind: 'object_update',
        entity_id: 'task-a',
        source_snapshot: { status: 'done' },
      },
    });
    const retry = {
      ...base,
      id: 'system-b',
      sourceMetadata: {
        source_snapshot: { status: 'done' },
        entity_id: 'task-a',
        kind: 'object_update',
        source_payload_ref: 'inline://retry',
      },
    };
    const other = {
      ...base,
      id: 'other',
      sourceMetadata: {
        kind: 'object_update',
        entity_id: 'task-b',
        source_snapshot: { status: 'done' },
      },
    };
    const changed = {
      ...base,
      id: 'changed',
      sourceMetadata: {
        kind: 'object_update',
        entity_id: 'task-a',
        source_snapshot: { status: 'open' },
      },
    };
    const moments = buildTimelineMoments([base, retry, other, changed], new Map());
    expect(moments).toHaveLength(3);
    expect(
      moments.find((moment) => moment.rawEvents.length === 2)?.rawEvents.map((raw) => raw.id),
    ).toEqual(['system-a', 'system-b']);
  });

  it('groups repeated integration pulses but preserves resource, state, actor and connection boundaries', () => {
    const metadata = {
      provider: 'monitor',
      integration_id: 'connection-a',
      external_object_id: 'job-a',
      event_type: 'job.completed',
      actor: { id: 'bot-a' },
      content: { status: 'success' },
    };
    const base = event({
      id: 'pulse-a',
      source: 'integration',
      contentText: 'Job completed',
      sourceMetadata: metadata,
    });
    const variants = [
      { external_event_id: 'delivery-b', sync_at: 'later' },
      { external_object_id: 'job-b' },
      { content: { status: 'failure' } },
      { actor: { id: 'bot-b' } },
      { integration_id: 'connection-b' },
    ].map((patch, index) => ({
      ...base,
      id: `pulse-${index}`,
      sourceMetadata: { ...metadata, ...patch },
    }));
    const moments = buildTimelineMoments([base, ...variants], new Map());
    expect(moments).toHaveLength(5);
    expect(moments.filter((moment) => moment.rawEvents.length === 2)).toHaveLength(1);
  });

  it('keeps unrelated webhook payloads separate while grouping identical deliveries', () => {
    const base = event({
      id: 'hook-a',
      source: 'ingest_webhook',
      contentText: '{"status":"up"}',
      sourceMetadata: { ingest_webhook_id: 'hook' },
    });
    const moments = buildTimelineMoments(
      [
        base,
        { ...base, id: 'hook-b' },
        { ...base, id: 'hook-c', contentText: '{"status":"down"}' },
        { ...base, id: 'hook-d', sourceMetadata: { ingest_webhook_id: 'other-hook' } },
      ],
      new Map(),
    );
    expect(moments).toHaveLength(3);
    expect(moments[0]?.rawEvents).toHaveLength(2);
  });

  it('groups calendar update and cancellation notices independently', () => {
    const events = ['updated', 'cancelled'].flatMap((action) =>
      [0, 1].map((index) =>
        event({
          id: `${action}-${index}`,
          source: 'calendar',
          contentText: `${action}: Daily digest`,
          sourceMetadata: { action, calendar_event_id: `calendar-${index}` },
        }),
      ),
    );
    const moments = buildTimelineMoments(events, new Map());
    expect(moments).toHaveLength(2);
    expect(moments.every((moment) => moment.rawEvents.length === 2)).toBe(true);
    expect(
      moments.every(
        (moment) =>
          new Set(moment.rawEvents.map((raw) => (raw.sourceMetadata as { action: string }).action))
            .size === 1,
      ),
    ).toBe(true);
    expect(
      moments.every((moment) => timelineMomentLookupPlan(moment.id)?.source === 'calendar'),
    ).toBe(true);
  });

  it('groups one CI run across lifecycle transitions but separates runs and connections', () => {
    const metadata = {
      provider: 'github',
      integration_id: 'connection-a',
      external_object_id: 'repo#workflow_run:1',
      github: { type: 'workflow_run', repo: 'repo' },
    };
    const base = event({
      id: 'run-start',
      source: 'integration',
      contentText: 'Running',
      sourceMetadata: metadata,
    });
    const moments = buildTimelineMoments(
      [
        base,
        {
          ...base,
          id: 'run-finish',
          contentText: 'Failed',
          occurredAt: '2026-06-27T18:30:00.000Z',
        },
        {
          ...base,
          id: 'other-run',
          sourceMetadata: { ...metadata, external_object_id: 'repo#workflow_run:2' },
        },
        {
          ...base,
          id: 'other-connection',
          sourceMetadata: { ...metadata, integration_id: 'connection-b' },
        },
      ],
      new Map(),
    );
    expect(moments).toHaveLength(3);
    expect(moments[0]?.rawEvents.map((raw) => raw.id)).toEqual(['run-finish', 'run-start']);
    expect(timelineMomentLookupPlan(moments[0]?.id ?? '')).toMatchObject({
      source: 'integration',
      metadataPredicates: [
        { path: ['provider'], equals: 'github' },
        { path: ['external_object_id'], equals: 'repo#workflow_run:1' },
      ],
    });
  });

  it('keeps notice identities stable across delivery envelopes and enrichment', () => {
    const metadata = {
      provider: 'monitor',
      integration_id: 'a',
      external_object_id: 'job-a',
      event_type: 'job.completed',
      source_snapshot_kind: 'normalized_integration_event',
    };
    const snapshot = {
      provider: 'monitor',
      externalObjectId: 'job-a',
      eventType: 'job.completed',
      contentText: 'Done',
      actor: { externalId: 'bot' },
      extra: { status: 'success' },
    };
    const notices = ['a', 'b'].map((id) =>
      event({
        id,
        source: 'integration',
        contentText: 'Done',
        sourceMetadata: {
          ...metadata,
          external_event_id: id,
          dedup_key: id,
          embedded_at: id,
          extracted_at: id,
          source_snapshot: { ...snapshot, dedupKey: id, externalEventId: id, occurredAt: id },
        },
      }),
    );
    const first = notices[0];
    if (!first) throw new Error('Expected notice');
    const before = buildTimelineMoments([first], new Map())[0];
    const merged = buildTimelineMoments(notices, new Map());
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe(before?.id);
    const system = event({
      id: 'system',
      source: 'system',
      contentText: 'Done',
      sourceMetadata: {
        kind: 'object_update',
        entity_id: 'task',
        source_snapshot: { status: 'done' },
      },
    });
    expect(
      buildTimelineMoments(
        [
          system,
          {
            ...system,
            id: 'enriched',
            sourceMetadata: {
              ...system.sourceMetadata,
              embedded_at: 'later',
              extracted_at: 'later',
            },
          },
        ],
        new Map(),
      ),
    ).toHaveLength(1);
  });

  it('creates bounded lookup plans for moment ids with source and time context', () => {
    const workflow = timelineMomentLookupPlan(
      'moment:integration:github:workflow_run:timborovkov/audit-ai:CI:main:2026-06-27',
    );
    const telegram = timelineMomentLookupPlan('moment:telegram:chat-a:2026-06-27:16:00');

    expect(workflow).toMatchObject({ source: 'integration', limit: 300 });
    expect(workflow?.from?.toISOString()).toBe('2026-06-26T00:00:00.000Z');
    expect(workflow?.to?.toISOString()).toBe('2026-06-29T00:00:00.000Z');
    expect(workflow?.metadataPredicates).toEqual([
      { path: ['provider'], equals: 'github' },
      { path: ['github', 'type'], equals: 'workflow_run' },
      { path: ['github', 'repo'], equals: 'timborovkov/audit-ai' },
      { path: ['github', 'head_branch'], equals: 'main' },
    ]);
    expect(workflow?.metadataPredicateGroups).toEqual([
      [
        { path: ['github', 'workflow_name'], equals: 'CI' },
        { path: ['workflow_name'], equals: 'CI' },
        { path: ['content', 'github_workflow_name'], equals: 'CI' },
      ],
    ]);
    expect(telegram).toMatchObject({ source: 'telegram', limit: 300 });
    expect(telegram?.from?.toISOString()).toBe('2026-06-27T10:00:00.000Z');
    expect(telegram?.to?.toISOString()).toBe('2026-06-28T22:00:00.000Z');
    expect(telegram?.metadataPredicateGroups).toEqual([
      [
        { path: ['tg_chat_id'], equals: 'chat-a' },
        { path: ['tg_chat_title'], equals: 'chat-a' },
      ],
    ]);
  });

  it('creates exact metadata lookup plans for stable moment identities', () => {
    expect(timelineMomentLookupPlan('moment:email:thread-a')).toMatchObject({
      source: 'email',
      limit: 300,
      metadataPredicates: [{ path: ['thread_root_id'], equals: 'thread-a' }],
    });
    expect(timelineMomentLookupPlan('moment:meeting:meeting-a')).toMatchObject({
      source: 'meeting',
      limit: 100,
      metadataPredicates: [{ path: ['meeting_id'], equals: 'meeting-a' }],
    });
    expect(timelineMomentLookupPlan('moment:calendar:calendar-a')).toMatchObject({
      source: 'calendar',
      limit: 100,
      metadataPredicates: [{ path: ['calendar_event_id'], equals: 'calendar-a' }],
    });
    expect(
      timelineMomentLookupPlan(
        'moment:document:00000000-0000-0000-0000-000000000123:2026-06-27:uploaded',
      ),
    ).toMatchObject({
      source: 'document',
      limit: 300,
      metadataPredicates: [
        { path: ['document_id'], equals: '00000000-0000-0000-0000-000000000123' },
        { path: ['action'], equals: 'uploaded' },
      ],
    });
    expect(timelineMomentLookupPlan('moment:slack:C123:1782600000.000100')).toMatchObject({
      source: 'slack',
      limit: 300,
      metadataPredicateGroups: [
        [
          { path: ['slack_channel_id'], equals: 'C123' },
          { path: ['slack_channel_name'], equals: 'C123' },
        ],
        [
          { path: ['slack_thread_ts'], equals: '1782600000.000100' },
          { path: ['slack_message_ts'], equals: '1782600000.000100' },
        ],
      ],
    });
    expect(
      timelineMomentLookupPlan('moment:integration:github:pr:timborovkov/audit-ai:292'),
    ).toMatchObject({
      source: 'integration',
      limit: 300,
      metadataPredicates: [
        { path: ['provider'], equals: 'github' },
        { path: ['github', 'repo'], equals: 'timborovkov/audit-ai' },
        { path: ['github', 'pr_number'], equals: '292' },
      ],
    });
    expect(timelineMomentLookupPlan('moment:integration:linear:issue-123')).toMatchObject({
      source: 'integration',
      limit: 300,
      metadataPredicates: [{ path: ['provider'], equals: 'linear' }],
      metadataPredicateGroups: [
        [
          { path: ['external_object_id'], equals: 'issue-123' },
          { path: ['external_event_id'], equals: 'issue-123' },
        ],
      ],
    });
    expect(timelineMomentLookupPlan('moment:integration:webhook:delivery-456')).toMatchObject({
      source: 'integration',
      limit: 300,
      metadataPredicates: [{ path: ['provider'], equals: 'webhook' }],
      metadataPredicateGroups: [
        [
          { path: ['external_object_id'], equals: 'delivery-456' },
          { path: ['external_event_id'], equals: 'delivery-456' },
        ],
      ],
    });
  });

  it('keeps GitHub workflow events without run identity separate', () => {
    const moments = buildTimelineMoments(
      [
        event({
          id: 'workflow-a',
          source: 'integration',
          contentText: 'GitHub workflow "CI" #1603 on timborovkov/audit-ai success',
          occurredAt: '2026-06-27T18:32:00.000Z',
          sourceMetadata: {
            provider: 'github',
            event_type: 'workflow_run.success',
            github: {
              type: 'workflow_run',
              repo: 'timborovkov/audit-ai',
              head_branch: 'main',
            },
          },
        }),
        event({
          id: 'workflow-b',
          source: 'integration',
          contentText: 'GitHub workflow "CI" #1602 on timborovkov/audit-ai success',
          occurredAt: '2026-06-27T18:08:00.000Z',
          sourceMetadata: {
            provider: 'github',
            event_type: 'workflow_run.success',
            github: {
              type: 'workflow_run',
              repo: 'timborovkov/audit-ai',
              head_branch: 'main',
            },
          },
        }),
      ],
      new Map(),
      { now: new Date('2026-06-27T19:00:00.000Z'), timezone: 'UTC' },
    );

    expect(moments).toHaveLength(2);
    expect(moments[0]).toMatchObject({
      version: 'timeline_moment.v1',
      kind: 'ci_deploy',
      eventClass: 'pulse',
      visualWeight: 'pulse',
      sourceLabel: 'GitHub',
      title: 'CI passed on timborovkov/audit-ai · main',
      evidenceSummary: { rawEventCount: 1 },
      grouping: { strategy: 'identical_notice_window' },
    });
    expect(moments[0]?.anchorId).toMatch(/^tm-moment_3Anotice_3Aintegration/);
    expect(moments[0]?.rawEvents.map((rawEvent) => rawEvent.id)).toEqual(['workflow-a']);
    expect(moments[0]?.impactItems).toEqual([]);
  });

  it('bundles GitHub pull request updates and reviews into one PR moment', () => {
    const moments = buildTimelineMoments(
      [
        event({
          id: 'pr-update',
          source: 'integration',
          contentText:
            'GitHub PR timborovkov/audit-ai#292 updated: Fix scoping tie-out extraction and timeline grouping',
          occurredAt: '2026-06-27T18:26:00.000Z',
          sourceMetadata: {
            provider: 'github',
            event_type: 'pr.updated',
            github: {
              type: 'pull_request',
              repo: 'timborovkov/audit-ai',
              number: 292,
            },
          },
        }),
        event({
          id: 'pr-review',
          source: 'integration',
          contentText: 'GitHub PR timborovkov/audit-ai#292 review (COMMENTED)',
          occurredAt: '2026-06-27T18:25:00.000Z',
          sourceMetadata: {
            provider: 'github',
            event_type: 'pr.review.commented',
            github: {
              type: 'review',
              repo: 'timborovkov/audit-ai',
              pr_number: 292,
              state: 'commented',
            },
          },
        }),
      ],
      new Map(),
      { now: new Date('2026-06-27T19:00:00.000Z'), timezone: 'UTC' },
    );

    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({
      id: 'moment:integration:github:pr:timborovkov/audit-ai:292',
      kind: 'code_review',
      eventClass: 'work_record',
      visualWeight: 'record',
      title: 'PR #292 updated: Fix scoping tie-out extraction and timeline grouping',
      evidenceSummary: { rawEventCount: 2 },
    });
    expect(moments[0]?.rawEvents.map((rawEvent) => rawEvent.id)).toEqual([
      'pr-update',
      'pr-review',
    ]);
  });

  it('renders provider IDs as human labels in integration moments', () => {
    const moments = buildTimelineMoments(
      [
        event({
          id: 'linear-issue',
          source: 'integration',
          contentText:
            'Linear issue TL-101 moved to In Progress: Polish seeded object pages for demo data.',
          occurredAt: '2026-06-27T18:26:00.000Z',
          sourceMetadata: {
            provider: 'linear',
            event_type: 'issue.updated',
            external_object_id: 'TL-101',
          },
        }),
      ],
      new Map(),
      { now: new Date('2026-06-27T19:00:00.000Z'), timezone: 'UTC' },
    );

    expect(moments[0]).toMatchObject({
      title: 'Linear issue updated · TL-101',
      eventClass: 'work_record',
      visualWeight: 'record',
      subtitle: 'Linear · issue updated · 1 event',
    });
  });

  it('keeps current provider fixture shapes grouped and readable', () => {
    const providerEvents = [
      event({
        id: 'github-commit',
        source: 'integration',
        contentText: 'GitHub commit acme/web@abc1234 — Tighten timeline moment grouping',
        occurredAt: '2026-06-27T18:40:00.000Z',
        sourceMetadata: {
          provider: 'github',
          event_type: 'commit.pushed',
          github: {
            type: 'commit',
            repo: 'acme/web',
            sha: 'abc1234',
          },
        },
      }),
      event({
        id: 'github-release',
        source: 'integration',
        contentText: 'GitHub release acme/web v1.2.3 published',
        occurredAt: '2026-06-27T18:35:00.000Z',
        sourceMetadata: {
          provider: 'github',
          event_type: 'release.created',
          github: {
            type: 'release',
            repo: 'acme/web',
            tag: 'v1.2.3',
          },
        },
      }),
      event({
        id: 'linear-issue',
        source: 'integration',
        contentText: 'Linear issue TL-101 moved to In Progress',
        occurredAt: '2026-06-27T18:30:00.000Z',
        sourceMetadata: {
          provider: 'linear',
          event_type: 'issue.updated',
          external_object_id: 'lin-issue-uuid',
          linear: {
            kind: 'issue',
            identifier: 'TL-101',
          },
        },
      }),
      event({
        id: 'sentry-issue',
        source: 'integration',
        contentText: 'Sentry issue API-42 resolved in api-service',
        occurredAt: '2026-06-27T18:25:00.000Z',
        sourceMetadata: {
          provider: 'sentry',
          event_type: 'issue.resolved',
          external_object_id: 'sentry-issue-id',
          sentry_short_id: 'API-42',
        },
      }),
      event({
        id: 'drive-file',
        source: 'integration',
        contentText: 'Google Drive file Product Brief.pdf changed',
        occurredAt: '2026-06-27T18:20:00.000Z',
        sourceMetadata: {
          provider: 'google_drive',
          event_type: 'file.changed',
          external_object_id: 'drive-file-id',
          drive: {
            name: 'Product Brief.pdf',
            mime_type: 'application/pdf',
          },
        },
      }),
      event({
        id: 'monday-item',
        source: 'integration',
        contentText: 'Monday item Launch checklist status changed',
        occurredAt: '2026-06-27T18:15:00.000Z',
        sourceMetadata: {
          provider: 'monday',
          event_type: 'status.changed',
          external_object_id: 'monday-item-id',
          monday_item_name: 'Launch checklist',
        },
      }),
      event({
        id: 'generic-webhook',
        source: 'integration',
        contentText: 'Generic provider activity received',
        occurredAt: '2026-06-27T18:10:00.000Z',
        sourceMetadata: {
          provider: 'custom_webhook',
          event_type: 'deployment.created',
          external_object_id: 'deploy-123',
          resource_name: 'Production deploy',
        },
      }),
      event({
        id: 'jira-issue',
        source: 'integration',
        contentText: 'Jira issue AUD-42 moved to review',
        occurredAt: '2026-06-27T18:05:00.000Z',
        sourceMetadata: {
          provider: 'jira',
          event_type: 'issue.status_changed',
          external_object_id: 'jira-issue-id',
          jira: {
            key: 'AUD-42',
            summary: 'Timeline source adapters',
          },
        },
      }),
      event({
        id: 'asana-task',
        source: 'integration',
        contentText: 'Asana task QA timeline mobile layout completed',
        occurredAt: '2026-06-27T18:00:00.000Z',
        sourceMetadata: {
          provider: 'asana',
          event_type: 'task.completed',
          external_object_id: 'asana-task-id',
          asana: {
            task_name: 'QA timeline mobile layout',
          },
        },
      }),
      event({
        id: 'trello-card',
        source: 'integration',
        contentText: 'Trello card Release checklist moved',
        occurredAt: '2026-06-27T17:55:00.000Z',
        sourceMetadata: {
          provider: 'trello',
          event_type: 'card.moved',
          external_object_id: 'trello-card-id',
          trello: {
            card_name: 'Release checklist',
          },
        },
      }),
      event({
        id: 'basecamp-todo',
        source: 'integration',
        contentText: 'Basecamp todo Publish pilot notes assigned',
        occurredAt: '2026-06-27T17:50:00.000Z',
        sourceMetadata: {
          provider: 'basecamp',
          event_type: 'todo.assigned',
          external_object_id: 'basecamp-todo-id',
          basecamp: {
            todo_title: 'Publish pilot notes',
          },
        },
      }),
      event({
        id: 'datadog-incident',
        source: 'integration',
        contentText: 'Datadog incident Search latency spike resolved',
        occurredAt: '2026-06-27T17:45:00.000Z',
        sourceMetadata: {
          provider: 'datadog',
          event_type: 'incident.resolved',
          external_object_id: 'datadog-incident-id',
          datadog: {
            incident_title: 'Search latency spike',
          },
        },
      }),
      event({
        id: 'salesforce-deal',
        source: 'integration',
        contentText: 'Salesforce opportunity Acme renewal moved to Legal Review',
        occurredAt: '2026-06-27T17:40:00.000Z',
        sourceMetadata: {
          provider: 'salesforce',
          event_type: 'opportunity.stage_changed',
          external_object_id: 'salesforce-opportunity-id',
          salesforce: {
            opportunity_name: 'Acme renewal',
          },
        },
      }),
      event({
        id: 'hubspot-deal',
        source: 'integration',
        contentText: 'HubSpot deal Nordic expansion owner changed',
        occurredAt: '2026-06-27T17:35:00.000Z',
        sourceMetadata: {
          provider: 'hubspot',
          event_type: 'deal.owner_changed',
          external_object_id: 'hubspot-deal-id',
          hubspot: {
            deal_name: 'Nordic expansion',
          },
        },
      }),
      event({
        id: 'zendesk-ticket',
        source: 'integration',
        contentText: 'Zendesk ticket Login loop escalated',
        occurredAt: '2026-06-27T17:30:00.000Z',
        sourceMetadata: {
          provider: 'zendesk',
          event_type: 'ticket.escalated',
          external_object_id: 'zendesk-ticket-id',
          zendesk: {
            ticket_subject: 'Login loop',
          },
        },
      }),
      event({
        id: 'intercom-conversation',
        source: 'integration',
        contentText: 'Intercom conversation Pricing question assigned',
        occurredAt: '2026-06-27T17:25:00.000Z',
        sourceMetadata: {
          provider: 'intercom',
          event_type: 'conversation.assigned',
          external_object_id: 'intercom-conversation-id',
          intercom: {
            conversation_title: 'Pricing question',
          },
        },
      }),
      event({
        id: 'notion-page',
        source: 'integration',
        contentText: 'Notion page Launch brief updated',
        occurredAt: '2026-06-27T17:20:00.000Z',
        sourceMetadata: {
          provider: 'notion',
          event_type: 'page.updated',
          external_object_id: 'notion-page-id',
          notion: {
            title: 'Launch brief',
          },
        },
      }),
      event({
        id: 'confluence-page',
        source: 'integration',
        contentText: 'Confluence page Runbook updated',
        occurredAt: '2026-06-27T17:15:00.000Z',
        sourceMetadata: {
          provider: 'confluence',
          event_type: 'page.updated',
          external_object_id: 'confluence-page-id',
          confluence: {
            title: 'Runbook',
          },
        },
      }),
      event({
        id: 'figma-file',
        source: 'integration',
        contentText: 'Figma file Timeline concepts commented',
        occurredAt: '2026-06-27T17:10:00.000Z',
        sourceMetadata: {
          provider: 'figma',
          event_type: 'file.commented',
          external_object_id: 'figma-file-id',
          figma: {
            file_name: 'Timeline concepts',
          },
        },
      }),
    ];
    const moments = buildTimelineMoments(providerEvents, new Map(), {
      now: new Date('2026-06-27T19:00:00.000Z'),
      timezone: 'UTC',
    });

    expect(moments.map((moment) => moment.title)).toEqual([
      'Commit pushed to acme/web',
      'Release v1.2.3 published for acme/web',
      'Linear issue updated · TL-101',
      'Sentry issue resolved · API-42',
      'Google Drive file changed · Product Brief.pdf',
      'Monday.com status changed · Launch checklist',
      'Custom Webhook deployment created · Production deploy',
      'Jira issue status changed · AUD-42',
      'Asana task completed · QA timeline mobile layout',
      'Trello card moved · Release checklist',
      'Basecamp todo assigned · Publish pilot notes',
      'Datadog incident resolved · Search latency spike',
      'Salesforce opportunity stage changed · Acme renewal',
      'HubSpot deal owner changed · Nordic expansion',
      'Zendesk ticket escalated · Login loop',
      'Intercom conversation assigned · Pricing question',
      'Notion page updated · Launch brief',
      'Confluence page updated · Runbook',
      'Figma file commented · Timeline concepts',
    ]);
    expect(timelineMomentDiagnostics(providerEvents)).toEqual([]);
  });

  it('keeps persisted live-adapter metadata readable when labels live outside top-level ids', () => {
    const providerEvents = [
      event({
        id: 'linear-comment',
        source: 'integration',
        contentText: 'Linear TL-101 comment: Can we review the timeline IA today?',
        occurredAt: '2026-06-27T18:30:00.000Z',
        sourceMetadata: {
          provider: 'linear',
          event_type: 'comment.updated',
          external_object_id: 'lin-issue-uuid#comment:comment-uuid',
          external_event_id: '2026-06-27T18:30:00.000Z',
          linear: {
            kind: 'comment',
            url: 'https://linear.app/acme/issue/TL-101/timeline-redesign',
            issue: {
              id: 'lin-issue-uuid',
              identifier: 'TL-101',
              title: 'Timeline redesign',
            },
          },
        },
      }),
      event({
        id: 'linear-project',
        source: 'integration',
        contentText: 'Linear project "Timeline redesign"\n\nRefresh the timeline UI.',
        occurredAt: '2026-06-27T18:25:00.000Z',
        sourceMetadata: {
          provider: 'linear',
          event_type: 'project.active',
          external_object_id: 'linear-project-uuid',
          external_event_id: '2026-06-27T18:25:00.000Z',
          linear: {
            kind: 'project',
            url: 'https://linear.app/acme/project/timeline-redesign',
            state: 'active',
          },
        },
      }),
      event({
        id: 'monday-activity',
        source: 'integration',
        contentText: 'Monday status changed on Pipeline: Acme renewal\nColumn: Status\nValue: Won',
        occurredAt: '2026-06-27T18:20:00.000Z',
        sourceMetadata: {
          provider: 'monday',
          event_type: 'status.changed',
          external_object_id: 'item-1',
          external_event_id: 'activity-1',
          monday_board_id: 'board-1',
          monday_board_name: 'Pipeline',
          monday_item_id: 'item-1',
          monday_activity_event: 'change_column_value',
        },
      }),
      event({
        id: 'monday-update',
        source: 'integration',
        contentText: 'Monday update on Acme renewal: Legal approved the renewal.',
        occurredAt: '2026-06-27T18:15:00.000Z',
        sourceMetadata: {
          provider: 'monday',
          event_type: 'update.created',
          external_object_id: 'item-1',
          external_event_id: 'update-1',
          monday_board_id: 'board-1',
          monday_board_name: 'Pipeline',
          monday_item_id: 'item-1',
          monday_update_id: 'update-1',
        },
      }),
      event({
        id: 'sentry-release',
        source: 'integration',
        contentText: 'Sentry release web@1.2.4 for web',
        occurredAt: '2026-06-27T18:10:00.000Z',
        sourceMetadata: {
          provider: 'sentry',
          event_type: 'release.created',
          external_object_id: 'acme/web/release/web@1.2.4',
          sentry_org_slug: 'acme',
          sentry_project_slug: 'web',
          release_version: 'web@1.2.4',
        },
      }),
    ];

    const moments = buildTimelineMoments(providerEvents, new Map(), {
      now: new Date('2026-06-27T19:00:00.000Z'),
      timezone: 'UTC',
    });

    expect(moments.map((moment) => moment.title)).toEqual([
      'Linear comment updated · TL-101',
      'Linear project active · Timeline redesign',
      'Monday.com status changed · Acme renewal',
      'Monday.com update created · Acme renewal',
      'Sentry release created · web@1.2.4',
    ]);
    expect(moments[2]).toMatchObject({ evidenceSummary: { rawEventCount: 1 } });
    expect(timelineMomentDiagnostics(providerEvents)).toEqual([]);
  });

  it('keeps source event mode split for audit/debug views', () => {
    const moments = buildTimelineMoments(
      [
        event({ id: 'message-a', source: 'telegram', sourceMetadata: { tg_chat_id: 'chat-a' } }),
        event({ id: 'message-b', source: 'telegram', sourceMetadata: { tg_chat_id: 'chat-a' } }),
      ],
      new Map(),
      { groupingMode: 'events' },
    );

    expect(moments.map((moment) => moment.rawEvents[0]?.id)).toEqual(['message-a', 'message-b']);
  });

  it('labels multi-signal document and calendar moments with signals, not source events', () => {
    const moments = buildTimelineMoments(
      [
        event({
          id: 'doc-a',
          source: 'document',
          contentText: 'Uploaded notes',
          occurredAt: '2026-06-27T18:00:00.000Z',
          sourceMetadata: {
            document_id: '00000000-0000-0000-0000-000000000123',
            action: 'uploaded',
          },
        }),
        event({
          id: 'doc-b',
          source: 'document',
          contentText: 'Uploaded notes revision',
          occurredAt: '2026-06-27T18:05:00.000Z',
          sourceMetadata: {
            document_id: '00000000-0000-0000-0000-000000000123',
            action: 'uploaded',
          },
        }),
        event({
          id: 'cal-a',
          source: 'calendar',
          contentText: 'Standup',
          occurredAt: '2026-06-27T19:00:00.000Z',
          sourceMetadata: { calendar_event_id: 'cal-standup' },
        }),
        event({
          id: 'cal-b',
          source: 'calendar',
          contentText: 'Standup update',
          occurredAt: '2026-06-27T19:05:00.000Z',
          sourceMetadata: { calendar_event_id: 'cal-standup' },
        }),
      ],
      new Map(),
    );

    const documentMoment = moments.find((moment) => moment.rawEvents[0]?.source === 'document');
    const calendarMoment = moments.find((moment) => moment.rawEvents[0]?.source === 'calendar');
    expect(documentMoment?.subtitle).toBe('2 signals');
    expect(documentMoment?.subtitle).not.toContain('source event');
    expect(calendarMoment?.subtitle).toBe('2 signals');
    expect(calendarMoment?.subtitle).not.toContain('source event');
  });

  it('diagnoses integration events that would fall back to weak grouping metadata', () => {
    const diagnostics = timelineMomentDiagnostics([
      event({
        id: 'weak-integration',
        source: 'integration',
        contentText: 'Provider event without stable object identity',
        sourceMetadata: {
          provider: 'linear',
          event_type: 'issue.updated',
        },
      }),
      event({
        id: 'weak-workflow',
        source: 'integration',
        contentText: 'GitHub workflow success without repo and branch',
        sourceMetadata: {
          provider: 'github',
          event_type: 'workflow_run.success',
          github: { type: 'workflow_run' },
        },
      }),
    ]);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'missing_grouping_metadata',
        provider: 'linear',
        eventId: 'weak-integration',
        missingFields: ['external_object_id'],
        groupingStrategy: 'provider_object',
      }),
      expect.objectContaining({
        code: 'missing_grouping_metadata',
        provider: 'github',
        eventId: 'weak-workflow',
        missingFields: ['github.repo', 'github.head_branch', 'github.workflow_name'],
        groupingStrategy: 'identical_notice_window',
      }),
    ]);
  });
});
