import { CORPUS_UUID } from './ids.js';
import type { CorpusPerson } from './people.js';

export type CadenceEventSource =
  | 'web'
  | 'email'
  | 'slack'
  | 'telegram'
  | 'integration'
  | 'meeting'
  | 'calendar'
  | 'document'
  | 'ingest_webhook';

export interface CadenceBeat {
  n: number;
  author: CorpusPerson['key'];
  source: CadenceEventSource;
  occurredAt: string;
  contentText: string;
  extra: Record<string, unknown>;
  payloadRef: string;
}

export const CADENCE_RANGE = { start: '2026-07-14', end: '2026-08-14' } as const;
export const CADENCE_WEEKDAY_EVENT_FLOOR = 90;
export const CADENCE_WEEKDAY_MOMENT_CEILING = 32;

const REPO = 'acme-labs/atlas';
const LEDGER_WEBHOOK_ID = CORPUS_UUID.webhook(1);
const TG_CHAT_ID = '-100710000003';

const ENG_COMMITS = [
  'Store CSV preview bytes before the vendor round-trip',
  'Fail closed when field maps are empty',
  'Replay ATLAS-218 fixtures from disk',
  'Add importer timeout budget of 8s',
  'Redact customer emails in importer logs',
  'Index Northstar CSV headers as aliases',
  'Skip live vendor calls in preview mode',
  'Surface stored-byte checksum in the preview footer',
  'Guard Monday.com keep-vs-replace mapping',
  'Pin atlas-0.8.0 release notes to the incident object',
  'Reject on-prem deploy flags in the SaaS installer',
  'Cache Qdrant collection names per team',
] as const;

const PR_COMMENTS = [
  'Jordan: stored-byte preview matches the fixture checksum.',
  'Mika: keep dashboards out of this PR. Importer reliability only.',
  'Jordan: timeout budget is 8s, fail closed on empty maps.',
  'Sam: empty-state copy is citation-first, no launch-blog tone.',
  'Jordan: skipped the live vendor call in preview mode.',
  'Mika: do not ship a clinical template from this branch.',
] as const;

const SLACK_ENG = [
  'Jordan: preview replay is green on staging. Not promoting until Mika signs the CSV fallback note.',
  'Mika: keep dashboards out of v1. Importer reliability only.',
  'Sam: screenshot crop is in Figma, waiting on confirmation before webinar use.',
  'Jordan: ATLAS-218 is quiet this morning. Leaving the Sentry alert armed.',
  'Mika: field-mapping still missing. Do not ping twice in one day.',
  'Jordan: merged the stored-byte preview. Tagging atlas-0.8.0 after QA.',
  'Sam: brand voice doc is in Documents. No more "AI-powered" on the landing page.',
  'Mika: Brightline stays on CSV plus evidence packs. No clinical template.',
  'Jordan: backend sourcing scorecard is on the hiring_loop object, not in DMs.',
  'Mika: webinar demo path is Northstar CSV fallback, then Brightline proposal.',
  'Jordan: Harbor Peak stays off the lead path. Catch-up only.',
  'Mika: diligence questions go to Harper, product questions to me.',
] as const;

const SLACK_PRODUCT = [
  'Mika: importer reliability is still the only v1 bet. No dashboard spike.',
  'Avery: Northwind proof is the CSV fallback path, not a new feature.',
  'Riley: freeze webinar copy after the partner meeting, not before.',
  'Sam: empty states cite the stored-byte replay, not a mock chart.',
  'Jordan: ATL-214 stays in review until preview fixtures are on disk.',
  'Mika: Brightline does not get a clinical-ops template in this beta.',
  'Quinn: scorecards live on the hiring object. Do not paste them here.',
  'Harper: diligence answers stay in the Fundraising folder.',
] as const;

const SLACK_GTM = [
  'Riley: CTA variants still lead with evidence before the status update.',
  'Casey: Helio remains Qualified until the validation attendees are named.',
  'Riley: quieter Atlas mark, no gradient on the webinar slide.',
  'Casey: Moss wants to keep Monday.com. Map keep-vs-replace before a proposal.',
  'Riley: Polar inbound is waiting on the add-to-board approval, not a live card.',
  'Casey: Orchard stays in Scoping. Twelve seats, September budget owner.',
  'Riley: Kite stays Lost unless they accept EU SaaS.',
  'Harper: Northwind wants 11 months of runway in the room, not 18.',
] as const;

const SLACK_HIRING = [
  'Quinn: Maya Chen final round is on the calendar. Craft loop is Sam.',
  'Sam: systems craft is strong, product narrative still thin.',
  'Quinn: backend sourcing reopens after the designer final, not before.',
  'Jordan: no on-prem customers in the backend scorecard.',
  'Quinn: keep the packet on the hiring_loop object.',
  'Avery: offers target 22 August if the loops stay on the objects.',
] as const;

const LINEAR_ISSUES = [
  { id: 'NORTH-42', text: 'still blocked on field-mapping confirmation.' },
  { id: 'ATL-12', text: 'CSV preview replay checklist moved to In Review.' },
  { id: 'ATL-19', text: 'release atlas-0.8.0 tagged after stored-byte preview.' },
  { id: 'GTM-4', text: 'webinar run-of-show is blocked on Avery quote.' },
  { id: 'HIR-7', text: 'Maya Chen final-round packet attached.' },
  { id: 'HIR-8', text: 'senior backend loop reopened, no on-prem customers.' },
  { id: 'FUN-3', text: 'Northwind data-room checklist assigned to Harper.' },
  { id: 'SAL-9', text: 'Helio validation window is 21 August, attendees TBD.' },
] as const;

const LINEAR_COMMENTS = [
  'Owner left a checklist comment.',
  'Blocked reason restated so it is not trapped in Slack.',
  'Due date still matches the customer email.',
  'No new scope added from this comment.',
] as const;

const MONDAY_ITEMS = [
  { id: 'monday:launch:importer', text: '"Importer reliability" stayed In progress.' },
  { id: 'monday:launch:one-pager', text: '"Investor one-pager" moved closer to Done.' },
  { id: 'monday:launch:webinar', text: '"Beta webinar" remains blocked on Avery quote.' },
  { id: 'monday:launch:designer', text: '"Designer hire" in final round.' },
  { id: 'monday:launch:dataroom', text: '"Series A data room" marked Working on it.' },
  { id: 'monday:launch:msa', text: '"Brightline MSA excerpt" assigned to Harper.' },
] as const;

const SENTRY_ISSUES = [
  {
    id: 'ATLAS-218',
    text: '12 CSV preview 500s in the last hour, then quiet after replay shipped.',
  },
  { id: 'ATLAS-218', text: 'no new events after atlas-0.8.0.' },
  { id: 'ATLAS-241', text: 'webhook signature mismatch on Ledger staging, Jordan muted it.' },
  { id: 'ATLAS-218', text: 'one replay from stored bytes succeeded, live vendor call skipped.' },
] as const;

const DRIVE_ACTIONS = [
  'edited Series A investor one-pager.md',
  'commented on Atlas strategy memo.md',
  'viewed Northstar MSA excerpt.md',
] as const;

const EMAIL_THREADS = [
  {
    author: 'casey' as const,
    from: 'ops@brightline.example',
    subject: 'Brightline scoping recap',
    lines: [
      'Stay on CSV plus evidence packs for the Brightline workspace.',
      'No clinical-ops template in v1. MSA excerpt is enough.',
      'Casey will send the excerpt, not a new template.',
      'Harper keeps HIPAA language in the excerpt only.',
    ],
  },
  {
    author: 'avery' as const,
    from: 'priya.shah@northwind.example',
    subject: 'Northwind diligence questions',
    lines: [
      'Please keep Northstar proof, runway, and the hiring plan in the same data room.',
      'Avery confirmed the room is the same link Linden will use.',
      'Harper owns Q&A. Product questions route to Mika.',
      'No term sheet this week.',
    ],
  },
  {
    author: 'casey' as const,
    from: 'ops@northstar.example',
    subject: 'Northstar mapping delay',
    lines: [
      'Sample export is still coming. Mapping is not confirmed today.',
      'CSV fallback remains the plan.',
      'Pilot review should wait for the mapping mail.',
      'Invoice is paid; this is a data freeze, not churn.',
    ],
  },
  {
    author: 'riley' as const,
    from: 'press@therecord.example',
    subject: 'Backgrounder timing',
    lines: [
      'They can wait until the one-pager is public-safe.',
      'Riley will not send a draft from Slack.',
      'Avery quote is still missing for the webinar page.',
      'No uncropped customer screenshot in the pack.',
    ],
  },
] as const;

const NOTES = [
  {
    author: 'avery' as const,
    text: 'Explicit note from Avery: Harbor Peak is a courtesy catch-up. Do not add them to the lead path.',
  },
  {
    author: 'harper' as const,
    text: 'Explicit note from Harper: runway is 11.4 months if we do not pull the Series A. Diligence answers stay in Fundraising.',
  },
  {
    author: 'quinn' as const,
    text: 'Explicit note from Quinn: Maya Chen final round is 15 August. Backend loop reopens after that, not before.',
  },
  {
    author: 'riley' as const,
    text: 'Explicit note from Riley: webinar copy stays citation-first. Avery still owes the quote.',
  },
  {
    author: 'casey' as const,
    text: 'Explicit note from Casey: Moss wants to keep Monday.com. Map keep-vs-replace before a proposal.',
  },
  {
    author: 'sam' as const,
    text: 'Explicit note from Sam: do not put the uncropped Northstar screenshot on the webinar deck.',
  },
  {
    author: 'jordan' as const,
    text: 'Explicit note from Jordan: preview replay reads stored bytes. Live vendor calls stay out of CI.',
  },
  {
    author: 'mika' as const,
    text: 'Explicit note from Mika: v1 is importer reliability and one design-partner launch. Dashboards stay out.',
  },
] as const;

const TELEGRAM = [
  'Avery told Harper to keep Harbor Peak off the lead slide.',
  'Mika confirmed CSV fallback is still the Northstar plan.',
  'Quinn posted Maya Chen interview loop times.',
  'Riley asked Avery for the webinar quote again, politely.',
  'Jordan said ATLAS-218 can stay muted overnight.',
  'Sam needs the cropped screenshot before deck lock.',
] as const;

const WEBHOOKS = [
  'Ledger billing webhook: invoice inv_2041 still open, reminder sent to Northstar finance.',
  'Ledger billing webhook: usage ping for 18 Northstar seats, no overage.',
  'Ledger billing webhook: Brightline trial workspace created, 6 seats, no invoice yet.',
] as const;

const DOC_TOUCHES = [
  { filename: 'Atlas strategy memo.md', folder: 'Product' },
  { filename: 'Series A investor one-pager.md', folder: 'Fundraising' },
] as const;

function weekdayDates(startIso: string, endIso: string): string[] {
  return datesInRange(startIso, endIso, (weekday) => weekday !== 0 && weekday !== 6);
}

function weekendDates(startIso: string, endIso: string): string[] {
  return datesInRange(startIso, endIso, (weekday) => weekday === 0 || weekday === 6);
}

function datesInRange(
  startIso: string,
  endIso: string,
  include: (weekday: number) => boolean,
): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    if (include(cursor.getUTCDay())) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function pick<T>(items: readonly T[], index: number): T {
  const item = items[index % items.length];
  if (item === undefined) throw new Error('cadence pick on empty list');
  return item;
}

function at(day: string, hours: number, minutes: number, seconds = 0): string {
  return `${day}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.000Z`;
}

function stamp(day: string): string {
  return day.replaceAll('-', '');
}

export function slackUnixTs(iso: string, salt = 0): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`invalid slack time ${iso}`);
  const seconds = Math.floor(ms / 1000);
  const micros = `${String(ms % 1000).padStart(3, '0')}${String(salt).padStart(3, '0')}`;
  return `${seconds}.${micros}`;
}

export function isSlackUnixTs(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{10}\.\d{6}$/.test(value)) return false;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 1_000_000_000;
}

function workflowRunNumber(name: string, dayIndex: number, index: number): number {
  const offset = name === 'Importer' ? 0 : name === 'Lint' ? 20 : 40;
  return 2000 + dayIndex * 60 + offset + index;
}

function githubWorkflow(name: string, branch = 'main'): Record<string, unknown> {
  return {
    provider: 'github',
    event_type: 'workflow_run.success',
    github: {
      type: 'workflow_run',
      repo: REPO,
      head_branch: branch,
      workflow_name: name,
    },
  };
}

function githubPr(prNumber: number, type: 'pull_request' | 'review'): Record<string, unknown> {
  return {
    provider: 'github',
    event_type: type === 'review' ? 'pull_request_review.submitted' : 'pull_request.synchronize',
    github: { type, repo: REPO, number: prNumber, pr_number: prNumber },
    external_object_id: `${REPO}#${String(prNumber)}`,
  };
}

function slackMeta(
  channelId: string,
  channelName: string,
  threadTs: string,
  messageTs: string,
  eventId: string,
): Record<string, unknown> {
  return {
    slack_channel_id: channelId,
    slack_channel_name: channelName,
    slack_thread_ts: threadTs,
    slack_message_ts: messageTs,
    slack_event_id: eventId,
    capture_kind: 'channel_message',
  };
}

export function cadenceBeatGroupKey(beat: CadenceBeat): string {
  const extra = beat.extra;
  if (beat.source === 'meeting') {
    return `meeting:${String(extra.meeting_id ?? beat.n)}`;
  }
  if (beat.source === 'email') {
    return `email:${String(extra.thread_root_id ?? beat.n)}`;
  }
  if (beat.source === 'slack') {
    return `slack:${String(extra.slack_channel_id)}:${String(extra.slack_thread_ts)}`;
  }
  if (beat.source === 'telegram') {
    return `telegram:${String(extra.tg_chat_id)}:${beat.occurredAt.slice(0, 10)}:${beat.occurredAt.slice(11, 13)}:${String(Math.floor(Number(beat.occurredAt.slice(14, 16)) / 15) * 15).padStart(2, '0')}`;
  }
  if (beat.source === 'calendar') {
    return `calendar:${String(extra.calendar_event_id ?? beat.n)}`;
  }
  if (beat.source === 'document') {
    return `document:${String(extra.document_id ?? beat.n)}:${beat.occurredAt.slice(0, 10)}:${String(extra.action ?? 'activity')}`;
  }
  if (beat.source === 'ingest_webhook') {
    return `ingest_webhook:${String(extra.ingest_webhook_id)}:${beat.occurredAt.slice(0, 10)}:${beat.occurredAt.slice(11, 13)}:${String(Math.floor(Number(beat.occurredAt.slice(14, 16)) / 15) * 15).padStart(2, '0')}`;
  }
  if (beat.source === 'integration') {
    const github = extra.github;
    if (github && typeof github === 'object' && !Array.isArray(github)) {
      const nested = github as Record<string, unknown>;
      if (nested.type === 'workflow_run') {
        return `integration:github:workflow_run:${String(nested.repo)}:${String(nested.workflow_name)}:${String(nested.head_branch)}:${beat.occurredAt.slice(0, 10)}`;
      }
      if (nested.type === 'pull_request' || nested.type === 'review') {
        return `integration:github:pr:${String(nested.repo)}:${String(nested.pr_number)}`;
      }
    }
    return `integration:${String(extra.provider)}:${String(extra.external_object_id ?? beat.n)}`;
  }
  return `${beat.source}:${String(beat.n)}`;
}

function pushWorkflows(
  push: (beat: Omit<CadenceBeat, 'n'>) => void,
  input: {
    day: string;
    dayIndex: number;
    name: string;
    author: CorpusPerson['key'];
    startHour: number;
    startMinute: number;
    count: number;
  },
): void {
  for (let index = 0; index < input.count; index += 1) {
    const minute = input.startMinute + index * 3;
    const hour = input.startHour + Math.floor(minute / 60);
    const clock = minute % 60;
    push({
      author: input.author,
      source: 'integration',
      occurredAt: at(input.day, hour, clock),
      contentText: `GitHub workflow "${input.name}" #${String(workflowRunNumber(input.name, input.dayIndex, index))} on ${REPO} success`,
      extra: githubWorkflow(input.name),
      payloadRef: `inline://timeline/demo-seed/github/${input.name.toLowerCase()}-${input.day}-${String(index)}`,
    });
  }
}

function pushSlackThread(
  push: (beat: Omit<CadenceBeat, 'n'>) => void,
  input: {
    day: string;
    channelId: string;
    channelName: string;
    threadKey: string;
    startHour: number;
    startMinute: number;
    lines: readonly string[];
    authors: readonly CorpusPerson['key'][];
  },
): void {
  const threadTs = slackUnixTs(at(input.day, input.startHour, input.startMinute));
  for (const [index, line] of input.lines.entries()) {
    const minute = input.startMinute + index * 2;
    const hour = input.startHour + Math.floor(minute / 60);
    const clock = minute % 60;
    const occurredAt = at(input.day, hour, clock);
    const messageTs = index === 0 ? threadTs : slackUnixTs(occurredAt, index);
    push({
      author: pick(input.authors, index),
      source: 'slack',
      occurredAt,
      contentText: `Slack ${input.channelName}: ${line}`,
      extra: slackMeta(
        input.channelId,
        input.channelName,
        threadTs,
        messageTs,
        `Ev${input.channelId}${stamp(input.day)}${input.threadKey}${String(index)}`,
      ),
      payloadRef: `inline://timeline/demo-seed/slack/${input.channelName.slice(1)}-${input.day}-${input.threadKey}-${String(index)}`,
    });
  }
}

function pushWorkday(
  push: (beat: Omit<CadenceBeat, 'n'>) => void,
  day: string,
  dayIndex: number,
): void {
  const prNumber = 190 + dayIndex;
  const commit = pick(ENG_COMMITS, dayIndex);
  const linear = pick(LINEAR_ISSUES, dayIndex);
  const monday = pick(MONDAY_ITEMS, dayIndex);
  const sentry = pick(SENTRY_ISSUES, dayIndex);
  const email = pick(EMAIL_THREADS, dayIndex);
  const threadRoot = `demo-seed-cadence-thread-${stamp(day)}`;

  pushWorkflows(push, {
    day,
    dayIndex,
    name: 'Importer',
    author: 'jordan',
    startHour: 8,
    startMinute: 6,
    count: 8,
  });
  pushWorkflows(push, {
    day,
    dayIndex,
    name: 'Lint',
    author: 'jordan',
    startHour: 8,
    startMinute: 32,
    count: 8,
  });

  for (let index = 0; index < 6; index += 1) {
    const comment = pick(PR_COMMENTS, dayIndex + index);
    push({
      author: comment.startsWith('Mika') ? 'mika' : comment.startsWith('Sam') ? 'sam' : 'jordan',
      source: 'integration',
      occurredAt: at(day, 9, index * 4),
      contentText: `GitHub ${REPO} PR #${String(prNumber)}: ${comment} — ${commit}`,
      extra: githubPr(prNumber, index % 2 === 0 ? 'pull_request' : 'review'),
      payloadRef: `inline://timeline/demo-seed/github/pr-${String(prNumber)}-${String(index)}`,
    });
  }

  pushSlackThread(push, {
    day,
    channelId: 'C0ENG',
    channelName: '#eng',
    threadKey: '0900',
    startHour: 9,
    startMinute: 26,
    lines: Array.from({ length: 10 }, (_, index) => pick(SLACK_ENG, dayIndex + index)),
    authors: ['jordan', 'mika', 'sam'],
  });
  pushSlackThread(push, {
    day,
    channelId: 'C0PRODUCT',
    channelName: '#product',
    threadKey: '1010',
    startHour: 10,
    startMinute: 10,
    lines: Array.from({ length: 8 }, (_, index) => pick(SLACK_PRODUCT, dayIndex + index)),
    authors: ['mika', 'avery', 'riley', 'sam'],
  });

  for (let index = 0; index < 4; index += 1) {
    push({
      author: 'mika',
      source: 'integration',
      occurredAt: at(day, 11, index * 4),
      contentText: `Linear ${linear.id}: ${pick(LINEAR_COMMENTS, index)} ${linear.text}`,
      extra: {
        provider: 'linear',
        event_type: 'comment.created',
        external_object_id: linear.id,
      },
      payloadRef: `inline://timeline/demo-seed/linear/${linear.id}-${day}-${String(index)}`,
    });
  }

  for (let index = 0; index < 3; index += 1) {
    push({
      author: 'riley',
      source: 'integration',
      occurredAt: at(day, 11, 20 + index * 4),
      contentText: `Monday.com Launch board: ${monday.text}`,
      extra: {
        provider: 'monday',
        event_type: 'item.update',
        external_object_id: monday.id,
      },
      payloadRef: `inline://timeline/demo-seed/monday/${monday.id}-${day}-${String(index)}`,
    });
  }

  for (let index = 0; index < 3; index += 1) {
    push({
      author: 'jordan',
      source: 'integration',
      occurredAt: at(day, 11, 36 + index * 3),
      contentText: `Sentry ${sentry.id}: ${sentry.text}`,
      extra: {
        provider: 'sentry',
        event_type: 'issue',
        external_object_id: sentry.id,
      },
      payloadRef: `inline://timeline/demo-seed/sentry/${sentry.id}-${day}-${String(index)}`,
    });
  }

  for (const [index, action] of DRIVE_ACTIONS.entries()) {
    push({
      author: index === 2 ? 'harper' : 'mika',
      source: 'integration',
      occurredAt: at(day, 12, 4 + index * 3),
      contentText: `Google Drive: ${action}`,
      extra: {
        provider: 'google_drive',
        event_type: 'file.updated',
        external_object_id: 'drive:atlas-working-docs',
      },
      payloadRef: `inline://timeline/demo-seed/drive/${day}-${String(index)}`,
    });
  }

  pushSlackThread(push, {
    day,
    channelId: 'C0GTM',
    channelName: '#gtm',
    threadKey: '1230',
    startHour: 12,
    startMinute: 30,
    lines: Array.from({ length: 8 }, (_, index) => pick(SLACK_GTM, dayIndex + index)),
    authors: ['riley', 'casey', 'harper'],
  });

  for (const [index, line] of email.lines.entries()) {
    push({
      author: email.author,
      source: 'email',
      occurredAt: at(day, 13, 40 + index * 6),
      contentText: line,
      extra: {
        message_id: `${threadRoot}-${String(index)}`,
        thread_root_id: threadRoot,
        from: email.from,
        subject: email.subject,
      },
      payloadRef: `inline://timeline/demo-seed/email/cadence-${day}-${String(index)}`,
    });
  }

  pushSlackThread(push, {
    day,
    channelId: 'C0HIRING',
    channelName: '#hiring',
    threadKey: '1410',
    startHour: 14,
    startMinute: 10,
    lines: Array.from({ length: 6 }, (_, index) => pick(SLACK_HIRING, dayIndex + index)),
    authors: ['quinn', 'sam', 'jordan'],
  });

  for (let index = 0; index < 3; index += 1) {
    push({
      author: 'jordan',
      source: 'ingest_webhook',
      occurredAt: at(day, 14, 52 + index * 2),
      contentText: pick(WEBHOOKS, dayIndex + index),
      extra: {
        webhook_name: 'Ledger billing',
        ingest_webhook_id: LEDGER_WEBHOOK_ID,
        provider: 'ledger',
      },
      payloadRef: `inline://timeline/demo-seed/webhook/ledger-${day}-${String(index)}`,
    });
  }

  for (let index = 0; index < 6; index += 1) {
    push({
      author: pick(['avery', 'mika', 'sam'] as const, index),
      source: 'telegram',
      occurredAt: at(day, 15, 40 + index * 2),
      contentText: `Telegram Acme leadership: ${pick(TELEGRAM, dayIndex + index)}`,
      extra: {
        telegram_chat_title: 'Acme leadership',
        tg_chat_title: 'Acme leadership',
        tg_chat_id: TG_CHAT_ID,
        capture_kind: 'group_message',
      },
      payloadRef: `inline://timeline/demo-seed/telegram/leadership-${day}-${String(index)}`,
    });
  }

  for (let index = 0; index < 4; index += 1) {
    const note = pick(NOTES, dayIndex + index);
    push({
      author: note.author,
      source: 'web',
      occurredAt: at(day, 16, 8 + index * 5),
      contentText: note.text,
      extra: {
        capture_kind: 'explicit_chat_note',
        command: '/timeline note',
        surface: 'manual_note',
      },
      payloadRef: `inline://timeline/demo-seed/note/cadence-${day}-${String(index)}`,
    });
  }

  pushSlackThread(push, {
    day,
    channelId: 'C0ENG',
    channelName: '#eng',
    threadKey: '1632',
    startHour: 16,
    startMinute: 32,
    lines: Array.from({ length: 8 }, (_, index) => pick(SLACK_ENG, dayIndex + index + 3)),
    authors: ['jordan', 'mika', 'sam'],
  });

  pushWorkflows(push, {
    day,
    dayIndex,
    name: 'Preview',
    author: 'jordan',
    startHour: 17,
    startMinute: 4,
    count: 6,
  });

  for (const [index, doc] of DOC_TOUCHES.entries()) {
    push({
      author: index === 0 ? 'mika' : 'harper',
      source: 'document',
      occurredAt: at(day, 17, 40 + index * 4),
      contentText: `${index === 0 ? 'Mika' : 'Harper'} updated ${doc.filename} in Documents / ${doc.folder}.`,
      extra: {
        filename: doc.filename,
        folder: doc.folder,
        document_id: `demo-seed-doc-${doc.filename}`,
        action: 'updated',
      },
      payloadRef: `inline://timeline/demo-seed/document/${doc.filename}-${day}`,
    });
  }
}

function pushWeekend(
  push: (beat: Omit<CadenceBeat, 'n'>) => void,
  day: string,
  dayIndex: number,
): void {
  const threadTs = slackUnixTs(at(day, 11, 0));
  for (let index = 0; index < 4; index += 1) {
    const occurredAt = at(day, 11, index * 4);
    push({
      author: pick(['riley', 'casey'] as const, index),
      source: 'slack',
      occurredAt,
      contentText: `Slack #gtm: ${pick(SLACK_GTM, dayIndex + index)} Weekend catch-up only.`,
      extra: slackMeta(
        'C0GTM',
        '#gtm',
        threadTs,
        index === 0 ? threadTs : slackUnixTs(occurredAt, index),
        `EvWEEKEND${stamp(day)}${String(index)}`,
      ),
      payloadRef: `inline://timeline/demo-seed/slack/weekend-gtm-${day}-${String(index)}`,
    });
  }
  for (let index = 0; index < 3; index += 1) {
    push({
      author: pick(['avery', 'mika'] as const, index),
      source: 'telegram',
      occurredAt: at(day, 15, 40 + index * 3),
      contentText: `Telegram Acme leadership: ${pick(TELEGRAM, dayIndex + index)} Weekend note.`,
      extra: {
        telegram_chat_title: 'Acme leadership',
        tg_chat_title: 'Acme leadership',
        tg_chat_id: TG_CHAT_ID,
        capture_kind: 'group_message',
      },
      payloadRef: `inline://timeline/demo-seed/telegram/weekend-${day}-${String(index)}`,
    });
  }
  const note = pick(NOTES, dayIndex);
  push({
    author: note.author,
    source: 'web',
    occurredAt: at(day, 16, 20),
    contentText: note.text,
    extra: {
      capture_kind: 'explicit_chat_note',
      command: '/timeline note',
      surface: 'manual_note',
    },
    payloadRef: `inline://timeline/demo-seed/note/weekend-${day}`,
  });
  const email = pick(EMAIL_THREADS, dayIndex);
  push({
    author: email.author,
    source: 'email',
    occurredAt: at(day, 17, 5),
    contentText: email.lines[0] ?? email.subject,
    extra: {
      message_id: `demo-seed-weekend-${stamp(day)}`,
      thread_root_id: `demo-seed-weekend-${stamp(day)}`,
      from: email.from,
      subject: email.subject,
    },
    payloadRef: `inline://timeline/demo-seed/email/weekend-${day}`,
  });
}

export function buildCadenceBeats(): CadenceBeat[] {
  const beats: CadenceBeat[] = [];
  let n = 61;
  const push = (beat: Omit<CadenceBeat, 'n'>): void => {
    beats.push({ ...beat, n });
    n += 1;
  };

  push({
    author: 'avery',
    source: 'meeting',
    occurredAt: '2026-07-14T09:32:00.000Z',
    contentText:
      'Meeting "Weekly product standup" completed on Google Meet. Importer 500s are the week-one fire. Northstar field-mapping is already the longer blocker.',
    extra: {
      provider: 'recall',
      meeting_title: 'Weekly product standup',
      consent_confirmed: true,
    },
    payloadRef: 'inline://timeline/demo-seed/meeting/standup-2026-07-14',
  });

  for (const [dayIndex, day] of weekdayDates(CADENCE_RANGE.start, CADENCE_RANGE.end).entries()) {
    pushWorkday(push, day, dayIndex);
  }
  for (const [dayIndex, day] of weekendDates(CADENCE_RANGE.start, CADENCE_RANGE.end).entries()) {
    pushWeekend(push, day, dayIndex);
  }

  return beats;
}
