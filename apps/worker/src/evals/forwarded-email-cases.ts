import type { SuggestionCase } from '#src/evals/suggestion-cases.js';

function forward(body: string) {
  return [
    'For our workspace, here is the customer discussion.',
    '',
    '---------- Forwarded message ---------',
    'From: Customer team <customer@example.test>',
    'Date: Mon, Jun 1, 2026 at 08:00 AM',
    'Subject: Customer project discussion',
    'To: Evaluator <eval@example.test>',
    '',
    body,
  ].join('\n');
}
const base = {
  split: 'development' as const,
  familyId: 'forwarded-customer-email',
  source: 'email' as const,
  forwardedSubject: 'Fwd: Customer project discussion',
  tags: ['forwarded-email', 'recall', 'email'],
};
export const FORWARDED_EMAIL_CASES: SuggestionCase[] = [
  {
    ...base,
    id: 'forwarded-customer-context',
    events: [
      forward(
        'Cedar Dental is our existing customer. The project we are delivering for Cedar Dental is called Patient Portal. This email confirms that customer and project context; there are no new tasks in this message.',
      ),
    ],
    expected: [
      {
        operation: 'create',
        targetKind: 'object',
        terms: [['cedar dental']],
        fields: { type: 'company' },
      },
      {
        operation: 'create',
        targetKind: 'object',
        terms: [['patient portal']],
        fields: { type: 'project' },
      },
    ],
    allowed: [
      {
        operation: 'create',
        targetKind: 'object_relationship',
        relatedNames: ['Cedar Dental', 'Patient Portal'],
        terms: [],
        fields: { kind: 'related' },
      },
    ],
    rationale:
      'Explicit existing customer and named delivery project establish durable workspace objects even without a new task commitment; one supporting relationship is permitted.',
  },
  {
    ...base,
    id: 'forwarded-project-tasks',
    events: [
      forward(
        'For the Northstar rollout project, please prepare the migration checklist and review the backup procedure. These are the two next steps we need from your team.',
      ),
    ],
    expected: [
      {
        operation: 'create',
        targetKind: 'task',
        terms: [['prepare', 'create'], ['migration'], ['checklist']],
        fields: { parentObjectId: '33333333-3333-4333-8333-333333333333' },
      },
      {
        operation: 'create',
        targetKind: 'task',
        terms: [['review'], ['backup']],
        fields: { parentObjectId: '33333333-3333-4333-8333-333333333333' },
      },
    ],
    rationale:
      'Two explicit customer requests inside the forwarded body must survive parsing and become proposals under the existing project.',
  },
  {
    ...base,
    id: 'forwarded-incidental-mention',
    events: [
      forward(
        'I read an article about Cedar Dental using Slack and Google Drive. Interesting industry news, but they are not our customer and this is not a project or request for our team.',
      ),
    ],
    expected: [],
    rationale:
      'An explicitly unrelated company mention and everyday platform names are not customer/project/task authority.',
  },
  {
    ...base,
    id: 'forwarded-informal-context',
    events: [
      forward(
        "Cedar Dental liked the latest screens. Their Patient Portal is the project we're building together; the reception team sounds happy with where it is going. Just keeping you in the loop, nothing new to action today.",
      ),
    ],
    expected: [
      {
        operation: 'create',
        targetKind: 'object',
        terms: [['cedar dental']],
        fields: { type: 'company' },
      },
      {
        operation: 'create',
        targetKind: 'object',
        terms: [['patient portal']],
        fields: { type: 'project' },
      },
    ],
    allowed: [
      {
        operation: 'create',
        targetKind: 'object_relationship',
        relatedNames: ['Cedar Dental', 'Patient Portal'],
        terms: [],
        fields: { kind: 'related' },
      },
    ],
    rationale:
      'Informal delivery discussion establishes the company and concrete project without formal customer labels or a creation instruction; it does not establish a new task.',
  },
];
