import { describe, expect, it } from 'vitest';

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

  it('bundles GitHub workflow bursts into one deterministic CI moment', () => {
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

    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({
      version: 'timeline_moment.v1',
      kind: 'ci_deploy',
      title: 'CI passed on timborovkov/audit-ai',
      evidenceSummary: { rawEventCount: 2 },
      grouping: { strategy: 'provider_workflow_window' },
    });
    expect(moments[0]?.anchorId).toMatch(/^tm-moment_3Aintegration_3Agithub/);
    expect(moments[0]?.rawEvents.map((rawEvent) => rawEvent.id)).toEqual([
      'workflow-a',
      'workflow-b',
    ]);
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
      'Sentry release created · web@1.2.4',
    ]);
    expect(moments[2]).toMatchObject({ evidenceSummary: { rawEventCount: 2 } });
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
        groupingStrategy: 'provider_workflow_window',
      }),
    ]);
  });
});
