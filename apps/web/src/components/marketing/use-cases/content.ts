import type { PublicCanonicalPath } from '@/lib/public-site';

export const USE_CASE_ROUTES = {
  workRecord: '/use-cases/work-record',
  teamDailyLog: '/use-cases/team-daily-log',
  communicationTrail: '/use-cases/communication-trail',
  crm: '/use-cases/crm',
  taskBoard: '/use-cases/task-board',
  onboarding: '/use-cases/onboarding-and-repeat-questions',
} as const satisfies Record<string, `/use-cases/${string}`>;

export type UseCaseRoute = (typeof USE_CASE_ROUTES)[keyof typeof USE_CASE_ROUTES];
type UseCaseSlug = UseCaseRoute extends `/use-cases/${infer Slug}` ? Slug : never;

interface UseCaseScreenshot {
  file: string;
  alt: string;
  caption: string;
  reshoot: string;
  placement: 'after-subhead' | 'after-how-it-works';
}

interface UseCaseFaq {
  question: string;
  answer: string;
}

interface UseCaseBlock {
  title: string;
  body: string;
}

export interface UseCaseContent {
  slug: UseCaseSlug;
  route: UseCaseRoute;
  navLabel: string;
  cardTitle: string;
  cardBody: string;
  seoTitle: string;
  seoDescription: string;
  eyebrow: string;
  title: string;
  summary: string;
  howItWorks?: string;
  example: {
    label: string;
    title?: string;
    lines: readonly string[];
  };
  needs?: string;
  whoItsFor?: string;
  problemLine?: string;
  boundary?: string;
  blocks?: readonly UseCaseBlock[];
  faqs: readonly UseCaseFaq[];
  screenshots: readonly UseCaseScreenshot[];
  relatedRoutes: readonly UseCaseRoute[];
}

const RESHOOT_CITATION_SEED =
  'To reshoot after citation redesign and seed update. Keep the same screen, URL and framing.';

export const USE_CASES: readonly UseCaseContent[] = [
  {
    slug: 'work-record',
    route: USE_CASE_ROUTES.workRecord,
    navLabel: 'Work record',
    cardTitle: 'Work record',
    cardBody: 'Every decision, promise and handoff in order, with where it was said.',
    seoTitle: 'An auto-updating work record',
    seoDescription:
      'Every decision, promise and handoff in order, with where it was said. The Timeline keeps it current from Slack, Telegram, email and calls.',
    eyebrow: 'Use case · Work record',
    title: 'A work record that keeps itself current.',
    summary:
      'Every decision, promise and handoff in order, with where it was said. Ask what happened on any project and trace each line to its source.',
    howItWorks:
      'Link a Slack channel or Telegram group, forward email, and add calls. The Timeline places each message, call and document on one timeline with its source, time and visibility. When something points to a lasting change, like a new owner, a decision or a deal stage, The Timeline proposes the update to the record and a person approves it. Captured evidence is never rewritten.',
    example: {
      label: 'Fictional example',
      lines: [
        'Mon 08:46 Telegram · Acme launch group: “Customer update promised”.',
        'Mon 09:14 Slack · #acme-rollout: “Onboarding copy approved”.',
        'Tue 11:40 Meeting · launch review: “SSO named as the blocker”.',
        'Wed 15:22 GitHub · PR #482: “Migration callback merged”.',
      ],
    },
    needs:
      'One linked chat to start. Email, calls, documents and tools like GitHub, Linear, Google Drive, Monday.com and Sentry can be added as needed.',
    faqs: [
      {
        question: 'Does it read our whole Slack?',
        answer: 'No. Only the channels you select and activate.',
      },
      {
        question: 'Can it change records on its own?',
        answer: 'No. Lasting changes wait for a person to approve them.',
      },
    ],
    screenshots: [
      {
        file: '11-timeline-dark.png',
        alt: 'The Timeline chronology with messages, notes, documents and code activity in order.',
        caption:
          'Every message, note, document and code update in order, with who said it, where and when.',
        reshoot: RESHOOT_CITATION_SEED,
        placement: 'after-subhead',
      },
      {
        file: '23-project-northstar-dark.png',
        alt: 'Project Northstar record with status, blocker and review date linked to sources.',
        caption:
          'The project record, written from the evidence: status, blocker, fallback and review date, each linked to its source.',
        reshoot: RESHOOT_CITATION_SEED,
        placement: 'after-how-it-works',
      },
    ],
    relatedRoutes: [USE_CASE_ROUTES.teamDailyLog, USE_CASE_ROUTES.communicationTrail],
  },
  {
    slug: 'team-daily-log',
    route: USE_CASE_ROUTES.teamDailyLog,
    navLabel: 'Team daily log',
    cardTitle: 'Team daily log',
    cardBody: 'A daily update for the workspace, written from what the team said and shipped.',
    seoTitle: 'Team daily log, written from your conversations',
    seoDescription:
      'A daily update for your workspace: who did what, what was decided and what’s blocked, written from what the team said and shipped, with the source for every line.',
    eyebrow: 'Use case · Team daily log',
    title: 'Who did what yesterday, without a standup.',
    summary:
      'A daily update for the workspace, written from what the team actually said and shipped, with links to each source.',
    howItWorks:
      'The Timeline writes one daily update for the workspace from the latest captured threads, calls, email and synced tools. Send it to every member by email, or post it to a Slack channel or Telegram group. Need more detail on one client, project or topic? Ask, and get an update for any time window.',
    example: {
      label: 'Fictional example',
      lines: [
        'SHIPPED: Migration callback merged (GitHub · PR #482).',
        'DECIDED: Onboarding copy approved (Slack · #acme-rollout).',
        'BLOCKED: SSO validation before launch (Meeting · launch review).',
      ],
    },
    faqs: [
      {
        question: 'Where does the daily update go?',
        answer:
          'By email to every member by default. You can add a Slack channel, Slack DMs, a Telegram chat or Telegram DMs.',
      },
      {
        question: 'Can I see past days?',
        answer: 'Yes. Work → Digests keeps every daily update.',
      },
    ],
    screenshots: [
      {
        file: '33-digest-dark.png',
        alt: 'Daily workspace update with highlights, status, follow-ups, new tasks and upcoming calendar.',
        caption:
          'The daily update: highlights, status, follow-ups, new tasks and what’s coming up, written from what the team said and shipped.',
        reshoot: `${RESHOOT_CITATION_SEED} Capture from the top of the page.`,
        placement: 'after-subhead',
      },
      {
        file: '44-work-dark.png',
        alt: 'Work surface listing past daily updates next to tasks, boards and approvals.',
        caption:
          'Every past daily update stays under Work → Digests, next to tasks, boards and approvals.',
        reshoot: RESHOOT_CITATION_SEED,
        placement: 'after-how-it-works',
      },
    ],
    relatedRoutes: [USE_CASE_ROUTES.workRecord, USE_CASE_ROUTES.communicationTrail],
  },
  {
    slug: 'communication-trail',
    route: USE_CASE_ROUTES.communicationTrail,
    navLabel: 'Communication trail',
    cardTitle: 'Communication trail',
    cardBody: 'Find what was agreed, by whom and where, across chat, email and calls.',
    seoTitle: 'A communication trail across chat, email and calls',
    seoDescription:
      'Find what was agreed, by whom and where, across Telegram, Slack, email and calls, without scrolling four apps or messaging three people.',
    eyebrow: 'Use case · Communication trail',
    title: 'Every promise, traceable.',
    summary:
      'Find what was agreed, by whom and where, across Telegram, Slack, email and calls, without scrolling four apps or messaging three people.',
    howItWorks:
      'Ask in the web app, in Slack (/ask or @Timeline) or in a Telegram chat with The Timeline. The answer quotes the record and links each line to the message, email or call it came from. People only see sources they are allowed to see.',
    example: {
      label: 'Fictional example',
      title: 'What did we promise Acme, and where?',
      lines: [
        'You: “What did we promise Acme, and where?”',
        'The Timeline: “An update by the 14th [01]. SSO is still the launch blocker [03]. Priya owns the review [05].”',
        '[01] Telegram · Acme launch group · [03] Meeting · launch review · [05] Documents · checklist',
      ],
    },
    faqs: [
      {
        question: 'What if two sources disagree?',
        answer: 'The answer names the conflict and cites both.',
      },
      {
        question: 'Does email count?',
        answer: 'Yes, when it’s forwarded, CC’d or BCC’d to the team address.',
      },
    ],
    screenshots: [
      {
        file: '14-timeline-email-dark.png',
        alt: 'An email on the timeline with a related Telegram message and call transcript beside it.',
        caption: 'One email, with the related Telegram message and call transcript beside it.',
        reshoot: RESHOOT_CITATION_SEED,
        placement: 'after-subhead',
      },
      {
        file: '31-ask-status-dark.png',
        alt: 'Ask answer about what was agreed, with each claim linked to its source.',
        caption:
          'Ask what was agreed, and every claim links to the message, email or call it came from.',
        reshoot: RESHOOT_CITATION_SEED,
        placement: 'after-how-it-works',
      },
    ],
    relatedRoutes: [USE_CASE_ROUTES.workRecord, USE_CASE_ROUTES.crm],
  },
  {
    slug: 'crm',
    route: USE_CASE_ROUTES.crm,
    navLabel: 'CRM',
    cardTitle: 'CRM',
    cardBody: 'People, companies, deals and follow-ups, filled in from the conversation.',
    seoTitle: 'CRM kept up to date from your conversations',
    seoDescription:
      'The Timeline fills in people, company, deal and follow-up records from Slack, Telegram, email and calls, with the source for every line and your approval before anything changes.',
    eyebrow: 'Use case · CRM',
    title: 'Customer context, filled in from the conversation.',
    summary:
      'People, companies, deals and follow-ups stay tied to the calls, emails and chats where they came up, and every update waits for your approval.',
    problemLine:
      'Even a well-kept Pipedrive misses what was said on the call, in the group chat or in the email thread. The opposite failure is an agent that updates records from weak signals without showing its evidence.',
    howItWorks:
      'The Timeline keeps people, companies, deals and follow-ups tied to the calls, emails and chats where they came up. Each update is proposed with its source, and a person approves it.',
    blocks: [
      {
        title: 'People and companies',
        body: 'Who you spoke to and what was said, each line linked to its source.',
      },
      {
        title: 'Deals and follow-ups',
        body: 'Commitments from calls and email become proposed updates that a person approves.',
      },
    ],
    boundary:
      'The Timeline keeps its own people, company and deal records. It doesn’t sync to Pipedrive, HubSpot or Salesforce today (listed as coming later).',
    example: {
      label: 'Fictional example',
      lines: [
        'Stakeholder: Maya Chen owns the technical evaluation [meeting].',
        'Interest: the customer requested a two-region expansion option [email].',
        'Commitment: security answers are due before the next review [Slack].',
        'Gap: no captured source confirms budget authority or purchase timing.',
      ],
    },
    faqs: [
      {
        question: 'Does The Timeline update Pipedrive, HubSpot or Salesforce automatically?',
        answer:
          'No. Those tools are listed as coming later. The Timeline keeps its own people, company and deal records, and inferred changes stay proposals until a person approves them.',
      },
      {
        question: 'Can an internal Slack comment become customer fact?',
        answer:
          'It can be preserved as an internal statement, not silently promoted to customer-confirmed fact. A good answer labels the source and distinguishes direct customer evidence from internal interpretation.',
      },
    ],
    screenshots: [
      {
        file: '22-client-northstar-dark.png',
        alt: 'A client record with open tasks, pending approvals and documents in one place.',
        caption:
          'A client record with its open tasks, pending approvals and documents in one place.',
        reshoot: RESHOOT_CITATION_SEED,
        placement: 'after-subhead',
      },
      {
        file: '27-board-dealflow-dark.png',
        alt: 'Deals on a board from Qualified to Proposal.',
        caption: 'Deals on a board, from Qualified to Proposal.',
        reshoot: `${RESHOOT_CITATION_SEED} The dealflow board is wider than 1440 px; crop to the visible lanes or reshoot wider.`,
        placement: 'after-how-it-works',
      },
    ],
    relatedRoutes: [USE_CASE_ROUTES.communicationTrail, USE_CASE_ROUTES.taskBoard],
  },
  {
    slug: 'task-board',
    route: USE_CASE_ROUTES.taskBoard,
    navLabel: 'Task board',
    cardTitle: 'Task board',
    cardBody: 'Owners, due dates and status changes said in chat become proposed task updates.',
    seoTitle: 'Task boards that keep up with the conversation',
    seoDescription:
      'Owners, due dates and status changes said in chat become proposed task updates, applied once a person approves. Kanban and list views included.',
    eyebrow: 'Use case · Task board',
    title: 'Task boards that keep up.',
    summary:
      'Owners, due dates and status changes said in chat become proposed task updates, applied once a person approves.',
    howItWorks:
      'The Timeline spots task changes in Slack, Telegram, email and calls and proposes them with the source attached. You approve, edit or reject. Boards show kanban and list views over the same tasks, people, companies, deals and projects. GitHub, Linear and Monday.com records can sync in alongside.',
    example: {
      label: 'Fictional example',
      lines: [
        'Slack · #acme-rollout: “Priya will own the migration checklist. Review on the 14th.”',
        'Proposed change, waiting for approval: Migration checklist, owner Priya Shah, due 14th.',
      ],
    },
    faqs: [
      {
        question: 'Is this another task tool to maintain?',
        answer:
          'No. Boards organise the same records The Timeline already keeps current. Manual edits are for judgment calls, not retyping.',
      },
      {
        question: 'Does it replace Jira or Linear?',
        answer:
          'No. Linear syncs in, and Jira can be looked up live via MCP (listed on Integrations).',
      },
    ],
    screenshots: [
      {
        file: '25-tasks-dark.png',
        alt: 'Tasks by status, with owners, due dates and pending task proposals.',
        caption:
          'Tasks by status, with owners, due dates and the task proposals waiting for approval.',
        reshoot: `${RESHOOT_CITATION_SEED} Every due date currently reads Overdue.`,
        placement: 'after-subhead',
      },
      {
        file: '24-task-northstar-dark.png',
        alt: 'A task record with evidence and facts explaining why it is blocked.',
        caption:
          'Each task keeps its evidence and facts, so you can see why it’s blocked and where that came from.',
        reshoot: RESHOOT_CITATION_SEED,
        placement: 'after-how-it-works',
      },
    ],
    relatedRoutes: [USE_CASE_ROUTES.workRecord, USE_CASE_ROUTES.crm],
  },
  {
    slug: 'onboarding-and-repeat-questions',
    route: USE_CASE_ROUTES.onboarding,
    navLabel: 'Onboarding and repeat questions',
    cardTitle: 'Onboarding and repeat questions',
    cardBody: 'Answer it once, and new people find it with its source.',
    seoTitle: 'Onboarding and repeat questions, answered once',
    seoDescription:
      'New teammates and frontline staff ask The Timeline and get the earlier answer back from the chat where it was given, with its source.',
    eyebrow: 'Use case · Onboarding and repeat questions',
    title: 'Answer it once. New people find it.',
    summary:
      'Questions that were already answered get the earlier answer back, with its source. Handoff briefs bring a new teammate up to speed on decisions, owners and open items.',
    howItWorks:
      'Staff ask in Telegram, Slack or the web app. The Timeline answers from the captured record and cites the message, call or document where it was settled. For a new owner, ask for a handoff brief: decisions, current state, blockers, commitments and owners, each with its source.',
    whoItsFor:
      'Frontline staff on Telegram, client teams at agencies and consultancies, and anyone joining a project mid-flight.',
    example: {
      label: 'Fictional example',
      lines: [
        'New teammate: “How do we handle a refund request?”',
        'The Timeline: “Use the process the team agreed in the support channel [01].”',
      ],
    },
    faqs: [
      {
        question: 'Can new people see private context?',
        answer: 'Only what visibility rules allow them to see.',
      },
    ],
    screenshots: [
      {
        file: '32-ask-handoff-dark.png',
        alt: 'A handoff brief in Ask, with account, current state, commitments and open gaps cited.',
        caption:
          'Ask for a handoff brief: account, current state, commitments and open gaps, each with its source.',
        reshoot: RESHOOT_CITATION_SEED,
        placement: 'after-subhead',
      },
      {
        file: '35b-meeting-northstar-dark.png',
        alt: 'A captured handoff call with its transcript on the record.',
        caption: 'The handoff call is on the record too, with its transcript.',
        reshoot: RESHOOT_CITATION_SEED,
        placement: 'after-how-it-works',
      },
    ],
    relatedRoutes: [USE_CASE_ROUTES.workRecord, USE_CASE_ROUTES.communicationTrail],
  },
];

export const USE_CASE_HUB = {
  route: '/use-cases' as const satisfies PublicCanonicalPath,
  seoTitle: 'Use cases',
  seoDescription:
    'One work record kept current from Slack, Telegram, email and calls. It powers a work record, a team daily log, a communication trail, a CRM, a task board, and onboarding and repeat questions.',
  title: 'One record. Six ways teams use it.',
  summary:
    'The Timeline keeps your work record current from the conversations your team already has. Here’s what teams do with it.',
} as const;

export const USE_CASE_CANONICAL_ROUTES = USE_CASES.map((useCase) => useCase.route);

export function findUseCase(slug: string): UseCaseContent | undefined {
  return USE_CASES.find((useCase) => useCase.slug === slug);
}

export function findUseCaseByRoute(route: UseCaseRoute): UseCaseContent {
  const useCase = USE_CASES.find((candidate) => candidate.route === route);
  if (!useCase) throw new Error(`Missing use-case content for ${route}`);
  return useCase;
}
