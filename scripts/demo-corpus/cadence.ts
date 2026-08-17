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

const SLACK_ENG = [
  'Jordan: preview replay is green on staging. Not promoting until Mika signs the CSV fallback note.',
  'Mika: keep dashboards out of v1. Importer reliability only.',
  'Sam: Northstar screenshot crop is in Figma, waiting on Elena confirmation before webinar use.',
  'Jordan: ATLAS-218 is quiet this morning. Leaving the Sentry alert armed.',
  'Mika: field-mapping still missing. Do not ping Elena twice in one day.',
  'Jordan: merged the stored-byte preview. Tagging atlas-0.8.0 after QA.',
  'Sam: brand voice doc is in Documents. No more "AI-powered" on the landing page.',
  'Mika: Brightline stays on CSV + evidence packs. No clinical template.',
  'Jordan: backend sourcing scorecard is on the hiring_loop object, not in DMs.',
  'Mika: webinar demo path is Northstar CSV fallback, then Brightline proposal.',
  'Jordan: Harbor Peak stays off the lead board. Catch-up only.',
  'Mika: diligence questions go to Harper, product questions to me.',
] as const;

const LINEAR_UPDATES = [
  { id: 'NORTH-42', text: 'still blocked on Northstar field-mapping confirmation.' },
  { id: 'ATL-12', text: 'CSV preview replay checklist moved to In Review.' },
  { id: 'ATL-19', text: 'release atlas-0.8.0 tagged after stored-byte preview.' },
  { id: 'GTM-4', text: 'webinar run-of-show is blocked on Avery quote.' },
  { id: 'HIR-7', text: 'Maya Chen final-round packet attached.' },
  { id: 'HIR-8', text: 'senior backend loop reopened, no on-prem customers.' },
  { id: 'FUN-3', text: 'Northwind data-room checklist assigned to Harper.' },
  { id: 'SAL-9', text: 'Helio technical validation scheduled for 21 August.' },
] as const;

const MONDAY_UPDATES = [
  'Monday.com Launch board: "Importer reliability" stayed In progress.',
  'Monday.com Launch board: "Investor one-pager" moved closer to Done.',
  'Monday.com Launch board: "Beta webinar" remains blocked on Avery quote.',
  'Monday.com Launch board: "Designer hire" in final round.',
  'Monday.com Launch board: "Series A data room" marked Working on it.',
  'Monday.com Launch board: "Brightline MSA excerpt" assigned to Harper.',
] as const;

const SENTRY_UPDATES = [
  'Sentry ATLAS-218: 12 CSV preview 500s in the last hour, then quiet after replay shipped.',
  'Sentry ATLAS-218: no new events after atlas-0.8.0.',
  'Sentry ATLAS-241: webhook signature mismatch on Ledger staging, Jordan muted it.',
  'Sentry ATLAS-218: one replay from stored bytes succeeded, live vendor call skipped.',
] as const;

const EMAILS = [
  {
    author: 'casey' as const,
    from: 'dana.cole@brightline.example',
    subject: 'Brightline scoping recap',
    text: 'Forwarded email from Dana Cole: Brightline will stay on CSV plus evidence packs. No clinical-ops template in v1.',
  },
  {
    author: 'avery' as const,
    from: 'priya.shah@northwind.example',
    subject: 'Northwind diligence questions',
    text: 'Email from Priya Shah: please keep Northstar proof, runway, and the hiring plan in the same data room.',
  },
  {
    author: 'casey' as const,
    from: 'elena.park@northstar.example',
    subject: 'Northstar mapping delay',
    text: 'Forwarded email from Elena Park at Northstar: sample export is still coming, field-mapping is not confirmed today.',
  },
  {
    author: 'riley' as const,
    from: 'press@therecord.example',
    subject: 'Backgrounder timing',
    text: 'Forwarded email from The Record: they can wait until the one-pager is public-safe.',
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
] as const;

const TELEGRAM = [
  'Telegram Acme leadership: Avery told Harper to keep Harbor Peak off the lead slide.',
  'Telegram Acme leadership: Mika confirmed CSV fallback is still the Northstar plan.',
  'Telegram Acme leadership: Quinn posted Maya Chen interview loop times.',
  'Telegram Acme leadership: Riley asked Avery for the webinar quote again, politely.',
] as const;

const WEBHOOKS = [
  'Ledger billing webhook: invoice inv_2041 still open, reminder sent to Northstar finance.',
  'Ledger billing webhook: invoice inv_2041 marked paid.',
  'Ledger billing webhook: usage ping for 18 Northstar seats, no overage.',
  'Ledger billing webhook: Brightline trial workspace created, 6 seats, no invoice yet.',
] as const;

const GTM_SLACK = [
  'Slack #gtm: Riley posted webinar CTA variants. Winner stays "Evidence before the status update."',
  'Slack #gtm: Casey dropped Helio Retail notes from the last call.',
  'Slack #gtm: Riley asked Sam for a quieter Atlas mark, no gradient.',
  'Slack #product: Mika pasted the importer decision in the channel so it is not trapped in DMs.',
] as const;

function weekdayDates(startIso: string, endIso: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startIso}T00:00:00.000Z`);
  const end = new Date(`${endIso}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function pick<T>(items: readonly T[], index: number): T {
  const item = items[index % items.length];
  if (item === undefined) throw new Error('cadence pick on empty list');
  return item;
}

export function buildCadenceBeats(): CadenceBeat[] {
  const days = weekdayDates('2026-07-14', '2026-08-14');
  const beats: CadenceBeat[] = [];
  let n = 61;

  beats.push({
    n,
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
  n += 1;

  for (const [dayIndex, day] of days.entries()) {
    const commit = pick(ENG_COMMITS, dayIndex);
    beats.push({
      n,
      author: dayIndex % 2 === 0 ? 'jordan' : 'mika',
      source: 'integration',
      occurredAt: `${day}T08:18:00.000Z`,
      contentText: `GitHub acme-labs/atlas: Jordan pushed "${commit}" (${day}). PR #${String(190 + dayIndex)} updated.`,
      extra: {
        provider: 'github',
        event_type: 'push',
        external_object_id: `acme-labs/atlas#${String(190 + dayIndex)}`,
      },
      payloadRef: `inline://timeline/demo-seed/github/push-${day}`,
    });
    n += 1;

    const slack = pick(SLACK_ENG, dayIndex);
    beats.push({
      n,
      author: slack.startsWith('Jordan') ? 'jordan' : slack.startsWith('Sam') ? 'sam' : 'mika',
      source: 'slack',
      occurredAt: `${day}T09:05:00.000Z`,
      contentText: `Slack #eng: ${slack}`,
      extra: {
        slack_channel_name: '#eng',
        slack_event_id: `EvDEMOCADENCEENG${day.replaceAll('-', '')}`,
        capture_kind: 'channel_message',
      },
      payloadRef: `inline://timeline/demo-seed/slack/eng-${day}`,
    });
    n += 1;

    const tracker = dayIndex % 3;
    if (tracker === 0) {
      const linear = pick(LINEAR_UPDATES, dayIndex);
      beats.push({
        n,
        author: 'mika',
        source: 'integration',
        occurredAt: `${day}T11:12:00.000Z`,
        contentText: `Linear ${linear.id}: ${linear.text}`,
        extra: {
          provider: 'linear',
          event_type: 'Issue.update',
          external_object_id: linear.id,
        },
        payloadRef: `inline://timeline/demo-seed/linear/${linear.id}-${day}`,
      });
    } else if (tracker === 1) {
      const monday = pick(MONDAY_UPDATES, dayIndex);
      beats.push({
        n,
        author: 'riley',
        source: 'integration',
        occurredAt: `${day}T11:12:00.000Z`,
        contentText: monday,
        extra: {
          provider: 'monday',
          event_type: 'item.update',
          external_object_id: `monday-launch-${day}`,
        },
        payloadRef: `inline://timeline/demo-seed/monday/launch-${day}`,
      });
    } else {
      const sentry = pick(SENTRY_UPDATES, dayIndex);
      beats.push({
        n,
        author: 'jordan',
        source: 'integration',
        occurredAt: `${day}T11:12:00.000Z`,
        contentText: sentry,
        extra: {
          provider: 'sentry',
          event_type: 'issue',
          external_object_id: sentry.split(':')[0],
        },
        payloadRef: `inline://timeline/demo-seed/sentry/${day}`,
      });
    }
    n += 1;

    const lane = dayIndex % 5;
    if (lane === 0) {
      const email = pick(EMAILS, dayIndex);
      beats.push({
        n,
        author: email.author,
        source: 'email',
        occurredAt: `${day}T15:40:00.000Z`,
        contentText: email.text,
        extra: {
          message_id: `demo-seed-cadence-${day}`,
          from: email.from,
          subject: email.subject,
        },
        payloadRef: `inline://timeline/demo-seed/email/cadence-${day}`,
      });
    } else if (lane === 1) {
      const note = pick(NOTES, dayIndex);
      beats.push({
        n,
        author: note.author,
        source: 'web',
        occurredAt: `${day}T15:40:00.000Z`,
        contentText: note.text,
        extra: {
          capture_kind: 'explicit_chat_note',
          command: '/timeline note',
          surface: 'manual_note',
        },
        payloadRef: `inline://timeline/demo-seed/note/cadence-${day}`,
      });
    } else if (lane === 2) {
      beats.push({
        n,
        author: 'avery',
        source: 'telegram',
        occurredAt: `${day}T15:40:00.000Z`,
        contentText: pick(TELEGRAM, dayIndex),
        extra: { telegram_chat_title: 'Acme leadership', capture_kind: 'group_message' },
        payloadRef: `inline://timeline/demo-seed/telegram/leadership-${day}`,
      });
    } else if (lane === 3) {
      beats.push({
        n,
        author: 'jordan',
        source: 'ingest_webhook',
        occurredAt: `${day}T15:40:00.000Z`,
        contentText: pick(WEBHOOKS, dayIndex),
        extra: { webhook_name: 'Ledger billing', provider: 'ledger' },
        payloadRef: `inline://timeline/demo-seed/webhook/ledger-${day}`,
      });
    } else {
      beats.push({
        n,
        author: 'riley',
        source: 'slack',
        occurredAt: `${day}T15:40:00.000Z`,
        contentText: pick(GTM_SLACK, dayIndex),
        extra: {
          slack_channel_name: pick(GTM_SLACK, dayIndex).startsWith('Slack #product')
            ? '#product'
            : '#gtm',
          slack_event_id: `EvDEMOCADENCEGTM${day.replaceAll('-', '')}`,
          capture_kind: 'channel_message',
        },
        payloadRef: `inline://timeline/demo-seed/slack/gtm-${day}`,
      });
    }
    n += 1;
  }

  return beats;
}
