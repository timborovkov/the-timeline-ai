import { createHash } from 'node:crypto';

import { classifyCapturedEvent } from '@timeline/shared/event-class';

import { DEMO_FIXTURE_VERSION, DEMO_IDS, DEMO_LOGIN_PASSWORD } from '../demo-fixture.js';

import {
  buildCadenceBeats,
  isSlackUnixTs,
  slackUnixTs,
  type CadenceEventSource,
} from './cadence.js';
import { CORPUS_UUID } from './ids.js';
import { buildSimplePdf } from './pdf.js';
import { CORPUS_PERSON, type CorpusPerson } from './people.js';

export const CORPUS_FIXTURE_VERSION = DEMO_FIXTURE_VERSION;
export const TEAM_ID = DEMO_IDS.team;

export const CORPUS_VOLUME_FLOORS = {
  people: 8,
  events: 2500,
  objects: 55,
  documents: 11,
  meetings: 11,
  pendingProposals: 14,
  boardItems: 17,
  chatSessions: 8,
  digests: 20,
  facts: 24,
} as const;

export const CORPUS_SECRETS = {
  password: DEMO_LOGIN_PASSWORD,
  githubAccess: 'gho_dev_seed_access_token_123',
  githubRefresh: 'ghr_dev_seed_refresh_token_123',
  linearAccess: 'lin_api_dev_seed_access_token_456',
  linearRefresh: 'lin_refresh_dev_seed_refresh_token_456',
  mondayAccess: 'mon_dev_seed_access_token_789',
  sentryAccess: 'sntrys_dev_seed_access_token_012',
  driveAccess: 'ya29.dev_seed_drive_access_token',
  slackBot: 'xoxb-demo-seed-acme-labs',
  ingestWebhook: 'tli_demo_seed_ledger_billing_0001',
  mcpOutbound: 'tla_demo_seed_read_key_000000000000000000000000',
  mcpInboundBearer: 'mcp_demo_seed_ledger_bearer_0001',
} as const;

type EventSource = CadenceEventSource;

export interface CorpusEvent {
  id: string;
  authorId: string;
  source: EventSource;
  occurredAt: string;
  contentText: string;
  sourceMetadata: Record<string, unknown>;
}

export interface CorpusObject {
  id: string;
  type:
    | 'person'
    | 'company'
    | 'project'
    | 'deal'
    | 'vendor'
    | 'incident'
    | 'decision'
    | 'hiring_loop'
    | 'task'
    | 'follow_up'
    | 'document'
    | 'topic';
  canonicalName: string;
  aliases?: string[];
  status: string;
  stage?: string | null;
  priority?: number | null;
  ownerUserId?: string | null;
  assigneeUserId?: string | null;
  dueAt?: string | null;
  taskCategory?: string | null;
  metadata?: Record<string, unknown>;
  identityFacets?: Array<{ kind: 'email' | 'phone'; value: string }>;
}

export interface CorpusDocument {
  id: string;
  versionId: string;
  chunkIds: string[];
  folderId: string;
  name: string;
  filename: string;
  contentType: string;
  objectKey: string;
  ownerUserId: string;
  occurredAt: string;
  body: string;
  bytes: Buffer;
  checksumSha256: string;
  byteSize: number;
  chunks: string[];
}

export interface CorpusMeeting {
  id: string;
  chunkIds: string[];
  rawEventId: string;
  title: string;
  platform: 'meet' | 'zoom' | 'teams';
  meetingUrl: string;
  startedAt: string;
  endedAt: string;
  createdByUserId: string;
  transcript: Array<{ speaker: string; text: string; startMs: number; endMs: number }>;
}

function eventId(n: number): string {
  return CORPUS_UUID.event(n);
}

function objectId(n: number): string {
  return CORPUS_UUID.object(n);
}

function meta(extra: Record<string, unknown>, payloadRef: string): Record<string, unknown> {
  return {
    fixture_version: CORPUS_FIXTURE_VERSION,
    source_payload_ref: payloadRef,
    payload_digest: `sha256:demo-seed:${payloadRef}`,
    ...extra,
  };
}

function event(
  n: number,
  author: CorpusPerson['key'],
  source: EventSource,
  occurredAt: string,
  contentText: string,
  extra: Record<string, unknown>,
  payloadRef: string,
): CorpusEvent {
  return {
    id: eventId(n),
    authorId: CORPUS_PERSON[author].id,
    source,
    occurredAt,
    contentText,
    sourceMetadata: meta(extra, payloadRef),
  };
}

const STORY_EVENTS: CorpusEvent[] = [
  event(
    1,
    'jordan',
    'integration',
    '2026-07-10T08:12:00.000Z',
    'GitHub PR #188 opened on acme-labs/atlas: Harden CSV importer against missing field maps. Author: Jordan Hale.',
    {
      provider: 'github',
      event_type: 'pull_request.opened',
      external_object_id: 'acme-labs/atlas#188',
    },
    'inline://timeline/demo-seed/github/pr-188',
  ),
  event(
    2,
    'riley',
    'slack',
    '2026-07-10T14:40:00.000Z',
    'Slack #gtm: Riley posted the Atlas beta landing-page outline. Hero line is "Evidence before the status update." Launch webinar target is August 20.',
    {
      slack_channel_name: '#gtm',
      slack_event_id: 'EvDEMOSEEDGTM001',
      capture_kind: 'channel_message',
    },
    'inline://timeline/demo-seed/slack/gtm-landing-outline',
  ),
  event(
    3,
    'avery',
    'email',
    '2026-07-13T09:05:00.000Z',
    'Email from Priya Shah at Northwind Capital: We would like a first partner meeting the week of August 4 to discuss a Series A lead. Please send the one-pager and the Northstar design-partner snapshot.',
    {
      message_id: 'demo-seed-northwind-intro-001',
      from: 'priya.shah@northwind.example',
      subject: 'Northwind Capital / Acme Labs Series A intro',
    },
    'inline://timeline/demo-seed/email/northwind-intro',
  ),
  event(
    4,
    'mika',
    'web',
    '2026-07-13T11:20:00.000Z',
    'Explicit note from Mika: Atlas beta scope is importer reliability, CSV fallback, and one design-partner launch. Dashboards stay out of v1.',
    { capture_kind: 'explicit_chat_note', command: '/timeline note', surface: 'manual_note' },
    'inline://timeline/demo-seed/note/atlas-beta-scope',
  ),
  event(
    5,
    'casey',
    'slack',
    '2026-07-14T16:10:00.000Z',
    'Slack #gtm: Casey logged Helio Retail as a new inbound. They want a 40-seat Atlas pilot in Q4 if the Northstar export path is proven.',
    {
      slack_channel_name: '#gtm',
      slack_event_id: 'EvDEMOSEEDGTM002',
      capture_kind: 'channel_message',
    },
    'inline://timeline/demo-seed/slack/helio-inbound',
  ),
  event(
    6,
    'jordan',
    'integration',
    '2026-07-15T07:44:00.000Z',
    'Sentry issue ATLAS-218: spike of 500s on /api/imports during CSV preview. Count 84 in 20 minutes. Assigned to Jordan.',
    {
      provider: 'sentry',
      event_type: 'issue.created',
      external_object_id: 'ATLAS-218',
      sentry_issue_id: 'ATLAS-218',
      sentry_short_id: 'ATLAS-218',
    },
    'inline://timeline/demo-seed/sentry/atlas-218',
  ),
  event(
    7,
    'sam',
    'telegram',
    '2026-07-15T12:02:00.000Z',
    'Telegram Acme leadership: Sam shared first-pass empty states for the importer. Avery: ship the CSV fallback copy, not a new illustration.',
    {
      telegram_chat_title: 'Acme leadership',
      capture_kind: 'group_message',
    },
    'inline://timeline/demo-seed/telegram/importer-empty-states',
  ),
  event(
    8,
    'riley',
    'integration',
    '2026-07-16T10:30:00.000Z',
    'Monday.com Launch board: "Beta webinar" moved to In progress. Owner Riley. Due August 20.',
    {
      provider: 'monday',
      event_type: 'item.status_changed',
      external_object_id: 'monday:launch:webinar',
    },
    'inline://timeline/demo-seed/monday/webinar-in-progress',
  ),
  event(
    9,
    'harper',
    'email',
    '2026-07-16T15:18:00.000Z',
    'Email from Harper: August cash forecast is 11.4 months of runway if we close Northwind as lead. Legal wants the vendor DPA signed before the diligence room opens.',
    {
      message_id: 'demo-seed-runway-forecast-001',
      from: 'harper@timeline.dev',
      subject: 'August runway and diligence room',
    },
    'inline://timeline/demo-seed/email/runway-forecast',
  ),
  event(
    10,
    'quinn',
    'web',
    '2026-07-17T08:50:00.000Z',
    'Explicit note from Quinn: open hiring loops this month are Senior backend engineer and Product designer. Target offers by August 22.',
    { capture_kind: 'explicit_chat_note', command: '/timeline note', surface: 'manual_note' },
    'inline://timeline/demo-seed/note/hiring-loops',
  ),
  event(
    11,
    'avery',
    'meeting',
    '2026-07-21T09:30:00.000Z',
    'Weekly product standup transcript: importer 500s are mitigated. Northstar field-mapping still blocks the pilot. Riley will freeze webinar copy after the August 4 Northwind meeting.',
    { platform: 'meet', title: 'Weekly product standup' },
    'inline://timeline/demo-seed/meeting/standup-2026-07-21',
  ),
  event(
    12,
    'jordan',
    'integration',
    '2026-07-21T11:05:00.000Z',
    'GitHub PR #188 merged to main. CI workflow "Importer" #1204 succeeded on acme-labs/atlas.',
    {
      provider: 'github',
      event_type: 'pull_request.merged',
      external_object_id: 'acme-labs/atlas#188',
    },
    'inline://timeline/demo-seed/github/pr-188-merged',
  ),
  event(
    13,
    'casey',
    'email',
    '2026-07-22T13:40:00.000Z',
    'Email from Dana Cole at Brightline Health: we can do a scoping call August 7. They need HIPAA language in the MSA and a sample export from a clinical ops workspace.',
    {
      message_id: 'demo-seed-brightline-scoping-001',
      from: 'dana.cole@brightline.example',
      subject: 'Brightline Health Atlas scoping',
    },
    'inline://timeline/demo-seed/email/brightline-scoping',
  ),
  event(
    14,
    'mika',
    'slack',
    '2026-07-22T17:12:00.000Z',
    'Slack #product: Mika asked Jordan to keep the Northstar field-mapping confirmation on the critical path. No new importer features until that email lands.',
    {
      slack_channel_name: '#product',
      slack_event_id: 'EvDEMOSEEDPROD001',
      capture_kind: 'channel_message',
    },
    'inline://timeline/demo-seed/slack/northstar-critical-path',
  ),
  event(
    15,
    'avery',
    'telegram',
    '2026-07-23T18:04:00.000Z',
    'Telegram Acme leadership: Avery will take the Northwind first meeting. Harper joins for runway. Mika joins only if they ask about the design partner.',
    { telegram_chat_title: 'Acme leadership', capture_kind: 'group_message' },
    'inline://timeline/demo-seed/telegram/northwind-staffing',
  ),
  event(
    16,
    'jordan',
    'ingest_webhook',
    '2026-07-24T06:15:00.000Z',
    'Ledger billing webhook: invoice inv_2041 for Northstar Works marked past_due (14 days). Amount 4800 USD. Owner success@acme.example.',
    {
      webhook_name: 'Ledger billing',
      external_object_id: 'inv_2041',
      event_type: 'invoice.past_due',
    },
    'inline://timeline/demo-seed/webhook/northstar-invoice-past-due',
  ),
  event(
    17,
    'sam',
    'web',
    '2026-07-24T15:33:00.000Z',
    'Explicit note from Sam: brand voice for the webinar is quiet, specific, and citation-first. No "AI-powered" in the hero.',
    { capture_kind: 'explicit_chat_note', command: '/timeline note', surface: 'manual_note' },
    'inline://timeline/demo-seed/note/brand-voice',
  ),
  event(
    18,
    'casey',
    'slack',
    '2026-07-27T15:50:00.000Z',
    'Slack #gtm: Casey moved Moss & Co to Qualified after a 30-minute intro. They have an existing Monday.com workflow they do not want to abandon.',
    {
      slack_channel_name: '#gtm',
      slack_event_id: 'EvDEMOSEEDGTM003',
      capture_kind: 'channel_message',
    },
    'inline://timeline/demo-seed/slack/moss-qualified',
  ),
  event(
    19,
    'quinn',
    'email',
    '2026-07-27T09:10:00.000Z',
    'Email from Quinn to the team: designer interviews start July 30. Loop owners are Sam (craft) and Mika (product sense). Please keep scorecards in the hiring object, not in Slack.',
    {
      message_id: 'demo-seed-designer-interviews-001',
      from: 'quinn@timeline.dev',
      subject: 'Designer interview loop is live',
    },
    'inline://timeline/demo-seed/email/designer-loop',
  ),
  event(
    20,
    'avery',
    'meeting',
    '2026-07-28T09:30:00.000Z',
    'Weekly product standup transcript: Northstar still waiting on field-mapping. Helio and Brightline are real pipeline. Diligence room opens after the DPA signature.',
    { platform: 'meet', title: 'Weekly product standup' },
    'inline://timeline/demo-seed/meeting/standup-2026-07-28',
  ),
  event(
    21,
    'harper',
    'document',
    '2026-07-28T14:05:00.000Z',
    'Harper uploaded Vendor DPA excerpt.pdf to Documents / People & Ops. Legal wants this signed before Northwind sees the data room.',
    {
      filename: 'Vendor DPA excerpt.pdf',
      folder: 'People & Ops',
      document_id: CORPUS_UUID.document(6),
    },
    'inline://timeline/demo-seed/document/vendor-dpa',
  ),
  event(
    22,
    'jordan',
    'integration',
    '2026-07-29T08:22:00.000Z',
    'Linear issue ATL-214 moved to In Review: Replay CSV preview without calling the live importer. Owner Jordan.',
    {
      provider: 'linear',
      event_type: 'issue.updated',
      external_object_id: 'ATL-214',
    },
    'inline://timeline/demo-seed/linear/atl-214',
  ),
  event(
    23,
    'riley',
    'email',
    '2026-07-29T19:40:00.000Z',
    'Email from Riley: webinar landing page is in review. Need Avery quote, Northstar anonymized timeline screenshot, and the August 20 date locked on the calendar.',
    {
      message_id: 'demo-seed-webinar-review-001',
      from: 'riley@timeline.dev',
      subject: 'Webinar landing page review',
    },
    'inline://timeline/demo-seed/email/webinar-review',
  ),
  event(
    24,
    'casey',
    'slack',
    '2026-07-30T16:45:00.000Z',
    'Slack #gtm: Kite Logistics went cold after asking for on-prem. Casey will park them in Lost unless they accept the EU SaaS posture.',
    {
      slack_channel_name: '#gtm',
      slack_event_id: 'EvDEMOSEEDGTM004',
      capture_kind: 'channel_message',
    },
    'inline://timeline/demo-seed/slack/kite-onprem',
  ),
  event(
    25,
    'sam',
    'web',
    '2026-07-30T18:12:00.000Z',
    'Explicit note from Sam after the first designer interview: candidate Maya Chen has strong systems craft, weaker product narrative. Second interview scheduled.',
    { capture_kind: 'explicit_chat_note', command: '/timeline note', surface: 'manual_note' },
    'inline://timeline/demo-seed/note/maya-chen-interview',
  ),
  event(
    26,
    'mika',
    'telegram',
    '2026-07-31T11:08:00.000Z',
    'Telegram Acme leadership: Mika recommends we do not promise Brightline a clinical-ops template in v1. Offer CSV + evidence packs only.',
    { telegram_chat_title: 'Acme leadership', capture_kind: 'group_message' },
    'inline://timeline/demo-seed/telegram/brightline-scope',
  ),
  event(
    27,
    'avery',
    'email',
    '2026-08-03T08:15:00.000Z',
    'Email from Avery to Priya Shah: attaching the investor one-pager and confirming August 6 16:00 Helsinki / 09:00 New York for the Northwind partner meeting. Consent noted for Timeline bot join.',
    {
      message_id: 'demo-seed-northwind-confirm-001',
      from: 'owner@timeline.dev',
      subject: 'Confirmed: Northwind partner meeting 6 Aug',
    },
    'inline://timeline/demo-seed/email/northwind-confirm',
  ),
  event(
    28,
    'jordan',
    'integration',
    '2026-08-03T09:50:00.000Z',
    'Sentry ATLAS-218 marked resolved. Error rate back to baseline after the CSV preview replay shipped.',
    {
      provider: 'sentry',
      event_type: 'issue.resolved',
      external_object_id: 'ATLAS-218',
      sentry_issue_id: 'ATLAS-218',
      sentry_short_id: 'ATLAS-218',
    },
    'inline://timeline/demo-seed/sentry/atlas-218-resolved',
  ),
  event(
    29,
    'avery',
    'meeting',
    '2026-08-04T09:30:00.000Z',
    'Weekly product standup transcript: importer is calm. Diligence room checklist is Harper plus Quinn. Casey will send Brightline the MSA excerpt, not a new template.',
    { platform: 'meet', title: 'Weekly product standup' },
    'inline://timeline/demo-seed/meeting/standup-2026-08-04',
  ),
  event(
    30,
    'quinn',
    'document',
    '2026-08-04T12:40:00.000Z',
    'Quinn uploaded Helsinki office rules.pdf and Code of conduct.pdf so new hires can be cited from Documents instead of a Notion page.',
    {
      filename: 'Helsinki office rules.pdf',
      folder: 'People & Ops',
      document_id: CORPUS_UUID.document(2),
    },
    'inline://timeline/demo-seed/document/office-rules',
  ),
  event(
    31,
    'casey',
    'email',
    '2026-08-05T15:05:00.000Z',
    'Email from Luca Moretti at Orchard Finance: they want a proposal for a 12-seat research workspace. Budget owner is in September. Keep them in Scoping.',
    {
      message_id: 'demo-seed-orchard-proposal-001',
      from: 'luca.moretti@orchard.example',
      subject: 'Orchard Finance workspace proposal',
    },
    'inline://timeline/demo-seed/email/orchard-scoping',
  ),
  event(
    32,
    'avery',
    'meeting',
    '2026-08-06T13:00:00.000Z',
    'Northwind Capital partner meeting transcript: Priya asked for Northstar proof, runway, and hiring plan. Avery committed to a data-room link by August 13. No term sheet this meeting.',
    { platform: 'meet', title: 'Northwind Capital partner meeting' },
    'inline://timeline/demo-seed/meeting/northwind-2026-08-06',
  ),
  event(
    33,
    'harper',
    'slack',
    '2026-08-06T15:22:00.000Z',
    'Slack #gtm: Harper: Northwind wants 11 months runway, not 18. We should not reforecast unless the designer hire slips.',
    {
      slack_channel_name: '#gtm',
      slack_event_id: 'EvDEMOSEEDGTM005',
      capture_kind: 'channel_message',
    },
    'inline://timeline/demo-seed/slack/northwind-runway',
  ),
  event(
    34,
    'mika',
    'web',
    '2026-08-07T10:18:00.000Z',
    'Explicit note from Mika after Brightline scoping: they accepted CSV + evidence packs. HIPAA language stays in the MSA excerpt. No clinical template in v1.',
    { capture_kind: 'explicit_chat_note', command: '/timeline note', surface: 'manual_note' },
    'inline://timeline/demo-seed/note/brightline-accepted-scope',
  ),
  event(
    35,
    'riley',
    'integration',
    '2026-08-07T14:11:00.000Z',
    'Monday.com Launch board: "Investor one-pager" moved to Done. "Beta webinar" still In progress, blocked on Avery quote.',
    {
      provider: 'monday',
      event_type: 'item.status_changed',
      external_object_id: 'monday:launch:one-pager',
    },
    'inline://timeline/demo-seed/monday/one-pager-done',
  ),
  event(
    36,
    'casey',
    'slack',
    '2026-08-10T17:36:00.000Z',
    'Slack #gtm: Polar Studio asked for a founder-led demo on August 19. Tiny deal, useful logo. Casey wants them in New once the board proposal lands.',
    {
      slack_channel_name: '#gtm',
      slack_event_id: 'EvDEMOSEEDGTM006',
      capture_kind: 'channel_message',
    },
    'inline://timeline/demo-seed/slack/polar-studio',
  ),
  event(
    37,
    'jordan',
    'integration',
    '2026-08-11T07:58:00.000Z',
    'GitHub release atlas-0.8.0 tagged. Notes: CSV preview replay, quieter import errors, no dashboard work.',
    {
      provider: 'github',
      event_type: 'release.published',
      external_object_id: 'acme-labs/atlas@atlas-0.8.0',
    },
    'inline://timeline/demo-seed/github/atlas-0-8-0',
  ),
  event(
    38,
    'avery',
    'meeting',
    '2026-08-11T09:30:00.000Z',
    'Weekly product standup transcript: Northstar is still the proof point for Northwind. Field-mapping email has not arrived. Webinar stays August 20. Designer loop: Maya Chen to final round.',
    { platform: 'meet', title: 'Weekly product standup' },
    'inline://timeline/demo-seed/meeting/standup-2026-08-11',
  ),
  event(
    39,
    'harper',
    'document',
    '2026-08-11T13:20:00.000Z',
    'Harper uploaded Series A investor one-pager.md and Atlas strategy memo.md to Fundraising and Product folders.',
    {
      filename: 'Series A investor one-pager.md',
      folder: 'Fundraising',
      document_id: CORPUS_UUID.document(3),
    },
    'inline://timeline/demo-seed/document/one-pager',
  ),
  event(
    40,
    'avery',
    'email',
    '2026-08-12T08:40:00.000Z',
    'Email from Elena Park at Northstar Works: field-mapping confirmation is delayed until August 19 because their data team is in a freeze. Pilot review should move to August 26.',
    {
      message_id: 'demo-seed-northstar-delay-001',
      from: 'elena.park@northstar.example',
      subject: 'Northstar field-mapping delay',
    },
    'inline://timeline/demo-seed/email/northstar-delay',
  ),
  event(
    41,
    'mika',
    'slack',
    '2026-08-12T09:12:00.000Z',
    'Slack #product: Mika: we keep the CSV fallback decision. I will tell Northwind the proof is delayed one week, not cancelled.',
    {
      slack_channel_name: '#product',
      slack_event_id: 'EvDEMOSEEDPROD002',
      capture_kind: 'channel_message',
    },
    'inline://timeline/demo-seed/slack/northstar-delay-response',
  ),
  event(
    42,
    'quinn',
    'web',
    '2026-08-12T15:47:00.000Z',
    'Explicit note from Quinn: backend engineer loop produced no offer this week. Reopen sourcing on August 18. Designer final round with Maya Chen is August 15.',
    { capture_kind: 'explicit_chat_note', command: '/timeline note', surface: 'manual_note' },
    'inline://timeline/demo-seed/note/hiring-status',
  ),
  event(
    43,
    'casey',
    'email',
    '2026-08-13T16:02:00.000Z',
    'Email from Casey to Helio Retail: sharing the anonymized Northstar handoff brief and proposing a technical validation on August 21. They remain in Qualified.',
    {
      message_id: 'demo-seed-helio-followup-001',
      from: 'casey@timeline.dev',
      subject: 'Helio Retail technical validation',
    },
    'inline://timeline/demo-seed/email/helio-followup',
  ),
  event(
    44,
    'jordan',
    'ingest_webhook',
    '2026-08-13T07:05:00.000Z',
    'Ledger billing webhook: invoice inv_2041 for Northstar Works paid. Amount 4800 USD. Past-due flag cleared.',
    {
      webhook_name: 'Ledger billing',
      external_object_id: 'inv_2041',
      event_type: 'invoice.paid',
    },
    'inline://timeline/demo-seed/webhook/northstar-invoice-paid',
  ),
  event(
    45,
    'avery',
    'telegram',
    '2026-08-13T18:30:00.000Z',
    'Telegram Acme leadership: Avery sent Northwind the data-room link. Diligence Q&A is Harper. Product questions route to Mika. No new features for the deck.',
    { telegram_chat_title: 'Acme leadership', capture_kind: 'group_message' },
    'inline://timeline/demo-seed/telegram/dataroom-sent',
  ),
  event(
    46,
    'riley',
    'calendar',
    '2026-08-14T09:00:00.000Z',
    'Atlas beta webinar | public launch event | 2026-08-20T15:00:00.000Z to 2026-08-20T16:00:00.000Z | (Europe/Helsinki)',
    {
      provider: 'calendar',
      action: 'scheduled',
      title: 'Atlas beta webinar',
      calendar_event_id: CORPUS_UUID.calendar(1),
    },
    'inline://timeline/demo-seed/calendar/webinar-scheduled',
  ),
  event(
    47,
    'sam',
    'slack',
    '2026-08-14T11:25:00.000Z',
    'Slack #product: Sam uploaded the pitch narrative to Documents. Please cite it in Ask instead of restating the story in Slack.',
    {
      slack_channel_name: '#product',
      slack_event_id: 'EvDEMOSEEDPROD003',
      capture_kind: 'channel_message',
    },
    'inline://timeline/demo-seed/slack/pitch-narrative',
  ),
  event(
    48,
    'mika',
    'web',
    '2026-08-14T13:08:00.000Z',
    'Explicit note from Mika: last week we shipped atlas-0.8.0, opened the Northwind data room, kept Northstar on CSV fallback, and moved Brightline to proposal. Still blocked on field-mapping.',
    { capture_kind: 'explicit_chat_note', command: '/timeline note', surface: 'manual_note' },
    'inline://timeline/demo-seed/note/last-week-recap',
  ),
  event(
    49,
    'jordan',
    'integration',
    '2026-08-14T14:44:00.000Z',
    'Linear issue NORTH-42 comment: still blocked on Northstar field-mapping confirmation. Due date moved to August 26 to match Elena Park email.',
    {
      provider: 'linear',
      event_type: 'comment.created',
      external_object_id: 'NORTH-42',
    },
    'inline://timeline/demo-seed/linear/north-42-comment',
  ),
  event(
    50,
    'casey',
    'slack',
    '2026-07-17T19:20:00.000Z',
    'Slack #gtm: Harbor Peak asked for a pre-seed catch-up, not a Series A check. Avery will take a 20-minute call and keep them off the lead path.',
    {
      slack_channel_name: '#gtm',
      slack_event_id: 'EvDEMOSEEDGTM007',
      capture_kind: 'channel_message',
    },
    'inline://timeline/demo-seed/slack/harbor-peak',
  ),
  event(
    51,
    'riley',
    'email',
    '2026-07-20T12:00:00.000Z',
    'Forwarded email from press@therecord.example: they want a backgrounder on evidence-backed work history. Riley will reply after the one-pager is public-safe.',
    {
      message_id: 'demo-seed-press-backgrounder-001',
      from: 'press@therecord.example',
      subject: 'Backgrounder request',
    },
    'inline://timeline/demo-seed/email/press-backgrounder',
  ),
  event(
    52,
    'harper',
    'web',
    '2026-07-21T16:40:00.000Z',
    'Explicit note from Harper: signed the vendor DPA in principle; wet-ink follow-up is Quinn. Diligence room stays closed until the PDF is in Documents.',
    { capture_kind: 'explicit_chat_note', command: '/timeline note', surface: 'manual_note' },
    'inline://timeline/demo-seed/note/dpa-in-principle',
  ),
  event(
    53,
    'jordan',
    'integration',
    '2026-07-23T08:05:00.000Z',
    'GitHub workflow "Importer" #1198 failed on acme-labs/atlas, then succeeded on retry #1199. Failure was a flake in preview snapshot tests.',
    {
      provider: 'github',
      event_type: 'workflow_run.failure',
      external_object_id: 'acme-labs/atlas:Importer:main',
    },
    'inline://timeline/demo-seed/github/importer-flake',
  ),
  event(
    54,
    'casey',
    'email',
    '2026-08-01T18:22:00.000Z',
    'Email from Nadia Holm at Linden Ventures: we are happy to follow a Northwind lead. Send the same data room. No separate process.',
    {
      message_id: 'demo-seed-linden-follow-001',
      from: 'nadia.holm@linden.example',
      subject: 'Linden Ventures follow-on',
    },
    'inline://timeline/demo-seed/email/linden-follow',
  ),
  event(
    55,
    'sam',
    'telegram',
    '2026-08-05T12:55:00.000Z',
    'Telegram Acme leadership: Sam needs a real Northstar screenshot with names changed before the webinar. Mika will crop the handoff brief.',
    { telegram_chat_title: 'Acme leadership', capture_kind: 'group_message' },
    'inline://timeline/demo-seed/telegram/webinar-screenshot',
  ),
  event(
    56,
    'mika',
    'meeting',
    '2026-07-15T13:00:00.000Z',
    'Importer incident review transcript: Jordan walked through ATLAS-218. Decision: replay CSV preview from stored bytes, never from the live vendor endpoint.',
    { platform: 'meet', title: 'Importer incident review' },
    'inline://timeline/demo-seed/meeting/incident-review-2026-07-15',
  ),
  event(
    57,
    'avery',
    'calendar',
    '2026-08-06T12:55:00.000Z',
    'Northwind Capital partner meeting | 2026-08-06T13:00:00.000Z to 2026-08-06T13:45:00.000Z | (Europe/Helsinki)',
    {
      provider: 'calendar',
      action: 'event',
      title: 'Northwind Capital partner meeting',
      calendar_event_id: CORPUS_UUID.calendar(8),
    },
    'inline://timeline/demo-seed/calendar/northwind-event',
  ),
  event(
    58,
    'quinn',
    'slack',
    '2026-08-08T10:14:00.000Z',
    'Slack #product: Quinn posted the new-hire onboarding doc. First week is Timeline, office rules, and the code of conduct. No separate wiki.',
    {
      slack_channel_name: '#product',
      slack_event_id: 'EvDEMOSEEDPROD004',
      capture_kind: 'channel_message',
    },
    'inline://timeline/demo-seed/slack/onboarding-doc',
  ),
  event(
    59,
    'riley',
    'integration',
    '2026-08-12T16:30:00.000Z',
    'Monday.com Launch board comment on Beta webinar: speakers are Avery and Mika. Riley hosts. Need 40-minute run of show by August 18.',
    {
      provider: 'monday',
      event_type: 'update.created',
      external_object_id: 'monday:launch:webinar',
    },
    'inline://timeline/demo-seed/monday/webinar-speakers',
  ),
  event(
    60,
    'casey',
    'web',
    '2026-08-14T16:50:00.000Z',
    'Explicit note from Casey: dealflow this week is Helio Qualified, Brightline Proposal, Orchard Scoping, Polar inbound (not on the board yet), Moss Qualified, Kite Lost. Series A stays with Northwind lead and Linden follow.',
    { capture_kind: 'explicit_chat_note', command: '/timeline note', surface: 'manual_note' },
    'inline://timeline/demo-seed/note/dealflow-week',
  ),
  event(
    3000,
    'casey',
    'meeting',
    '2026-08-07T14:00:00.000Z',
    'Brightline Health scoping call transcript: Dana accepted CSV plus evidence packs. HIPAA stays in the MSA excerpt. No clinical template in v1.',
    { platform: 'meet', title: 'Brightline Health scoping' },
    'inline://timeline/demo-seed/meeting/brightline-scoping-2026-08-07',
  ),
  event(
    3001,
    'sam',
    'meeting',
    '2026-07-30T15:00:00.000Z',
    'Maya Chen designer interview transcript: strong systems craft, thinner product narrative. Quinn moved her to final round.',
    { platform: 'meet', title: 'Maya Chen designer interview' },
    'inline://timeline/demo-seed/meeting/maya-chen-2026-07-30',
  ),
  event(
    3002,
    'riley',
    'calendar',
    '2026-08-14T12:00:00.000Z',
    'Webinar dry-run blocked on Avery quote | 2026-08-18T13:00:00.000Z to 2026-08-18T13:40:00.000Z | (Europe/Helsinki)',
    {
      provider: 'calendar',
      action: 'scheduled',
      title: 'Webinar dry run',
      calendar_event_id: CORPUS_UUID.calendar(6),
    },
    'inline://timeline/demo-seed/calendar/webinar-dry-run',
  ),
  event(
    3003,
    'avery',
    'calendar',
    '2026-07-17T18:00:00.000Z',
    'Harbor Peak courtesy call stays off the lead slide | 2026-07-24T14:00:00.000Z to 2026-07-24T14:20:00.000Z | (Europe/Helsinki)',
    {
      provider: 'calendar',
      action: 'scheduled',
      title: 'Harbor Peak courtesy call',
      calendar_event_id: CORPUS_UUID.calendar(7),
    },
    'inline://timeline/demo-seed/calendar/harbor-peak-call',
  ),
  event(
    3004,
    'quinn',
    'calendar',
    '2026-08-08T10:20:00.000Z',
    'Maya Chen final round | 2026-08-15T13:00:00.000Z to 2026-08-15T14:00:00.000Z | (Europe/Helsinki)',
    {
      provider: 'calendar',
      action: 'scheduled',
      title: 'Maya Chen final round',
      calendar_event_id: CORPUS_UUID.calendar(2),
    },
    'inline://timeline/demo-seed/calendar/maya-chen-final',
  ),
  event(
    3005,
    'casey',
    'calendar',
    '2026-08-13T16:40:00.000Z',
    'Helio Retail technical validation | 2026-08-21T15:00:00.000Z to 2026-08-21T16:00:00.000Z | (Europe/Helsinki)',
    {
      provider: 'calendar',
      action: 'scheduled',
      title: 'Helio Retail technical validation',
      calendar_event_id: CORPUS_UUID.calendar(3),
    },
    'inline://timeline/demo-seed/calendar/helio-validation',
  ),
  event(
    3006,
    'casey',
    'calendar',
    '2026-08-04T15:55:00.000Z',
    'Polar Studio founder demo | 2026-08-19T14:00:00.000Z to 2026-08-19T14:30:00.000Z | (Europe/Helsinki)',
    {
      provider: 'calendar',
      action: 'scheduled',
      title: 'Polar Studio founder demo',
      calendar_event_id: CORPUS_UUID.calendar(4),
    },
    'inline://timeline/demo-seed/calendar/polar-founder-demo',
  ),
  event(
    3007,
    'harper',
    'calendar',
    '2026-08-13T18:45:00.000Z',
    'Northwind diligence working session | 2026-08-19T09:00:00.000Z to 2026-08-19T10:30:00.000Z | (Europe/Helsinki)',
    {
      provider: 'calendar',
      action: 'scheduled',
      title: 'Northwind diligence working session',
      calendar_event_id: CORPUS_UUID.calendar(5),
    },
    'inline://timeline/demo-seed/calendar/northwind-diligence',
  ),
];

const RAW_CORPUS_EVENTS: CorpusEvent[] = [
  ...STORY_EVENTS,
  ...buildCadenceBeats().map((beat) =>
    event(
      beat.n,
      beat.author,
      beat.source,
      beat.occurredAt,
      beat.contentText,
      beat.extra,
      beat.payloadRef,
    ),
  ),
];

const OBJECT_DEFS: Array<Omit<CorpusObject, 'id'> & { n: number }> = [
  {
    n: 1,
    type: 'company',
    canonicalName: 'Northstar Works',
    aliases: ['Northstar'],
    status: 'active',
    ownerUserId: CORPUS_PERSON.casey.id,
    metadata: { domain: 'northstar.example', relationship: 'design_partner' },
  },
  {
    n: 2,
    type: 'person',
    canonicalName: 'Elena Park',
    aliases: ['Elena'],
    status: 'active',
    ownerUserId: CORPUS_PERSON.casey.id,
    metadata: { role: 'Customer lead' },
    identityFacets: [{ kind: 'email', value: 'elena.park@northstar.example' }],
  },
  {
    n: 3,
    type: 'company',
    canonicalName: 'Northwind Capital',
    aliases: ['Northwind'],
    status: 'active',
    ownerUserId: CORPUS_PERSON.avery.id,
    metadata: { domain: 'northwind.example', relationship: 'investor' },
  },
  {
    n: 4,
    type: 'person',
    canonicalName: 'Priya Shah',
    aliases: ['Priya'],
    status: 'active',
    ownerUserId: CORPUS_PERSON.avery.id,
    metadata: { role: 'Partner' },
    identityFacets: [{ kind: 'email', value: 'priya.shah@northwind.example' }],
  },
  {
    n: 5,
    type: 'company',
    canonicalName: 'Linden Ventures',
    status: 'active',
    ownerUserId: CORPUS_PERSON.avery.id,
    metadata: { domain: 'linden.example', relationship: 'investor' },
  },
  {
    n: 6,
    type: 'company',
    canonicalName: 'Harbor Peak',
    status: 'active',
    ownerUserId: CORPUS_PERSON.avery.id,
    metadata: { domain: 'harborpeak.example', relationship: 'investor' },
  },
  {
    n: 7,
    type: 'project',
    canonicalName: 'Series A process',
    aliases: ['Series A'],
    status: 'active',
    stage: 'diligence',
    priority: 1,
    ownerUserId: CORPUS_PERSON.avery.id,
  },
  {
    n: 8,
    type: 'deal',
    canonicalName: 'Northwind Capital lead',
    status: 'qualified',
    stage: 'diligence',
    priority: 1,
    ownerUserId: CORPUS_PERSON.avery.id,
    assigneeUserId: CORPUS_PERSON.harper.id,
  },
  {
    n: 9,
    type: 'deal',
    canonicalName: 'Linden Ventures follow',
    status: 'open',
    stage: 'intro',
    ownerUserId: CORPUS_PERSON.avery.id,
  },
  {
    n: 10,
    type: 'deal',
    canonicalName: 'Harbor Peak catch-up',
    status: 'open',
    stage: 'intro',
    ownerUserId: CORPUS_PERSON.avery.id,
  },
  {
    n: 11,
    type: 'deal',
    canonicalName: 'Helio Retail pilot',
    status: 'qualified',
    stage: 'qualified',
    priority: 2,
    ownerUserId: CORPUS_PERSON.casey.id,
  },
  {
    n: 12,
    type: 'deal',
    canonicalName: 'Brightline Health',
    status: 'proposal',
    stage: 'proposal',
    priority: 2,
    ownerUserId: CORPUS_PERSON.casey.id,
    assigneeUserId: CORPUS_PERSON.mika.id,
  },
  {
    n: 13,
    type: 'deal',
    canonicalName: 'Moss & Co',
    status: 'qualified',
    stage: 'qualified',
    ownerUserId: CORPUS_PERSON.casey.id,
  },
  {
    n: 14,
    type: 'deal',
    canonicalName: 'Orchard Finance',
    status: 'open',
    stage: 'scoping',
    ownerUserId: CORPUS_PERSON.casey.id,
  },
  {
    n: 15,
    type: 'deal',
    canonicalName: 'Kite Logistics',
    status: 'lost',
    stage: 'lost',
    ownerUserId: CORPUS_PERSON.casey.id,
    metadata: { lost_reason: 'Requested on-prem' },
  },
  {
    n: 16,
    type: 'deal',
    canonicalName: 'Polar Studio',
    status: 'open',
    stage: 'new',
    ownerUserId: CORPUS_PERSON.casey.id,
  },
  {
    n: 17,
    type: 'incident',
    canonicalName: 'CSV preview 500s',
    aliases: ['ATLAS-218'],
    status: 'resolved',
    stage: 'postmortem',
    ownerUserId: CORPUS_PERSON.jordan.id,
  },
  {
    n: 18,
    type: 'decision',
    canonicalName: 'Replay CSV preview from stored bytes',
    status: 'accepted',
    stage: 'decided',
    ownerUserId: CORPUS_PERSON.jordan.id,
  },
  {
    n: 19,
    type: 'decision',
    canonicalName: 'No clinical-ops template in Atlas v1',
    status: 'accepted',
    stage: 'decided',
    ownerUserId: CORPUS_PERSON.mika.id,
  },
  {
    n: 20,
    type: 'decision',
    canonicalName: 'Northwind is the Series A lead',
    status: 'accepted',
    stage: 'decided',
    ownerUserId: CORPUS_PERSON.avery.id,
  },
  {
    n: 21,
    type: 'hiring_loop',
    canonicalName: 'Senior backend engineer',
    status: 'sourcing',
    stage: 'sourcing',
    ownerUserId: CORPUS_PERSON.quinn.id,
    assigneeUserId: CORPUS_PERSON.jordan.id,
  },
  {
    n: 22,
    type: 'hiring_loop',
    canonicalName: 'Product designer',
    status: 'interviewing',
    stage: 'final_round',
    ownerUserId: CORPUS_PERSON.quinn.id,
    assigneeUserId: CORPUS_PERSON.sam.id,
  },
  {
    n: 23,
    type: 'person',
    canonicalName: 'Maya Chen',
    status: 'active',
    ownerUserId: CORPUS_PERSON.quinn.id,
    metadata: { role: 'Designer candidate' },
  },
  {
    n: 24,
    type: 'task',
    canonicalName: 'Send Northwind data room',
    status: 'done',
    stage: 'done',
    priority: 1,
    ownerUserId: CORPUS_PERSON.avery.id,
    assigneeUserId: CORPUS_PERSON.harper.id,
    dueAt: '2026-08-13T17:00:00.000Z',
    taskCategory: 'finance',
  },
  {
    n: 25,
    type: 'task',
    canonicalName: 'Lock webinar run of show',
    status: 'doing',
    stage: 'doing',
    ownerUserId: CORPUS_PERSON.riley.id,
    assigneeUserId: CORPUS_PERSON.riley.id,
    dueAt: '2026-08-18T17:00:00.000Z',
    taskCategory: 'marketing',
  },
  {
    n: 26,
    type: 'task',
    canonicalName: 'Crop Northstar screenshot for webinar',
    status: 'todo',
    stage: 'todo',
    ownerUserId: CORPUS_PERSON.mika.id,
    assigneeUserId: CORPUS_PERSON.sam.id,
    dueAt: '2026-08-16T17:00:00.000Z',
    taskCategory: 'design',
  },
  {
    n: 27,
    type: 'task',
    canonicalName: 'Reopen backend engineer sourcing',
    status: 'todo',
    stage: 'todo',
    ownerUserId: CORPUS_PERSON.quinn.id,
    dueAt: '2026-08-18T09:00:00.000Z',
    taskCategory: 'people_recruiting',
  },
  {
    n: 28,
    type: 'task',
    canonicalName: 'Move Northstar pilot review to August 26',
    status: 'todo',
    stage: 'todo',
    ownerUserId: CORPUS_PERSON.mika.id,
    assigneeUserId: CORPUS_PERSON.mika.id,
    dueAt: '2026-08-19T17:00:00.000Z',
    taskCategory: 'customer_success',
  },
  {
    n: 29,
    type: 'task',
    canonicalName: 'Prepare Brightline MSA excerpt',
    status: 'doing',
    stage: 'doing',
    ownerUserId: CORPUS_PERSON.casey.id,
    assigneeUserId: CORPUS_PERSON.harper.id,
    dueAt: '2026-08-15T17:00:00.000Z',
    taskCategory: 'legal_compliance',
  },
  {
    n: 30,
    type: 'follow_up',
    canonicalName: 'Ping Elena Park on field-mapping',
    status: 'todo',
    ownerUserId: CORPUS_PERSON.casey.id,
    dueAt: '2026-08-19T15:00:00.000Z',
  },
  {
    n: 31,
    type: 'follow_up',
    canonicalName: 'Helio technical validation August 21',
    status: 'todo',
    ownerUserId: CORPUS_PERSON.casey.id,
    dueAt: '2026-08-21T16:00:00.000Z',
  },
  {
    n: 32,
    type: 'vendor',
    canonicalName: 'Northwind diligence counsel',
    status: 'active',
    ownerUserId: CORPUS_PERSON.harper.id,
  },
  {
    n: 33,
    type: 'topic',
    canonicalName: 'Atlas beta webinar',
    status: 'active',
    ownerUserId: CORPUS_PERSON.riley.id,
  },
  {
    n: 34,
    type: 'topic',
    canonicalName: 'CSV importer reliability',
    status: 'active',
    ownerUserId: CORPUS_PERSON.jordan.id,
  },
  {
    n: 35,
    type: 'person',
    canonicalName: 'Dana Cole',
    status: 'active',
    ownerUserId: CORPUS_PERSON.casey.id,
    metadata: { role: 'Buyer' },
    identityFacets: [{ kind: 'email', value: 'dana.cole@brightline.example' }],
  },
  {
    n: 36,
    type: 'person',
    canonicalName: 'Dana Cole champion',
    status: 'active',
    ownerUserId: CORPUS_PERSON.casey.id,
    metadata: { note: 'Duplicate label retired; use Dana Cole' },
  },
  {
    n: 37,
    type: 'company',
    canonicalName: 'Helio Retail',
    status: 'active',
    ownerUserId: CORPUS_PERSON.casey.id,
    metadata: { domain: 'helio.example' },
  },
  {
    n: 38,
    type: 'company',
    canonicalName: 'Brightline Health account',
    status: 'active',
    ownerUserId: CORPUS_PERSON.casey.id,
    metadata: { domain: 'brightline.example' },
  },
  {
    n: 39,
    type: 'task',
    canonicalName: 'Write Avery webinar quote',
    status: 'blocked',
    stage: 'blocked',
    ownerUserId: CORPUS_PERSON.riley.id,
    assigneeUserId: CORPUS_PERSON.avery.id,
    dueAt: '2026-08-17T17:00:00.000Z',
    taskCategory: 'marketing',
  },
  {
    n: 40,
    type: 'task',
    canonicalName: 'Schedule Maya Chen final round',
    status: 'doing',
    stage: 'doing',
    ownerUserId: CORPUS_PERSON.quinn.id,
    dueAt: '2026-08-15T16:00:00.000Z',
    taskCategory: 'people_recruiting',
  },
  {
    n: 41,
    type: 'project',
    canonicalName: 'GTM launch system',
    status: 'active',
    stage: 'active',
    ownerUserId: CORPUS_PERSON.riley.id,
  },
  {
    n: 42,
    type: 'decision',
    canonicalName: 'Quiet citation-first brand voice',
    status: 'accepted',
    stage: 'decided',
    ownerUserId: CORPUS_PERSON.sam.id,
  },
  {
    n: 43,
    type: 'company',
    canonicalName: 'Polar Studio account',
    status: 'active',
    ownerUserId: CORPUS_PERSON.casey.id,
    metadata: { domain: 'polarstudio.example' },
  },
  {
    n: 44,
    type: 'company',
    canonicalName: 'Moss & Co account',
    status: 'active',
    ownerUserId: CORPUS_PERSON.casey.id,
    metadata: { domain: 'moss.example' },
  },
  {
    n: 45,
    type: 'company',
    canonicalName: 'Orchard Finance account',
    status: 'active',
    ownerUserId: CORPUS_PERSON.casey.id,
    metadata: { domain: 'orchard.example' },
  },
  {
    n: 46,
    type: 'company',
    canonicalName: 'Kite Logistics account',
    status: 'archived',
    ownerUserId: CORPUS_PERSON.casey.id,
    metadata: { domain: 'kite.example', reason: 'on_prem' },
  },
  {
    n: 47,
    type: 'task',
    canonicalName: 'Answer Northwind diligence Q&A',
    status: 'doing',
    stage: 'doing',
    ownerUserId: CORPUS_PERSON.harper.id,
    dueAt: '2026-08-19T17:00:00.000Z',
    taskCategory: 'finance',
  },
  {
    n: 48,
    type: 'task',
    canonicalName: 'Record webinar dry run',
    status: 'todo',
    stage: 'todo',
    ownerUserId: CORPUS_PERSON.riley.id,
    dueAt: '2026-08-18T16:00:00.000Z',
    taskCategory: 'marketing',
  },
  {
    n: 49,
    type: 'follow_up',
    canonicalName: 'Send one-pager to Linden Ventures',
    status: 'todo',
    ownerUserId: CORPUS_PERSON.avery.id,
    dueAt: '2026-08-16T17:00:00.000Z',
  },
  {
    n: 50,
    type: 'follow_up',
    canonicalName: 'Press backgrounder for The Record',
    status: 'todo',
    ownerUserId: CORPUS_PERSON.riley.id,
    dueAt: '2026-08-22T17:00:00.000Z',
  },
  {
    n: 51,
    type: 'task',
    canonicalName: 'Map Moss Monday.com keep-vs-replace',
    status: 'todo',
    stage: 'todo',
    ownerUserId: CORPUS_PERSON.casey.id,
    assigneeUserId: CORPUS_PERSON.mika.id,
    dueAt: '2026-08-20T17:00:00.000Z',
    taskCategory: 'customer_success',
  },
  {
    n: 52,
    type: 'decision',
    canonicalName: 'Harbor Peak is not a Series A lead',
    status: 'accepted',
    stage: 'decided',
    ownerUserId: CORPUS_PERSON.avery.id,
  },
  {
    n: 53,
    type: 'incident',
    canonicalName: 'Ledger webhook signature mismatch',
    aliases: ['ATLAS-241'],
    status: 'resolved',
    ownerUserId: CORPUS_PERSON.jordan.id,
  },
  {
    n: 54,
    type: 'document',
    canonicalName: 'Helsinki office rules',
    status: 'active',
    ownerUserId: CORPUS_PERSON.quinn.id,
  },
];

export const CORPUS_OBJECTS: CorpusObject[] = OBJECT_DEFS.map((row) => {
  const { n, ...rest } = row;
  return { id: objectId(n), ...rest };
});

{
  const names = CORPUS_OBJECTS.map((row) => row.canonicalName.toLowerCase());
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate corpus object names: ${[...new Set(duplicates)].join(', ')}`);
  }
}

export function corpusObjectId(name: string, type?: CorpusObject['type']): string {
  const matches = CORPUS_OBJECTS.filter(
    (row) => row.canonicalName === name && (type === undefined || row.type === type),
  );
  if (matches.length !== 1 || !matches[0]) {
    throw new Error(
      `Expected exactly one corpus object named ${name}${type ? ` (${type})` : ''}, found ${String(matches.length)}`,
    );
  }
  return matches[0].id;
}

export const CORPUS_FACTS = [
  {
    id: CORPUS_UUID.fact(1),
    rawEventId: eventId(3),
    entityId: objectId(8),
    statement: 'Northwind Capital asked for a Series A partner meeting the week of August 4.',
  },
  {
    id: CORPUS_UUID.fact(2),
    rawEventId: eventId(6),
    entityId: objectId(17),
    statement: 'Sentry issue ATLAS-218 captured a spike of CSV preview 500s.',
  },
  {
    id: CORPUS_UUID.fact(3),
    rawEventId: eventId(11),
    entityId: DEMO_IDS.objectDelivery,
    statement: 'As of July 21 the Northstar field-mapping confirmation still blocked the pilot.',
  },
  {
    id: CORPUS_UUID.fact(4),
    rawEventId: eventId(18),
    entityId: objectId(13),
    statement: 'Moss & Co was qualified after a 30-minute intro and wants to keep Monday.com.',
  },
  {
    id: CORPUS_UUID.fact(5),
    rawEventId: eventId(32),
    entityId: objectId(8),
    statement: 'Avery committed to send Northwind a data-room link by August 13.',
  },
  {
    id: CORPUS_UUID.fact(6),
    rawEventId: eventId(34),
    entityId: objectId(12),
    statement: 'Brightline Health accepted CSV plus evidence packs and no clinical template in v1.',
  },
  {
    id: CORPUS_UUID.fact(7),
    rawEventId: eventId(40),
    entityId: DEMO_IDS.objectPilot,
    statement: 'Elena Park delayed Northstar field-mapping confirmation until August 19.',
  },
  {
    id: CORPUS_UUID.fact(8),
    rawEventId: eventId(37),
    entityId: objectId(34),
    statement: 'Acme tagged atlas-0.8.0 with CSV preview replay and quieter import errors.',
  },
  {
    id: CORPUS_UUID.fact(9),
    rawEventId: eventId(20),
    entityId: objectId(7),
    statement: 'The diligence room stays closed until the vendor DPA PDF is in Documents.',
  },
  {
    id: CORPUS_UUID.fact(10),
    rawEventId: eventId(24),
    entityId: objectId(15),
    statement: 'Kite Logistics is lost unless they accept the EU SaaS posture instead of on-prem.',
  },
  {
    id: CORPUS_UUID.fact(11),
    rawEventId: eventId(42),
    entityId: objectId(22),
    statement: 'Maya Chen is in the product designer final round on August 15.',
  },
  {
    id: CORPUS_UUID.fact(12),
    rawEventId: eventId(45),
    entityId: objectId(8),
    statement: 'Avery sent the Northwind data-room link on August 13.',
  },
  {
    id: CORPUS_UUID.fact(13),
    rawEventId: eventId(48),
    entityId: DEMO_IDS.objectPilot,
    statement:
      'Last week Acme shipped atlas-0.8.0, opened the Northwind data room, and kept Northstar on CSV fallback.',
  },
  {
    id: CORPUS_UUID.fact(14),
    rawEventId: eventId(56),
    entityId: objectId(18),
    statement:
      'The team decided to replay CSV preview from stored bytes, not the live vendor endpoint.',
  },
  {
    id: CORPUS_UUID.fact(15),
    rawEventId: eventId(16),
    entityId: objectId(1),
    statement: 'Northstar Works invoice inv_2041 was past due on July 24 and later paid.',
  },
  {
    id: CORPUS_UUID.fact(16),
    rawEventId: eventId(10),
    entityId: objectId(21),
    statement: 'Open hiring loops this month are Senior backend engineer and Product designer.',
  },
  {
    id: CORPUS_UUID.fact(17),
    rawEventId: eventId(61),
    entityId: objectId(34),
    statement: 'The 14 July standup named importer 500s as the week-one fire.',
  },
  {
    id: CORPUS_UUID.fact(18),
    rawEventId: eventId(51),
    entityId: objectId(50),
    statement:
      'The Record asked for a backgrounder and can wait until the one-pager is public-safe.',
  },
  {
    id: CORPUS_UUID.fact(19),
    rawEventId: eventId(50),
    entityId: objectId(52),
    statement: 'Harbor Peak is a courtesy catch-up and is not on the Series A lead path.',
  },
  {
    id: CORPUS_UUID.fact(20),
    rawEventId: eventId(45),
    entityId: objectId(47),
    statement: 'Harper owns Northwind diligence Q&A from the data room.',
  },
  {
    id: CORPUS_UUID.fact(21),
    rawEventId: eventId(18),
    entityId: objectId(51),
    statement:
      'Moss & Co wants to keep Monday.com; keep-vs-replace must be mapped before a proposal.',
  },
  {
    id: CORPUS_UUID.fact(22),
    rawEventId: eventId(60),
    entityId: objectId(16),
    statement: 'Polar Studio is inbound and not yet on the dealflow board.',
  },
  {
    id: CORPUS_UUID.fact(23),
    rawEventId: eventId(3000),
    entityId: objectId(12),
    statement: 'Brightline scoping confirmed CSV plus evidence packs and no clinical template.',
  },
  {
    id: CORPUS_UUID.fact(24),
    rawEventId: eventId(3001),
    entityId: objectId(23),
    statement: 'Maya Chen advanced to the designer final round after the 30 July interview.',
  },
] as const;

function documentSpec(input: {
  n: number;
  folderN: number;
  name: string;
  filename: string;
  contentType: string;
  owner: CorpusPerson['key'];
  occurredAt: string;
  paragraphs: string[];
  asPdf?: boolean;
}): CorpusDocument {
  const body = [input.name, '', ...input.paragraphs].join('\n');
  const bytes = input.asPdf
    ? buildSimplePdf(input.name.replace(/\.pdf$/i, ''), input.paragraphs)
    : Buffer.from(body, 'utf8');
  const id = CORPUS_UUID.document(input.n);
  const versionId = CORPUS_UUID.document(100 + input.n);
  const chunks = [
    input.paragraphs.slice(0, Math.ceil(input.paragraphs.length / 2) || 1).join('\n\n'),
    input.paragraphs.slice(Math.ceil(input.paragraphs.length / 2) || 1).join('\n\n'),
  ].filter((chunk) => chunk.length > 0);
  return {
    id,
    versionId,
    chunkIds: chunks.map((_, index) => CORPUS_UUID.document(400 + input.n * 10 + index)),
    folderId: CORPUS_UUID.folder(input.folderN),
    name: input.name,
    filename: input.filename,
    contentType: input.contentType,
    objectKey: `${TEAM_ID}/${id}/v1/${input.filename}`,
    ownerUserId: CORPUS_PERSON[input.owner].id,
    occurredAt: input.occurredAt,
    body,
    bytes,
    checksumSha256: createHash('sha256').update(bytes).digest('hex'),
    byteSize: bytes.byteLength,
    chunks,
  };
}

export const CORPUS_FOLDERS = [
  { id: CORPUS_UUID.folder(1), name: 'People & Ops', ownerUserId: CORPUS_PERSON.quinn.id },
  { id: CORPUS_UUID.folder(2), name: 'Product', ownerUserId: CORPUS_PERSON.mika.id },
  { id: CORPUS_UUID.folder(3), name: 'Fundraising', ownerUserId: CORPUS_PERSON.harper.id },
  { id: CORPUS_UUID.folder(4), name: 'GTM', ownerUserId: CORPUS_PERSON.riley.id },
] as const;

export const CORPUS_DOCUMENTS: CorpusDocument[] = [
  documentSpec({
    n: 1,
    folderN: 1,
    name: 'Code of conduct.pdf',
    filename: 'code-of-conduct.pdf',
    contentType: 'application/pdf',
    owner: 'quinn',
    occurredAt: '2026-08-04T12:40:00.000Z',
    asPdf: true,
    paragraphs: [
      'Acme Labs code of conduct applies to employees, contractors, and interviewers.',
      'We assume good intent, cite sources in writing, and do not share customer evidence outside the people named on the object.',
      'Harassment, surprise recordings, or quiet forwarding of private Timeline events is a firing offense.',
      'Report issues to Quinn Okonkwo or Avery Timeline. This document is the source of truth, not a wiki copy.',
    ],
  }),
  documentSpec({
    n: 2,
    folderN: 1,
    name: 'Helsinki office rules.pdf',
    filename: 'helsinki-office-rules.pdf',
    contentType: 'application/pdf',
    owner: 'quinn',
    occurredAt: '2026-08-04T12:41:00.000Z',
    asPdf: true,
    paragraphs: [
      'The Helsinki studio at Pursimiehenkatu is a quiet-archive office: no hot desks in the focus room, no stand-up in the phone booths.',
      'Doors lock at 19:00. Guests need a calendar event and a named host. Kitchen is labelled, not communal-by-default.',
      'Meeting bots may join only when the host has confirmed participants will be told. Raw audio is never copied to S3.',
      'Bikes go in the inner courtyard. The printer is for contracts, not posters.',
    ],
  }),
  documentSpec({
    n: 3,
    folderN: 3,
    name: 'Series A investor one-pager.md',
    filename: 'series-a-investor-one-pager.md',
    contentType: 'text/markdown',
    owner: 'harper',
    occurredAt: '2026-08-11T13:20:00.000Z',
    paragraphs: [
      'Acme Labs is building Atlas, an evidence-backed working history for operators who are tired of status theater.',
      'Design partner: Northstar Works, currently blocked on field-mapping confirmation, CSV fallback already accepted.',
      'Traction: Helio, Moss, Orchard, Brightline, and Northstar on dealflow; Polar inbound pending an add-to-board approval; one paid design-partner invoice; importer reliability shipped in atlas-0.8.0.',
      'Ask: Northwind Capital to lead a Series A. Runway at current burn is 11.4 months. Hiring two roles: backend and design.',
      'Use of proceeds: capture reliability, approval-backed CRM memory, and a quieter launch webinar on 20 August.',
    ],
  }),
  documentSpec({
    n: 4,
    folderN: 2,
    name: 'Atlas strategy memo.md',
    filename: 'atlas-strategy-memo.md',
    contentType: 'text/markdown',
    owner: 'mika',
    occurredAt: '2026-08-11T13:21:00.000Z',
    paragraphs: [
      'v1 is importer reliability, CSV fallback, and one design-partner launch. Dashboards are explicitly out.',
      'Every answer should cite a raw event, document chunk, or meeting utterance. If we cannot cite it, we do not say it.',
      'Brightline does not get a clinical-ops template. Helio can wait for Northstar proof. Kite is lost on on-prem.',
      'The weekly standup is the system of record for "what shipped." Slack is capture, not the plan.',
    ],
  }),
  documentSpec({
    n: 5,
    folderN: 4,
    name: 'Pitch narrative.md',
    filename: 'pitch-narrative.md',
    contentType: 'text/markdown',
    owner: 'sam',
    occurredAt: '2026-08-14T11:20:00.000Z',
    paragraphs: [
      'Brand voice is quiet, specific, and citation-first. Do not write AI-powered. Do not write platform.',
      'The story is: teams already did the work in Slack, mail, and meetings. Atlas keeps the evidence and asks for approval before it becomes memory.',
      'Hero line for the webinar: Evidence before the status update.',
      'Screenshot must be the Northstar handoff brief with names changed, never a synthetic dashboard.',
    ],
  }),
  documentSpec({
    n: 6,
    folderN: 1,
    name: 'Vendor DPA excerpt.pdf',
    filename: 'vendor-dpa-excerpt.pdf',
    contentType: 'application/pdf',
    owner: 'harper',
    occurredAt: '2026-07-28T14:05:00.000Z',
    asPdf: true,
    paragraphs: [
      'This excerpt is fictional. Subprocessors for Atlas demo data are Postgres, Qdrant, and object storage in the EU.',
      'Customer content is team-scoped. Private events are invisible to outbound MCP bearer keys.',
      'Deletion follows team export plus wipe. Diligence reviewers see only documents in the Fundraising folder.',
      'Signature block: Acme Labs Oy / Harper Singh / 28 July 2026.',
    ],
  }),
  documentSpec({
    n: 7,
    folderN: 3,
    name: 'Northstar MSA excerpt.md',
    filename: 'northstar-msa-excerpt.md',
    contentType: 'text/markdown',
    owner: 'casey',
    occurredAt: '2026-08-05T09:00:00.000Z',
    paragraphs: [
      'Pilot term: 90 days. Seats: 25. Export format: CSV fallback with field-mapping confirmation still outstanding.',
      'HIPAA language is not in this Northstar MSA. Brightline requires a separate excerpt.',
      'Invoice inv_2041 was past due on 24 July and paid on 13 August.',
      'Governing law: Finland. Design-partner reference rights require Elena Park approval.',
    ],
  }),
  documentSpec({
    n: 8,
    folderN: 1,
    name: 'New-hire onboarding.md',
    filename: 'new-hire-onboarding.md',
    contentType: 'text/markdown',
    owner: 'quinn',
    occurredAt: '2026-08-08T10:10:00.000Z',
    paragraphs: [
      'Day 1: log into Timeline as yourself, bind Slack and Telegram, read the code of conduct and office rules.',
      'Day 2: ask "what did the team achieve last week" and follow every citation.',
      'Do not create a parallel Notion. If it is not on the timeline or in Documents, it is not the record.',
      'Hiring scorecards live on the hiring_loop object, never in a private DM.',
    ],
  }),
  documentSpec({
    n: 9,
    folderN: 2,
    name: 'Brand voice guide.md',
    filename: 'brand-voice-guide.md',
    contentType: 'text/markdown',
    owner: 'sam',
    occurredAt: '2026-07-24T15:40:00.000Z',
    paragraphs: [
      'Write like an archive, not a launch blog. Short sentences. Named people. Named dates.',
      'Banned: synergy, AI-powered, single source of truth as decoration.',
      'Preferred: evidence, approval, citation, handoff, field-mapping, CSV fallback.',
    ],
  }),
  documentSpec({
    n: 10,
    folderN: 1,
    name: 'Contractor agreement excerpt.pdf',
    filename: 'contractor-agreement-excerpt.pdf',
    contentType: 'application/pdf',
    owner: 'quinn',
    occurredAt: '2026-07-22T11:00:00.000Z',
    asPdf: true,
    paragraphs: [
      'This excerpt is fictional. Contractors use Timeline as themselves, never a shared login.',
      'Customer evidence stays on the objects named in the statement of work. Forwarding private events is a material breach.',
      'Meeting bots join only after the host confirms participants will be told. Raw audio is not retained.',
      'Governing law: Finland. Quinn Okonkwo is the hiring manager of record for people operations contractors.',
    ],
  }),
  documentSpec({
    n: 11,
    folderN: 2,
    name: 'Security FAQ.md',
    filename: 'security-faq.md',
    contentType: 'text/markdown',
    owner: 'jordan',
    occurredAt: '2026-08-01T16:10:00.000Z',
    paragraphs: [
      'Atlas stores team-scoped events. Outbound MCP bearer keys see only team-visibility rows.',
      'Secrets at rest use AES-256-GCM. Integration tokens are never stored as plaintext.',
      'CSV preview replay reads stored bytes. We do not call the customer vendor during preview.',
      'Production deletes follow team export. Demo wipe is pnpm demo:reset on local stacks only.',
    ],
  }),
];

function standupTranscript(beats: string[]): CorpusMeeting['transcript'] {
  return beats.map((text, index) => ({
    speaker: index % 2 === 0 ? 'Avery Timeline' : 'Mika Product',
    text,
    startMs: 12_000 + index * 40_000,
    endMs: 12_000 + index * 40_000 + 32_000,
  }));
}

export const CORPUS_MEETINGS: CorpusMeeting[] = [
  {
    id: CORPUS_UUID.meeting(1),
    chunkIds: [CORPUS_UUID.meeting(101), CORPUS_UUID.meeting(111)],
    rawEventId: eventId(56),
    title: 'Importer incident review',
    platform: 'meet',
    meetingUrl: 'https://meet.example.test/acme-incident-review',
    startedAt: '2026-07-15T13:00:00.000Z',
    endedAt: '2026-07-15T13:35:00.000Z',
    createdByUserId: CORPUS_PERSON.jordan.id,
    transcript: [
      {
        speaker: 'Jordan Hale',
        text: 'ATLAS-218 is a live importer call during CSV preview. I want replay from stored bytes.',
        startMs: 8_000,
        endMs: 22_000,
      },
      {
        speaker: 'Mika Product',
        text: 'Agreed. Do not add dashboards. Decision: replay CSV preview from stored bytes.',
        startMs: 24_000,
        endMs: 38_000,
      },
    ],
  },
  {
    id: CORPUS_UUID.meeting(2),
    chunkIds: [CORPUS_UUID.meeting(102), CORPUS_UUID.meeting(103)],
    rawEventId: eventId(11),
    title: 'Weekly product standup',
    platform: 'meet',
    meetingUrl: 'https://meet.example.test/acme-weekly-standup',
    startedAt: '2026-07-21T09:30:00.000Z',
    endedAt: '2026-07-21T10:00:00.000Z',
    createdByUserId: CORPUS_PERSON.avery.id,
    transcript: standupTranscript([
      'Importer 500s are mitigated. Northstar field-mapping is still the blocker.',
      'Riley should freeze webinar copy after the Northwind meeting, not before.',
    ]),
  },
  {
    id: CORPUS_UUID.meeting(3),
    chunkIds: [CORPUS_UUID.meeting(104), CORPUS_UUID.meeting(112)],
    rawEventId: eventId(20),
    title: 'Weekly product standup',
    platform: 'meet',
    meetingUrl: 'https://meet.example.test/acme-weekly-standup',
    startedAt: '2026-07-28T09:30:00.000Z',
    endedAt: '2026-07-28T10:05:00.000Z',
    createdByUserId: CORPUS_PERSON.avery.id,
    transcript: standupTranscript([
      'Helio and Brightline are real pipeline. Diligence room waits on the DPA PDF.',
      'I will not promise Brightline a clinical template.',
    ]),
  },
  {
    id: CORPUS_UUID.meeting(4),
    chunkIds: [CORPUS_UUID.meeting(105), CORPUS_UUID.meeting(113)],
    rawEventId: eventId(29),
    title: 'Weekly product standup',
    platform: 'meet',
    meetingUrl: 'https://meet.example.test/acme-weekly-standup',
    startedAt: '2026-08-04T09:30:00.000Z',
    endedAt: '2026-08-04T10:00:00.000Z',
    createdByUserId: CORPUS_PERSON.avery.id,
    transcript: standupTranscript([
      'Importer is calm. Harper and Quinn own the diligence checklist.',
      'Casey sends Brightline the MSA excerpt, not a new template.',
    ]),
  },
  {
    id: CORPUS_UUID.meeting(5),
    chunkIds: [CORPUS_UUID.meeting(106), CORPUS_UUID.meeting(107)],
    rawEventId: eventId(32),
    title: 'Northwind Capital partner meeting',
    platform: 'meet',
    meetingUrl: 'https://meet.example.test/northwind-partner',
    startedAt: '2026-08-06T13:00:00.000Z',
    endedAt: '2026-08-06T13:45:00.000Z',
    createdByUserId: CORPUS_PERSON.avery.id,
    transcript: [
      {
        speaker: 'Priya Shah',
        text: 'We need Northstar proof, runway, and the hiring plan. We are not writing a term sheet today.',
        startMs: 10_000,
        endMs: 28_000,
      },
      {
        speaker: 'Avery Timeline',
        text: 'You will have a data-room link by August 13. Runway is 11.4 months. Designer hire is in flight.',
        startMs: 30_000,
        endMs: 48_000,
      },
    ],
  },
  {
    id: CORPUS_UUID.meeting(6),
    chunkIds: [CORPUS_UUID.meeting(108), CORPUS_UUID.meeting(114)],
    rawEventId: eventId(38),
    title: 'Weekly product standup',
    platform: 'meet',
    meetingUrl: 'https://meet.example.test/acme-weekly-standup',
    startedAt: '2026-08-11T09:30:00.000Z',
    endedAt: '2026-08-11T10:02:00.000Z',
    createdByUserId: CORPUS_PERSON.avery.id,
    transcript: standupTranscript([
      'Northstar remains the proof point. Field-mapping email still missing. Webinar stays August 20.',
      'Maya Chen goes to final round. Backend loop reopens next week.',
    ]),
  },
  {
    id: CORPUS_UUID.meeting(7),
    chunkIds: [CORPUS_UUID.meeting(109), CORPUS_UUID.meeting(110)],
    rawEventId: eventId(61),
    title: 'Weekly product standup',
    platform: 'meet',
    meetingUrl: 'https://meet.example.test/acme-weekly-standup',
    startedAt: '2026-07-14T09:30:00.000Z',
    endedAt: '2026-07-14T10:00:00.000Z',
    createdByUserId: CORPUS_PERSON.avery.id,
    transcript: standupTranscript([
      'Importer 500s are the week-one fire. Do not start webinar polish until replay is in.',
      'Northstar field-mapping is already the longer blocker. CSV fallback is the plan if they slip.',
    ]),
  },
  {
    id: CORPUS_UUID.meeting(8),
    chunkIds: [CORPUS_UUID.meeting(115), CORPUS_UUID.meeting(116)],
    rawEventId: eventId(3000),
    title: 'Brightline Health scoping',
    platform: 'meet',
    meetingUrl: 'https://meet.example.test/brightline-scoping',
    startedAt: '2026-08-07T14:00:00.000Z',
    endedAt: '2026-08-07T14:35:00.000Z',
    createdByUserId: CORPUS_PERSON.casey.id,
    transcript: [
      {
        speaker: 'Dana Cole',
        text: 'We can live on CSV plus evidence packs. Do not build us a clinical-ops template for v1.',
        startMs: 8_000,
        endMs: 24_000,
      },
      {
        speaker: 'Mika Product',
        text: 'HIPAA language stays in the MSA excerpt. Casey will send that, not a new template.',
        startMs: 26_000,
        endMs: 40_000,
      },
    ],
  },
  {
    id: CORPUS_UUID.meeting(9),
    chunkIds: [CORPUS_UUID.meeting(117), CORPUS_UUID.meeting(118)],
    rawEventId: eventId(3001),
    title: 'Maya Chen designer interview',
    platform: 'meet',
    meetingUrl: 'https://meet.example.test/maya-chen-interview',
    startedAt: '2026-07-30T15:00:00.000Z',
    endedAt: '2026-07-30T15:45:00.000Z',
    createdByUserId: CORPUS_PERSON.sam.id,
    transcript: [
      {
        speaker: 'Sam Rivera',
        text: 'Maya, walk us through a systems-craft piece you would put on an evidence archive.',
        startMs: 10_000,
        endMs: 24_000,
      },
      {
        speaker: 'Maya Chen',
        text: 'I would start from the captured event, not a dashboard. The narrative is still the weaker part of my packet.',
        startMs: 26_000,
        endMs: 42_000,
      },
    ],
  },
];

function slackChannelId(name: unknown): string {
  if (name === '#gtm') return 'C0GTM';
  if (name === '#product') return 'C0PRODUCT';
  if (name === '#hiring') return 'C0HIRING';
  return 'C0ENG';
}

function eventSerial(id: string): number {
  const suffix = id.split('-').at(-1);
  if (!suffix) throw new Error(`corpus event id missing serial: ${id}`);
  const n = Number.parseInt(suffix, 16);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`corpus event id serial invalid: ${id}`);
  }
  return n;
}

function enrichCaptureMetadata(row: CorpusEvent): CorpusEvent {
  const extra: Record<string, unknown> = { ...row.sourceMetadata };
  if (row.source === 'slack') {
    extra.slack_channel_id ??= slackChannelId(extra.slack_channel_name);
    const unixTs = slackUnixTs(row.occurredAt, eventSerial(row.id));
    extra.slack_message_ts = isSlackUnixTs(extra.slack_message_ts)
      ? extra.slack_message_ts
      : unixTs;
    extra.slack_thread_ts = isSlackUnixTs(extra.slack_thread_ts)
      ? extra.slack_thread_ts
      : extra.slack_message_ts;
    extra.slack_workspace_id ??= CORPUS_UUID.slack(1);
    extra.slack_team_id ??= 'T0ACMEDEMO';
  }
  if (row.source === 'email') {
    extra.thread_root_id ??= extra.message_id ?? row.id;
    extra.html_body ??= `<p>${escapeHtml(row.contentText)}</p>`;
    extra.source_snapshot ??= {
      provider: 'postmark',
      subject: extra.subject ?? 'Acme Labs email',
      html_body: extra.html_body,
      text_body: row.contentText,
      from: { email: extra.from ?? 'owner@timeline.dev' },
    };
  }
  if (row.source === 'telegram') {
    extra.tg_chat_id ??= '-100710000003';
    extra.tg_chat_title ??= extra.telegram_chat_title ?? 'Acme leadership';
    extra.tg_update_id ??= String(710_000_000 + eventSerial(row.id));
  }
  if (row.source === 'ingest_webhook') {
    extra.ingest_webhook_id ??= CORPUS_UUID.webhook(1);
    extra.ingest_webhook_dedup_key ??= String(extra.source_payload_ref ?? row.id);
  }
  if (row.source === 'integration') {
    extra.dedup_key ??= `demo-seed:${String(extra.provider ?? 'integration')}:${row.id}`;
  }
  if (row.source === 'integration' && extra.provider === 'github') {
    const github = extra.github;
    if (!github || typeof github !== 'object' || Array.isArray(github)) {
      const workflow = /GitHub workflow "([^"]+)"/.exec(row.contentText);
      const pr = /PR #(\d+)/.exec(row.contentText);
      const release = /GitHub release ([^\s]+) tagged/.exec(row.contentText);
      if (workflow?.[1]) {
        extra.github = {
          type: 'workflow_run',
          repo: 'acme-labs/atlas',
          head_branch: 'main',
          workflow_name: workflow[1],
        };
      } else if (pr?.[1]) {
        extra.github = {
          type: 'pull_request',
          repo: 'acme-labs/atlas',
          number: Number(pr[1]),
          pr_number: Number(pr[1]),
        };
      } else if (release?.[1]) {
        extra.github = {
          type: 'release',
          repo: 'acme-labs/atlas',
          tag: release[1],
        };
      }
    }
  }
  if (row.source === 'integration' && extra.provider === 'sentry') {
    extra.sentry_issue_id ??= extra.external_object_id;
    extra.sentry_short_id ??= extra.external_object_id;
    extra.event_class ??= 'incident';
  }
  if (row.source === 'calendar') {
    extra.calendar_event_id ??= extra.calendar_event_id;
  }
  if (row.source === 'meeting') {
    const meeting = CORPUS_MEETINGS.find((item) => item.rawEventId === row.id);
    if (meeting) extra.meeting_id ??= meeting.id;
  }
  if (row.source === 'document') {
    extra.action ??= 'uploaded';
  }
  extra.event_class ??= classifyCapturedEvent({ source: row.source, metadata: extra });
  return { ...row, sourceMetadata: extra };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export const CORPUS_EVENTS: CorpusEvent[] = RAW_CORPUS_EVENTS.map(enrichCaptureMetadata);

export function corpusEventId(needle: string): string {
  const matches = CORPUS_EVENTS.filter((row) => row.contentText.includes(needle));
  if (matches.length !== 1 || !matches[0]) {
    throw new Error(
      `Expected exactly one corpus event containing ${JSON.stringify(needle)}, found ${String(matches.length)}`,
    );
  }
  return matches[0].id;
}

export const CORPUS_SAVED_MEETING = {
  id: CORPUS_UUID.meeting(20),
  title: 'Weekly product standup',
  meetingUrl: 'https://meet.example.test/acme-weekly-standup',
  createdByUserId: CORPUS_PERSON.avery.id,
  permissionConfirmedAt: '2026-07-14T09:00:00.000Z',
  scheduleConfig: {
    weekdays: [2],
    times: ['12:30'],
    timezone: 'Europe/Helsinki',
    joinOffsetMinutes: 0,
  },
  upcoming: {
    id: CORPUS_UUID.meeting(21),
    scheduledStartAt: '2026-08-18T09:30:00.000Z',
    scheduledEndAt: '2026-08-18T10:00:00.000Z',
  },
} as const;
