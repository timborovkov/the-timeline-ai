const OBJECT_STATUS_OPTIONS: Record<string, readonly string[]> = {
  deal: ['open', 'qualified', 'proposal', 'won', 'lost'],
  task: ['suggested', 'todo', 'doing', 'done', 'blocked', 'cancelled'],
  follow_up: ['todo', 'doing', 'done', 'cancelled'],
  project: ['planning', 'active', 'on_hold', 'shipped', 'cancelled'],
  incident: ['open', 'mitigated', 'resolved', 'postmortem'],
  hiring_loop: ['sourcing', 'interviewing', 'offer', 'hired', 'closed'],
  decision: ['draft', 'proposed', 'accepted', 'rejected'],
  person: ['active', 'archived'],
  company: ['active', 'archived'],
};

const FALLBACK_STATUS_OPTIONS = ['open', 'active', 'archived'] as const;

export function statusOptionsForType(type: string, current?: string | null): string[] {
  const options = [...(OBJECT_STATUS_OPTIONS[type] ?? FALLBACK_STATUS_OPTIONS)];
  if (current && !options.includes(current)) options.push(current);
  return options;
}
