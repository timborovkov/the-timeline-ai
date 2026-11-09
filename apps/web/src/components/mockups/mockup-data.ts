/**
 * Hardcoded Acme Labs fixtures for visual mockups only.
 * Example data — not loaded from the database, APIs, or auth session.
 */

import { providerLogoSrc } from '@/lib/connections';

export const MOCKUP_TEAM = {
  name: 'Acme Labs',
  viewer: 'Avery Timeline',
  viewerRole: 'CEO',
} as const;

export const MOCKUP_ROUTES = [
  {
    href: '/mockups/today',
    title: 'Brief-first home',
    description:
      'A chief-of-staff Today brief, then needs-you actions, with the current record one click deeper.',
  },
  {
    href: '/mockups/milestones',
    title: 'Milestone history',
    description:
      'Meaningful Northstar milestones with expandable evidence, plus a toggle to the raw timeline.',
  },
  {
    href: '/mockups/approve',
    title: 'Approve in chat',
    description:
      'Drafted replies and proposed record changes as cards in Slack/Telegram and in-app Ask.',
  },
] as const;

export interface MockPerson {
  id: string;
  name: string;
  title: string;
  kind: 'member' | 'external';
  company?: string;
}

export interface MockProject {
  id: string;
  name: string;
  kind: 'company' | 'project' | 'deal';
}

export interface MockEvidence {
  id: string;
  number: number;
  source: 'slack' | 'telegram' | 'email' | 'meeting';
  sourceLabel: string;
  author: string;
  dateLabel: string;
  quote: string;
  channel?: string;
}

function required<T>(value: T | undefined, label: string): T {
  if (!value) throw new Error(`Missing mockup example data: ${label}`);
  return value;
}

export const PEOPLE = {
  avery: {
    id: 'avery',
    name: 'Avery Timeline',
    title: 'CEO',
    kind: 'member',
  },
  mika: {
    id: 'mika',
    name: 'Mika Product',
    title: 'Head of Product',
    kind: 'member',
  },
  casey: {
    id: 'casey',
    name: 'Casey Novak',
    title: 'Account executive',
    kind: 'member',
  },
  sam: {
    id: 'sam',
    name: 'Sam Rivera',
    title: 'Design lead',
    kind: 'member',
  },
  riley: {
    id: 'riley',
    name: 'Riley Cho',
    title: 'Marketing lead',
    kind: 'member',
  },
  elena: {
    id: 'elena',
    name: 'Elena Park',
    title: 'VP Product',
    kind: 'external',
    company: 'Northstar Works',
  },
  priya: {
    id: 'priya',
    name: 'Priya Shah',
    title: 'Partner',
    kind: 'external',
    company: 'Northwind Capital',
  },
  maya: {
    id: 'maya',
    name: 'Maya Chen',
    title: 'Product designer candidate',
    kind: 'external',
  },
};

const PROJECTS = {
  northstar: { id: 'northstar', name: 'Northstar Works', kind: 'company' },
  pilot: { id: 'pilot', name: 'Northstar pilot', kind: 'project' },
  atlas: { id: 'atlas', name: 'Project Atlas', kind: 'project' },
  seriesA: { id: 'seriesA', name: 'Series A', kind: 'deal' },
  polar: { id: 'polar', name: 'Polar Studio', kind: 'company' },
};

const EVIDENCE = {
  elenaEmail: {
    id: 'elenaEmail',
    number: 1,
    source: 'email',
    sourceLabel: 'Email',
    author: 'Avery Timeline',
    dateLabel: 'Thu 09:14',
    quote:
      'Elena — mapping the remaining three export columns tonight. If those stay as-is we can ship CSV this week.',
    channel: 'elena@northstar.example',
  },
  caseySlack: {
    id: 'caseySlack',
    number: 2,
    source: 'slack',
    sourceLabel: 'Slack',
    author: 'Casey Novak',
    dateLabel: 'Fri 16:41',
    quote:
      'Told Priya the diligence pack would land today. I need Avery to sanity-check the data room index.',
    channel: '#gtm',
  },
  mayaCal: {
    id: 'mayaCal',
    number: 3,
    source: 'meeting',
    sourceLabel: 'Calendar',
    author: 'Quinn Okonkwo',
    dateLabel: 'Today 15:00',
    quote:
      'Maya Chen final round. Sam dropped the scorecard in #hiring — please read it before 15:00.',
    channel: 'Hiring',
  },
  kickoff: {
    id: 'kickoff',
    number: 1,
    source: 'meeting',
    sourceLabel: 'Call',
    author: 'Elena Park',
    dateLabel: '37 days ago',
    quote: 'Let’s treat Atlas as the design partner path. I’ll send a sample export next week.',
    channel: 'Northstar kickoff',
  },
  exportCommit: {
    id: 'exportCommit',
    number: 2,
    source: 'email',
    sourceLabel: 'Email',
    author: 'Elena Park',
    dateLabel: '31 days ago',
    quote:
      'Sample export attached. Field names are still in flux — flag anything Atlas cannot map.',
    channel: 'elena@northstar.example',
  },
  csvFallback: {
    id: 'csvFallback',
    number: 3,
    source: 'slack',
    sourceLabel: 'Slack',
    author: 'Mika Product',
    dateLabel: '24 days ago',
    quote:
      'Decision: CSV fallback for the Northstar pilot. Linear NORTH-42 stays blocked on field-mapping.',
    channel: '#product',
  },
  proposalSent: {
    id: 'proposalSent',
    number: 4,
    source: 'email',
    sourceLabel: 'Email',
    author: 'Casey Novak',
    dateLabel: '12 days ago',
    quote:
      'Pilot SOW and pricing sent to Elena. Asked for a go / no-go before the next working session.',
    channel: 'elena@northstar.example',
  },
  mvpSignoff: {
    id: 'mvpSignoff',
    number: 5,
    source: 'slack',
    sourceLabel: 'Slack',
    author: 'Sam Rivera',
    dateLabel: '6 days ago',
    quote:
      'Elena signed off MVP designs in the working session. I’ll publish the spec to the data room.',
    channel: '#product',
  },
  telegramNudge: {
    id: 'telegramNudge',
    number: 6,
    source: 'telegram',
    sourceLabel: 'Telegram',
    author: 'Avery Timeline',
    dateLabel: 'Fri 18:02',
    quote: 'Casey, don’t let the Priya pack slip. If it is not in her inbox Friday we look sloppy.',
    channel: 'Acme leadership',
  },
};

export type PersonId = keyof typeof PEOPLE;
export type ProjectId = keyof typeof PROJECTS;
export type EvidenceId = keyof typeof EVIDENCE;

export function mockPerson(id: PersonId): MockPerson {
  return required(PEOPLE[id], id) as MockPerson;
}

export function mockProject(id: ProjectId): MockProject {
  return required(PROJECTS[id], id) as MockProject;
}

export function mockEvidence(id: EvidenceId): MockEvidence {
  return required(EVIDENCE[id], id) as MockEvidence;
}

export function mockupSourceLogoSrc(source: MockEvidence['source']): string {
  if (source === 'meeting') return providerLogoSrc('google-meet');
  return providerLogoSrc(source);
}

export const TODAY_COUNTS = [
  { id: 'needs', count: 3, label: 'needs you', danger: false },
  { id: 'overdue', count: 1, label: 'overdue', danger: true },
  { id: 'meetings', count: 2, label: 'meetings', danger: false },
  { id: 'promises', count: 4, label: 'open promises', danger: false },
] as const;

export const TODAY_NEEDS = [
  {
    id: 'elena-reply',
    title: 'Unanswered proposal to Elena Park',
    body: 'Thursday’s field-mapping note is still unread. The CSV fallback cannot ship until three columns are confirmed.',
    context: 'Northstar Works · 4 days',
    evidenceId: 'elenaEmail' as const,
    primary: 'Send reply draft',
    personId: 'elena' as const,
    projectId: 'northstar' as const,
  },
  {
    id: 'priya-pack',
    title: 'Diligence pack promised to Priya Shah',
    body: 'Casey told Northwind the pack would land Friday. It did not. Avery still needs to check the data room index.',
    context: 'Series A · overdue',
    evidenceId: 'caseySlack' as const,
    primary: 'Prep me',
    personId: 'priya' as const,
    projectId: 'seriesA' as const,
    danger: true,
  },
  {
    id: 'polar-board',
    title: 'Polar Studio waiting on a record change',
    body: 'Inbound from Polar Studio is not a live dealflow card until someone approves adding it to Customer dealflow.',
    context: 'Approvals · pending',
    evidenceId: 'caseySlack' as const,
    primary: 'Approve record change',
    projectId: 'polar' as const,
  },
] as const;

export const TODAY_MEETINGS = [
  {
    id: 'maya',
    title: 'Maya Chen final round',
    when: 'Today 15:00 · 45 min',
    detail: 'Product designer. Sam left the scorecard in #hiring.',
    evidenceId: 'mayaCal' as const,
    personId: 'maya' as const,
  },
  {
    id: 'northstar-checkin',
    title: 'Northstar weekly',
    when: 'Today 16:30 · 30 min',
    detail: 'Elena may join. Field-mapping is the only decision on the agenda.',
    evidenceId: 'elenaEmail' as const,
    personId: 'elena' as const,
    projectId: 'northstar' as const,
  },
] as const;

export const ASK_SUGGESTIONS = [
  'What did we promise people?',
  'Prep me for Elena Park',
  'Prep me for Maya Chen',
  'What is overdue?',
] as const;

export const CURRENT_HOME_ATTENTION = [
  { href: '#approvals', count: 3, label: 'pending approvals', action: 'Review', danger: false },
  { href: '#overdue', count: 1, label: 'overdue', action: 'Open work', danger: true },
  { href: '#tasks', count: 8, label: 'open tasks', action: 'Open tasks', danger: false },
  { href: '#objects', count: 12, label: 'open objects', action: 'Open objects', danger: false },
] as const;

export const CURRENT_HOME_MOMENTS = [
  {
    id: 'm1',
    time: '09:14',
    source: 'Email',
    title: 'Avery asked Elena to confirm three export columns',
  },
  {
    id: 'm2',
    time: 'Yesterday',
    source: 'Slack',
    title: 'Casey promised Priya the diligence pack on Friday',
  },
  {
    id: 'm3',
    time: 'Yesterday',
    source: 'Telegram',
    title: 'Avery asked Casey not to let the Priya pack slip',
  },
  {
    id: 'm4',
    time: 'Fri',
    source: 'Linear',
    title: 'NORTH-42 still blocked on Northstar field-mapping',
  },
] as const;

export const NORTHSTAR_SUMMARY =
  'Northstar Works is the Atlas design partner. Elena committed a sample export, the team accepted a CSV fallback, and MVP designs are signed off. The live gap is the unanswered field-mapping note — without those three columns the pilot cannot ship.';

export const NORTHSTAR_NEEDS_YOU =
  'Reply to Elena on the three remaining export columns before the 16:30 weekly, or the CSV fallback stays blocked.';

export const MILESTONES = [
  {
    id: 'mvp',
    title: 'Signed off MVP designs',
    when: '6 days ago',
    summary: 'Elena accepted Sam’s Atlas MVP spec in the working session.',
    evidenceIds: ['mvpSignoff'] as const,
  },
  {
    id: 'proposal',
    title: 'Proposal sent',
    when: '12 days ago',
    summary: 'Casey sent the pilot SOW and asked for a go / no-go.',
    evidenceIds: ['proposalSent'] as const,
  },
  {
    id: 'csv',
    title: 'CSV fallback accepted',
    when: '24 days ago',
    summary: 'Mika recorded the decision in #product. Field-mapping remains the blocker.',
    evidenceIds: ['csvFallback'] as const,
  },
  {
    id: 'export',
    title: 'Sample export committed',
    when: '31 days ago',
    summary: 'Elena attached a sample file and warned that field names were still in flux.',
    evidenceIds: ['exportCommit'] as const,
  },
  {
    id: 'kickoff',
    title: 'Kickoff call',
    when: '37 days ago',
    summary: 'Elena agreed to treat Atlas as the design-partner path.',
    evidenceIds: ['kickoff'] as const,
  },
] as const;

export const RAW_EVENTS = [
  {
    id: 'r1',
    time: 'Today 09:14',
    source: 'email' as const,
    title: 'Avery → Elena: three remaining export columns',
  },
  {
    id: 'r2',
    time: 'Fri 18:02',
    source: 'telegram' as const,
    title: 'Avery in Acme leadership: don’t let the Priya pack slip',
  },
  {
    id: 'r3',
    time: 'Fri 16:41',
    source: 'slack' as const,
    title: 'Casey in #gtm: diligence pack promised to Priya today',
  },
  {
    id: 'r4',
    time: '6 days ago',
    source: 'slack' as const,
    title: 'Sam: Elena signed off MVP designs',
  },
  {
    id: 'r5',
    time: '6 days ago',
    source: 'meeting' as const,
    title: 'Northstar working session · 48 min transcript',
  },
  {
    id: 'r6',
    time: '12 days ago',
    source: 'email' as const,
    title: 'Casey → Elena: pilot SOW and pricing',
  },
  {
    id: 'r7',
    time: '24 days ago',
    source: 'slack' as const,
    title: 'Mika: CSV fallback decision, NORTH-42 still blocked',
  },
  {
    id: 'r8',
    time: '31 days ago',
    source: 'email' as const,
    title: 'Elena: sample export attached',
  },
  {
    id: 'r9',
    time: '37 days ago',
    source: 'meeting' as const,
    title: 'Northstar kickoff call · 52 min transcript',
  },
] as const;

export const DRAFT_REPLY = `Elena — circling on the Northstar export field map. We can ship CSV this week if the three remaining columns stay as-is. Want me to send the mapping tonight?`;

export const SLACK_THREAD = [
  {
    id: 's1',
    author: 'Casey Novak',
    handle: 'casey',
    time: '09:02',
    text: 'Avery — Elena still hasn’t answered the field-mapping note. Can Timeline draft a follow-up I can send from #gtm?',
  },
  {
    id: 's2',
    author: 'Riley Cho',
    handle: 'riley',
    time: '09:04',
    text: 'Please keep it short. She already has the SOW; this is only the three columns.',
  },
] as const;

export const TELEGRAM_THREAD = [
  {
    id: 't1',
    author: 'Casey Novak',
    time: '09:06',
    text: 'Same ask in leadership: we need a reply to Elena today or the weekly is a status meeting.',
  },
] as const;

export const ASK_USER_PROMPT =
  'Draft a reply to Elena on the three export columns, and propose updating Northstar Works if she confirms.';
