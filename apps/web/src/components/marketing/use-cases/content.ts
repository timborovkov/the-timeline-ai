import type { MarketingScreenshotCallout } from '@/components/marketing/screenshot-slot';
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
  callouts?: readonly MarketingScreenshotCallout[];
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
  howItWorks?: readonly string[];
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
    summary: 'Find the decisions, promises and handoffs behind a project’s current state.',
    howItWorks: [
      'Link a Slack channel or Telegram group, forward email, or add calls. Each item joins the timeline with its source, time and visibility.',
      'Lasting record changes are proposed for your approval. Captured evidence stays unchanged.',
    ],
    example: {
      label: 'Fictional example',
      lines: [
        'Mon 08:46 Telegram · Acme launch group: “Customer update promised”.',
        'Mon 09:14 Slack · #acme-rollout: “Onboarding copy approved”.',
        'Tue 11:40 Meeting · launch review: “SSO named as the blocker”.',
        'Wed 15:22 GitHub · PR #482: “Migration callback merged”.',
      ],
    },
    needs: 'Start with one linked chat. Add documents and connected tools when you need them.',
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
    howItWorks: [
      'Send the workspace update by email, Slack or Telegram.',
      'For a specific client, project or time window, ask for a focused update.',
    ],
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
        caption: 'Highlights, follow-ups and upcoming work, with linked tasks and calendar items.',
        reshoot: `${RESHOOT_CITATION_SEED} Capture from the top of the page.`,
        placement: 'after-subhead',
        callouts: [
          {
            label: 'What changed',
            detail: 'Highlights and status are written from that day’s captured work.',
          },
          {
            label: 'Who owns the next step',
            detail: 'Follow-ups and new tasks name the next owner.',
          },
          {
            label: 'Link to the source',
            detail: 'Open linked tasks and calendar items; find captured sources in Timeline.',
          },
        ],
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
      'Find an agreement across chat, email and calls without retracing every conversation.',
    eyebrow: 'Use case · Communication trail',
    title: 'Every promise, traceable.',
    summary: 'Find an agreement across chat, email and calls without retracing every conversation.',
    howItWorks: [
      'Ask in the web app, Slack (/ask or @Timeline), or Telegram.',
      'Each answer links to the original message, email or call. Access follows the source’s visibility.',
    ],
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
          'A stored example from the fictional Acme Labs demo: what was agreed, with each claim linked to its source.',
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
    problemLine: 'A well-kept Pipedrive can still miss what was said on a call or in a group chat.',
    howItWorks: [
      'Review suggested changes beside the conversation that prompted them.',
      'Keep people, companies, deals and follow-ups together in the work record.',
    ],
    blocks: [
      {
        title: 'People and companies',
        body: 'Keep contacts and conversation history together.',
      },
      {
        title: 'Deals and follow-ups',
        body: 'Track commitments and the next follow-up.',
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
        answer: 'No. Native sync with those tools is planned, not available today.',
      },
      {
        question: 'Can an internal Slack comment become customer fact?',
        answer:
          'It stays an internal statement. Answers distinguish it from direct customer evidence.',
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
        alt: 'Customer dealflow board with complete kanban lanes, including Committed.',
        caption: 'Deals on a board, with complete lanes from inbound through committed.',
        reshoot: `${RESHOOT_CITATION_SEED} Capture the scrolling kanban so lane cards are complete, not clipped.`,
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
    howItWorks: [
      'Review suggested changes, then approve, edit or reject them.',
      'Kanban and list views use the same records. GitHub, Linear and Monday.com activity can sync in alongside them.',
    ],
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
        reshoot: `${RESHOOT_CITATION_SEED} Recapture after a current demo seed so due dates match relative seed days.`,
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
    summary: 'Give new teammates the earlier answer, with the source where it was settled.',
    howItWorks: [
      'Ask in Telegram, Slack or the web app.',
      'Request a handoff brief for a new owner: decisions, current state, blockers and commitments.',
    ],
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
          'A stored example from the fictional Acme Labs demo: account, current state, commitments and open gaps, each with its source.',
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
    'One work record kept current from Slack, Telegram, email and calls. Use it for a work record, daily updates, communication history, customer context, task boards and onboarding.',
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
