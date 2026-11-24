import type { MarketingScreenshotCallout } from '@/components/marketing/screenshot-slot';
import type { PublicCanonicalPath } from '@/lib/public-site';

export const USE_CASE_ROUTES = {
  teamDailyLog: '/use-cases/team-daily-log',
  communicationTrail: '/use-cases/communication-trail',
  customerContext: '/use-cases/customer-context',
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
    slug: 'team-daily-log',
    route: USE_CASE_ROUTES.teamDailyLog,
    navLabel: 'Team daily log',
    cardTitle: 'Team daily log',
    cardBody: 'A daily update for the workspace, written from what the team said and shipped.',
    seoTitle: 'Team daily log, written from your conversations',
    seoDescription:
      'A daily update for your workspace: who did what, what was decided and what’s blocked, written from what the team said and shipped, with links to supporting sources.',
    eyebrow: 'Use case · Team daily log',
    title: 'Catch up on what changed.',
    summary:
      'Read highlights and follow-ups from captured activity, then ask about a project, customer or time window.',
    howItWorks: [
      'Preview a daily brief or weekly overview in Customize updates on Home. Choose workspace activity or new matches from saved views you follow.',
      'Ask “What did I work on this week?” for a personal recap, or ask what changed for a specific customer or project. Both draw on captured activity you have permission to see.',
    ],
    example: {
      label: 'Example',
      lines: [
        'MERGED: Migration callback (GitHub · PR #482).',
        'DECIDED: Onboarding copy approved (Slack · #acme-rollout).',
        'BLOCKED: SSO validation before launch (Meeting · launch review).',
      ],
    },
    faqs: [
      {
        question: 'Where does the daily update go?',
        answer:
          'Read your update on Home. You can also use the email or direct-message destinations available in your workspace. A workspace admin manages delivery to shared Slack channels and Telegram chats separately.',
      },
      {
        question: 'Can I see past days?',
        answer: 'Yes. Open Work → Digests for recent updates and their sources.',
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
            label: 'Open linked work',
            detail: 'Tasks and calendar items open from the digest.',
          },
        ],
      },
      {
        file: '44-work-dark.png',
        alt: 'Work surface listing past daily updates next to tasks, boards and approvals.',
        caption:
          'Recent daily updates are available under Work → Digests, next to tasks, boards and approvals.',
        reshoot: RESHOOT_CITATION_SEED,
        placement: 'after-how-it-works',
      },
    ],
    relatedRoutes: [USE_CASE_ROUTES.communicationTrail],
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
    title: 'Find what was agreed.',
    summary: 'Find an agreement across chat, email and calls without retracing every conversation.',
    howItWorks: [
      'Ask in the web app, Slack (/ask or @Timeline), or Telegram.',
      'Each answer links to the original message, email or call. Access follows the source’s visibility.',
    ],
    example: {
      label: 'Example',
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
        caption: 'What was agreed, with each claim linked to its source.',
        reshoot: RESHOOT_CITATION_SEED,
        placement: 'after-how-it-works',
      },
    ],
    relatedRoutes: [USE_CASE_ROUTES.customerContext],
  },
  {
    slug: 'customer-context',
    route: USE_CASE_ROUTES.customerContext,
    navLabel: 'Customer context',
    cardTitle: 'Customer context',
    cardBody: 'People, companies, deals and follow-ups, filled in from the conversation.',
    seoTitle: 'Keep customer context together',
    seoDescription:
      'Connect people, companies, deals and follow-ups to the Slack messages, Telegram conversations, emails and calls behind them.',
    eyebrow: 'Use case · Customer context',
    title: 'Keep customer context together.',
    summary:
      'People, companies, deals and follow-ups stay tied to the calls, emails and chats where they came up, with links to the activity behind them.',
    problemLine:
      'Before a customer call, check what was promised and what still needs following up.',
    howItWorks: [
      'Open the source behind a record change. Changes that need a decision appear in Approvals.',
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
      'Small teams can use Timeline’s people, company and deal records directly. If you already use a CRM, keep it as your operational system and check the integration directory for supported access.',
    example: {
      label: 'Example',
      lines: [
        'Stakeholder: Maya Chen owns the technical evaluation [meeting].',
        'Interest: the customer requested a two-region expansion option [email].',
        'Commitment: security answers are due before the next review [Slack].',
        'Gap: no captured source confirms budget authority or purchase timing.',
      ],
    },
    faqs: [
      {
        question: 'Can changes here update my CRM?',
        answer:
          'Timeline customer records are separate. External tools may have their own actions and permissions, as listed in Integrations.',
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
      'A first report can suggest a task. Later evidence can suggest an owner, planned date or status change. Kanban and list views included.',
    eyebrow: 'Use case · Task board',
    title: 'Keep tasks connected to the conversation.',
    summary:
      'A first report can suggest a task. Later evidence can suggest an owner, planned date or status change.',
    howItWorks: [
      'Eligible routine task changes can apply automatically under workspace policy and appear in history. Review exceptions with their supporting sources.',
      'Kanban and list views use the same records. GitHub, Linear and Monday.com activity can sync in alongside them.',
    ],
    example: {
      label: 'Example',
      lines: [
        'Slack · #acme-rollout: “Priya will own the migration checklist. Review on the 14th.”',
        'Suggested update for review: Migration checklist, owner Priya Shah, review planned for the 14th.',
      ],
    },
    faqs: [
      {
        question: 'Is this another task tool to maintain?',
        answer:
          'Boards organize the same tasks you can inspect individually or ask about. Use the view that suits the work.',
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
    relatedRoutes: [USE_CASE_ROUTES.customerContext],
  },
  {
    slug: 'onboarding-and-repeat-questions',
    route: USE_CASE_ROUTES.onboarding,
    navLabel: 'Picking up work',
    cardTitle: 'Picking up work',
    cardBody: 'Answer it once, and new people find it with its source.',
    seoTitle: 'Pick up work with its context',
    seoDescription:
      'New teammates and frontline staff ask The Timeline and get the earlier answer back from the chat where it was given, with its source.',
    eyebrow: 'Use case · Picking up work',
    title: 'Pick up work with its context.',
    summary:
      'Recover the decision, open questions and next step when taking over work, with links to the original sources.',
    howItWorks: [
      'Ask in Telegram, Slack or the web app.',
      'Request a handoff brief for a new owner: decisions, current state, blockers and commitments.',
    ],
    whoItsFor:
      'Frontline staff on Telegram, client teams at agencies and consultancies, and anyone joining a project mid-flight.',
    example: {
      label: 'Example',
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
        caption: 'Account, current state, commitments and open gaps, each with its source.',
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
    relatedRoutes: [USE_CASE_ROUTES.communicationTrail],
  },
];

export const USE_CASE_HUB = {
  route: '/use-cases' as const satisfies PublicCanonicalPath,
  seoTitle: 'Use cases',
  seoDescription:
    'Turn connected sources into a work record, daily updates, customer context and task boards. See how teams keep up with work in The Timeline.',
  title: 'Keep up with the work that matters.',
  summary:
    'The Timeline turns context from your tools and sources into a connected work record. Here’s what teams do with it.',
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
