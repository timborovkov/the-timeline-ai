import {
  DEMO_DATES,
  DEMO_DIGEST_HOUR,
  isoAt,
  latestDigestDayOffset,
  localDay,
  teamDate,
} from '../demo-clock.js';
import { DEMO_IDS } from '../demo-fixture.js';

import { CORPUS_DOCUMENTS, CORPUS_OBJECTS, corpusEventId, corpusObjectId } from './catalog.js';
import { CORPUS_UUID } from './ids.js';
import { CORPUS_PERSON } from './people.js';

const D = DEMO_DATES;
const md = (days: number): string => teamDate(days, 'md');
const dm = (days: number): string => teamDate(days, 'dm');

export const CORPUS_CONNECTIONS = {
  monday: CORPUS_UUID.connection(1),
  sentry: CORPUS_UUID.connection(2),
  drive: CORPUS_UUID.connection(3),
} as const;

export const CORPUS_INTEGRATIONS = {
  monday: CORPUS_UUID.integration(1),
  sentry: CORPUS_UUID.integration(2),
  drive: CORPUS_UUID.integration(3),
} as const;

export const CORPUS_SLACK = {
  workspace: CORPUS_UUID.slack(1),
  workspaceTeam: CORPUS_UUID.slack(2),
  productBinding: CORPUS_UUID.slack(3),
  gtmBinding: CORPUS_UUID.slack(4),
  engBinding: CORPUS_UUID.slack(5),
  hiringBinding: CORPUS_UUID.slack(6),
} as const;

export const CORPUS_TELEGRAM = {
  avery: CORPUS_UUID.telegram(1),
  mika: CORPUS_UUID.telegram(2),
  leadership: CORPUS_UUID.telegram(3),
} as const;

export const CORPUS_WEBHOOK = {
  id: CORPUS_UUID.webhook(1),
  credentialId: CORPUS_UUID.webhook(2),
} as const;

export const CORPUS_MCP = {
  inbound: CORPUS_UUID.mcp(1),
  outbound: CORPUS_UUID.mcp(2),
} as const;

export const DEALFLOW_BOARD = {
  id: CORPUS_UUID.board(1),
  name: 'Customer dealflow',
  purpose: 'Inbound and design-partner pipeline for Atlas.',
  templateKind: 'pipeline' as const,
  recommendedObjectTypes: ['deal', 'company'],
  lanes: [
    { id: CORPUS_UUID.board(11), name: 'New', kind: 'active' as const, position: 0 },
    { id: CORPUS_UUID.board(12), name: 'Qualified', kind: 'active' as const, position: 1 },
    { id: CORPUS_UUID.board(13), name: 'Scoping', kind: 'active' as const, position: 2 },
    { id: CORPUS_UUID.board(14), name: 'Proposal', kind: 'active' as const, position: 3 },
    { id: CORPUS_UUID.board(15), name: 'Committed', kind: 'done' as const, position: 4 },
    { id: CORPUS_UUID.board(16), name: 'Active', kind: 'active' as const, position: 5 },
    { id: CORPUS_UUID.board(17), name: 'Won', kind: 'terminal' as const, position: 6 },
    { id: CORPUS_UUID.board(18), name: 'Lost', kind: 'lost' as const, position: 7 },
  ],
};

export const SERIES_A_BOARD = {
  id: CORPUS_UUID.board(2),
  name: 'Series A funding',
  purpose: 'Lead and follow process for the round.',
  templateKind: 'pipeline' as const,
  recommendedObjectTypes: ['deal', 'company', 'person'],
  lanes: [
    { id: CORPUS_UUID.board(21), name: 'Intro', kind: 'active' as const, position: 0 },
    { id: CORPUS_UUID.board(22), name: 'Partner meeting', kind: 'active' as const, position: 1 },
    { id: CORPUS_UUID.board(23), name: 'Diligence', kind: 'active' as const, position: 2 },
    { id: CORPUS_UUID.board(24), name: 'Term sheet', kind: 'active' as const, position: 3 },
    { id: CORPUS_UUID.board(25), name: 'Verbal commit', kind: 'done' as const, position: 4 },
    { id: CORPUS_UUID.board(26), name: 'Closed', kind: 'terminal' as const, position: 5 },
    { id: CORPUS_UUID.board(27), name: 'Passed', kind: 'lost' as const, position: 6 },
  ],
};

function objectByName(name: string, type?: (typeof CORPUS_OBJECTS)[number]['type']): string {
  return corpusObjectId(name, type);
}

function buildDealflowItems() {
  return [
    {
      id: CORPUS_UUID.board(32),
      entityName: 'Helio Retail pilot',
      laneName: 'Qualified',
      responsibleUserId: CORPUS_PERSON.casey.id,
      nextStep: `Technical validation on ${dm(D.helioValidation)}`,
    },
    {
      id: CORPUS_UUID.board(33),
      entityName: 'Moss & Co',
      laneName: 'Qualified',
      responsibleUserId: CORPUS_PERSON.casey.id,
      nextStep: 'Map Monday.com keep-vs-replace',
    },
    {
      id: CORPUS_UUID.board(34),
      entityName: 'Orchard Finance',
      laneName: 'Scoping',
      responsibleUserId: CORPUS_PERSON.casey.id,
      nextStep: '12-seat research workspace proposal',
    },
    {
      id: CORPUS_UUID.board(35),
      entityName: 'Brightline Health',
      laneName: 'Proposal',
      responsibleUserId: CORPUS_PERSON.casey.id,
      nextStep: 'Send MSA excerpt, not a new template',
    },
    {
      id: CORPUS_UUID.board(36),
      entityName: 'Kite Logistics',
      laneName: 'Lost',
      responsibleUserId: CORPUS_PERSON.casey.id,
      nextStep: 'Reopen only if they accept EU SaaS',
    },
    {
      id: CORPUS_UUID.board(37),
      entityName: 'Northstar Works',
      laneName: 'Active',
      responsibleUserId: CORPUS_PERSON.casey.id,
      nextStep: `Field-mapping confirmation on ${dm(D.elenaConfirm)}`,
    },
  ];
}

export let DEALFLOW_ITEMS = buildDealflowItems();

export const SERIES_A_ITEMS = [
  {
    id: CORPUS_UUID.board(41),
    entityName: 'Harbor Peak catch-up',
    laneName: 'Intro',
    responsibleUserId: CORPUS_PERSON.avery.id,
    nextStep: '20-minute call, keep off the lead path',
  },
  {
    id: CORPUS_UUID.board(42),
    entityName: 'Linden Ventures follow',
    laneName: 'Intro',
    responsibleUserId: CORPUS_PERSON.avery.id,
    nextStep: 'Share the same data room as Northwind',
  },
  {
    id: CORPUS_UUID.board(43),
    entityName: 'Northwind Capital lead',
    laneName: 'Diligence',
    responsibleUserId: CORPUS_PERSON.harper.id,
    nextStep: 'Answer diligence Q&A from the data room',
  },
] as const;

export function boardLaneId(
  board: { lanes: Array<{ id: string; name: string }> },
  name: string,
): string {
  const lane = board.lanes.find((row) => row.name === name);
  if (!lane) throw new Error(`Missing lane ${name}`);
  return lane.id;
}

export function dealflowEntityId(name: string): string {
  return objectByName(name);
}

export const ATLAS_LAUNCH_BOARD = {
  id: 'b0000000-0000-4000-8000-000000000001',
  lanes: {
    todo: 'b0000000-0000-4000-8000-000000000002',
    doing: 'b0000000-0000-4000-8000-000000000003',
    done: 'b0000000-0000-4000-8000-000000000004',
  },
} as const;

function buildAtlasLaunchItems() {
  return [
    {
      id: CORPUS_UUID.board(51),
      entityName: 'Write Avery webinar quote',
      laneId: ATLAS_LAUNCH_BOARD.lanes.todo,
      position: 1,
      responsibleUserId: CORPUS_PERSON.avery.id,
      nextStep: 'Avery writes the quote Riley can put on the landing page',
    },
    {
      id: CORPUS_UUID.board(52),
      entityName: 'Record webinar dry run',
      laneId: ATLAS_LAUNCH_BOARD.lanes.todo,
      position: 2,
      responsibleUserId: CORPUS_PERSON.riley.id,
      nextStep: `Record after the ${dm(D.dryRun)} run-of-show`,
    },
    {
      id: CORPUS_UUID.board(53),
      entityName: 'Schedule Maya Chen final round',
      laneId: ATLAS_LAUNCH_BOARD.lanes.doing,
      position: 1,
      responsibleUserId: CORPUS_PERSON.quinn.id,
      nextStep: `Final round ${dm(D.mayaFinal)}`,
    },
    {
      id: CORPUS_UUID.board(54),
      entityName: 'Prepare Brightline MSA excerpt',
      laneId: ATLAS_LAUNCH_BOARD.lanes.doing,
      position: 2,
      responsibleUserId: CORPUS_PERSON.harper.id,
      nextStep: 'Send the excerpt, not a new template',
    },
    {
      id: CORPUS_UUID.board(55),
      entityName: 'Answer Northwind diligence Q&A',
      laneId: ATLAS_LAUNCH_BOARD.lanes.doing,
      position: 3,
      responsibleUserId: CORPUS_PERSON.harper.id,
      nextStep: 'Keep answers in the Fundraising folder',
    },
    {
      id: CORPUS_UUID.board(56),
      entityName: 'Replay CSV preview from stored bytes',
      laneId: ATLAS_LAUNCH_BOARD.lanes.done,
      position: 1,
      responsibleUserId: CORPUS_PERSON.jordan.id,
      nextStep: 'Keep preview off the live vendor endpoint',
    },
  ];
}

export let ATLAS_LAUNCH_ITEMS = buildAtlasLaunchItems();

function buildCorpusCalendarEvents() {
  return [
    {
      id: CORPUS_UUID.calendar(1),
      title: 'Atlas beta webinar',
      startAt: isoAt(6, '15:00:00'),
      endAt: isoAt(6, '16:00:00'),
      createdByUserId: CORPUS_PERSON.riley.id,
      rawEventId: corpusEventId('public launch event'),
    },
    {
      id: CORPUS_UUID.calendar(2),
      title: 'Maya Chen final round',
      startAt: isoAt(1, '13:00:00'),
      endAt: isoAt(1, '14:00:00'),
      createdByUserId: CORPUS_PERSON.quinn.id,
      rawEventId: corpusEventId('Maya Chen final round |'),
    },
    {
      id: CORPUS_UUID.calendar(3),
      title: 'Helio Retail technical validation',
      startAt: isoAt(7, '15:00:00'),
      endAt: isoAt(7, '16:00:00'),
      createdByUserId: CORPUS_PERSON.casey.id,
      rawEventId: corpusEventId('Helio Retail technical validation |'),
    },
    {
      id: CORPUS_UUID.calendar(4),
      title: 'Polar Studio founder demo',
      startAt: isoAt(5, '14:00:00'),
      endAt: isoAt(5, '14:30:00'),
      createdByUserId: CORPUS_PERSON.casey.id,
      rawEventId: corpusEventId('Polar Studio founder demo |'),
    },
    {
      id: CORPUS_UUID.calendar(5),
      title: 'Northwind diligence working session',
      startAt: isoAt(5, '09:00:00'),
      endAt: isoAt(5, '10:30:00'),
      createdByUserId: CORPUS_PERSON.harper.id,
      rawEventId: corpusEventId('Northwind diligence working session |'),
    },
    {
      id: CORPUS_UUID.calendar(6),
      title: 'Webinar dry run',
      startAt: isoAt(4, '13:00:00'),
      endAt: isoAt(4, '13:40:00'),
      createdByUserId: CORPUS_PERSON.riley.id,
      rawEventId: corpusEventId('Webinar dry-run blocked on Avery quote'),
    },
    {
      id: CORPUS_UUID.calendar(7),
      title: 'Harbor Peak courtesy call',
      startAt: isoAt(-21, '14:00:00'),
      endAt: isoAt(-21, '14:20:00'),
      createdByUserId: CORPUS_PERSON.avery.id,
      rawEventId: corpusEventId('Harbor Peak courtesy call stays off the lead slide'),
    },
  ];
}

export let CORPUS_CALENDAR_EVENTS = buildCorpusCalendarEvents();

function buildCorpusProposals() {
  return [
    {
      id: CORPUS_UUID.suggestion(1),
      itemId: CORPUS_UUID.suggestion(101),
      evidenceId: CORPUS_UUID.suggestion(201),
      title: `Slip Elena field-mapping follow-up to ${dm(D.elenaConfirm)}`,
      summary: `Northstar field-mapping slipped to ${dm(D.elenaConfirm)}.`,
      source: 'background' as const,
      operation: 'update' as const,
      targetKind: 'object' as const,
      targetId: objectByName('Ping Elena Park on field-mapping'),
      proposedPayload: { dueAt: isoAt(5, '15:00:00') },
      eventId: corpusEventId('field-mapping confirmation is delayed'),
    },
    {
      id: CORPUS_UUID.suggestion(2),
      itemId: CORPUS_UUID.suggestion(102),
      evidenceId: CORPUS_UUID.suggestion(202),
      title: 'Create Brightline MSA send follow-up',
      summary: 'Proposal work is the excerpt, not a new template.',
      source: 'background' as const,
      operation: 'create' as const,
      targetKind: 'task' as const,
      proposedPayload: {
        type: 'follow_up',
        canonicalName: `Send Brightline MSA excerpt by ${dm(D.mayaFinal)}`,
        dueAt: isoAt(1, '17:00:00'),
        assigneeUserId: CORPUS_PERSON.harper.id,
      },
      eventId: corpusEventId('accepted CSV + evidence packs'),
    },
    {
      id: CORPUS_UUID.suggestion(3),
      itemId: CORPUS_UUID.suggestion(103),
      evidenceId: CORPUS_UUID.suggestion(203),
      title: 'Schedule webinar run-of-show working session',
      summary: 'Riley still needs a 40-minute run of show.',
      source: 'background' as const,
      operation: 'create' as const,
      targetKind: 'calendar_event' as const,
      proposedPayload: {
        title: 'Webinar run of show',
        startAt: isoAt(4, '13:00:00'),
        endAt: isoAt(4, '13:40:00'),
        timezone: 'Europe/Helsinki',
      },
      eventId: corpusEventId('Need 40-minute run of show'),
    },
    {
      id: CORPUS_UUID.suggestion(4),
      itemId: CORPUS_UUID.suggestion(104),
      evidenceId: CORPUS_UUID.suggestion(204),
      title: 'Add Polar Studio to dealflow',
      summary: `New inbound logo, founder demo on ${dm(D.polarDemo)}.`,
      source: 'background' as const,
      operation: 'create' as const,
      targetKind: 'board_membership' as const,
      proposedPayload: {
        boardId: DEALFLOW_BOARD.id,
        entityId: objectByName('Polar Studio'),
        laneId: boardLaneId(DEALFLOW_BOARD, 'New'),
      },
      eventId: corpusEventId('Polar Studio asked'),
    },
    {
      id: CORPUS_UUID.suggestion(5),
      itemId: CORPUS_UUID.suggestion(105),
      evidenceId: CORPUS_UUID.suggestion(205),
      title: 'Capture Nadia Holm as an investor contact',
      summary: 'Linden will follow a Northwind lead.',
      source: 'background' as const,
      operation: 'create' as const,
      targetKind: 'object' as const,
      proposedPayload: {
        type: 'person',
        canonicalName: 'Nadia Holm',
        metadata: { role: 'Partner' },
      },
      eventId: corpusEventId('Nadia Holm'),
    },
    {
      id: CORPUS_UUID.suggestion(6),
      itemId: CORPUS_UUID.suggestion(106),
      evidenceId: CORPUS_UUID.suggestion(206),
      title: 'Confirm Helio validation attendees',
      summary: `Casey already proposed ${md(D.helioValidation)}.`,
      source: 'background' as const,
      operation: 'update' as const,
      targetKind: 'board_item_update' as const,
      proposedPayload: {
        boardItemId: CORPUS_UUID.board(32),
        field: 'nextStep',
        newValue: 'Confirm Helio technical validation attendees',
      },
      eventId: corpusEventId('Helio Retail: sharing'),
    },
    {
      id: CORPUS_UUID.suggestion(7),
      itemId: CORPUS_UUID.suggestion(107),
      evidenceId: CORPUS_UUID.suggestion(207),
      title: `Slip backend engineer sourcing to ${dm(D.dryRun)}`,
      summary: 'No offer this week; reopen sourcing after Maya’s final round.',
      source: 'chat' as const,
      operation: 'update' as const,
      targetKind: 'object' as const,
      targetId: objectByName('Reopen backend engineer sourcing'),
      proposedPayload: { dueAt: isoAt(4, '09:00:00') },
      eventId: corpusEventId('backend engineer loop'),
    },
    {
      id: CORPUS_UUID.suggestion(8),
      itemId: CORPUS_UUID.suggestion(108),
      evidenceId: CORPUS_UUID.suggestion(208),
      title: 'Archive the duplicate Dana Cole label',
      summary: 'Keep a single buyer person object.',
      source: 'background' as const,
      operation: 'archive_or_cancel' as const,
      targetKind: 'object' as const,
      targetId: objectByName('Dana Cole champion'),
      proposedPayload: { status: 'archived' },
      eventId: corpusEventId('Dana Cole'),
    },
    {
      id: CORPUS_UUID.suggestion(9),
      itemId: CORPUS_UUID.suggestion(109),
      evidenceId: CORPUS_UUID.suggestion(209),
      title: 'Note the CSV fallback still stands',
      summary: 'Mika restated the decision after the delay.',
      source: 'background' as const,
      operation: 'create' as const,
      targetKind: 'object_note' as const,
      proposedPayload: {
        entityId: DEMO_IDS.objectPilot,
        body: 'CSV fallback remains the plan. Proof is delayed one week, not cancelled.',
      },
      eventId: corpusEventId('we keep the CSV fallback decision'),
    },
    {
      id: CORPUS_UUID.suggestion(10),
      itemId: CORPUS_UUID.suggestion(110),
      evidenceId: CORPUS_UUID.suggestion(210),
      title: 'Link Brightline deal to the MSA excerpt task',
      summary: 'Proposal work is legal, not product.',
      source: 'background' as const,
      operation: 'create' as const,
      targetKind: 'object_relationship' as const,
      proposedPayload: {
        fromEntityId: objectByName('Brightline Health'),
        toEntityId: objectByName('Prepare Brightline MSA excerpt'),
        kind: 'related',
      },
      eventId: corpusEventId('accepted CSV + evidence packs'),
    },
    {
      id: CORPUS_UUID.suggestion(11),
      itemId: CORPUS_UUID.suggestion(111),
      evidenceId: CORPUS_UUID.suggestion(211),
      title: `Slip Northstar pilot review to ${dm(D.pilotReview)}`,
      summary: 'Elena asked to move the review after the field-mapping delay.',
      source: 'background' as const,
      operation: 'update' as const,
      targetKind: 'object' as const,
      targetId: objectByName(`Move Northstar pilot review to ${md(D.pilotReview)}`),
      proposedPayload: { dueAt: isoAt(12, '15:00:00') },
      eventId: corpusEventId('Pilot review should move'),
    },
    {
      id: CORPUS_UUID.suggestion(12),
      itemId: CORPUS_UUID.suggestion(112),
      evidenceId: CORPUS_UUID.suggestion(212),
      title: 'Create Kite reopen follow-up',
      summary: 'On-prem is a hard no; reopen only for EU SaaS.',
      source: 'background' as const,
      operation: 'create' as const,
      targetKind: 'task' as const,
      proposedPayload: {
        type: 'follow_up',
        canonicalName: 'Reopen Kite only if they accept EU SaaS',
        dueAt: isoAt(18, '17:00:00'),
        assigneeUserId: CORPUS_PERSON.casey.id,
      },
      eventId: corpusEventId('Kite Logistics went cold'),
    },
    {
      id: CORPUS_UUID.suggestion(13),
      itemId: CORPUS_UUID.suggestion(113),
      evidenceId: CORPUS_UUID.suggestion(213),
      title: 'Add phone for Northstar Works',
      summary: 'Capture the office switchboard on the company contact facets.',
      source: 'background' as const,
      operation: 'create' as const,
      targetKind: 'identity_facet' as const,
      proposedPayload: {
        entityId: objectByName('Northstar Works'),
        kind: 'phone',
        value: '+358 9 123 4567',
      },
      eventId: corpusEventId('Elena Park at Northstar'),
    },
    {
      id: CORPUS_UUID.suggestion(14),
      itemId: CORPUS_UUID.suggestion(114),
      evidenceId: CORPUS_UUID.suggestion(214),
      title: 'Cancel the stale press backgrounder follow-up',
      summary: 'Wait until the one-pager is public-safe.',
      source: 'chat' as const,
      operation: 'archive_or_cancel' as const,
      targetKind: 'task' as const,
      targetId: objectByName('Press backgrounder for The Record'),
      proposedPayload: { status: 'cancelled' },
      eventId: corpusEventId('backgrounder on evidence-backed'),
    },
  ];
}

export let CORPUS_PROPOSALS = buildCorpusProposals();

function buildCorpusEventNeedles() {
  return [
    'public launch event',
    `Designer final round with Maya Chen is ${md(D.mayaFinal)}`,
    `proposing a technical validation on ${md(D.helioValidation)}`,
    'Polar Studio asked',
    'Avery sent Northwind the data-room link',
    'Maya Chen final round |',
    'Helio Retail technical validation |',
    'Polar Studio founder demo |',
    'Northwind diligence working session |',
    'field-mapping confirmation is delayed',
    'accepted CSV + evidence packs',
    'Need 40-minute run of show',
    'Nadia Holm',
    'Helio Retail: sharing',
    'backend engineer loop',
    'Dana Cole',
    'we keep the CSV fallback decision',
    'Pilot review should move',
    'Kite Logistics went cold',
    'Elena Park at Northstar',
    'backgrounder on evidence-backed',
    'dealflow this week',
    'Webinar dry-run blocked on Avery quote',
    'Harbor Peak courtesy call stays off the lead slide',
    'Voice memo from Avery',
    'Telegram DM Avery → Timeline',
  ] as const;
}

export let CORPUS_EVENT_NEEDLES = buildCorpusEventNeedles();

function citeDocument(name: string, chunkIndex = 0): string {
  const document = CORPUS_DOCUMENTS.find((row) => row.name === name);
  const chunkId = document?.chunkIds[chunkIndex];
  if (!document || !chunkId) {
    throw new Error(`Missing demo document citation for ${name} chunk ${String(chunkIndex)}`);
  }
  return `[doc:${document.id}#v1:chunk:${chunkId}]`;
}

function buildCorpusChats() {
  return [
    {
      id: CORPUS_UUID.chat(1),
      userId: CORPUS_PERSON.avery.id,
      title: 'Recent activity recap',
      createdAt: isoAt(0, '13:20:00'),
      question: 'What did the team achieve recently?',
      answer: [
        'Recently Acme shipped **atlas-0.8.0** with CSV preview replay [ev:EVENT_ATLAS].',
        'Avery opened the Northwind data room [ev:EVENT_DATAROOM].',
        'The Northstar pilot stayed on the CSV fallback after Elena Park delayed field-mapping [ev:EVENT_ELENA].',
        'Brightline Health moved to proposal on CSV plus evidence packs [ev:EVENT_BRIGHTLINE].',
        '',
        `The webinar is still ${dm(D.webinar)}; Avery still owes Riley a quote [ev:EVENT_WEBINAR].`,
      ]
        .join('\n')
        .replaceAll('EVENT_ATLAS', corpusEventId('GitHub release atlas-0.8.0 tagged'))
        .replaceAll('EVENT_DATAROOM', corpusEventId('Avery sent Northwind the data-room link'))
        .replaceAll('EVENT_ELENA', corpusEventId('field-mapping confirmation is delayed'))
        .replaceAll('EVENT_BRIGHTLINE', corpusEventId('accepted CSV + evidence packs'))
        .replaceAll('EVENT_WEBINAR', corpusEventId('Need 40-minute run of show')),
    },
    {
      id: CORPUS_UUID.chat(2),
      userId: CORPUS_PERSON.avery.id,
      title: 'Northstar status',
      createdAt: isoAt(-2, '10:05:00'),
      question: 'What is the current status of the Northstar pilot?',
      answer: [
        '**Current state:** blocked on field-mapping confirmation [ev:EVENT_ELENA].',
        `Elena Park moved that to ${dm(D.elenaConfirm)} and asked to shift the review to ${dm(D.pilotReview)} [ev:EVENT_REVIEW].`,
        `The team already accepted the CSV fallback [ev:EVENT_CSV]. Avery’s voice memo the morning of ${dm(D.today)} repeats that instruction [ev:EVENT_VOICE].`,
        'Invoice inv_2041 is paid [ev:EVENT_INVOICE].',
      ]
        .join('\n')
        .replaceAll('EVENT_ELENA', corpusEventId('field-mapping confirmation is delayed'))
        .replaceAll('EVENT_REVIEW', corpusEventId('Pilot review should move'))
        .replaceAll('EVENT_CSV', corpusEventId('we keep the CSV fallback decision'))
        .replaceAll('EVENT_VOICE', corpusEventId('Voice memo from Avery'))
        .replaceAll('EVENT_INVOICE', corpusEventId('invoice inv_2041 for Northstar Works paid')),
    },
    {
      id: CORPUS_UUID.chat(3),
      userId: CORPUS_PERSON.harper.id,
      title: 'Who owns Series A diligence?',
      createdAt: isoAt(-1, '19:00:00'),
      question: 'Who owns Series A diligence questions from Northwind?',
      answer: [
        'Harper owns diligence Q&A. Avery sent the data-room link [ev:EVENT_DATAROOM].',
        'Product questions route to Mika. Northwind is the lead; Linden will follow the same room; Harbor Peak stays a catch-up, not a lead [ent:ENT_PROCESS].',
      ]
        .join('\n')
        .replaceAll('EVENT_DATAROOM', corpusEventId('Avery sent Northwind the data-room link'))
        .replaceAll('ENT_PROCESS', objectByName('Series A process')),
    },
    {
      id: CORPUS_UUID.chat(4),
      userId: CORPUS_PERSON.jordan.id,
      title: 'What is blocking the Atlas importer?',
      createdAt: isoAt(-23, '08:15:00'),
      question: 'What is blocking the Atlas importer?',
      answer: [
        'The live importer 500s on CSV preview were the internal blocker; that is resolved by replaying stored bytes [ev:EVENT_REVIEW].',
        'The customer-facing blocker is still Northstar field-mapping [ev:EVENT_ELENA].',
      ]
        .join('\n')
        .replaceAll('EVENT_REVIEW', corpusEventId('Importer incident review transcript'))
        .replaceAll('EVENT_ELENA', corpusEventId('field-mapping confirmation is delayed')),
    },
    {
      id: CORPUS_UUID.chat(5),
      userId: CORPUS_PERSON.casey.id,
      title: 'Show the dealflow pipeline',
      createdAt: isoAt(0, '16:55:00'),
      question: 'Show the dealflow pipeline.',
      answer: [
        'Customer dealflow is Helio and Moss in Qualified, Orchard in Scoping, Brightline in Proposal, Northstar Active, and Kite Lost [ev:EVENT_DEALFLOW].',
        'Polar Studio is inbound and waiting on an add-to-board approval [ev:EVENT_POLAR]. Series A is Northwind in Diligence, Linden and Harbor Peak in Intro.',
      ]
        .join('\n')
        .replaceAll('EVENT_DEALFLOW', corpusEventId('dealflow this week'))
        .replaceAll('EVENT_POLAR', corpusEventId('Polar Studio asked')),
    },
    {
      id: CORPUS_UUID.chat(6),
      userId: CORPUS_PERSON.quinn.id,
      title: 'What does the code of conduct say about private events?',
      createdAt: isoAt(-6, '11:00:00'),
      question: 'What does the code of conduct say about private events?',
      answer: `The code of conduct says not to share customer evidence outside the people named on the object ${citeDocument('Code of conduct.pdf')}. Quiet forwarding of private Timeline events is a firing offense ${citeDocument('Code of conduct.pdf', 1)}. Report issues to Quinn or Avery.`,
    },
    {
      id: CORPUS_UUID.chat(7),
      userId: CORPUS_PERSON.sam.id,
      title: 'Where is Maya Chen in the designer loop?',
      createdAt: isoAt(-2, '16:10:00'),
      question: 'Where is Maya Chen in the designer loop?',
      answer: [
        `Maya Chen is in the product designer final round on ${dm(D.mayaFinal)} [ev:EVENT_MAYA].`,
        `Sam owns craft. Quinn owns the loop. The backend engineer loop produced no offer and reopens on ${dm(D.dryRun)} [ev:EVENT_BACKEND].`,
      ]
        .join('\n')
        .replaceAll(
          'EVENT_MAYA',
          corpusEventId(`Designer final round with Maya Chen is ${md(D.mayaFinal)}`),
        )
        .replaceAll('EVENT_BACKEND', corpusEventId('backend engineer loop')),
    },
    {
      id: CORPUS_UUID.chat(8),
      userId: CORPUS_PERSON.riley.id,
      title: 'What is still blocking the webinar?',
      createdAt: isoAt(0, '12:10:00'),
      question: 'What is still blocking the Atlas beta webinar?',
      answer: [
        `The webinar stays ${dm(D.webinar)}. Riley still needs Avery’s quote, a cropped Northstar screenshot, and a 40-minute run of show by ${dm(D.dryRun)} [ev:EVENT_WEBINAR].`,
        `Brand voice is quiet and citation-first [ev:${corpusEventId('brand voice for the webinar is quiet')}].`,
      ]
        .join('\n')
        .replaceAll('EVENT_WEBINAR', corpusEventId('Need 40-minute run of show')),
    },
    {
      id: CORPUS_UUID.chat(9),
      userId: CORPUS_PERSON.avery.id,
      title: 'Northstar handoff brief',
      createdAt: isoAt(0, '17:10:00'),
      question: 'Write a handoff brief for the incoming owner of the Northstar pilot.',
      answer: [
        '## Northstar pilot handoff',
        '',
        '**Account:** Northstar Works, design partner [ent:ENT_COMPANY].',
        '**Owner in flight:** Mika, with Casey on the customer thread.',
        '',
        `**Current state.** Field-mapping confirmation is delayed to ${dm(D.elenaConfirm)} [ev:EVENT_ELENA]. The CSV fallback already stands [ev:EVENT_CSV]. Avery’s ${dm(D.today)} voice memo tells engineering not to reopen live importer previews [ev:EVENT_VOICE].`,
        '',
        `**Commitments.** Invoice inv_2041 is paid [ev:EVENT_INVOICE]. Review should move to ${dm(D.pilotReview)} [ev:EVENT_REVIEW]. Elena’s next confirmation is the gate, not a new importer build.`,
        '',
        '**Open gap.** NORTH-42 stays blocked until Elena confirms the field map. Do not treat Slack speculation as a status change.',
      ]
        .join('\n')
        .replaceAll('ENT_COMPANY', objectByName('Northstar Works'))
        .replaceAll('EVENT_ELENA', corpusEventId('field-mapping confirmation is delayed'))
        .replaceAll('EVENT_CSV', corpusEventId('we keep the CSV fallback decision'))
        .replaceAll('EVENT_VOICE', corpusEventId('Voice memo from Avery'))
        .replaceAll('EVENT_INVOICE', corpusEventId('invoice inv_2041 for Northstar Works paid'))
        .replaceAll('EVENT_REVIEW', corpusEventId('Pilot review should move')),
    },
  ];
}

export let CORPUS_CHATS = buildCorpusChats();

function digestSendTime(days: number): string {
  return isoAt(days, `${String(DEMO_DIGEST_HOUR).padStart(2, '0')}:00:00`);
}

function buildCorpusDigestWindows(): Array<{
  dayOffset: number;
  windowStart: string;
  windowEnd: string;
  localDate: string;
  summary: string;
}> {
  const latest = latestDigestDayOffset();
  const rows: Array<{ dayOffset: number; summary: string }> = [
    { dayOffset: -25, summary: 'Importer flake, designer loop opened, Helio still inbound.' },
    { dayOffset: -24, summary: 'Standup: Northstar still blocked; PR 188 merged.' },
    { dayOffset: -23, summary: 'Brightline asked for a scoping call and HIPAA language.' },
    { dayOffset: -22, summary: 'Avery will take Northwind; Harper joins for runway.' },
    { dayOffset: -21, summary: 'Northstar invoice past due; brand voice locked.' },
    { dayOffset: -18, summary: 'Moss qualified; designer interviews start.' },
    { dayOffset: -17, summary: 'Standup: diligence room waits on the DPA PDF.' },
    { dayOffset: -16, summary: 'ATL-214 in review; webinar landing page needs Avery.' },
    { dayOffset: -15, summary: 'Kite parked on on-prem; Maya Chen first interview.' },
    { dayOffset: -14, summary: 'No clinical template for Brightline in v1.' },
    { dayOffset: -11, summary: 'Northwind meeting confirmed; ATLAS-218 resolved.' },
    { dayOffset: -10, summary: 'Office rules and code of conduct uploaded.' },
    { dayOffset: -9, summary: 'Orchard stays in scoping; webinar screenshot needed.' },
    { dayOffset: -8, summary: 'Northwind asked for proof, runway, and hiring plan.' },
    { dayOffset: -7, summary: 'Brightline accepted CSV scope; one-pager done on Monday.' },
    { dayOffset: -4, summary: 'Polar Studio inbound; tiny logo, founder demo.' },
    { dayOffset: -3, summary: 'atlas-0.8.0 tagged; standup kept the webinar date.' },
    { dayOffset: -2, summary: 'Elena delayed field-mapping; CSV fallback still stands.' },
    { dayOffset: -1, summary: 'Data room sent; Northstar invoice paid; Helio follow-up out.' },
    { dayOffset: latest, summary: 'Pitch narrative in Documents; dealflow recap captured.' },
  ];
  const shifted =
    latest === 0 ? rows : [{ dayOffset: -26, summary: rows[0]!.summary }, ...rows.slice(0, -1)];
  return shifted.map((row) => ({
    ...row,
    windowStart: digestSendTime(row.dayOffset - 1),
    windowEnd: digestSendTime(row.dayOffset),
    localDate: localDay(row.dayOffset),
  }));
}

export let CORPUS_DIGEST_WINDOWS = buildCorpusDigestWindows();

export function refreshDemoWorkspace(): void {
  DEALFLOW_ITEMS = buildDealflowItems();
  ATLAS_LAUNCH_ITEMS = buildAtlasLaunchItems();
  CORPUS_EVENT_NEEDLES = buildCorpusEventNeedles();
  CORPUS_CALENDAR_EVENTS = buildCorpusCalendarEvents();
  CORPUS_PROPOSALS = buildCorpusProposals();
  CORPUS_CHATS = buildCorpusChats();
  CORPUS_DIGEST_WINDOWS = buildCorpusDigestWindows();
  CORPUS_NOTES = buildCorpusNotes();
  CORPUS_MENTION_NOTIFICATIONS = buildCorpusMentionNotifications();
}

export const CORPUS_ONBOARDING_STEPS = [
  'first_note',
  'telegram',
  'slack',
  'email_forwarding',
  'first_document',
  'first_integration',
  'invite_teammate',
  'first_ask',
  'first_meeting',
  'review_proposal',
  'daily_digest',
] as const;

export const CORPUS_PINS = [
  { targetKind: 'object' as const, targetKey: DEMO_IDS.objectPilot, sortKey: 1n },
  { targetKind: 'board' as const, targetKey: DEALFLOW_BOARD.id, sortKey: 2n },
  { targetKind: 'board' as const, targetKey: SERIES_A_BOARD.id, sortKey: 3n },
  { targetKind: 'object' as const, targetKey: objectByName('Series A process'), sortKey: 4n },
  { targetKind: 'saved_meeting' as const, targetKey: CORPUS_UUID.meeting(20), sortKey: 5n },
  { targetKind: 'board' as const, targetKey: ATLAS_LAUNCH_BOARD.id, sortKey: 6n },
  {
    targetKind: 'object' as const,
    targetKey: objectByName('Brightline Health', 'deal'),
    sortKey: 7n,
  },
  { targetKind: 'object' as const, targetKey: objectByName('CSV preview 500s'), sortKey: 8n },
] as const;

function buildCorpusNotes() {
  return [
    {
      id: CORPUS_UUID.note(1),
      entityId: objectByName('Northwind Capital lead'),
      authorUserId: CORPUS_PERSON.avery.id,
      body: 'Priya will not write a term sheet until Northstar proof lands. Do not reforecast runway.',
    },
    {
      id: CORPUS_UUID.note(2),
      entityId: objectByName('Brightline Health', 'deal'),
      authorUserId: CORPUS_PERSON.mika.id,
      body: 'CSV + evidence packs only. HIPAA stays in the MSA excerpt.',
    },
    {
      id: CORPUS_UUID.note(3),
      entityId: objectByName('Product designer'),
      authorUserId: CORPUS_PERSON.sam.id,
      body: `Maya Chen: strong systems craft, weaker product narrative. Final round ${dm(D.mayaFinal)}.`,
    },
    {
      id: CORPUS_UUID.note(4),
      entityId: objectByName('Northstar Works'),
      authorUserId: CORPUS_PERSON.casey.id,
      body: `Field-mapping is delayed to ${dm(D.elenaConfirm)}. CSV fallback stands. Review should move to ${dm(D.pilotReview)}.`,
    },
    {
      id: CORPUS_UUID.note(5),
      entityId: objectByName('Helio Retail pilot'),
      authorUserId: CORPUS_PERSON.casey.id,
      body: `Technical validation is ${dm(D.helioValidation)}. Confirm attendees before the call.`,
    },
    {
      id: CORPUS_UUID.note(6),
      entityId: objectByName('Atlas beta webinar'),
      authorUserId: CORPUS_PERSON.riley.id,
      body: `Blocked on Avery quote, cropped screenshot, and the ${dm(D.dryRun)} dry run.`,
    },
    {
      id: CORPUS_UUID.note(7),
      entityId: objectByName('Senior backend engineer'),
      authorUserId: CORPUS_PERSON.quinn.id,
      body: `No offer this week. Reopen sourcing ${dm(D.dryRun)}. No on-prem customers.`,
    },
    {
      id: CORPUS_UUID.note(8),
      entityId: objectByName('Replay CSV preview from stored bytes'),
      authorUserId: CORPUS_PERSON.jordan.id,
      body: 'Preview reads stored bytes. Live vendor calls stay out of CI.',
    },
    {
      id: CORPUS_UUID.note(9),
      entityId: objectByName('Northstar Works'),
      authorUserId: CORPUS_PERSON.avery.id,
      body: `@Casey can you confirm the ${dm(D.pilotReview)} review still holds? @TheTimelineBot summarize the blockers.`,
    },
    {
      id: CORPUS_UUID.note(10),
      entityId: objectByName('Northstar Works'),
      authorUserId: CORPUS_PERSON.casey.id,
      body: `@Avery yes — keep ${dm(D.pilotReview)}. CSV fallback is the source of truth.`,
    },
    {
      id: CORPUS_UUID.note(11),
      entityId: objectByName('Helio Retail pilot'),
      authorUserId: CORPUS_PERSON.mika.id,
      body: '@Riley please attach the attendee list before Tuesday.',
    },
  ];
}

export let CORPUS_NOTES = buildCorpusNotes();

export const CORPUS_NOTE_MENTIONS = [
  {
    id: CORPUS_UUID.mention(1),
    noteId: CORPUS_UUID.note(9),
    entityId: objectByName('Northstar Works'),
    mentionedUserId: CORPUS_PERSON.casey.id,
    kind: 'user' as const,
    startOffset: 0,
    endOffset: 6,
  },
  {
    id: CORPUS_UUID.mention(2),
    noteId: CORPUS_UUID.note(9),
    entityId: objectByName('Northstar Works'),
    mentionedUserId: null,
    kind: 'agent' as const,
    startOffset: 56,
    endOffset: 66,
  },
  {
    id: CORPUS_UUID.mention(3),
    noteId: CORPUS_UUID.note(10),
    entityId: objectByName('Northstar Works'),
    mentionedUserId: CORPUS_PERSON.avery.id,
    kind: 'user' as const,
    startOffset: 0,
    endOffset: 6,
  },
  {
    id: CORPUS_UUID.mention(4),
    noteId: CORPUS_UUID.note(11),
    entityId: objectByName('Helio Retail pilot'),
    mentionedUserId: CORPUS_PERSON.riley.id,
    kind: 'user' as const,
    startOffset: 0,
    endOffset: 6,
  },
] as const;

function buildCorpusMentionNotifications() {
  return [
    {
      id: CORPUS_UUID.notification(1),
      userId: CORPUS_PERSON.casey.id,
      entityId: objectByName('Northstar Works'),
      noteId: CORPUS_UUID.note(9),
      summary: 'Avery Timeline mentioned you on Northstar Works',
      actorUserId: CORPUS_PERSON.avery.id,
      actorName: 'Avery Timeline',
      excerpt: `@Casey can you confirm the ${dm(D.pilotReview)} review still holds? @TheTimelineBot summarize the blockers.`,
    },
    {
      id: CORPUS_UUID.notification(2),
      userId: CORPUS_PERSON.riley.id,
      entityId: objectByName('Helio Retail pilot'),
      noteId: CORPUS_UUID.note(11),
      summary: 'Mika Product mentioned you on Helio Retail pilot',
      actorUserId: CORPUS_PERSON.mika.id,
      actorName: 'Mika Product',
      excerpt: '@Riley please attach the attendee list before Tuesday.',
    },
  ];
}

export let CORPUS_MENTION_NOTIFICATIONS = buildCorpusMentionNotifications();
