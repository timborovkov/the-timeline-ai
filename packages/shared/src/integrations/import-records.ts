import { z } from 'zod';

const namedCompany = z.object({
  id: z.string(),
  name: z.string().nullable(),
  domain: z.string().nullable().optional(),
});
const github = z.object({
  repo: z.string(),
  type: z.enum(['issue', 'pull_request']),
  number: z.number().int(),
  id: z.string().optional(),
  title: z.string().optional(),
  state: z.enum(['open', 'closed']),
  state_reason: z.string().nullable().optional(),
  merged_at: z.string().nullable().optional(),
  url: z.string(),
  closing_issues: z.array(z.string()).optional(),
});
const hubspot = z.object({
  id: z.string(),
  pipeline_id: z.string(),
  title: z.string().optional(),
  stage_id: z.string().optional(),
  stage_label: z.string().optional(),
  companies: z.array(namedCompany).default([]),
  active: z.boolean(),
  url: z.string().optional(),
});
const envelope = z.object({
  provider: z.string(),
  integration_id: z.string(),
  event_type: z.string(),
  signal_class: z.literal('captured_work').optional(),
  external_object_id: z.string(),
  dedup_key: z.string(),
  object_map: z
    .object({ displayTitle: z.string().optional(), aliases: z.array(z.string()).optional() })
    .nullish(),
  github: z.unknown().optional(),
  hubspot: z.unknown().optional(),
});
export interface ImportRecord {
  key: string;
  type: 'task' | 'company' | 'deal';
  kind: 'issue' | 'pr' | 'company' | 'deal';
  resource: string;
  title: string;
  url: string | null;
  sourceAt: Date;
  eventId: string;
  status?: 'todo' | 'cancelled' | 'done';
  stage?: string;
  stageLabel?: string;
  active: boolean;
  aliases: string[];
  companies: string[];
  closingIssues?: string[];
  mergedAt?: Date;
}
export function recordsForImport(row: {
  id: string;
  occurredAt: Date;
  sourceMetadata: unknown;
}): ImportRecord[] {
  const parsed = envelope.safeParse(row.sourceMetadata);
  if (!parsed.success) return [];
  const meta = parsed.data;
  const base = {
    eventId: row.id,
    sourceAt: row.occurredAt,
    active: true,
    aliases: [] as string[],
    companies: [] as string[],
  };
  if (meta.provider === 'github') {
    const value = github.safeParse(meta.github);
    if (!value.success) return [];
    const g = value.data;
    const isPr = g.type === 'pull_request';
    if (
      isPr
        ? meta.event_type !== 'pr.merged'
        : !['issue.updated', 'issue.reopened', 'issue.closed'].includes(meta.event_type)
    )
      return [];
    const id = g.id ?? /^github:(?:pr|issue):(\d+):/.exec(meta.dedup_key)?.[1];
    if (!id) return [];
    const title = g.title ?? meta.object_map?.displayTitle;
    if (!title) return [];
    return [
      {
        ...base,
        kind: isPr ? 'pr' : 'issue',
        type: 'task',
        key: (isPr ? 'pr:' : 'issue:') + id,
        resource: g.repo,
        title,
        url: g.url,
        status: isPr
          ? 'done'
          : g.state === 'open'
            ? 'todo'
            : g.state_reason === 'not_planned'
              ? 'cancelled'
              : 'done',
        ...(g.merged_at ? { mergedAt: new Date(g.merged_at) } : {}),
        ...(g.closing_issues ? { closingIssues: g.closing_issues } : {}),
        aliases: [
          meta.external_object_id,
          g.repo + '#' + String(g.number),
          ...(meta.object_map?.aliases ?? []),
        ],
      },
    ];
  }
  if (meta.provider !== 'hubspot') return [];
  const value = hubspot.safeParse(meta.hubspot);
  if (!value.success) return [];
  const h = value.data;
  const companies = h.companies.flatMap((c) =>
    c.name?.trim() ? [{ id: c.id, name: c.name, domain: c.domain }] : [],
  );
  return [
    ...companies.map((c): ImportRecord => ({
      ...base,
      kind: 'company',
      type: 'company',
      resource: h.pipeline_id,
      title: c.name,
      aliases: c.domain ? [c.domain] : [],
      url: null,
      key: 'company:' + c.id,
    })),
    {
      ...base,
      key: 'deal:' + h.id,
      type: 'deal',
      kind: 'deal',
      resource: h.pipeline_id,
      title: h.title ?? 'Deal left the pipeline',
      active: h.active,
      ...(h.stage_id ? { stage: h.stage_id } : {}),
      ...(h.stage_label ? { stageLabel: h.stage_label } : {}),
      url: h.url ?? null,
      companies: companies.map((c) => 'company:' + c.id),
    },
  ];
}
