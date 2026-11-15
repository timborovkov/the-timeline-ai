import { dateOnlyEventRange, resolveTimePhrase } from '@timeline/shared/time';
import { z } from 'zod';

export const communicationGroundingSchema = z.object({
  field: z.enum(['assignee', 'dueAt', 'status', 'customer', 'project', 'prospect']),
  rawEventId: z.uuid(),
  quote: z.string().min(3).max(800),
  subject: z.string().min(1).max(200),
  value: z.string().max(200),
  context: z.object({ rawEventId: z.uuid(), quote: z.string().min(3).max(800) }).optional(),
});
type Support = z.infer<typeof communicationGroundingSchema>;
interface Item {
  operation: string;
  targetKind: string;
  title: string;
  targetId?: string | null | undefined;
  proposedPayload: Record<string, unknown>;
  grounding?: Support[] | undefined;
}
interface Bundle<T extends Item> {
  title: string;
  confidence: 'low' | 'medium' | 'high';
  reason?: string | null | undefined;
  summary?: string | null | undefined;
  quote?: string | null | undefined;
  items: T[];
}
const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
const mentions = (text: string, name: string) => normalize(text).includes(normalize(name));
const namesTask = (text: string, name: string) => {
  const words = name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const significant = words.filter(
    (word) =>
      word.length > 3 &&
      !['prepare', 'review', 'please', 'draft', 'write', 'create', 'send'].includes(word),
  );
  return significant.length > 0
    ? significant.every((word) => mentions(text, word))
    : mentions(text, name);
};
const unsafe = (quote: string) =>
  /<\/?(?:system|developer)>|ignore (?:all|previous)|assign all tasks|disclose|reveal.*(?:secret|prompt)/i.test(
    quote,
  );
const prospect = (quote: string) =>
  /\b(?:potential|prospective|possible|proposed engagement|no contract|not signed|unsigned)\b/i.test(
    quote,
  );

function safeSourceQuote(text: string, quote: string): boolean {
  const body = normalize(text),
    fragment = normalize(quote);
  const start = body.indexOf(fragment);
  if (start < 0 || unsafe(quote) || quote.includes('?')) return false;
  const before = body.slice(0, start);
  for (const tag of ['system', 'developer'])
    if (before.lastIndexOf(`<${tag}>`) > before.lastIndexOf(`</${tag}>`)) return false;
  return true;
}
function deadlineMatches(
  quote: string,
  value: unknown,
  timezone: string,
  referenceDate?: Date,
): boolean {
  if (
    typeof value !== 'string' ||
    !/\b(?:deadline|due|by|before|plazo|fecha límite|fällig|bis)\b/i.test(quote)
  )
    return false;
  const target = Date.parse(value);
  for (const match of quote.matchAll(
    /\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})| at \d{2}:\d{2} UTC)?/g,
  )) {
    const raw = match[0].replace(' at ', 'T').replace(' UTC', ':00Z');
    try {
      const date = dateOnlyEventRange(raw.slice(0, 10), timezone);
      if (raw.includes('T') ? Date.parse(raw) === target : date.startAt.getTime() === target)
        return true;
    } catch {
      /* Invalid source dates never support a write. */
    }
  }
  for (const match of quote.matchAll(
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2},? \d{4}\b/gi,
  )) {
    const date = new Date(`${match[0]} 00:00:00 UTC`);
    if (
      Number.isFinite(date.getTime()) &&
      dateOnlyEventRange(date.toISOString().slice(0, 10), timezone).startAt.getTime() === target
    )
      return true;
  }
  if (referenceDate) {
    for (const match of quote.matchAll(
      /\b(?:today|tomorrow|next (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    )) {
      const resolved = resolveTimePhrase(match[0], { timezone, referenceDate });
      if (resolved?.from.getTime() === target) return true;
    }
  }
  return false;
}
function taskClause(quote: string, subject: string): string | undefined {
  if (/^blocked until\b/i.test(quote.trim()) && namesTask(quote, subject)) return quote;
  const connected = quote.replace(/\.\s+(?:Its|The task[’']s) (deadline|due date)\b/gi, ' $1');
  const clauses = connected
    .split(/(?:[;!?]|\.(?=\s|$)|\band\b|\bwhile\b|\bwhereas\b|\buntil\b|\bpero\b|\by\b)/iu)
    .filter((clause) => namesTask(clause, subject));
  return clauses.length === 1 ? clauses[0]?.trim() : undefined;
}

/** Ground optional writes against admitted source text, not the model's echoed context. */
export function groundCommunicationBundles<T extends Item>(args: {
  bundles: Bundle<T>[];
  packet: string;
  sources: {
    id: string;
    text: string;
    authorUserId?: string | null;
    speakerContext?: string;
    occurredAt?: Date;
  }[];
  members: { userId: string; name: string | null; email: string | null }[];
  hubs: { id: string; name: string; type: string; aliases?: string[] }[];
  source: string;
  timezone?: string;
  pendingNames?: string[];
  objects?: { id: string; type: string; name?: string; aliases?: string[] }[];
}): Bundle<T>[] {
  return args.bundles.map((bundle) => {
    const validContexts = new Set<Support>();
    const verified = (item: T) =>
      (item.grounding ?? [])
        .map((support) => {
          if (support.field !== 'dueAt' || !/^its (?:deadline|due date)\b/i.test(support.quote))
            return support;
          const source = args.sources.find((row) => row.id === support.rawEventId);
          const at = source?.text.indexOf(support.quote) ?? -1;
          if (!source || at < 0) return support;
          const previous = /[^.!?\n]+[.!?]$/.exec(source.text.slice(0, at).trim())?.[0]?.trim();
          if (!previous || !namesTask(previous, support.subject)) return support;
          const quote = `${previous} ${support.quote}`;
          return safeSourceQuote(source.text, quote) &&
            normalize(args.packet).includes(normalize(quote))
            ? { ...support, quote }
            : support;
        })
        .filter((support) => {
          const source = args.sources.find((row) => row.id === support.rawEventId);
          const prior =
            args.sources[args.sources.findIndex((row) => row.id === support.rawEventId) - 1];
          const context = support.context;
          const contextValid =
            context &&
            prior?.id === context.rawEventId &&
            safeSourceQuote(prior.text, context.quote) &&
            normalize(args.packet).includes(normalize(context.quote)) &&
            namesTask(context.quote, support.subject) &&
            new Set(
              [
                ...(args.objects ?? [])
                  .filter((object) => object.type === 'task')
                  .map((object) => object.name),
                ...(args.pendingNames ?? []),
              ].filter(
                (name): name is string =>
                  typeof name === 'string' && namesTask(context.quote, name),
              ),
            ).size === 1;
          if (contextValid) validContexts.add(support);
          return (
            source &&
            safeSourceQuote(source.text, support.quote) &&
            normalize(args.packet).includes(normalize(support.quote)) &&
            !unsafe(support.quote) &&
            (item.targetKind === 'object_relationship' ||
              namesTask(support.quote, support.subject) ||
              (support.field === 'assignee' &&
                contextValid &&
                /\b(?:this|it|instead)\b/i.test(support.quote))) &&
            (item.targetKind === 'object_relationship' || namesTask(item.title, support.subject))
          );
        });
    const uncertainty = new Set<string>();
    const extra: T[] = [];
    const items = bundle.items.flatMap((item, index) => {
      const supports = verified(item);
      const payload = { ...item.proposedPayload };
      const type =
        item.targetKind === 'task'
          ? 'task'
          : (payload.type ?? args.objects?.find((object) => object.id === item.targetId)?.type);
      if (item.targetKind === 'object_relationship') {
        const endpoint = (side: 'from' | 'to') => {
          const id = payload[`${side}EntityId`];
          if (typeof id === 'string') {
            const object =
              args.objects?.find((object) => object.id === id) ??
              args.hubs.find((hub) => hub.id === id);
            return object?.name
              ? { id, name: object.name, type: object.type, aliases: object.aliases ?? [] }
              : null;
          }
          const ref = payload[`${side}Ref`];
          const object = bundle.items.find(
            (candidate) => candidate.proposedPayload.localRef === ref && typeof ref === 'string',
          );
          return object
            ? {
                id: String(ref),
                aliases: [] as string[],
                type: object.targetKind === 'task' ? 'task' : object.proposedPayload.type,
                name:
                  typeof object.proposedPayload.canonicalName === 'string'
                    ? object.proposedPayload.canonicalName
                    : object.title,
              }
            : null;
        };
        const from = endpoint('from'),
          to = endpoint('to');
        const known = [
          ...args.hubs,
          ...(args.objects ?? []),
          ...bundle.items
            .filter((candidate) => candidate.targetKind === 'object')
            .map((candidate) => ({
              id:
                typeof candidate.proposedPayload.localRef === 'string'
                  ? candidate.proposedPayload.localRef
                  : '',
              name:
                typeof candidate.proposedPayload.canonicalName === 'string'
                  ? candidate.proposedPayload.canonicalName
                  : candidate.title,
              type:
                typeof candidate.proposedPayload.type === 'string'
                  ? candidate.proposedPayload.type
                  : '',
              aliases: [] as string[],
            })),
        ];
        const namesEndpoint = (quote: string, object: NonNullable<typeof from>) =>
          object.type === 'task'
            ? namesTask(quote, object.name)
            : mentions(quote, object.name) ||
              object.aliases.some(
                (alias) =>
                  mentions(quote, alias) &&
                  !known.some(
                    (other) =>
                      other.id !== object.id &&
                      other.type === object.type &&
                      [other.name, ...(other.aliases ?? [])].some(
                        (name) => name && normalize(name) === normalize(alias),
                      ),
                  ),
              );
        const grounded =
          from &&
          to &&
          supports.some((support) => {
            if (
              !(
                (support.field === 'customer' && [from.type, to.type].includes('company')) ||
                (support.field === 'project' && [from.type, to.type].includes('project'))
              ) ||
              ![to.id, to.name, from.id, from.name].includes(support.value) ||
              /[?]|\b(?:maybe|perhaps|undecided|not|unless|if|separate|unrelated)\b/i.test(
                support.quote,
              )
            )
              return false;
            const direct = namesEndpoint(support.quote, from) && namesEndpoint(support.quote, to);
            if (direct) return true;
            // A typed reference can combine admitted statements from the SAME source only.
            // It must be an explicit link instruction, with exactly one visible candidate.
            if (!/\blink\b/i.test(support.quote)) return false;
            const other = namesEndpoint(support.quote, from)
              ? to
              : namesEndpoint(support.quote, to)
                ? from
                : null;
            if (
              !other ||
              !['company', 'project'].includes(String(other.type)) ||
              !new RegExp(
                `\\bthe ${other.type === 'company' ? '(?:company|customer|client)' : 'project'}\\b`,
                'i',
              ).test(support.quote)
            )
              return false;
            const source = args.sources.find((source) => source.id === support.rawEventId);
            const candidates = new Set(
              known
                .filter(
                  (candidate) =>
                    candidate.type === other.type &&
                    candidate.name &&
                    source &&
                    [candidate.name, ...(candidate.aliases ?? [])].some((name) =>
                      mentions(source.text, name),
                    ),
                )
                .map((candidate) => candidate.id),
            );
            return (
              candidates.size === 1 &&
              candidates.has(other.id) &&
              supports.some(
                (evidence) =>
                  evidence.rawEventId === support.rawEventId &&
                  namesEndpoint(evidence.quote, other),
              )
            );
          });
        if (!grounded) return [];
      }
      const has = (field: Support['field'], value: unknown) =>
        supports.find((support) => support.field === field && support.value === value);
      if (type === 'company' || type === 'project') {
        const tentative = supports.find(
          (support) => support.field === 'prospect' && prospect(support.quote),
        );
        if (tentative) {
          uncertainty.add('prospect');
          if (type === 'project' && item.operation === 'create') payload.status = 'planning';
        }
      }
      if (type === 'task' || (item.targetKind === 'task' && item.operation === 'update')) {
        const assignment = supports.find((support) => support.field === 'assignee');
        const member = args.members.find((member) => member.userId === assignment?.value);
        const source = args.sources.find((source) => source.id === assignment?.rawEventId);
        const originalClause = assignment
          ? (taskClause(assignment.quote, assignment.subject) ??
            (validContexts.has(assignment) ? assignment.quote : undefined))
          : undefined;
        const clause = originalClause?.replace(
          /,\s*not\s+([^.!?,]+)\.?$/i,
          (phrase, alternative: string) =>
            args.members.some(
              (other) =>
                other.userId !== member?.userId &&
                other.name &&
                normalize(other.name) === normalize(alternative),
            )
              ? ''
              : phrase,
        );
        const name = member?.name?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const named =
          name &&
          clause &&
          new RegExp(
            `(?:${name}\\s+(?:will|shall|owns|is responsible|to|revisará|preparará|hará|wird|übernimmt|tarkistaa)|assign[^.!?]*\\b${name}\\b|${name},?\\s+please)`,
            'i',
          ).test(clause) &&
          !/\b(?:not|cannot|can't|declined|no|nicht|if|unless)\b/i.test(clause);
        const headers =
          source && assignment
            ? [
                ...source.text
                  .slice(0, source.text.indexOf(assignment.quote))
                  .matchAll(/(?:^|\n)(?:From|Von|De):([^\n]*)/gi),
              ]
            : [];
        const latestHeader = headers.at(-1);
        const nested =
          latestHeader &&
          (!member?.email ||
            normalize(
              latestHeader[1]?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '',
            ) !== normalize(member.email) ||
            !normalize(args.packet).includes(normalize(latestHeader[0].trim())));
        const self =
          member &&
          assignment &&
          !nested &&
          clause &&
          (args.source === 'email'
            ? Boolean(
                member.email &&
                source?.speakerContext?.includes(`"senderHandle":${JSON.stringify(member.email)}`),
              )
            : source?.authorUserId === member.userId) &&
          /\bI (?:will|shall|'ll)|\bI'll\b/i.test(clause) &&
          !/\b(?:if|unless|not|cannot)\b/i.test(clause);
        const clearAssignment =
          assignment?.value === 'unassigned' &&
          Boolean(clause) &&
          !/\b(?:not|never|if|unless)\b/i.test(clause ?? '') &&
          /\b(?:unassign|unassigned|remove.*owner)\b/i.test(clause ?? '') &&
          payload.assigneeUserId === null;
        if (
          !clearAssignment &&
          !(
            member &&
            (named || self) &&
            !assignment?.quote.includes('?') &&
            (payload.assigneeUserId === member.userId || payload.assigneeName === member.name)
          )
        ) {
          delete payload.assigneeUserId;
          delete payload.assigneeName;
          delete payload.ownerUserId;
          delete payload.ownerName;
        }
        const clearDeadline = supports.some(
          (support) =>
            support.field === 'dueAt' &&
            support.value === 'unset' &&
            !/\b(?:not|never|if|unless)\b/i.test(
              taskClause(support.quote, support.subject) ?? '',
            ) &&
            /\b(?:remove|clear) (?:the )?deadline\b/i.test(
              taskClause(support.quote, support.subject) ?? '',
            ),
        );
        const deadline = has('dueAt', payload.dueAt);
        if (
          payload.dueAt !== undefined &&
          !(payload.dueAt === null && clearDeadline) &&
          !(
            deadline &&
            deadlineMatches(
              taskClause(deadline.quote, deadline.subject) ?? '',
              payload.dueAt,
              args.timezone ?? 'UTC',
              args.sources.find((row) => row.id === deadline.rawEventId)?.occurredAt,
            )
          )
        )
          delete payload.dueAt;
        const lifecycle = has('status', payload.status);
        const lifecycleWords: Record<string, RegExp> = {
          doing: /\b(?:started|working on|in progress|empezado|trabajando|begonnen)\b/i,
          done: /\b(?:finished|(?:is|now|was|marked) complete|completed|done|shipped|valmis|terminada|terminado|completada|completado|abgeschlossen)\b/i,
          cancelled: /\b(?:cancel|cancelled|canceled|cancelada|cancelado|abgesagt)\b/i,
          blocked: /\bblocked\b/i,
          todo: /\b(?:reopen|restart|unblock)\b/i,
        };
        const lifecycleClause = lifecycle
          ? taskClause(lifecycle.quote, lifecycle.subject)
          : undefined;
        const sentDeliverable =
          /^(?:mark )?send\b/i.test(item.title) &&
          lifecycleClause &&
          /\b(?:sent|delivery confirmed)\b/i.test(lifecycleClause);
        if (
          payload.status !== undefined &&
          !(item.operation === 'create' && payload.status === 'todo') &&
          !(
            lifecycle &&
            lifecycleClause &&
            (lifecycleWords[typeof payload.status === 'string' ? payload.status : '']?.test(
              lifecycleClause,
            ) ||
              (payload.status === 'done' && sentDeliverable)) &&
            !/[?]|\b(?:not|if|might|perhaps)\b/i.test(lifecycleClause)
          )
        )
          delete payload.status;
        if (typeof payload.parentObjectId === 'string') {
          const projectSupport = has('project', payload.parentObjectId);
          const clause = projectSupport
            ? taskClause(projectSupport.quote, projectSupport.subject)
            : undefined;
          const projects = clause
            ? args.hubs.filter((hub) => hub.type === 'project' && mentions(clause, hub.name))
            : [];
          if (projects.length !== 1 || projects[0]?.id !== payload.parentObjectId) {
            delete payload.parentObjectId;
            delete payload.projectName;
          }
        }
        const links = supports.filter((support) => {
          if (support.field !== 'customer') return false;
          const clause = taskClause(support.quote, support.subject);
          if (!clause || /\b(?:or|maybe|perhaps|undecided|not)\b/i.test(clause)) return false;
          const candidates = args.hubs.filter(
            (hub) => hub.type === 'company' && mentions(clause, hub.name),
          );
          return candidates.length === 1 && candidates[0]?.id === support.value;
        });
        const ids = [...new Set(links.map((support) => support.value))];
        if (ids.length === 1 && item.operation === 'create') {
          const ref =
            typeof payload.localRef === 'string' ? payload.localRef : `grounded-task-${index}`;
          payload.localRef = ref;
          extra.push({
            ...item,
            operation: 'create',
            targetKind: 'object_relationship',
            title: `${item.title}: customer`,
            proposedPayload: { kind: 'related', fromRef: ref, toEntityId: ids[0] },
          });
        }
      }
      // Internal grounding must never leak into user-editable canonical payloads.
      delete payload.grounding;
      if (item.operation === 'update' && Object.keys(payload).length === 0) return [];
      return [{ ...item, proposedPayload: payload }];
    });
    return {
      ...bundle,
      confidence: uncertainty.size ? ('low' as const) : bundle.confidence,
      reason: uncertainty.size
        ? `Prospective engagement; not confirmed. ${bundle.reason ?? ''}`.trim()
        : bundle.reason,
      items: [
        ...items,
        ...extra.filter(
          (candidate) =>
            !items.some(
              (item) =>
                item.targetKind === 'object_relationship' &&
                item.proposedPayload.fromRef === candidate.proposedPayload.fromRef &&
                item.proposedPayload.toEntityId === candidate.proposedPayload.toEntityId &&
                item.proposedPayload.kind === candidate.proposedPayload.kind,
            ),
        ),
      ],
    };
  });
}
