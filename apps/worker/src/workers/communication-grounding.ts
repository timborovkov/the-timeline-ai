import {
  dateOnlyEventRange,
  resolveTimePhrase,
  zonedDateTimeFromDate,
} from '@timeline/shared/time';
import { z } from 'zod';

export const communicationGroundingSchema = z.object({
  field: z.enum(['assignee', 'dueAt', 'status', 'customer', 'project', 'prospect', 'relationship']),
  rawEventId: z.uuid(),
  quote: z.string().min(3).max(800),
  subject: z.string().min(1).max(200),
  value: z.string().max(200),
  context: z.object({ rawEventId: z.uuid(), quote: z.string().min(3).max(800) }).optional(),
});
type Support = z.infer<typeof communicationGroundingSchema>;
interface Item {
  auditId?: string | undefined;
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
      (word.length >= 2 || /^\p{N}$/u.test(word)) &&
      ![
        'an',
        'and',
        'for',
        'in',
        'of',
        'on',
        'the',
        'to',
        'with',
        'prepare',
        'review',
        'please',
        'draft',
        'write',
        'create',
        'send',
      ].includes(word),
  );
  const evidenceWords = new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  return significant.length > 0
    ? significant.every((word) => evidenceWords.has(word))
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
function deadlineTimeMatches(day: string, tail: string, target: number, timezone: string): boolean {
  try {
    const start = dateOnlyEventRange(day, timezone).startAt;
    const time =
      /^(?:T|\s+(?:at\s+)?)(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:\s*(UTC|GMT|Z|[+-]\d{2}:\d{2}))?/i.exec(
        tail,
      );
    if (!time) return !/^(?:T|\s+(?:at\b|\d))/i.test(tail) && start.getTime() === target;
    const hour = Number(time[1]);
    const minute = Number(time[2]);
    const second = Number(time[3] ?? 0);
    const millisecond = Number((time[4] ?? '').padEnd(3, '0'));
    if (hour > 23 || minute > 59 || second > 59) return false;
    // A time marker must end at a boundary; ordinary following prose is not a zone.
    const suffix = tail.slice(time[0].length);
    if (/^[\p{L}\p{N}]|^\s*[+-]\d/u.test(suffix)) return false;
    if (/^\s*(?:a\.?m\.?|p\.?m\.?)(?:\b|[.\s]|$)/i.test(suffix)) return false;
    const token = /^\s+([A-Za-z][A-Za-z_/-]*)/.exec(suffix)?.[1];
    if (token && !/^(?:for|before|after|with|to|on|in|by|at)$/i.test(token)) {
      if (
        /^(?:am|pm|[PMCE][SD]T|[A-Z]EST|[A-Z]EDT|CET|CEST|BST|IST)$/i.test(token) ||
        /^[A-Z]{2,6}$/.test(token) ||
        token.includes('/')
      )
        return false;
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: token });
        return false;
      } catch {
        // Ordinary words are not timezone identifiers.
      }
    }
    const zone = time[5];
    const instant = zone
      ? Date.parse(
          `${day}T${String(hour).padStart(2, '0')}:${time[2]}:${String(second).padStart(2, '0')}.${String(millisecond).padStart(3, '0')}${/^(UTC|GMT|Z)$/i.test(zone) ? 'Z' : zone}`,
        )
      : zonedDateTimeFromDate(start, timezone).with({ hour, minute, second, millisecond })
          .epochMilliseconds;
    return instant === target;
  } catch {
    return false;
  }
}
function deadlineMatches(
  quote: string,
  subject: string,
  value: unknown,
  timezone: string,
  referenceDate?: Date,
): boolean {
  if (typeof value !== 'string') return false;
  const target = Date.parse(value);
  const deadlineAt = (index: number) => {
    const prefix =
      quote
        .slice(0, index)
        .split(/\bbut\b|,\s*(?:instead|now)\b/i)
        .at(-1) ?? '';
    return (
      (/\b(?:deadline|due(?: date)?|by|before|plazo|fecha límite|fällig|bis)\b(?:\s+(?:is|was|on|by|for|set|now|el|es|am|ist))*\s*[:=-]?\s*$/i.test(
        prefix,
      ) ||
        ['is', 'to', 'was', 'is now'].some((verb) =>
          normalize(prefix).endsWith(`deadline for ${normalize(subject)} ${verb}`),
        )) &&
      !/\b(?:not|never|no longer|isn[’']t|wasn[’']t|won[’']t|shouldn[’']t|nicht|kein)\b/i.test(
        prefix,
      )
    );
  };
  for (const match of quote.matchAll(/\b\d{4}-\d{2}-\d{2}/g)) {
    if (!deadlineAt(match.index)) continue;
    if (deadlineTimeMatches(match[0], quote.slice(match.index + match[0].length), target, timezone))
      return true;
  }
  for (const match of quote.matchAll(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2})\b(?:,?\s+(\d{4})\b)?/gi,
  )) {
    if (!deadlineAt(match.index)) continue;
    const reference = referenceDate ? zonedDateTimeFromDate(referenceDate, timezone) : undefined;
    let year = match[3] ? Number(match[3]) : reference?.year;
    if (year === undefined) continue;
    let date = new Date(`${match[1]} ${match[2]}, ${year} 00:00:00 UTC`);
    if (!Number.isFinite(date.getTime()) || date.getUTCDate() !== Number(match[2])) continue;
    if (
      !match[3] &&
      reference &&
      date.toISOString().slice(0, 10) < reference.toPlainDate().toString()
    ) {
      year++;
      date = new Date(`${match[1]} ${match[2]}, ${year} 00:00:00 UTC`);
      if (!Number.isFinite(date.getTime()) || date.getUTCDate() !== Number(match[2])) continue;
    }
    if (
      Number.isFinite(date.getTime()) &&
      deadlineTimeMatches(
        date.toISOString().slice(0, 10),
        quote.slice(match.index + match[0].length),
        target,
        timezone,
      )
    )
      return true;
  }
  if (referenceDate) {
    for (const match of quote.matchAll(
      /\b(?:today|tomorrow|next (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    )) {
      if (!deadlineAt(match.index)) continue;
      const phrase = match[0].toLowerCase();
      const weekdays = [
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ];
      const weekday = weekdays.indexOf(phrase) + 1;
      const relative = weekday
        ? zonedDateTimeFromDate(referenceDate, timezone).dayOfWeek === weekday
          ? 'today'
          : `next ${phrase}`
        : phrase;
      const resolved = resolveTimePhrase(relative, { timezone, referenceDate });
      if (
        resolved &&
        deadlineTimeMatches(
          zonedDateTimeFromDate(resolved.from, timezone).toPlainDate().toString(),
          quote.slice(match.index + match[0].length),
          target,
          timezone,
        )
      )
        return true;
    }
  }
  return false;
}
const lifecycleWords: Record<string, RegExp> = {
  doing: /\b(?:started|working on|in progress|empezado|trabajando|begonnen)\b/i,
  done: /\b(?:finished|(?:is|now|was|marked) complete|completed|done|delivered|shipped|valmis|terminada|terminado|completada|completado|abgeschlossen)\b/i,
  cancelled: /\b(?:cancel|cancelled|canceled|archive|archived|cancelada|cancelado|abgesagt)\b/i,
  blocked: /\bblocked\b/i,
  todo: /\b(?:reopen(?:ed)?|restart(?:ed)?|unblock(?:ed)?)\b/i,
};
function affirmativeTaskHub(
  clause: string,
  subject: string,
  hubName: string,
  type: string,
): boolean {
  if (
    /[?]|\b(?:or|maybe|perhaps|might|undecided|not|never|no|if|unless|unrelated|except|without)\b/i.test(
      clause,
    )
  )
    return false;
  if (type === 'project') return affirmativeProjectMembership(clause, subject, hubName, true);
  const name = normalize(hubName);
  const qualifiedSubject = normalize(subject);
  const qualifier = ` for ${name}`;
  const deliverable = qualifiedSubject.endsWith(qualifier)
    ? qualifiedSubject.slice(0, -qualifier.length)
    : qualifiedSubject;
  const task = taskIdentityPattern(deliverable, true);
  const statement = normalize(clause);
  const position = statement.indexOf(name);
  if (!name || !task || position < 0) return false;
  const before = statement.slice(0, position);
  const after = statement.slice(position + name.length);
  if (after && !/^[\s.,:;!'’]/.test(after)) return false;
  const link = new RegExp(
    `^(?:please )?(?:link|connect|associate|relate) (?:the )?${task} (?:to|with) (?:the )?$`,
  );
  const direct = new RegExp(
    `(?:^|\\s)${task} (?:is )?(?:for|requested by|commissioned by) (?:our (?:customer|client) )?$`,
  );
  // In a coordinated request the second item may reuse the first verb:
  // “prepare a checklist for A and another checklist for B”.
  const repeatedDeliverable = taskIdentityPattern(
    deliverable.replace(/^(?:prepare|draft|create|write|review|send|build|test) /, ''),
  );
  const coordinated = new RegExp(`^another ${repeatedDeliverable} for $`).test(before);
  return (
    link.test(before) ||
    direct.test(before) ||
    coordinated ||
    (!before &&
      /^ (?:needs|requests|requested|commissioned)\b/.test(after) &&
      namesTask(after, subject))
  );
}

function hasProjectAlternative(assertion: string, projectNames: string[]): boolean {
  const statement = normalize(assertion);
  return (
    /\b(?:or|either|undecided)\b/i.test(statement) ||
    projectNames.some((name) => {
      const project = normalize(name);
      if (!project) return false;
      const fragments = statement.split(project);
      return (
        fragments.slice(1).some((suffix) => /^\s*\//.test(suffix)) ||
        fragments.slice(0, -1).some((prefix) => /\/\s*$/.test(prefix))
      );
    })
  );
}

function taskIdentityPattern(subject: string, allowRequestModifiers = false): string {
  return normalize(subject)
    .split(' ')
    .filter((word) => word && !['the', 'a', 'an', 'of'].includes(word))
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join(
      allowRequestModifiers
        ? ' (?:of )?(?:the |a |an )?(?:separate |new )?'
        : ' (?:of )?(?:the |a |an )?',
    );
}

function affirmativeProjectMembership(
  assertion: string,
  subject: string,
  name: string,
  allowTaskRouting: boolean,
): boolean {
  const statement = normalize(assertion);
  const project = normalize(name);
  const task = taskIdentityPattern(subject);
  if (
    !project ||
    !task ||
    /[?]|\b(?:not|no|never|unless|if|maybe|perhaps|unrelated|without|except|might|may|instead)\b/i.test(
      statement,
    )
  )
    return false;
  const membership = '(?:under|within|part of|belongs? to|in (?:the )?project)';
  const predicate = allowTaskRouting ? `(?:${membership}|for|in|on)` : membership;
  const followsTask = new RegExp(
    `(?:^|\\s)${task}(?: task)? (?:(?:is|was|should be|will be) )?${predicate} (?:the )?$`,
  );
  const explicitAssignment = new RegExp(
    `^(?:please )?(?:attach|link|assign|move) (?:the )?${task}(?: task)? to (?:the )?$`,
  );
  const startsTask = new RegExp(`^[:,]\\s+(?:please )?(?:the )?${task}(?![\\p{L}\\p{N}])`, 'u');
  const fragments = statement.split(project);
  return fragments.slice(1).some((suffix, index) => {
    const prefix = fragments[index] ?? '';
    if (suffix && !/^[\s.,:;!]/.test(suffix)) return false;
    return (
      (index === 0 && !prefix && suffix.startsWith(':') && startsTask.test(suffix)) ||
      followsTask.test(prefix) ||
      (allowTaskRouting &&
        (explicitAssignment.test(prefix) ||
          (index === 0 &&
            /^(?:separately, )?for (?:the )?$/.test(prefix) &&
            startsTask.test(suffix))))
    );
  });
}

function taskAssertion(clause: string, subject: string): string | undefined {
  // Keep only the assertion describing this task. Causal/dependent
  // clauses can describe a different artifact, and task titles are identifiers.
  const parts = clause
    .trim()
    .split(
      /\s+\b(because|although|since|whereas|while|until|even though|but|yet|which|who|that(?=\s+(?:is|are|was|were|has|have|had|will|would|may|must|can|could|should)\b))\b\s+/i,
    );
  const statements = parts.filter((_, index) => index % 2 === 0);
  const named = statements.filter((statement) => namesTask(statement, subject));
  const first = statements.length === 1 ? statements[0] : named.length === 1 ? named[0] : undefined;
  if (!first) return undefined;
  let assertion = first;
  const at = parts.indexOf(first);
  for (let index = at + 1; index < parts.length; index += 2) {
    const conjunction = parts[index]?.toLowerCase();
    const next = parts[index + 1];
    if (
      (conjunction !== 'but' && conjunction !== 'yet') ||
      !next ||
      !/^(?:(?:it|this task|the task) )?(?:is|was|has|had|remains)\b/i.test(next)
    )
      break;
    assertion = next;
  }
  return assertion;
}

function affirmativeLifecycle(
  clause: string | undefined,
  subject: string,
  status: unknown,
  sendTask = false,
): boolean {
  if (!clause || typeof status !== 'string') return false;
  const assertion =
    status === 'blocked' && /^blocked until\b/i.test(clause) && namesTask(clause, subject)
      ? 'blocked'
      : taskAssertion(clause, subject);
  if (!assertion) return false;
  const identity = normalize(subject);
  clause = identity ? normalize(assertion).replaceAll(identity, '[task]') : normalize(assertion);
  if (/[?]|\b(?:no longer|not|never|if|unless|maybe|might|perhaps|[a-z]+n[’']t)\b/i.test(clause))
    return false;
  if (
    status === 'done' &&
    /\b(?:almost|nearly|partly|partially|half|not quite|being|in the process of|basically|practically|essentially)\b/i.test(
      clause,
    )
  )
    return false;

  if (
    /\b(?:will|shall|should|would|could|may|must|going to|expected to|scheduled to|planned to|needs? to|has to|have to|supposed to)\s+(?:(?:not|never|soon|already|finally|eventually|definitely)\s+)*(?:be\s+|have\s+been\s+)?(?:finish(?:ed)?|complete[ds]?|done|delivered|shipped|sent|cancel(?:led|ed)?|archive[ds]?|start(?:ed)?|working on|in progress|blocked|reopen(?:ed)?|restart(?:ed)?|unblock(?:ed)?)\b/i.test(
      clause,
    )
  )
    return false;
  return (
    (lifecycleWords[status]?.test(clause) ?? false) ||
    (status === 'done' && sendTask && /\b(?:sent|delivery confirmed)\b/i.test(clause))
  );
}

function taskClause(quote: string, subject: string): string | undefined {
  // Keep source citations literal; normalize contractions only for assertion checks.
  quote = quote
    .replace(/\b([a-z]+)n[’']t\b/gi, '$1 not')
    .replace(/\b([a-z]+)[’']ll\b/gi, '$1 will');
  if (/^blocked until\b/i.test(quote.trim()) && namesTask(quote, subject)) return quote;
  const completionNoun =
    subject
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.at(-1) ?? 'deliverable';
  const connected = quote
    .replace(
      /\band\s+(?=(?:it|this task|the task) (?:is|was) due\b|its (?:deadline|due date)\b)/gi,
      ' ',
    )
    .replace(
      new RegExp(
        `\\.\\s+(?=(?:it|this|that|the (?:task|item|deliverable|${completionNoun})) (?:is|was|has been) (?:delivered|completed|finished|done|shipped)[.!]?$)`,
        'i',
      ),
      ' ',
    )
    .replace(/\.\s+(?:Its|The task[’']s) (deadline|due date)\b/gi, ' $1')
    .replace(
      /\.\s+(?=[\p{L}][\p{L} ]{0,60} (?:remains|is still) (?:the )?owner(?=\s*(?:[.!?]|$)|\s+and\b))/gu,
      ' ',
    );
  const literalName = subject
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  const identities = literalName ? [...connected.matchAll(new RegExp(literalName, 'gi'))] : [];
  const clauses: string[] = [];
  let start = 0;
  for (const boundary of connected.matchAll(
    /(?:[;!?]|\.(?=\s|$)|\band\b|\bwhile\b|\bwhereas\b|\buntil\b|\bpero\b|\by\b)/giu,
  )) {
    if (
      identities.some(
        (name) =>
          boundary.index >= name.index &&
          boundary.index + boundary[0].length <= name.index + name[0].length,
      )
    )
      continue;
    clauses.push(connected.slice(start, boundary.index));
    start = boundary.index + boundary[0].length;
  }
  clauses.push(connected.slice(start));
  const matching = clauses.filter((clause) => namesTask(clause, subject));
  return matching.length === 1 ? matching[0]?.trim() : undefined;
}

function supportedTaskAssertion(support: Support | undefined): string | undefined {
  if (!support) return undefined;
  const clause = taskClause(support.quote, support.subject);
  return clause ? taskAssertion(clause, support.subject) : undefined;
}

/** Canonicalize an existing object ID placed in a local-ref slot, never guessing identity. */
export function normalizeKnownRelationshipReferences(
  input: Record<string, unknown>,
  localRefs: string[],
  objectIds: string[],
): Record<string, unknown> | null {
  const payload = { ...input };
  for (const side of ['from', 'to']) {
    const ref = payload[`${side}Ref`];
    if (typeof ref !== 'string' || localRefs.includes(ref) || !objectIds.includes(ref)) continue;
    const existing = payload[`${side}EntityId`];
    if (typeof existing === 'string' && existing !== ref) return null;
    payload[`${side}EntityId`] = ref;
    if (side === 'from') delete payload.fromRef;
    else delete payload.toRef;
  }
  return payload;
}

/** Ground optional writes against admitted source text, not the model's echoed context. */
export function groundCommunicationBundles<T extends Item>(args: {
  bundles: Bundle<T>[];
  packet: string;
  sources: {
    id: string;
    source?: string;
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
  calendarTargets?: { id: string; title: string }[];
  verifiedLifecycleAuditIds?: Set<string>;
  objects?: { id: string; type: string; name?: string; aliases?: string[] }[];
}): Bundle<T>[] {
  return args.bundles.map((bundle) => {
    const validContexts = new Set<Support>();
    const taskIdentityNames = (
      item: Pick<Item, 'targetId' | 'title'> &
        Partial<Pick<Item, 'targetKind' | 'proposedPayload'>>,
      objects = args.objects ?? [],
    ) => {
      if (item.targetKind === 'calendar_event') {
        const calendar = args.calendarTargets?.find((event) => event.id === item.targetId);
        return calendar ? [calendar.title] : [];
      }
      const target = objects.find((object) => object.id === item.targetId);
      const proposedName = item.proposedPayload?.canonicalName;
      const names = [
        target?.name ??
          (typeof proposedName === 'string' && proposedName.trim() ? proposedName : item.title),
      ];
      if (target?.type !== 'task') return names;
      return [
        ...names,
        ...(target.aliases ?? []).filter(
          (alias) =>
            alias.trim() &&
            !objects.some(
              (other) =>
                other.id !== target.id &&
                [other.name, ...(other.aliases ?? [])].some(
                  (name) => name && normalize(name) === normalize(alias),
                ),
            ),
        ),
      ];
    };
    const taskEvidenceUnambiguous = (
      item: Pick<Item, 'targetId' | 'title'>,
      text: string,
      objects = args.objects ?? [],
    ) => {
      const names = taskIdentityNames(item, objects);
      const literal = (name: string) => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
      };
      const competing = objects.filter(
        (object) =>
          object.type === 'task' &&
          object.id !== item.targetId &&
          object.name &&
          (Boolean(item.targetId) ||
            !names.some((name) => normalize(name) === normalize(object.name ?? ''))) &&
          [object.name, ...(object.aliases ?? [])].some((name) => namesTask(text, name)),
      );
      return (
        !competing.length ||
        (names.some(literal) &&
          !competing.some((object) =>
            [object.name ?? '', ...(object.aliases ?? [])].some((name) => name && literal(name)),
          ))
      );
    };
    const namesTaskQuote = (item: T, text: string, subject: string) => {
      const target = args.objects?.find((object) => object.id === item.targetId);
      const alias = target?.aliases?.find((name) => normalize(name) === normalize(subject));
      if (!alias || normalize(target?.name ?? '') === normalize(subject))
        return namesTask(text, subject);
      if (!taskIdentityNames(item).includes(alias)) return false;
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
    };
    const verified = (item: T) =>
      (item.grounding ?? [])
        .map((support) => {
          const names = taskIdentityNames(item);
          if (names.some((name) => normalize(name) === normalize(support.subject))) {
            const citedName = names.find((name) => namesTaskQuote(item, support.quote, name));
            if (citedName) support = { ...support, subject: citedName };
          }
          const sourceForQuote = args.sources.find((row) => row.id === support.rawEventId);
          const context = support.context;
          const completionNoun = support.subject
            .toLowerCase()
            .match(/[\p{L}\p{N}]+/gu)
            ?.at(-1);
          if (
            sourceForQuote &&
            context?.rawEventId === support.rawEventId &&
            support.field === 'status' &&
            support.value === 'done' &&
            completionNoun &&
            new RegExp(
              `^(?:it|this|that|the (?:task|item|deliverable|${completionNoun})) (?:is|was|has been) (?:delivered|completed|finished|done|shipped)[.!]?$`,
              'i',
            ).test(support.quote.trim())
          ) {
            const start = sourceForQuote.text.indexOf(context.quote);
            const end = start + context.quote.length;
            const at = sourceForQuote.text.indexOf(support.quote, end);
            if (
              start >= 0 &&
              at >= end &&
              !sourceForQuote.text.slice(end, at).trim() &&
              !sourceForQuote.text.includes(context.quote, start + 1) &&
              !sourceForQuote.text.includes(support.quote, at + 1)
            ) {
              const quote = sourceForQuote.text.slice(start, at + support.quote.length);
              if (
                quote.length <= 800 &&
                safeSourceQuote(sourceForQuote.text, quote) &&
                normalize(args.packet).includes(normalize(quote))
              )
                support = { ...support, quote };
            }
          }
          // Recover visible sentence context for short entity citations. Never cross a
          // source, header, truncated packet, or an ambiguous repeated occurrence.
          if (sourceForQuote && ['customer', 'project', 'prospect'].includes(support.field)) {
            const start = sourceForQuote.text.indexOf(support.quote);
            if (start >= 0 && !sourceForQuote.text.includes(support.quote, start + 1)) {
              const sentence = [...sourceForQuote.text.matchAll(/[^.!?\n]+[.!?]?/g)]
                .find(
                  (match) =>
                    start >= match.index &&
                    start + support.quote.length <= match.index + match[0].length,
                )?.[0]
                .trim();
              if (
                sentence &&
                !/^(?:From|To|Cc|Subject):/i.test(sentence) &&
                safeSourceQuote(sourceForQuote.text, sentence) &&
                normalize(args.packet).includes(normalize(sentence))
              )
                support = { ...support, quote: sentence };
            }
          }
          // Link supports sometimes name the endpoint as their subject. The
          // source clause must still name this exact task and the known endpoint.
          const taskObject = args.objects?.find(
            (object) => object.id === item.targetId && object.type === 'task',
          );
          const taskName =
            typeof item.proposedPayload.canonicalName === 'string'
              ? item.proposedPayload.canonicalName
              : (taskObject?.name ?? item.title);
          if (
            (item.targetKind === 'task' || item.proposedPayload.type === 'task' || taskObject) &&
            (support.field === 'project' || support.field === 'customer')
          ) {
            const endpoint = args.hubs.find(
              (hub) =>
                hub.id === support.value &&
                hub.type === (support.field === 'project' ? 'project' : 'company'),
            );
            if (
              endpoint &&
              [endpoint.name, ...(endpoint.aliases ?? [])].some(
                (name) => normalize(name) === normalize(support.subject),
              ) &&
              namesTask(support.quote, taskName)
            )
              support = { ...support, subject: taskName };
          }
          if (
            sourceForQuote &&
            support.field === 'assignee' &&
            (/^[\p{L}][\p{L} ]{0,60} (?:remains|is still) (?:the )?owner(?=\s*(?:[.!?]|$)|\s+and\b)/u.test(
              support.quote,
            ) ||
              args.members.some(
                (member) =>
                  member.userId === support.value &&
                  member.name &&
                  support.quote === `Please use ${member.name} as the assignee.`,
              ))
          ) {
            const at = sourceForQuote.text.indexOf(support.quote);
            const previous =
              at < 0
                ? undefined
                : /[^.!?\n]+[.!?]$/.exec(sourceForQuote.text.slice(0, at).trim())?.[0]?.trim();
            const knownTasks = [
              ...(args.objects ?? []).filter((row) => row.type === 'task').map((row) => row.name),
              ...(args.pendingNames ?? []),
              ...bundle.items
                .filter((row) => row.targetKind === 'task' || row.proposedPayload.type === 'task')
                .map((row) => row.title),
            ];
            const otherTask =
              previous &&
              knownTasks.some(
                (name) => name && !namesTask(name, support.subject) && namesTask(previous, name),
              );
            const quote = previous ? `${previous} ${support.quote}` : '';
            if (
              previous &&
              namesTask(previous, support.subject) &&
              !otherTask &&
              !sourceForQuote.text.includes(support.quote, at + 1) &&
              safeSourceQuote(sourceForQuote.text, quote) &&
              normalize(args.packet).includes(normalize(quote))
            )
              support = { ...support, quote };
          }
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
          const isTask =
            item.targetKind === 'task' ||
            item.proposedPayload.type === 'task' ||
            args.objects?.some((object) => object.id === item.targetId && object.type === 'task');
          const identityText =
            taskClause(support.quote, support.subject) ??
            (contextValid ? context.quote : support.quote);
          return (
            (!isTask || taskEvidenceUnambiguous(item, identityText)) &&
            source &&
            safeSourceQuote(source.text, support.quote) &&
            normalize(args.packet).includes(normalize(support.quote)) &&
            !unsafe(support.quote) &&
            (item.targetKind === 'object_relationship' ||
              namesTaskQuote(item, support.quote, support.subject) ||
              (support.field === 'assignee' &&
                contextValid &&
                /\b(?:this|it|instead)\b/i.test(support.quote))) &&
            (item.targetKind === 'object_relationship' ||
              taskIdentityNames(item).some((name) => namesTask(name, support.subject)))
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
      if (item.operation === 'archive_or_cancel') {
        const cancellation = supports.find(
          (support) => support.field === 'status' && support.value === 'cancelled',
        );
        if (
          !cancellation ||
          !affirmativeLifecycle(
            taskClause(cancellation.quote, cancellation.subject),
            cancellation.subject,
            'cancelled',
          )
        )
          return [];
      }
      if (item.targetKind === 'object_relationship') {
        const normalizedRefs = normalizeKnownRelationshipReferences(
          payload,
          bundle.items
            .map((candidate) => candidate.proposedPayload.localRef)
            .filter((ref): ref is string => typeof ref === 'string'),
          [...args.hubs, ...(args.objects ?? [])].map((object) => object.id),
        );
        if (!normalizedRefs) return [];
        if (!('fromRef' in normalizedRefs)) delete payload.fromRef;
        if (!('toRef' in normalizedRefs)) delete payload.toRef;
        Object.assign(payload, normalizedRefs);
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
        // Customer and generic link evidence establishes only a related edge. A
        // directed task → project child edge needs its own project-membership assertion.
        const taskProjectChild =
          payload.kind === 'child' && from?.type === 'task' && to?.type === 'project';
        if (payload.kind !== 'related' && !taskProjectChild) return [];
        const known = [
          ...args.hubs,
          ...(args.objects ?? []),
          ...bundle.items
            .filter(
              (candidate) =>
                candidate.operation === 'create' &&
                (candidate.targetKind === 'object' || candidate.targetKind === 'task'),
            )
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
                candidate.targetKind === 'task'
                  ? 'task'
                  : typeof candidate.proposedPayload.type === 'string'
                    ? candidate.proposedPayload.type
                    : '',
              aliases: [] as string[],
            })),
        ];
        const namesEndpoint = (quote: string, object: NonNullable<typeof from>) =>
          object.type === 'task'
            ? taskEvidenceUnambiguous({ title: object.name, targetId: object.id }, quote, known) &&
              taskIdentityNames({ title: object.name, targetId: object.id }, known).some((name) =>
                namesTask(quote, name),
              )
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
        // The bundle quote is evidence only after the same source/packet checks.
        // Reuse explicit link clauses when endpoint supports are quoted separately.
        const linkSupports = [...supports];
        for (const support of supports) {
          const source = args.sources.find((source) => source.id === support.rawEventId);
          if (
            !bundle.quote ||
            !source ||
            !safeSourceQuote(source.text, bundle.quote) ||
            !normalize(args.packet).includes(normalize(bundle.quote))
          )
            continue;
          for (const quote of bundle.quote.split(/(?<=[.!?])\s+/)) {
            if (/\blink\b/i.test(quote) && safeSourceQuote(source.text, quote))
              linkSupports.push({ ...support, quote });
          }
        }
        const adjacentEngagement = () => {
          const company = from?.type === 'company' ? from : to?.type === 'company' ? to : null;
          const project = from?.type === 'project' ? from : to?.type === 'project' ? to : null;
          if (!company || !project) return false;
          return args.sources.some((source) => {
            const sentences = [...source.text.matchAll(/[^.!?\n]+[.!?]?/g)].filter((match) =>
              match[0].trim(),
            );
            const visibleText = sentences
              .filter(
                (match) =>
                  safeSourceQuote(source.text, match[0].trim()) &&
                  normalize(args.packet).includes(normalize(match[0])),
              )
              .map((match) => match[0])
              .join(' ');
            if (
              /\b(?:do not|don't|must not|never) (?:link|connect|associate)\b|\bunrelated\b|\bseparate from\b/i.test(
                visibleText,
              )
            )
              return false;
            for (const object of [company, project]) {
              const candidates = new Set(
                known
                  .filter(
                    (candidate) =>
                      candidate.type === object.type &&
                      [candidate.name, ...(candidate.aliases ?? [])].some(
                        (name) => name && mentions(visibleText, name),
                      ),
                  )
                  .map((candidate) => candidate.id),
              );
              if (candidates.size !== 1 || !candidates.has(object.id)) return false;
              if (
                !supports.some(
                  (support) =>
                    support.rawEventId === source.id && namesEndpoint(support.quote, object),
                )
              )
                return false;
            }
            return sentences.some((first, index) => {
              const second = sentences[index + 1];
              if (!second) return false;
              const engagement =
                /^(?:we are |we're )?(?:discussing|considering|exploring|planning) (?:a |the )?(?:(?:potential|possible|prospective|proposed) )?engagement (?:with|for)\b/i.test(
                  first[0].trim(),
                ) &&
                /^(?:the|their) (?:(?:concrete|proposed|potential|possible) ){0,2}project is (?:called|named)\b/i.test(
                  second[0].trim(),
                );
              const possessive =
                /\bis our (?:new )?(?:client|customer)[.!]?$/i.test(first[0].trim()) &&
                /^(?:we are|we're) (?:planning|building|delivering|tracking) their\b.*\bproject[.!]?$/i.test(
                  second[0].trim(),
                );
              const namedProjectForClient =
                /\bis our (?:new )?(?:client|customer)[.!]?$/i.test(first[0].trim()) &&
                /^(?:we are|we're) (?:planning|building|delivering|tracking) (?:a |the )?(?:named |new |concrete )?project for them, [^.!?]+[.!]?$/i.test(
                  second[0].trim(),
                );
              const feedbackContinuation =
                [company.name, ...company.aliases].some((name) => {
                  const beginning = `${normalize(name)} `;
                  const statement = normalize(first[0]);
                  return (
                    statement.startsWith(beginning) &&
                    /^(?:liked|reviewed|approved) (?:the|our) (?:latest )?(?:screens|designs|prototype|proposal)[.!]?$/.test(
                      statement.slice(beginning.length),
                    )
                  );
                }) &&
                /\bis (?:the|our) project (?:we are|we're) (?:planning|building|delivering|tracking) (?:with|for) them[.!]?$/i.test(
                  second[0].trim(),
                );
              if (!engagement && !possessive && !namedProjectForClient && !feedbackContinuation)
                return false;
              const span = source.text.slice(first.index, second.index + second[0].length);
              return (
                namesEndpoint(first[0], company) &&
                namesEndpoint(second[0], project) &&
                !/[?]|\b(?:not|no|unless|if|instead|unrelated|separate|another|either|or|maybe|perhaps)\b/i.test(
                  span,
                ) &&
                safeSourceQuote(source.text, span) &&
                normalize(args.packet).includes(normalize(span))
              );
            });
          });
        };
        const grounded =
          from &&
          to &&
          linkSupports.some((support) => {
            const taskEndpoint = from.type === 'task' ? from : to.type === 'task' ? to : null;
            const assertion = taskEndpoint
              ? (taskClause(support.quote, taskEndpoint.name) ?? support.quote)
              : support.quote;
            if (
              support.quote.includes('?') ||
              ![to.id, to.name, from.id, from.name].includes(support.value) ||
              /[?]|\b(?:maybe|perhaps|undecided|not|never|cannot|don['’]t|can['’]t|mustn['’]t|shouldn['’]t|won['’]t|unless|if|unrelated)\b/i.test(
                assertion,
              ) ||
              (!taskEndpoint && /\bseparate\b/i.test(assertion))
            )
              return false;
            if (
              support.field !== 'relationship' &&
              !(
                (support.field === 'customer' && [from.type, to.type].includes('company')) ||
                (support.field === 'project' && [from.type, to.type].includes('project'))
              )
            )
              return false;
            if (taskProjectChild) {
              if (support.field !== 'project' || !namesEndpoint(assertion, from)) return false;
              const membership = taskAssertion(assertion, from.name);
              if (!membership || !namesEndpoint(membership, from)) return false;
              const projects = new Set(
                known
                  .filter(
                    (candidate) =>
                      candidate.type === 'project' &&
                      [candidate.name, ...(candidate.aliases ?? [])].some(
                        (name) => name && mentions(membership, name),
                      ),
                  )
                  .map((candidate) => candidate.id),
              );
              if (
                projects.size !== 1 ||
                !projects.has(to.id) ||
                hasProjectAlternative(membership, [to.name, ...to.aliases])
              )
                return false;
              return [to.name, ...to.aliases].some(
                (name) =>
                  namesEndpoint(name, to) &&
                  affirmativeProjectMembership(membership, from.name, name, false),
              );
            }
            const link =
              /^(?:please )?(?:link|connect|relate|associate) (.+?) (?:to|with) (.+?)[.!]?$/i.exec(
                assertion.trim(),
              );
            if (link && payload.kind === 'related') {
              const exactEndpoint = (reference: string, object: NonNullable<typeof from>) =>
                [object.name, ...object.aliases].some(
                  (name) =>
                    [normalize(name), `the ${normalize(name)}`].includes(normalize(reference)) &&
                    !known.some(
                      (candidate) =>
                        candidate.id !== object.id &&
                        [candidate.name, ...(candidate.aliases ?? [])].some(
                          (other) => other && normalize(other) === normalize(name),
                        ),
                    ),
                );
              if (
                (exactEndpoint(link[1] ?? '', from) && exactEndpoint(link[2] ?? '', to)) ||
                (exactEndpoint(link[1] ?? '', to) && exactEndpoint(link[2] ?? '', from))
              )
                return true;
            }
            if (support.field === 'relationship') return false;
            const direct = namesEndpoint(assertion, from) && namesEndpoint(assertion, to);
            if (direct) {
              const company = from.type === 'company' ? from : to.type === 'company' ? to : null;
              const project = from.type === 'project' ? from : to.type === 'project' ? to : null;
              if (taskEndpoint) {
                const hub = from === taskEndpoint ? to : from;
                const association = taskAssertion(assertion, taskEndpoint.name);
                if (!association || !namesEndpoint(association, taskEndpoint)) return false;
                const type = typeof hub.type === 'string' ? hub.type : '';
                return [hub.name, ...hub.aliases].some(
                  (name) =>
                    namesEndpoint(name, hub) &&
                    affirmativeTaskHub(association, taskEndpoint.name, name, type) &&
                    !(
                      type === 'company' &&
                      known.some(
                        (other) =>
                          other.id !== hub.id &&
                          other.type === 'company' &&
                          [other.name, ...(other.aliases ?? [])].some(
                            (otherName) =>
                              otherName &&
                              normalize(otherName).startsWith(`${normalize(name)} `) &&
                              affirmativeTaskHub(association, taskEndpoint.name, otherName, type),
                          ),
                      )
                    ),
                );
              }
              if (!company || !project) return false;
              // Bind the predicate to these two named endpoints in the same statement.
              const names = (object: typeof company) =>
                [object.name, ...object.aliases]
                  .filter(
                    (name) =>
                      name &&
                      namesEndpoint(name, object) &&
                      !known.some(
                        (other) =>
                          other.id !== object.id &&
                          other.type === object.type &&
                          [other.name, ...(other.aliases ?? [])].some(
                            (alias) => alias && normalize(alias) === normalize(name),
                          ),
                      ),
                  )
                  .map(normalize);
              const statement = normalize(assertion).replace(/[.!]$/, '');
              return names(company).some((client) =>
                names(project).some((work) => {
                  return (
                    [
                      `link ${work} to ${client}`,
                      `link ${client} to ${work}`,
                      `${work} is a project for ${client}`,
                      `${work} is the project for ${client}`,
                      `${work} is a project with ${client}`,
                      `${client}'s project is ${work}`,
                      `${work} is ${client}'s project`,
                    ].includes(statement.replace(/^please /, '').replace(/[’]/g, "'")) ||
                    (statement.endsWith(` ${work}`) &&
                      [client, `our existing customer ${client}`, `our client ${client}`].some(
                        (subject) =>
                          statement.startsWith(`${subject} is `) &&
                          /^(?:planning|considering|launching) (?:a |the )?(?:new |possible |proposed )?project(?: called| named)?$/.test(
                            statement.slice(subject.length + 4, -work.length - 1),
                          ),
                      ))
                  );
                }),
              );
            }
            // A typed reference can combine admitted statements from the SAME source only.
            // It must be an explicit link instruction, with exactly one visible candidate.
            if (!/\blink\b/i.test(support.quote)) return false;
            const other = namesEndpoint(support.quote, from)
              ? to
              : namesEndpoint(support.quote, to)
                ? from
                : null;
            const taskNoun = other?.name
              .toLowerCase()
              .match(/[\p{L}\p{N}]+/gu)
              ?.at(-1);
            const referenceKind =
              other?.type === 'task'
                ? `(?:task|item|deliverable${taskNoun && taskNoun.length > 3 ? `|${taskNoun}` : ''})`
                : other?.type === 'company'
                  ? '(?:company|customer|client)'
                  : 'project';
            if (
              !other ||
              !['company', 'project', 'task'].includes(String(other.type)) ||
              !new RegExp(`\\b(?:the|this|that) ${referenceKind}\\b`, 'i').test(support.quote)
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
                    (candidate.type === 'task'
                      ? namesTask(source.text, candidate.name)
                      : [candidate.name, ...(candidate.aliases ?? [])].some((name) =>
                          mentions(source.text, name),
                        )),
                )
                .map((candidate) => candidate.id),
            );
            return (
              candidates.size === 1 &&
              candidates.has(other.id) &&
              [
                ...supports,
                ...bundle.items
                  .filter(
                    (candidate) =>
                      candidate.targetKind !== 'object_relationship' &&
                      (candidate.proposedPayload.localRef === other.id ||
                        candidate.targetId === other.id),
                  )
                  .flatMap(verified),
              ].some(
                (evidence) =>
                  evidence.rawEventId === support.rawEventId &&
                  namesEndpoint(evidence.quote, other),
              )
            );
          });
        if (!grounded && !adjacentEngagement()) return [];
      }
      const has = (field: Support['field'], value: unknown) =>
        supports.find(
          (support) =>
            support.field === field &&
            (support.value === value ||
              (field === 'dueAt' &&
                typeof value === 'string' &&
                Number.isFinite(Date.parse(value)) &&
                Date.parse(support.value) === Date.parse(value))),
        );
      if (type === 'company' || type === 'project') {
        const tentative = supports.find(
          (support) =>
            (support.field === 'prospect' ||
              (type === 'company' && support.field === 'customer') ||
              (type === 'project' && support.field === 'project')) &&
            prospect(support.quote),
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
        const citedAssignment = assignment
          ? taskClause(assignment.quote, assignment.subject)
          : undefined;
        const originalClause = assignment
          ? citedAssignment
            ? taskAssertion(citedAssignment, assignment.subject)
            : validContexts.has(assignment)
              ? assignment.quote
              : undefined
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
        const escapedName = member?.name?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const name = escapedName
          ? `(?<![\\p{L}\\p{N}'’_-])${escapedName}(?![\\p{L}\\p{N}'’_-])`
          : undefined;
        const hasTaskContext = assignment !== undefined && validContexts.has(assignment);
        const matchesAssignedTask = (action: string) =>
          assignment !== undefined && (hasTaskContext || namesTask(action, assignment.subject));
        const namedAction =
          name && clause
            ? new RegExp(
                `(?:${name}\\s+(?:will|shall|owns|is responsible(?: for)?|to|revisará|preparará|hará|wird|übernimmt|tarkistaa)(?![\\p{L}\\p{N}])|${name},?\\s+please\\b)`,
                'iu',
              ).exec(clause)
            : null;
        const explicitAssignment =
          name && clause
            ? new RegExp(
                `\\b(?:re)?assign(?:ed)?\\b([^.!?]*?)${name}(?=\\s*(?:[.!?,]|$)|\\s+(?:for|to|as|by)\\b)`,
                'iu',
              ).exec(clause)
            : null;
        const passiveSubject = assignment ? taskIdentityPattern(assignment.subject) : '';
        const passiveAssignment =
          clause &&
          explicitAssignment &&
          passiveSubject &&
          /^(?:re)?assigned\s+to\s+/i.test(explicitAssignment[0]) &&
          new RegExp(
            `(?:^|\\s)${passiveSubject}(?: task)? (?:is|was|has been|had been) (?:now )?$`,
            'iu',
          ).test(normalize(clause.slice(0, explicitAssignment.index)) + ' ');
        const confirmedOwner =
          name &&
          clause &&
          new RegExp(
            `${name}\\s+(?:remains|is still) (?:the )?owner(?=\\s*(?:[.!?]|$)|\\s+and\\b)`,
            'iu',
          ).test(clause);
        const named =
          clause &&
          !/\b(?:not|cannot|can't|declined|no|nicht|if|unless)\b/i.test(clause) &&
          ((namedAction !== null &&
            matchesAssignedTask(clause.slice(namedAction.index + namedAction[0].length))) ||
            (explicitAssignment !== null &&
              matchesAssignedTask(
                (explicitAssignment[1] ?? '') +
                  clause.slice(explicitAssignment.index + explicitAssignment[0].length),
              )) ||
            Boolean(passiveAssignment) ||
            confirmedOwner);
        const commitmentQuotes = assignment
          ? [...assignment.quote.matchAll(/[^.!?]+[.!?]?/g)].flatMap((match) => {
              const start = /\b(?:I (?:will|shall)|I['’]ll)\b/i.exec(match[0]);
              return start &&
                (namesTask(match[0], assignment.subject) || validContexts.has(assignment))
                ? [match[0].slice(start.index).trim()]
                : [];
            })
          : [];
        const commitment = commitmentQuotes.length === 1 ? commitmentQuotes[0] : undefined;
        const quoteAt = source && assignment ? source.text.indexOf(assignment.quote) : -1;
        const commitmentAt =
          source && commitment && quoteAt >= 0 ? source.text.indexOf(commitment, quoteAt) : -1;
        const uniqueCommitment =
          source &&
          assignment &&
          commitment &&
          commitmentAt >= quoteAt &&
          commitmentAt >= 0 &&
          commitmentAt + commitment.length <= quoteAt + assignment.quote.length &&
          source.text.indexOf(commitment) === commitmentAt &&
          !source.text.includes(commitment, commitmentAt + 1);
        const headers =
          source && uniqueCommitment
            ? [...source.text.slice(0, commitmentAt).matchAll(/(?:^|\n)(?:From|Von|De):([^\n]*)/gi)]
            : [];
        const latestHeader = headers.at(-1);
        const headerEmails = new Set(
          [...(latestHeader?.[1] ?? '').matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map(
            (match) => normalize(match[0]),
          ),
        );
        const emailSpeaker = Boolean(
          member?.email &&
          uniqueCommitment &&
          (latestHeader
            ? headerEmails.size === 1 &&
              headerEmails.has(normalize(member.email)) &&
              safeSourceQuote(source.text, latestHeader[0].trim()) &&
              normalize(args.packet).includes(normalize(latestHeader[0].trim()))
            : source.speakerContext?.includes(`"senderHandle":${JSON.stringify(member.email)}`)),
        );
        const selfAction = clause && /\bI (?:will|shall)\b/i.exec(clause);
        const self =
          member &&
          assignment &&
          clause &&
          ((source?.source ?? args.source) === 'email'
            ? emailSpeaker
            : source?.authorUserId === member.userId) &&
          selfAction &&
          matchesAssignedTask(clause.slice(selfAction.index + selfAction[0].length)) &&
          !/\b(?:if|unless|not|cannot)\b/i.test(clause);
        // A cited, verified assignment is a concrete claim even if the model
        // omitted its payload field on a new task. Updates and repairs may have
        // intentionally protected fields removed. Never overwrite a field or choose
        // between competing supported owners.
        if (
          item.operation === 'create' &&
          !item.targetId &&
          member &&
          (named || self) &&
          !assignment?.quote.includes('?') &&
          !['assigneeUserId', 'assigneeName', 'ownerUserId', 'ownerName'].some((key) =>
            Object.hasOwn(payload, key),
          ) &&
          new Set(
            supports
              .filter((support) => support.field === 'assignee')
              .map((support) => support.value),
          ).size === 1
        ) {
          payload.assigneeUserId = member.userId;
        }
        const clearAssignment =
          assignment?.value === 'unassigned' &&
          Boolean(clause) &&
          !/\b(?:not|never|if|unless|maybe|perhaps|might|could)\b/i.test(clause ?? '');
        const clearOwner =
          clearAssignment &&
          /\b(?:remove|clear|unset|unassign)\b.*\bowner\b|\bowner\b.*\b(?:removed|cleared|unassigned)\b/i.test(
            clause ?? '',
          );
        const clearAssignee =
          clearAssignment &&
          (/\b(?:remove|clear|unset)\b.*\bassignee\b/i.test(clause ?? '') ||
            (/\b(?:unassign|unassigned)\b/i.test(clause ?? '') &&
              !/\bowner\b/i.test(clause ?? '')));
        const supportedAssignment =
          member && (Boolean(named) || Boolean(self)) && !assignment?.quote.includes('?');
        const retainAssignment = (
          key: 'assigneeUserId' | 'ownerUserId' | 'assigneeName' | 'ownerName',
        ) =>
          (key.startsWith('owner') ? clearOwner : clearAssignee)
            ? payload[key] === null
            : supportedAssignment &&
              payload[key] === (key.endsWith('UserId') ? member.userId : member.name);
        if (!retainAssignment('assigneeUserId')) delete payload.assigneeUserId;
        if (!retainAssignment('ownerUserId')) delete payload.ownerUserId;
        if (!retainAssignment('assigneeName')) delete payload.assigneeName;
        if (!retainAssignment('ownerName')) delete payload.ownerName;
        const deadlineRemoval = supportedTaskAssertion(has('dueAt', 'unset'));
        const clearDeadline =
          deadlineRemoval &&
          !/\b(?:not|never|if|unless)\b/i.test(deadlineRemoval) &&
          /\b(?:remove|clear) (?:the )?deadline\b/i.test(deadlineRemoval);
        const deadline = has('dueAt', payload.dueAt);
        if (
          payload.dueAt !== undefined &&
          !(payload.dueAt === null && clearDeadline) &&
          !(
            deadline &&
            deadlineMatches(
              supportedTaskAssertion(deadline) ?? '',
              deadline.subject,
              payload.dueAt,
              args.timezone ?? 'UTC',
              args.sources.find((row) => row.id === deadline.rawEventId)?.occurredAt,
            )
          )
        )
          delete payload.dueAt;
        const lifecycle = has('status', payload.status);
        const lifecycleClause = lifecycle
          ? taskClause(lifecycle.quote, lifecycle.subject)
          : undefined;
        const targetName =
          args.objects?.find((object) => object.id === item.targetId)?.name ??
          (typeof payload.canonicalName === 'string' ? payload.canonicalName : item.title);
        const lifecycleVerified =
          lifecycle &&
          affirmativeLifecycle(
            lifecycleClause,
            lifecycle.subject,
            payload.status,
            /^(?:mark )?send\b/i.test(targetName),
          );
        if (lifecycleVerified && item.auditId) args.verifiedLifecycleAuditIds?.add(item.auditId);
        if (
          payload.status !== undefined &&
          !(item.operation === 'create' && payload.status === 'todo') &&
          !lifecycleVerified
        )
          delete payload.status;
        if (payload.parentObjectId === null) {
          const clause = supportedTaskAssertion(has('project', 'unset'));
          if (
            !clause ||
            /[?]|\b(?:not|never|if|unless|maybe|perhaps|[a-z]+n[’']t)\b/i.test(clause) ||
            !/\b(?:remove|clear|unset) (?:the |its )?(?:primary )?project(?: assignment| association)?\b/i.test(
              clause,
            )
          ) {
            delete payload.parentObjectId;
            delete payload.projectName;
          }
        }
        if (typeof payload.parentObjectId === 'string') {
          const selected = args.hubs.find(
            (hub) => hub.type === 'project' && hub.id === payload.parentObjectId,
          );
          const projectSupport =
            has('project', payload.parentObjectId) ??
            supports.find(
              (entry) =>
                entry.field === 'project' &&
                selected &&
                [selected.name, ...(selected.aliases ?? [])].some(
                  (name) => normalize(name) === normalize(entry.value),
                ),
            );
          const clause = supportedTaskAssertion(projectSupport);
          const projects = clause
            ? args.hubs.filter(
                (hub) =>
                  hub.type === 'project' &&
                  [hub.name, ...(hub.aliases ?? [])].some((name) => mentions(clause, name)),
              )
            : [];
          const project = projects.length === 1 ? projects[0] : undefined;
          const names = project ? [project.name, ...(project.aliases ?? [])] : [];
          if (
            !clause ||
            !projectSupport ||
            project?.id !== payload.parentObjectId ||
            hasProjectAlternative(clause, names) ||
            !names.some((name) =>
              affirmativeProjectMembership(clause, projectSupport.subject, name, true),
            )
          ) {
            delete payload.parentObjectId;
            delete payload.projectName;
          }
        }
        if (typeof payload.createProjectName === 'string') {
          const name = payload.createProjectName;
          const project = bundle.items.find(
            (candidate) =>
              candidate.operation === 'create' &&
              candidate.proposedPayload.type === 'project' &&
              typeof candidate.proposedPayload.canonicalName === 'string' &&
              normalize(candidate.proposedPayload.canonicalName) === normalize(name),
          );
          const support = supports.find(
            (entry) =>
              entry.field === 'project' &&
              (normalize(entry.value) === normalize(name) ||
                entry.value === project?.proposedPayload.localRef),
          );
          const clause = supportedTaskAssertion(support);
          if (
            item.operation !== 'create' ||
            !support ||
            !clause ||
            hasProjectAlternative(clause, [name]) ||
            !affirmativeProjectMembership(clause, support.subject, name, true)
          ) {
            delete payload.createProjectName;
            if (payload.parentObjectId === undefined) delete payload.projectName;
          }
        }
        const links = supports.filter((support) => {
          if (support.field !== 'customer') return false;
          const clause = supportedTaskAssertion(support);
          if (
            !clause ||
            support.quote.includes('?') ||
            /\b(?:or|maybe|perhaps|might|may|undecided|not|never|no|if|unless|unrelated|except|without)\b/i.test(
              clause,
            )
          )
            return false;
          const candidates = args.hubs.filter(
            (hub) => hub.type === 'company' && mentions(clause, hub.name),
          );
          const customer = candidates[0];
          if (!customer || candidates.length !== 1 || customer.id !== support.value) return false;
          return affirmativeTaskHub(clause, support.subject, customer.name, 'company');
        });
        const ids = [...new Set(links.map((support) => support.value))];
        if (ids.length === 1 && item.operation === 'create') {
          const ref =
            typeof payload.localRef === 'string' ? payload.localRef : `grounded-task-${index}`;
          payload.localRef = ref;
          extra.push({
            ...item,
            auditId: undefined,
            operation: 'create',
            targetKind: 'object_relationship',
            title: `${item.title}: customer`,
            proposedPayload: { kind: 'related', fromRef: ref, toEntityId: ids[0] },
          });
        }
      }
      // Internal grounding must never leak into user-editable canonical payloads.
      delete payload.grounding;
      const operation =
        item.operation === 'archive_or_cancel' && type === 'task' && payload.status === 'cancelled'
          ? 'update'
          : item.operation;
      if (operation === 'update' && Object.keys(payload).length === 0) return [];
      return [{ ...item, operation, proposedPayload: payload }];
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
