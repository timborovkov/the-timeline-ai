import { DEMO_IDS } from '../demo-fixture.js';

import { CORPUS_EVENTS, CORPUS_OBJECTS, corpusObjectId } from './catalog.js';
import { CORPUS_UUID } from './ids.js';
import { CORPUS_PERSON } from './people.js';

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

export const DEALFLOW_ITEMS = [
  {
    id: CORPUS_UUID.board(32),
    entityName: 'Helio Retail pilot',
    laneName: 'Qualified',
    responsibleUserId: CORPUS_PERSON.casey.id,
    nextStep: 'Technical validation on 21 August',
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
    nextStep: 'Field-mapping confirmation on 19 August',
  },
] as const;

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

export const ATLAS_LAUNCH_ITEMS = [
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
    nextStep: 'Record after the 18 August run-of-show',
  },
  {
    id: CORPUS_UUID.board(53),
    entityName: 'Schedule Maya Chen final round',
    laneId: ATLAS_LAUNCH_BOARD.lanes.doing,
    position: 1,
    responsibleUserId: CORPUS_PERSON.quinn.id,
    nextStep: 'Final round 15 August',
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
] as const;

export const CORPUS_CALENDAR_EVENTS = [
  {
    id: CORPUS_UUID.calendar(1),
    title: 'Atlas beta webinar',
    startAt: '2026-08-20T15:00:00.000Z',
    endAt: '2026-08-20T16:00:00.000Z',
    createdByUserId: CORPUS_PERSON.riley.id,
    rawEventId: CORPUS_EVENTS.find((row) => row.contentText.includes('public launch event'))?.id,
  },
  {
    id: CORPUS_UUID.calendar(2),
    title: 'Maya Chen final round',
    startAt: '2026-08-15T13:00:00.000Z',
    endAt: '2026-08-15T14:00:00.000Z',
    createdByUserId: CORPUS_PERSON.quinn.id,
  },
  {
    id: CORPUS_UUID.calendar(3),
    title: 'Helio Retail technical validation',
    startAt: '2026-08-21T15:00:00.000Z',
    endAt: '2026-08-21T16:00:00.000Z',
    createdByUserId: CORPUS_PERSON.casey.id,
  },
  {
    id: CORPUS_UUID.calendar(4),
    title: 'Polar Studio founder demo',
    startAt: '2026-08-19T14:00:00.000Z',
    endAt: '2026-08-19T14:30:00.000Z',
    createdByUserId: CORPUS_PERSON.casey.id,
  },
  {
    id: CORPUS_UUID.calendar(5),
    title: 'Northwind diligence working session',
    startAt: '2026-08-19T09:00:00.000Z',
    endAt: '2026-08-19T10:30:00.000Z',
    createdByUserId: CORPUS_PERSON.harper.id,
  },
] as const;

export const CORPUS_PROPOSALS = [
  {
    id: CORPUS_UUID.suggestion(1),
    itemId: CORPUS_UUID.suggestion(101),
    evidenceId: CORPUS_UUID.suggestion(201),
    title: 'Create follow-up to ping Elena Park',
    summary: 'Northstar field-mapping slipped to 19 August.',
    source: 'background' as const,
    operation: 'create' as const,
    targetKind: 'task' as const,
    proposedPayload: {
      type: 'follow_up',
      canonicalName: 'Confirm Elena Park field-mapping on 19 August',
      dueAt: '2026-08-19T15:00:00.000Z',
      assigneeUserId: CORPUS_PERSON.casey.id,
    },
    eventId: CORPUS_EVENTS.find((row) =>
      row.contentText.includes('field-mapping confirmation is delayed'),
    )?.id,
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
      canonicalName: 'Send Brightline MSA excerpt by 15 August',
      dueAt: '2026-08-15T17:00:00.000Z',
      assigneeUserId: CORPUS_PERSON.harper.id,
    },
    eventId: CORPUS_EVENTS.find((row) => row.contentText.includes('accepted CSV + evidence packs'))
      ?.id,
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
      startAt: '2026-08-18T13:00:00.000Z',
      endAt: '2026-08-18T13:40:00.000Z',
      timezone: 'Europe/Helsinki',
    },
    eventId: CORPUS_EVENTS.find((row) => row.contentText.includes('Need 40-minute run of show'))
      ?.id,
  },
  {
    id: CORPUS_UUID.suggestion(4),
    itemId: CORPUS_UUID.suggestion(104),
    evidenceId: CORPUS_UUID.suggestion(204),
    title: 'Add Polar Studio to dealflow',
    summary: 'New inbound logo, founder demo on 19 August.',
    source: 'background' as const,
    operation: 'create' as const,
    targetKind: 'board_membership' as const,
    proposedPayload: {
      boardId: DEALFLOW_BOARD.id,
      entityId: objectByName('Polar Studio'),
      laneId: boardLaneId(DEALFLOW_BOARD, 'New'),
    },
    eventId: CORPUS_EVENTS.find((row) => row.contentText.includes('Polar Studio asked'))?.id,
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
      metadata: { email: 'nadia.holm@linden.example', role: 'Partner' },
    },
    eventId: CORPUS_EVENTS.find((row) => row.contentText.includes('Nadia Holm'))?.id,
  },
  {
    id: CORPUS_UUID.suggestion(6),
    itemId: CORPUS_UUID.suggestion(106),
    evidenceId: CORPUS_UUID.suggestion(206),
    title: 'Move Helio next step to technical validation',
    summary: 'Casey already proposed August 21.',
    source: 'background' as const,
    operation: 'update' as const,
    targetKind: 'board_item_update' as const,
    proposedPayload: {
      boardItemId: CORPUS_UUID.board(32),
      field: 'nextStep',
      newValue: 'Confirm Helio technical validation attendees',
    },
    eventId: CORPUS_EVENTS.find((row) => row.contentText.includes('Helio Retail: sharing'))?.id,
  },
  {
    id: CORPUS_UUID.suggestion(7),
    itemId: CORPUS_UUID.suggestion(107),
    evidenceId: CORPUS_UUID.suggestion(207),
    title: 'Reopen backend engineer sourcing as a task',
    summary: 'No offer this week.',
    source: 'chat' as const,
    operation: 'create' as const,
    targetKind: 'task' as const,
    proposedPayload: {
      canonicalName: 'Restart backend engineer outreach',
      dueAt: '2026-08-18T09:00:00.000Z',
      assigneeUserId: CORPUS_PERSON.quinn.id,
    },
    eventId: CORPUS_EVENTS.find((row) => row.contentText.includes('backend engineer loop'))?.id,
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
    eventId: CORPUS_EVENTS.find((row) => row.contentText.includes('Dana Cole'))?.id,
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
    eventId: CORPUS_EVENTS.find((row) =>
      row.contentText.includes('we keep the CSV fallback decision'),
    )?.id,
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
    eventId: CORPUS_EVENTS.find((row) => row.contentText.includes('accepted CSV + evidence packs'))
      ?.id,
  },
  {
    id: CORPUS_UUID.suggestion(11),
    itemId: CORPUS_UUID.suggestion(111),
    evidenceId: CORPUS_UUID.suggestion(211),
    title: 'Create a decision for the delayed pilot review',
    summary: 'Move the Northstar review to 26 August.',
    source: 'background' as const,
    operation: 'create' as const,
    targetKind: 'object' as const,
    proposedPayload: {
      type: 'decision',
      canonicalName: 'Move Northstar pilot review to 26 August',
      status: 'proposed',
      stage: 'proposed',
    },
    eventId: CORPUS_EVENTS.find((row) => row.contentText.includes('Pilot review should move'))?.id,
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
      dueAt: '2026-09-01T17:00:00.000Z',
      assigneeUserId: CORPUS_PERSON.casey.id,
    },
    eventId: CORPUS_EVENTS.find((row) => row.contentText.includes('Kite Logistics went cold'))?.id,
  },
  {
    id: CORPUS_UUID.suggestion(13),
    itemId: CORPUS_UUID.suggestion(113),
    evidenceId: CORPUS_UUID.suggestion(213),
    title: 'Create identity facet for Elena Park email',
    summary: 'Keep the customer email on the person object.',
    source: 'background' as const,
    operation: 'create' as const,
    targetKind: 'identity_facet' as const,
    proposedPayload: {
      entityId: objectByName('Elena Park'),
      kind: 'email',
      value: 'elena.park@northstar.example',
    },
    eventId: CORPUS_EVENTS.find((row) => row.contentText.includes('Elena Park at Northstar'))?.id,
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
    eventId: CORPUS_EVENTS.find((row) =>
      row.contentText.includes('backgrounder on evidence-backed'),
    )?.id,
  },
] as const;

export const CORPUS_CHATS = [
  {
    id: CORPUS_UUID.chat(1),
    userId: CORPUS_PERSON.avery.id,
    title: 'What did the team achieve last week?',
    createdAt: '2026-08-14T13:20:00.000Z',
    question: 'What did the team achieve last week?',
    answer:
      'Last week Acme shipped atlas-0.8.0 with CSV preview replay, opened the Northwind data room, kept the Northstar pilot on the CSV fallback after Elena Park delayed field-mapping, and moved Brightline Health to proposal. The webinar is still 20 August; Avery still owes Riley a quote.',
  },
  {
    id: CORPUS_UUID.chat(2),
    userId: CORPUS_PERSON.mika.id,
    title: 'Status of the Northstar pilot?',
    createdAt: '2026-08-12T10:05:00.000Z',
    question: 'What is the current status of the Northstar pilot?',
    answer:
      'The Northstar pilot remains blocked on field-mapping confirmation. Elena Park moved that to 19 August and asked to shift the review to 26 August. The team already accepted the CSV fallback. Invoice inv_2041 is paid.',
  },
  {
    id: CORPUS_UUID.chat(3),
    userId: CORPUS_PERSON.harper.id,
    title: 'Who owns Series A diligence?',
    createdAt: '2026-08-13T19:00:00.000Z',
    question: 'Who owns Series A diligence questions from Northwind?',
    answer:
      'Harper owns diligence Q&A. Avery sent the data-room link. Product questions route to Mika. Northwind is the lead; Linden will follow the same room; Harbor Peak stays a catch-up, not a lead.',
  },
  {
    id: CORPUS_UUID.chat(4),
    userId: CORPUS_PERSON.jordan.id,
    title: 'What is blocking the Atlas importer?',
    createdAt: '2026-07-22T08:15:00.000Z',
    question: 'What is blocking the Atlas importer?',
    answer:
      'The live importer 500s on CSV preview (ATLAS-218) were the internal blocker; that is resolved by replaying stored bytes. The customer-facing blocker is still Northstar field-mapping, tracked on NORTH-42.',
  },
  {
    id: CORPUS_UUID.chat(5),
    userId: CORPUS_PERSON.casey.id,
    title: 'Show the dealflow pipeline',
    createdAt: '2026-08-14T16:55:00.000Z',
    question: 'Show the dealflow pipeline.',
    answer:
      'Customer dealflow is Helio and Moss in Qualified, Orchard in Scoping, Brightline in Proposal, Northstar Active, and Kite Lost. Polar Studio is inbound and waiting on an add-to-board approval. Series A is Northwind in Diligence, Linden and Harbor Peak in Intro.',
  },
  {
    id: CORPUS_UUID.chat(6),
    userId: CORPUS_PERSON.quinn.id,
    title: 'What does the code of conduct say about private events?',
    createdAt: '2026-08-08T11:00:00.000Z',
    question: 'What does the code of conduct say about private events?',
    answer:
      'The code of conduct says not to share customer evidence outside the people named on the object. Quiet forwarding of private Timeline events is a firing offense. Report issues to Quinn or Avery.',
  },
] as const;

export const CORPUS_DIGEST_WINDOWS: Array<{ start: string; summary: string }> = [
  {
    start: '2026-07-20T00:00:00.000Z',
    summary: 'Importer flake, designer loop opened, Helio still inbound.',
  },
  {
    start: '2026-07-21T00:00:00.000Z',
    summary: 'Standup: Northstar still blocked; PR 188 merged.',
  },
  {
    start: '2026-07-22T00:00:00.000Z',
    summary: 'Brightline asked for a scoping call and HIPAA language.',
  },
  {
    start: '2026-07-23T00:00:00.000Z',
    summary: 'Avery will take Northwind; Harper joins for runway.',
  },
  { start: '2026-07-24T00:00:00.000Z', summary: 'Northstar invoice past due; brand voice locked.' },
  { start: '2026-07-27T00:00:00.000Z', summary: 'Moss qualified; designer interviews start.' },
  { start: '2026-07-28T00:00:00.000Z', summary: 'Standup: diligence room waits on the DPA PDF.' },
  {
    start: '2026-07-29T00:00:00.000Z',
    summary: 'ATL-214 in review; webinar landing page needs Avery.',
  },
  {
    start: '2026-07-30T00:00:00.000Z',
    summary: 'Kite parked on on-prem; Maya Chen first interview.',
  },
  { start: '2026-07-31T00:00:00.000Z', summary: 'No clinical template for Brightline in v1.' },
  {
    start: '2026-08-03T00:00:00.000Z',
    summary: 'Northwind meeting confirmed; ATLAS-218 resolved.',
  },
  { start: '2026-08-04T00:00:00.000Z', summary: 'Office rules and code of conduct uploaded.' },
  {
    start: '2026-08-05T00:00:00.000Z',
    summary: 'Orchard stays in scoping; webinar screenshot needed.',
  },
  {
    start: '2026-08-06T00:00:00.000Z',
    summary: 'Northwind asked for proof, runway, and hiring plan.',
  },
  {
    start: '2026-08-07T00:00:00.000Z',
    summary: 'Brightline accepted CSV scope; one-pager done on Monday.',
  },
  { start: '2026-08-10T00:00:00.000Z', summary: 'Polar Studio inbound; tiny logo, founder demo.' },
  {
    start: '2026-08-11T00:00:00.000Z',
    summary: 'atlas-0.8.0 tagged; standup kept the webinar date.',
  },
  {
    start: '2026-08-12T00:00:00.000Z',
    summary: 'Elena delayed field-mapping; CSV fallback still stands.',
  },
  {
    start: '2026-08-13T00:00:00.000Z',
    summary: 'Data room sent; Northstar invoice paid; Helio follow-up out.',
  },
  {
    start: '2026-08-14T00:00:00.000Z',
    summary: 'Pitch narrative in Documents; dealflow recap captured.',
  },
];

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
] as const;

export const CORPUS_NOTES = [
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
    body: 'Maya Chen: strong systems craft, weaker product narrative. Final round 15 August.',
  },
] as const;
