import { splitStoredEmailContent } from '@timeline/shared/email';
import { maintainedRecordFields, type MaintainedRecordField } from '@timeline/shared/objects/types';
import {
  chronologicalLifecycleEvidence,
  explicitArchiveInstruction,
  explicitArchiveRetraction,
  explicitLifecycleState,
} from '@timeline/shared/suggestions';
import {
  dateOnlyEventRange,
  resolveTimePhrase,
  zonedDateTimeFromDate,
} from '@timeline/shared/time';
import { z } from 'zod';

export const communicationGroundingSchema = z.object({
  field: z.enum([
    'assignee',
    'canonicalName',
    'dueAt',
    'plannedDate',
    'stage',
    'status',
    'customer',
    'project',
    'prospect',
    'relationship',
  ]),
  rawEventId: z.uuid(),
  quote: z.string().min(3).max(800),
  subject: z.string().min(1).max(200),
  value: z.string().max(200),
  context: z.object({ rawEventId: z.uuid(), quote: z.string().min(3).max(800) }).optional(),
});
type Support = z.infer<typeof communicationGroundingSchema>;
type AssignmentRole = 'owner' | 'assignee';
interface VerifiedClaim {
  rawEventId: string;
  contextRawEventId?: string;
  identityRawEventId?: string;
  assertedAt: string;
  value: string | null;
}
const RECORD_STATE_TERMS: Record<string, Record<string, readonly string[]>> = {
  project: {
    planning: ['in planning'],
    active: ['active', 'in progress', 'underway'],
    on_hold: ['on hold', 'paused'],
    shipped: ['shipped', 'completed', 'finished'],
    cancelled: ['cancelled', 'canceled'],
  },
  deal: {
    open: ['open', 'reopened'],
    qualified: ['qualified'],
    proposal: ['in proposal', 'at proposal', 'proposal sent', 'offer sent'],
    won: ['won', 'closed won'],
    lost: ['lost', 'closed lost'],
  },
  incident: {
    open: ['open', 'reopened'],
    mitigated: ['mitigated'],
    resolved: ['resolved'],
    postmortem: ['in postmortem'],
  },
  decision: {
    draft: ['a draft'],
    proposed: ['proposed'],
    accepted: ['accepted'],
    rejected: ['rejected'],
  },
  hiring_loop: {
    sourcing: ['in sourcing'],
    interviewing: ['in interviews', 'in interviewing'],
    offer: ['at offer', 'in offer'],
    hired: ['hired'],
    closed: ['closed'],
  },
};

function isWorkRecord(type: unknown): boolean {
  return type === 'task' || type === 'follow_up';
}

function recordState(text: string, name: string, type: string, field: 'status' | 'stage') {
  const clause = normalize(text).replace(/[.!]$/, '');
  const identity = normalize(name);
  const prefix = field === 'stage' ? `the stage for ${identity} is ` : `${identity} is `;
  let value = clause.startsWith(prefix) ? clause.slice(prefix.length) : undefined;
  if (!value && field === 'status' && type === 'deal') {
    const offerPrefix = [
      `the offer for ${identity} has `,
      `the proposal for ${identity} has `,
      `the offer for ${identity} was `,
      `the proposal for ${identity} was `,
      `${identity} offer has `,
      `${identity} proposal has `,
    ].find((prefix) => clause.startsWith(prefix));
    const delivery = offerPrefix ? clause.slice(offerPrefix.length) : undefined;
    if (delivery && /^(?:(?:not|never) )?(?:been )?sent$/u.test(delivery))
      value = /^(?:not|never) /u.test(delivery) ? 'not offer sent' : 'offer sent';
  }
  if (!value) return undefined;
  const denial = /^(?:not|no longer) /u.exec(value);
  if (denial) value = value.slice(denial[0].length);
  if (field === 'stage')
    return /^[\p{L}\p{N}][\p{L}\p{N} -]{0,39}$/u.test(value)
      ? { value, denied: Boolean(denial) }
      : undefined;
  const assertion = value;
  const status = Object.entries(RECORD_STATE_TERMS[type] ?? {}).find(([, words]) =>
    words.includes(assertion),
  )?.[0];
  return status ? { value: status, denied: Boolean(denial) } : undefined;
}
export interface GroundedRelationship {
  rawEventIds: string[];
  fromName: string;
  toName: string;
  payload: Record<string, unknown>;
}

interface Item {
  auditId?: string | undefined;
  operation: string;
  targetKind: string;
  title: string;
  targetId?: string | null | undefined;
  proposedPayload: Record<string, unknown>;
  grounding?: Support[] | undefined;
  scopedSourceIdentity?: { name: string; scopeLabels: string[] } | undefined;
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
const CONVERSATIONAL_PLAN_CORRECTION =
  /^(?:actually|instead),?\s+(?:today|tomorrow|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{4}-\d{2}-\d{2}|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,?\s+\d{4})?)(?:\s+(?:in\s+)?(?:utc|gmt|(?:[a-z_]+\/)+[a-z_+-]+))?[.!]?$/i;
const contextualTaskAction =
  '(?:look into|work on|investigate|fix|review|triage|test|check|address) (?:it|this|that)(?: task| issue| problem)? on\\b';
const CONTEXTUAL_TASK_PLAN = new RegExp(
  `^(?:i[’']ll|i will|we[’']ll|we will) ${contextualTaskAction}`,
  'i',
);
const CONTEXTUAL_TASK_ACTION = new RegExp(`^\\s*${contextualTaskAction}`, 'i');

function literalWorkReference(text: string, name: string): boolean {
  const escaped = normalize(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(normalize(text));
}

function reportedWorkReference(title: string, quote: string): string | undefined {
  const report = normalize(quote).replace(/[.!]$/u, '');
  const label =
    /^(?:the |our )?([\p{L}\p{N}][\p{L}\p{N}'’ -]{1,96}) (?:is|are) (?:broken|failing|down|unavailable|not working)$/u.exec(
      report,
    )?.[1];
  if (!label?.includes(' ')) return undefined;
  const name = normalize(title).replace(/[.!]$/u, '');
  const artifact = name
    .replace(/^(?:fix|repair|resolve|investigate|address|restore) (?:the )?/u, '')
    .replace(/^(?:broken|failing|unavailable) /u, '');
  return artifact === label || name === report.replace(/^(?:the |our )/u, '') ? label : undefined;
}

function plannedAssertionTimezone(quote: string, fallback: string): string {
  const explicit =
    /\b(?:in|time zone) ((?:[A-Za-z_]+\/)+[A-Za-z_+-]+)\b/.exec(quote)?.[1] ??
    /(?:\s|\()(UTC|GMT)(?:\s|[.!?)]|$)/i.exec(quote)?.[1]?.toUpperCase();
  return explicit ?? fallback;
}

const tentativeAssertion =
  /\b(?:maybe|might|perhaps|probably|possibly|tentative(?:ly)?|potentially|provisionally|likely|could|(?:I|we|they|he|she) (?:think|guess|suspect|believe)s?)\b/i;
const projectMembershipTerms = '(?:under|within|part of|belongs? to|in (?:the )?project)';
const projectRoutingTerms = `(?:${projectMembershipTerms}|for|in|on)`;
const projectRoutingCue = new RegExp(`\\b${projectRoutingTerms}\\b`, 'i');
const mentions = (text: string, name: string) => normalize(text).includes(normalize(name));
const TASK_ACTIONS = new Set(['prepare', 'review', 'draft', 'write', 'create', 'send']);
const namesTask = (text: string, name: string, requireActionIdentity = false) => {
  const titleWords = (name.match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word !== 'a');
  const words = titleWords.map((word) => word.toLowerCase());
  const action = words[0];
  const directional = /\b(?:to|from|into|onto|towards?|through|against|versus|vs)\b/i.test(name);
  const actionCanBeOmitted = action !== undefined && TASK_ACTIONS.has(action);
  const significant = (actionCanBeOmitted ? words.slice(1) : words).filter(
    (word) =>
      !['an', 'and', 'for', 'in', 'of', 'on', 'the', 'with', 'please'].includes(word) &&
      (directional || word !== 'to'),
  );
  if (!significant.length) return mentions(text, name);
  const evidenceWords: string[] = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (actionCanBeOmitted && !evidenceWords.includes(action)) {
    if (evidenceWords.some((word) => TASK_ACTIONS.has(word))) return false;
    // The artifact can stand on its own as a subject or as the object of
    // an explicit outcome. Arbitrary prefixes can name a different action.
    if (requireActionIdentity) {
      const artifact = taskIdentityPattern(titleWords.slice(1).join(' '), true);
      if (!artifact) return false;
      const outcome = new RegExp(
        `^(?:(?:update|correction|status): )?(?:(?:[\\p{L}][\\p{L}\\p{M}'’.-]* ){0,4}(?:(?:has|have|had) )?(?:completed|finished|delivered|shipped|sent|reopened|cancelled|canceled|(?:am|is|are|was|were) working on) )?(?:(?:the|this|that|our) )?${artifact}(?![\\p{L}\\p{N}])`,
        'iu',
      );
      if (!outcome.test(normalize(text))) return false;
    }
  }
  // Directional arguments must remain ordered. Non-directional identities
  // may vary in word order, e.g. a customer prefix or “for Customer”.
  if (!directional) return significant.every((word) => evidenceWords.includes(word));
  let previous = -1;
  return significant.every((word) => {
    previous = evidenceWords.indexOf(word, previous + 1);
    return previous >= 0;
  });
};
const unsafe = (quote: string) =>
  /<\/?(?:system|developer)>|ignore (?:all|previous)|assign all tasks|disclose|reveal.*(?:secret|prompt)/i.test(
    quote,
  );
const prospect = (quote: string) =>
  /\b(?:potential|prospective|possible|proposed engagement|no contract|not signed|unsigned)\b/i.test(
    quote,
  );

// These predicates explicitly identify the speaker even when the language omits “I”.
const firstPersonCommitment =
  /(?<![\p{L}\p{N}])(?:I (?:will|shall|won['’]t|can['’]t|cannot|can(?=\s+not\b))|I['’]ll|ich werde|revisaré|prepararé|haré|enviaré|escribiré|terminaré|completaré|tarkistan|valmistelen|lähetän|kirjoitan)(?![\p{L}\p{N}])/iu;
const assignmentDenial = /(?:(?:will|shall|can)\s+not|won['’]t|can['’]t|cannot|declines to)\b/i;

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

function completeSourceAssertion(text: string, quote: string): string | undefined {
  if (!quote.trim()) return undefined;
  const literal = quote
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  const matches = [...text.matchAll(new RegExp(literal, 'giu'))];
  const match = matches[0];
  if (!match || matches.length !== 1) return undefined;
  const end = match.index + match[0].length;
  const boundaries = [...text.matchAll(/(?:[.!?](?=\s|$)|\r?\n+)/gu)];
  const before = boundaries.filter((boundary) => boundary.index < match.index).at(-1);
  const after = boundaries.find((boundary) => boundary.index + boundary[0].length >= end);
  return text
    .slice(
      before ? before.index + before[0].length : 0,
      after ? after.index + after[0].length : undefined,
    )
    .trim();
}

interface EmailChronologyStatement {
  id: string;
  contentText: string;
  occurredAt: Date;
  deadlineReferenceAt?: Date | undefined;
  senderEmail?: string | null | undefined;
  routingOnly?: boolean;
}

/** Retain candidate corrections with the original time and speaker for veto checks. */
export function emailChronologyStatements(
  event: EmailChronologyStatement,
): EmailChronologyStatement[] {
  const messages = datedEmailBodies({
    text: event.contentText,
    occurredAt: event.occurredAt,
    senderEmail: event.senderEmail,
  });
  return chronologicalLifecycleEvidence([{ ...event, source: 'email' }]).flatMap((part) => {
    const body = normalize(part.contentText);
    const matchingBodies = messages.filter((message) => message.body === body);
    const matchingBody = matchingBodies.length === 1 ? matchingBodies[0] : undefined;
    return part.contentText.split(/(?<=[.!?])\s+|\n+/u).flatMap((sentence) => {
      const explicit =
        Boolean(explicitLifecycleState(sentence)) ||
        firstPersonCommitment.test(sentence) ||
        assignmentDenial.test(sentence) ||
        /\b(?:deadline|due|by|before|plazo|fecha límite|fällig|bis|will|shall|owns|owner|responsible|assign|assigned|reassign|reassigned|unassign|remove|declines|cannot|project|under|within|part of|belongs to|attach|move|link)\b/i.test(
          sentence,
        );
      if (
        (!explicit && !projectRoutingCue.test(sentence)) ||
        !safeSourceQuote(part.contentText, sentence.trim())
      )
        return [];
      return [
        {
          id: event.id,
          contentText: sentence.trim(),
          occurredAt: part.occurredAt ?? event.occurredAt,
          deadlineReferenceAt: matchingBody?.occurredAt,
          senderEmail: matchingBody?.senderEmail,
          routingOnly: !explicit,
        },
      ];
    });
  });
}

function isOriginalChatCommitment(text: string, at: number, memberName: string | null): boolean {
  const before = text.slice(0, at);
  const lines = before.split('\n');
  const linePrefix = lines.pop() ?? '';
  const attributionLine = linePrefix.trim() || (lines.at(-1)?.trim() ?? '');
  const attribution = /^([\p{Lu}][\p{L}'’.-]*(?: [\p{Lu}][\p{L}'’.-]*){0,4})\s*:\s*$/u.exec(
    attributionLine,
  )?.[1];
  const asciiQuotes = before.match(/(?<!\\)"/g)?.length ?? 0;
  return (
    (!attribution || normalize(attribution) === normalize(memberName ?? '')) &&
    !/^\s*(?:>|&gt;)/u.test(linePrefix) &&
    !/^(?:[\t ]*)(?:>>>|&gt;&gt;&gt;)/mu.test(before) &&
    !/\b(?:said|says|wrote|writes|texted|replied|shared)\s*:\s*["“']?\s*$/iu.test(linePrefix) &&
    !/["“`]\s*$/u.test(linePrefix) &&
    asciiQuotes % 2 === 0 &&
    before.lastIndexOf('“') <= before.lastIndexOf('”') &&
    before.lastIndexOf('«') <= before.lastIndexOf('»') &&
    before.split('```').length % 2 === 1
  );
}

function datedEmailBodies(source: {
  text: string;
  occurredAt?: Date;
  senderEmail?: string | null | undefined;
}) {
  const { intro, forwarded } = splitStoredEmailContent(source.text);
  return [
    { body: normalize(intro), occurredAt: source.occurredAt, senderEmail: source.senderEmail },
    ...forwarded.map((message) => {
      const time = message.date ? Date.parse(message.date) : Number.NaN;
      return {
        body: normalize(message.body ?? ''),
        senderEmail: message.from.email,
        occurredAt:
          Number.isFinite(time) && (!source.occurredAt || time <= source.occurredAt.getTime())
            ? new Date(time)
            : undefined,
      };
    }),
  ];
}
function deadlineReferenceDate(
  source: { text: string; occurredAt?: Date },
  kind: string,
  quote: string,
  assertion: string,
): Date | undefined {
  if (kind !== 'email') return source.occurredAt;
  const messages = datedEmailBodies(source);
  for (const fragment of [quote, assertion]) {
    if (!fragment.trim()) continue;
    const containing = messages.filter((message) => message.body.includes(normalize(fragment)));
    if (containing.length) return containing.length === 1 ? containing[0]?.occurredAt : undefined;
  }
  return undefined;
}
interface DeadlineTiming {
  timezone: string;
  time?: { hour: number; minute: number; second: number; millisecond: number };
}

/** A missing suffix allows fallback. An unsupported explicit zone does not. */
function deadlineSuffixTimezone(
  suffix: string,
  position: 'first' | 'following' = 'first',
): { timezone: string; remainder: string } | null | undefined {
  const cue = /^\s+(?:(time\s+zone)|in)(?=[\s.,:;!?()]|$)/i.exec(suffix);
  const tail = suffix.slice(cue?.[0].length ?? 0).trimStart();
  const parenthesized = tail.startsWith('(');
  const zoneText = parenthesized ? tail.slice(1).trimStart() : tail;
  const candidate = /^[^\s.,;!?()]+/.exec(zoneText)?.[0];
  if (candidate) {
    const utc = /^(?:UTC|GMT)$/i.test(candidate);
    if (utc || /^[+-]\d{2}:\d{2}$/.test(candidate) || candidate.includes('/')) {
      const remainder = zoneText.slice(candidate.length);
      const closing = parenthesized ? /^\s*\)(?=[\s.,;!?)]|$)/.exec(remainder) : null;
      if (parenthesized && !closing) return null;
      return {
        timezone: utc ? 'UTC' : candidate,
        remainder: remainder.slice(closing?.[0].length ?? 0),
      };
    }
    if (/^[+-]\d/.test(candidate)) return null;
  }
  if (cue?.[1]) return null;

  const token = /^[A-Za-z][A-Za-z_/-]*/.exec(zoneText)?.[0];
  if (!token || /^(?:for|before|after|with|to|on|in|by|at)$/i.test(token)) return undefined;
  const remainder = zoneText.slice(token.length);
  // A wrapper can introduce prose. Reserve the broad abbreviation check for isolated tokens.
  const isolated = parenthesized ? /^\s*\)/.test(remainder) : /^[\s.,;!?]*$/.test(remainder);
  if (
    /^(?:am|pm|[PMCE][SD]T|[A-Z]EST|[A-Z]EDT|CET|CEST|BST|IST)$/i.test(token) ||
    (position === 'first' && ((!cue && !parenthesized) || isolated) && /^[A-Z]{2,6}$/.test(token))
  )
    return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: token });
    return null;
  } catch {
    // Ordinary words are not timezone identifiers.
    return undefined;
  }
}

function deadlineTiming(tail: string, fallbackTimezone: string): DeadlineTiming | undefined {
  const time =
    /^(?:T|\s+(?:at\s+)?)(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:\s*(UTC|GMT|Z|[+-]\d{2}:\d{2}))?/i.exec(
      tail,
    );
  if (!time) {
    return /^(?:T|\s+(?:at\b|\d))/i.test(tail) ? undefined : { timezone: fallbackTimezone };
  }
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  const second = Number(time[3] ?? 0);
  const millisecond = Number((time[4] ?? '').padEnd(3, '0'));
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  // A time marker must end at a boundary; ordinary following prose is not a zone.
  const suffix = tail.slice(time[0].length);
  if (/^[\p{L}\p{N}]|^\s*[+-]\d/u.test(suffix)) return undefined;
  if (/^\s*(?:a\.?m\.?|p\.?m\.?)(?:\b|[.\s]|$)/i.test(suffix)) return undefined;
  const suffixZone = deadlineSuffixTimezone(suffix);
  const inlineTimezone = time[5];
  if (
    suffixZone === null ||
    (suffixZone &&
      (inlineTimezone || deadlineSuffixTimezone(suffixZone.remainder, 'following') !== undefined))
  )
    return undefined;
  const timezone =
    suffixZone?.timezone ??
    (inlineTimezone && /^(UTC|GMT|Z)$/i.test(inlineTimezone) ? 'UTC' : inlineTimezone);
  if (timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      return undefined;
    }
  }
  return { timezone: timezone ?? fallbackTimezone, time: { hour, minute, second, millisecond } };
}

function taskDateAssertions(
  quote: string,
  subject: string,
  timezone: string,
  referenceDate: Date | undefined,
  field: 'dueAt' | 'plannedDate',
): { affirmed: Set<number | null>; denied: Set<number> } {
  const dates = { affirmed: new Set<number | null>(), denied: new Set<number>() };
  const add = (kind: 'affirmed' | 'denied', day: string, timing: DeadlineTiming) => {
    try {
      const zone = field === 'plannedDate' ? 'UTC' : timing.timezone;
      const start = dateOnlyEventRange(day, zone).startAt;
      const instant = timing.time
        ? zonedDateTimeFromDate(start, zone).with(timing.time).epochMilliseconds
        : start.getTime();
      dates[kind].add(instant);
    } catch {
      // Malformed dates do not establish a claim.
    }
  };
  const deadlineAt = (index: number, length: number) => {
    const prefix =
      quote
        .slice(0, index)
        .split(/\bbut\b|,\s*(?:instead|now)\b/i)
        .at(-1) ?? '';
    const suffix = quote.slice(index + length).split(/\bbut\b|,\s*(?:instead|now)\b/i)[0] ?? '';
    const assertion = normalize(`${prefix} ${suffix}`).replaceAll(normalize(subject), '[task]');
    const negation =
      /\b(?:not|never|no longer|isn[’']t|wasn[’']t|won[’']t|shouldn[’']t|nicht|kein)\b/i;
    const affirmedPrefix = normalize(prefix.replace(negation, ' '));
    const cue =
      field === 'plannedDate'
        ? /\b(?:plan(?:ned date)?|rescheduled|moved)(?:\s+(?:is|for|to|on|now))*$|\b(?:i[’']ll|i will|we[’']ll|we will)\b.+\bon$/i.test(
            affirmedPrefix.replaceAll(normalize(subject), '[task]'),
          ) ||
          /^(?:i am|i[’']m|we are|we[’']re) (?:moving|rescheduling) (?:my|our|the) (?:work on|investigation of|review of|testing of) (?:the )?\[task\] to$/i.test(
            affirmedPrefix.replaceAll(normalize(subject), '[task]'),
          ) ||
          CONVERSATIONAL_PLAN_CORRECTION.test(quote.trim())
        : /\b(?:deadline|due(?: date)?|by|before|plazo|fecha límite|fällig|bis)\b(?:\s+(?:is|was|on|by|for|set|now|el|es|am|ist))*\s*[:=-]?\s*$/i.test(
            affirmedPrefix,
          ) ||
          ['is', 'to', 'was', 'is now'].some((verb) =>
            affirmedPrefix.endsWith(`deadline for ${normalize(subject)} ${verb}`),
          );
    if (
      !cue ||
      tentativeAssertion.test(assertion) ||
      (field === 'plannedDate' &&
        /[?]|\b(?:due|deadline|doesn[’']t|don[’']t|can[’']t|cannot)\b/i.test(assertion)) ||
      /\b(?:if|unless|subject to|provided that)\b|\b(?:may|would) (?:be|have|get|fall)\b/i.test(
        assertion,
      )
    )
      return undefined;
    const kind: 'affirmed' | 'denied' = negation.test(
      normalize(prefix).replaceAll(normalize(subject), '[task]'),
    )
      ? 'denied'
      : 'affirmed';
    const timing = field === 'plannedDate' ? { timezone } : deadlineTiming(suffix, timezone);
    return timing ? { kind, timing } : undefined;
  };
  for (const match of quote.matchAll(/\b\d{4}-\d{2}-\d{2}/g)) {
    const assertion = deadlineAt(match.index, match[0].length);
    if (assertion) add(assertion.kind, match[0], assertion.timing);
  }
  const absoluteDates = [
    ...quote.matchAll(
      /\b(?:(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s+)?(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2})\b(?:,?\s+(\d{4})\b)?/gi,
    ),
  ];
  for (const match of absoluteDates) {
    const [, weekday, month, day, statedYear] = match;
    const assertion = deadlineAt(match.index, match[0].length);
    if (!assertion) continue;
    const { kind, timing } = assertion;
    const reference = referenceDate
      ? zonedDateTimeFromDate(referenceDate, timing.timezone)
      : undefined;
    let year = statedYear ? Number(statedYear) : reference?.year;
    if (year === undefined) continue;
    let date = new Date(`${month} ${day}, ${year} 00:00:00 UTC`);
    if (!Number.isFinite(date.getTime()) || date.getUTCDate() !== Number(day)) continue;
    if (
      !statedYear &&
      reference &&
      date.toISOString().slice(0, 10) < reference.toPlainDate().toString()
    ) {
      year++;
      date = new Date(`${month} ${day}, ${year} 00:00:00 UTC`);
      if (!Number.isFinite(date.getTime()) || date.getUTCDate() !== Number(day)) continue;
    }
    const weekdayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' });
    if (weekday && normalize(weekdayLabel.format(date)) !== normalize(weekday)) continue;
    add(kind, date.toISOString().slice(0, 10), timing);
  }
  if (referenceDate) {
    for (const match of quote.matchAll(
      /\b(?:today|tomorrow|next (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    )) {
      if (absoluteDates.some((date) => date.index === match.index)) continue;
      const assertion = deadlineAt(match.index, match[0].length);
      if (!assertion) continue;
      const { kind, timing } = assertion;
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
        ? zonedDateTimeFromDate(referenceDate, timing.timezone).dayOfWeek === weekday
          ? 'today'
          : `next ${phrase}`
        : phrase;
      const resolved = resolveTimePhrase(relative, { timezone: timing.timezone, referenceDate });
      if (resolved) add(kind, resolved.localStartDate, timing);
    }
  }
  return dates;
}
const lifecycleWords: Record<string, RegExp> = {
  doing: /\b(?:started|working on|in progress|empezado|trabajando|begonnen)\b/i,
  done: /\b(?:finished|(?:is|now|was|marked) complete|completed|done|delivered|shipped|verified (?:fixed|resolved)|valmis|terminada|terminado|completada|completado|abgeschlossen)\b/i,
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
    tentativeAssertion.test(
      normalize(clause)
        .replaceAll(normalize(subject), '[task]')
        .replaceAll(normalize(hubName), '[hub]'),
    ) ||
    hasEndpointAlternative(clause, [hubName]) ||
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

function hasEndpointAlternative(assertion: string, names: string[]): boolean {
  const statement = normalize(assertion);
  return (
    /\b(?:or|either|undecided)\b/i.test(statement) ||
    names.some((name) => {
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
  return subject
    .trim()
    .split(/\s+/)
    .filter(
      (word) => word && (word === 'A' || !['the', 'a', 'an', 'of'].includes(word.toLowerCase())),
    )
    .map((word) => word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join(
      allowRequestModifiers
        ? ' (?:of )?(?:the |a |an )?(?:separate |new )?'
        : ' (?:of )?(?:the |a |an )?',
    );
}

function mentionedProjectIds(
  clause: string,
  projects: readonly { id: string; name?: string; aliases?: string[] }[],
): Set<string> {
  const text = normalize(clause);
  const matches = projects.flatMap((project) =>
    [project.name, ...(project.aliases ?? [])].flatMap((name) => {
      if (!name?.trim()) return [];
      const literal = normalize(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return [
        ...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${literal}(?![\\p{L}\\p{N}])`, 'gu')),
      ].map((match) => ({ id: project.id, from: match.index, to: match.index + match[0].length }));
    }),
  );
  return new Set(
    matches
      .filter(
        (match) =>
          !matches.some(
            (other) =>
              other.from <= match.from &&
              other.to >= match.to &&
              (other.from < match.from || other.to > match.to),
          ),
      )
      .map((match) => match.id),
  );
}

function projectTaskSubject(subject: string, project: string): string {
  const name = normalize(subject);
  const suffix = ` for ${project}`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

function groupedProjectRequest(assertion: string, subject: string, projectName: string): boolean {
  const original = assertion.trim();
  const speaker =
    /^(?:\p{Lu}[\p{L}\p{M}'’-]* ){0,2}\p{Lu}[\p{L}\p{M}'’-]*:\s+(?=[Ff][Oo][Rr]\s)/u.exec(original);
  const statement = normalize(
    speaker && !/\b(?:example|hypothetical|scenario|template)\b/i.test(speaker[0])
      ? original.slice(speaker[0].length)
      : original,
  );
  if (/[.!?;]\s/u.test(statement)) return false;
  const project = normalize(projectName);
  const task = taskIdentityPattern(projectTaskSubject(subject, project), true);
  if (!project || !task) return false;
  const literalProject = project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const group = new RegExp(`^(?:separately, )?for (?:the )?${literalProject}[:,]\\s+`, 'iu').exec(
    statement,
  );
  if (!group) return false;
  const request = new RegExp(
    `^(?:(?:please|(?:i|we) (?:will|shall)|(?:i|we)[’']ll) )?${task}(?![\\p{L}\\p{N}])`,
    'iu',
  );
  return statement
    .slice(group[0].length)
    .split(/\s+and\s+|,\s*/u)
    .some((part) => request.test(part));
}

function affirmativeProjectMembership(
  assertion: string,
  subject: string,
  name: string,
  allowTaskRouting: boolean,
): boolean {
  const statement = normalize(assertion);
  const project = normalize(name);
  const task = taskIdentityPattern(
    allowTaskRouting ? projectTaskSubject(subject, project) : subject,
  );
  if (
    !project ||
    !task ||
    tentativeAssertion.test(statement.replaceAll(normalize(subject), '[task]')) ||
    /[?]|\b(?:not|no|never|unless|if|maybe|perhaps|unrelated|without|except|might|may|instead)\b/i.test(
      statement,
    )
  )
    return false;
  if (allowTaskRouting && groupedProjectRequest(assertion, subject, name)) return true;
  const predicate = allowTaskRouting ? projectRoutingTerms : projectMembershipTerms;
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

function deniedProjectMembership(assertion: string, subject: string, project: string): boolean {
  const text = normalize(assertion);
  const affirmative = text
    .replace(
      new RegExp(`\\b(?:is|was) (?:not|no longer) (?=${projectRoutingTerms}\\b)`, 'i'),
      'is ',
    )
    .replace(/\b(?:does not|no longer) belongs? to\b/i, 'belongs to');
  return affirmative !== text && affirmativeProjectMembership(affirmative, subject, project, true);
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
  const blockedUntil =
    status === 'blocked' && /^blocked until\b/i.test(clause) && namesTask(clause, subject);
  const assertion = blockedUntil ? 'blocked' : taskAssertion(clause, subject);
  if (!assertion) return false;
  if (!blockedUntil && !namesTask(clause, subject, true)) return false;
  const identity = normalize(subject);
  clause = identity ? normalize(assertion).replaceAll(identity, '[task]') : normalize(assertion);
  if (
    tentativeAssertion.test(clause) ||
    /[?]|\b(?:no longer|not|never|no|nobody|none|nothing|neither|nunca|jamás|tampoco|nicht|kein(?:e|en|em|er|es)?|ei|eivät|if|unless|[a-z]+n[’']t)\b/i.test(
      clause,
    )
  )
    return false;
  if (
    /(?<![\p{L}\p{N}])(?:estarán?|estarían?|serán?|serían?|van? a (?:estar|ser)|wird|werden|würden?|soll(?:en)?|könnten?|tulee olemaan|on tarkoitus)(?![\p{L}\p{N}])/iu.test(
      clause,
    )
  )
    return false;
  if (
    status === 'done' &&
    /\b(?:almost|nearly|partly|partially|half|not quite|being|in the process of|basically|practically|essentially)\b/i.test(
      clause,
    )
  )
    return false;

  if (
    /\b(?:will|shall|should|would|can|could|may|must|going to|able to|expected to|scheduled to|planned to|needs? to|has to|have to|supposed to)\s+(?:(?:not|never|soon|already|finally|eventually|definitely)\s+)*(?:(?:be|get)\s+|have\s+been\s+)?(?:(?:marked|declared|considered|reported|counted|treated)(?:\s+as)?\s+)?(?:finish(?:ed)?|complete[ds]?|done|delivered|shipped|verified (?:fixed|resolved)|sent|cancel(?:led|ed)?|archive[ds]?|start(?:ed)?|working on|in progress|blocked|reopen(?:ed)?|restart(?:ed)?|unblock(?:ed)?)\b/i.test(
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
    .replace(/\bwon['’]t\b/gi, 'will not')
    .replace(/\bcan['’]t\b/gi, 'can not')
    .replace(/\bshan['’]t\b/gi, 'shall not')
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

function affirmativeFieldClear(assertion: string, subject: string): boolean {
  const text = normalize(assertion).replaceAll(normalize(subject), '[task]');
  return (
    Boolean(text) &&
    !tentativeAssertion.test(text) &&
    !/[?]|\b(?:not|never|if|unless|[a-z]+n[’']t)\b/i.test(text)
  );
}

function explicitProjectClear(assertion: string, subject: string): boolean {
  return (
    affirmativeFieldClear(assertion, subject) &&
    /\b(?:remove|clear|unset) (?:the |its )?(?:primary )?project(?: assignment| association)?\b/i.test(
      assertion,
    )
  );
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
    emailEnvelopeSender?: string | null | undefined;
    occurredAt?: Date;
  }[];
  conversationEventIds?: readonly string[] | undefined;
  conversationTaskEvidence?:
    | {
        reports: readonly { taskId: string; rawEventId: string }[];
        plans: readonly { taskId: string; rawEventId: string }[];
      }
    | undefined;
  reviewedLaterEmailIds?: ReadonlySet<string> | undefined;
  emailChronologyLookahead?: readonly EmailChronologyStatement[] | undefined;
  members: { userId: string; name: string | null; email: string | null }[];
  hubs: { id: string; name: string; type: string; aliases?: string[] }[];
  source: string;
  timezone?: string;
  pendingNames?: string[];
  calendarTargets?: { id: string; title: string }[];
  verifiedLifecycleAuditIds?: Set<string>;
  verifiedPlannedDates?: Map<string, VerifiedClaim>;
  verifiedRelationships?: Map<string, GroundedRelationship>;
  verifiedTaskClaims?: Map<string, Partial<Record<MaintainedRecordField, VerifiedClaim>>>;
  objects?: { id: string; type: string; name?: string; aliases?: string[] }[];
}): Bundle<T>[] {
  const sourceIds = new Set(args.sources.map((source) => source.id));
  const chronology = chronologicalLifecycleEvidence([
    ...args.sources.map((source) => ({
      ...source,
      source: source.source ?? args.source,
      contentText: source.text,
    })),
    ...(args.emailChronologyLookahead ?? []).filter((event) => !sourceIds.has(event.id)),
  ]);
  const chronologyVetoIds = new Set([
    ...(args.reviewedLaterEmailIds ?? []),
    ...(args.emailChronologyLookahead ?? []).map((event) => event.id),
  ]);
  const emailStatementByQuote = new Map(
    (args.emailChronologyLookahead ?? []).map((statement) => [
      `${statement.id}:${statement.occurredAt.getTime()}:${normalize(statement.contentText)}`,
      statement,
    ]),
  );
  const packet = normalize(args.packet);
  const conversationSourceIds = args.conversationEventIds ?? [...sourceIds];
  const reportIdentities = new Map<string, { label: string; rawEventId: string }[]>();
  for (const report of args.conversationTaskEvidence?.reports ?? []) {
    const object = args.objects?.find((candidate) => candidate.id === report.taskId);
    const source = args.sources.find((candidate) => candidate.id === report.rawEventId);
    if (!object?.name || !source || !conversationSourceIds.includes(source.id)) continue;
    const quote = source.text.trim();
    const label = reportedWorkReference(object.name, quote);
    if (
      !label ||
      !safeSourceQuote(source.text, quote) ||
      !packet.includes(normalize(quote)) ||
      args.objects?.some(
        (candidate) =>
          candidate.id !== object.id &&
          isWorkRecord(candidate.type) &&
          [candidate.name, ...(candidate.aliases ?? [])].some(
            (name) => name && literalWorkReference(name, label),
          ),
      ) ||
      args.pendingNames?.some((name) => literalWorkReference(name, label))
    )
      continue;
    const references = reportIdentities.get(object.id) ?? [];
    references.push({ label, rawEventId: source.id });
    reportIdentities.set(object.id, references);
  }
  const stripTranscriptSpeaker = (text: string) => text.replace(/^\[\d+s\] [^:\r\n]+:\s*/, '');
  function enclosingAssertion(support: Support): string | undefined {
    const source = args.sources.find((event) => event.id === support.rawEventId);
    if (!source) return undefined;
    const enclosing = completeSourceAssertion(source.text, support.quote);
    return (
      enclosing && (source.source === 'meeting' ? stripTranscriptSpeaker(enclosing) : enclosing)
    );
  }
  function groupedProjectEvidence(
    subject: string,
    project: { id: string; name: string; aliases?: string[] },
  ): Support | undefined {
    const names = [project.name, ...(project.aliases ?? [])];
    for (const source of args.sources) {
      for (const sentence of source.text.split(/(?<=[.!?])\s+|\n+/u)) {
        const quote = sentence.trim();
        if (
          safeSourceQuote(source.text, quote) &&
          packet.includes(normalize(quote)) &&
          names.some(
            (name) =>
              groupedProjectRequest(quote, subject, name) &&
              affirmativeProjectMembership(quote, subject, name, true),
          )
        )
          return { field: 'project', rawEventId: source.id, quote, subject, value: project.id };
      }
    }
    return undefined;
  }
  function lifecycleVerified(support: Support, status: unknown, sendTask = false): boolean {
    const enclosing = enclosingAssertion(support);
    if (!enclosing) return false;
    if (status === 'cancelled' && explicitArchiveInstruction(support.quote, support.subject))
      return explicitArchiveInstruction(enclosing, support.subject);
    return [support.quote, enclosing].every((quote) =>
      affirmativeLifecycle(taskClause(quote, support.subject), support.subject, status, sendTask),
    );
  }
  function* assertionsFromCitation(support: Pick<Support, 'rawEventId' | 'quote' | 'subject'>) {
    const citedClause = taskClause(support.quote, support.subject);
    let from = -1;
    let assertionStart = 0;
    for (const quote of [citedClause, support.quote]) {
      if (!quote?.trim()) continue;
      const literal = quote
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\s+/g, '\\s+');
      const pattern = new RegExp(literal, 'iu');
      from = chronology.findIndex(
        (event) => event.id === support.rawEventId && pattern.test(event.contentText),
      );
      if (from >= 0) {
        assertionStart = pattern.exec(chronology[from]?.contentText ?? '')?.index ?? 0;
        break;
      }
    }
    if (from < 0) return;
    for (const [offset, event] of chronology.slice(from).entries()) {
      const text = offset === 0 ? event.contentText.slice(assertionStart) : event.contentText;
      for (const sentence of text.split(/(?<=[.!?])\s+|\n+/u)) {
        if (sentence.trim() && safeSourceQuote(event.contentText, sentence.trim()))
          yield {
            event,
            sentence:
              (event.source ?? args.source) === 'meeting'
                ? stripTranscriptSpeaker(sentence)
                : sentence,
            visible: packet.includes(normalize(sentence)),
          };
      }
    }
  }
  function lifecycleSuperseded(
    support: Support,
    names: string[],
    unambiguous: (identity: string) => boolean,
  ): boolean {
    let status: string | undefined = support.value;
    let found = false;
    const subjects = names.flatMap((name) => {
      const [action, ...artifact] = name.trim().split(/\s+/u);
      const identities =
        action && TASK_ACTIONS.has(action.toLowerCase()) ? [name, artifact.join(' ')] : [name];
      return identities.flatMap((identity) => {
        const pattern = taskIdentityPattern(identity);
        return pattern ? [new RegExp(`^(?:(?:the|la|el|die|der|das) )?${pattern}$`, 'iu')] : [];
      });
    });
    for (const { event, sentence, visible } of assertionsFromCitation(support)) {
      found = true;
      const admitted = visible || Boolean(event.id && chronologyVetoIds.has(event.id));
      if (
        admitted &&
        status === 'cancelled' &&
        names.some((name) => explicitArchiveRetraction(sentence, name))
      ) {
        status = undefined;
        continue;
      }
      const state = explicitLifecycleState(sentence);
      if (
        state &&
        (visible || (event.id && chronologyVetoIds.has(event.id))) &&
        subjects.some((subject) => subject.test(normalize(state.subject))) &&
        unambiguous(state.subject)
      ) {
        if (state.affirmative) status = state.status;
        else if (status === state.status) status = undefined;
      }
    }
    return !found || status !== support.value;
  }
  function taskDateVerified(
    support: Support,
    wanted: number | null,
    names: string[],
    unambiguous: (assertion: string) => boolean,
    contextVerified = false,
  ): boolean {
    const field = support.field === 'plannedDate' ? 'plannedDate' : 'dueAt';
    const dateIn = (
      assertion: string,
      subject: string,
      sourceId: string | undefined,
      quote: string,
      occurredAt?: Date,
    ) => {
      if (
        affirmativeFieldClear(assertion, subject) &&
        (field === 'plannedDate'
          ? /\b(?:remove|clear) (?:the )?planned date\b/i
          : /\b(?:remove|clear) (?:the )?deadline\b/i
        ).test(assertion)
      )
        return { affirmed: new Set<number | null>([null]), denied: new Set<number>() };
      const source = args.sources.find((row) => row.id === sourceId);
      const fallbackTimezone = args.timezone ?? 'UTC';
      const zone =
        field === 'plannedDate'
          ? plannedAssertionTimezone(assertion, fallbackTimezone)
          : fallbackTimezone;
      try {
        new Intl.DateTimeFormat('en', { timeZone: zone });
      } catch {
        return { affirmed: new Set<number | null>(), denied: new Set<number>() };
      }
      return taskDateAssertions(
        assertion,
        subject,
        zone,
        source
          ? deadlineReferenceDate(source, source.source ?? args.source, quote, assertion)
          : emailStatementByQuote.get(`${sourceId}:${occurredAt?.getTime()}:${normalize(quote)}`)
              ?.deadlineReferenceAt,
        field,
      );
    };
    const enclosing = enclosingAssertion(support);
    if (!enclosing) return false;
    const context = support.context;
    const correction =
      field === 'plannedDate' &&
      context &&
      contextVerified &&
      dateIn(
        supportedTaskAssertion({ ...support, quote: context.quote }) ??
          (CONTEXTUAL_TASK_PLAN.test(context.quote.trim()) ? context.quote : ''),
        support.subject,
        context.rawEventId,
        context.quote,
      ).affirmed.size === 1;
    for (const quote of new Set([support.quote, enclosing])) {
      const assertion =
        supportedTaskAssertion({ ...support, quote }) ??
        ((correction && CONVERSATIONAL_PLAN_CORRECTION.test(quote.trim())) ||
        (field === 'plannedDate' && contextVerified && CONTEXTUAL_TASK_PLAN.test(quote.trim()))
          ? quote.trim()
          : '');
      const cited = dateIn(assertion, support.subject, support.rawEventId, quote);
      if (cited.affirmed.size !== 1 || !cited.affirmed.has(wanted)) return false;
    }
    let latest: number | null | undefined = wanted;
    let priorPlan: { rawEventId: string; subject: string } | undefined;
    const visibleSourceOrder = conversationSourceIds;
    for (const { event, sentence, visible } of assertionsFromCitation(support)) {
      if (!visible && (!event.id || !chronologyVetoIds.has(event.id))) continue;
      const direct = names.find((name) => namesTask(sentence, name, true));
      const previousId = event.id
        ? visibleSourceOrder[visibleSourceOrder.indexOf(event.id) - 1]
        : undefined;
      const adjacent =
        field === 'plannedDate' &&
        !direct &&
        visible &&
        priorPlan &&
        priorPlan.rawEventId === previousId &&
        CONVERSATIONAL_PLAN_CORRECTION.test(sentence.trim());
      const subject = direct ?? (adjacent ? priorPlan?.subject : undefined);
      const assertion =
        subject &&
        (adjacent
          ? sentence.trim()
          : supportedTaskAssertion({ ...support, subject, quote: sentence }));
      if (!subject || !assertion || (!adjacent && !unambiguous(assertion))) {
        if (event.id !== priorPlan?.rawEventId) priorPlan = undefined;
        continue;
      }
      const dates = dateIn(assertion, subject, event.id, sentence, event.occurredAt);
      priorPlan =
        field === 'plannedDate' && visible && event.id && dates.affirmed.size === 1
          ? { rawEventId: event.id, subject }
          : undefined;
      if (dates.affirmed.size > 0)
        latest = dates.affirmed.size === 1 ? [...dates.affirmed][0] : undefined;
      else if (typeof latest === 'number' && dates.denied.has(latest)) latest = undefined;
    }
    return latest === wanted;
  }
  function assignmentProof(
    assignment: Support | undefined,
    member: (typeof args.members)[number] | undefined,
    hasTaskContext: boolean,
    compact?: EmailChronologyStatement,
  ) {
    const source = compact
      ? {
          text: compact.contentText,
          source: 'email',
          authorUserId: null,
          speakerContext: undefined,
          emailEnvelopeSender: compact.senderEmail ?? null,
        }
      : args.sources.find((source) => source.id === assignment?.rawEventId);
    const unsupported = {
      role: undefined,
      clearRole: undefined,
      verified: false,
      withdrawn: false,
    };
    if (!source || !assignment) return unsupported;
    const enclosing = completeSourceAssertion(source.text, assignment.quote);
    if (!enclosing) return unsupported;
    const expanded = packet.includes(normalize(enclosing));
    const quote = expanded ? enclosing : assignment.quote;
    const citedAssignment = taskClause(quote, assignment.subject);
    const originalClause = citedAssignment
      ? taskAssertion(citedAssignment, assignment.subject)
      : hasTaskContext
        ? assignment.quote
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
    const surrounding = expanded ? clause : enclosing;
    const escapedName = member?.name?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const name = escapedName
      ? `(?<![\\p{L}\\p{N}'’_-])${escapedName}(?![\\p{L}\\p{N}'’_-])`
      : undefined;
    const actor = name ? `(?:${name}|\\bI\\b)` : '\\bI\\b';
    const alternative = '(?:\\s+or\\s+|\\s*/\\s*)';
    const unresolvedOwner =
      surrounding &&
      new RegExp(
        `${actor}${alternative}|${alternative}${actor}|\\b(?:either|one of)\\s+(?:[^.!?;]{0,120}\\s+)?${actor}`,
        'iu',
      ).test(surrounding);
    const tentative =
      surrounding &&
      tentativeAssertion.test(
        normalize(surrounding).replaceAll(normalize(assignment.subject), '[task]'),
      );
    const delegation =
      /\b(?:ask(?:ed|ing)?|remind(?:ed|ing)?|tell(?:ing)?|request(?:ed|ing)?|assign(?:ed|ing)?|expect(?:ed|ing)?|allow(?:ed|ing)?)\b[^.!?;]{0,120}\bto\b/i;
    const matchesAssignedTask = (action: string) =>
      (namesTask(action, assignment.subject, true) &&
        (!delegation.test(action) ||
          normalize(action).startsWith(normalize(assignment.subject)))) ||
      (hasTaskContext &&
        (CONTEXTUAL_TASK_ACTION.test(action) ||
          /^(?:take(?: over)?|own|handle|do|pick up|be responsible for) (?:it|this(?: task)?|that(?: task)?|the task)(?: instead| now| from here| going forward)?[.!]?$/i.test(
            action.trim(),
          )));
    const namedAction =
      name && clause
        ? new RegExp(
            `(?:${name}\\s+(?:will|shall|owns|is responsible(?: for)?|to|revisará|preparará|hará|wird|übernimmt|tarkistaa)(?![\\p{L}\\p{N}])|${name},?\\s+please\\b)`,
            'iu',
          ).exec(clause)
        : null;
    const namedActionRemainder =
      clause && namedAction ? clause.slice(namedAction.index + namedAction[0].length) : undefined;
    const explicitAssignment =
      name && clause
        ? new RegExp(
            `\\b(?:re)?assign(?:ed)?\\b([^.!?]*?)${name}(?=\\s*(?:[.!?,]|$)|\\s+(?:for|to|as|by)\\b)`,
            'iu',
          ).exec(clause)
        : null;
    const passiveSubject = taskIdentityPattern(assignment.subject);
    const passiveAssignment =
      clause &&
      explicitAssignment &&
      passiveSubject &&
      /^(?:re)?assigned\s+to\s+/i.test(explicitAssignment[0]) &&
      new RegExp(
        `(?:^|\\s)${passiveSubject}(?: task)? (?:is|was|has been|had been) (?:now )?$`,
        'iu',
      ).test(normalize(clause.slice(0, explicitAssignment.index)) + ' ');
    const ownerAssertion =
      name && clause
        ? new RegExp(
            `${name}\\s+(?:remains|is(?: still)?) (?:the )?owner(?=\\s*(?:[.!?]|$)|\\s+(?:and|of|for)\\b)`,
            'iu',
          ).exec(clause)
        : null;
    const ownerTask =
      clause && ownerAssertion
        ? /^\s+(?:of|for)\s+(.+)$/i.exec(
            clause.slice(ownerAssertion.index + ownerAssertion[0].length),
          )
        : null;
    const confirmedOwner =
      ownerAssertion !== null && (ownerTask === null || matchesAssignedTask(ownerTask[1] ?? ''));
    const named =
      clause &&
      !unresolvedOwner &&
      !tentative &&
      !/\b(?:not|cannot|can't|declined|no|nicht|if|unless)\b/i.test(surrounding ?? clause) &&
      ((namedAction !== null &&
        !delegation.test(clause.slice(0, namedAction.index + namedAction[0].length)) &&
        matchesAssignedTask(clause.slice(namedAction.index + namedAction[0].length))) ||
        (explicitAssignment !== null &&
          matchesAssignedTask(
            (explicitAssignment[1] ?? '') +
              clause.slice(explicitAssignment.index + explicitAssignment[0].length),
          )) ||
        Boolean(passiveAssignment) ||
        confirmedOwner);
    const commitmentQuotes = [...assignment.quote.matchAll(/[^.!?]+[.!?]?/g)].flatMap((match) => {
      const start = firstPersonCommitment.exec(match[0]);
      return start && (namesTask(match[0], assignment.subject) || hasTaskContext)
        ? [match[0].slice(start.index).trim()]
        : [];
    });
    const commitment = commitmentQuotes.length === 1 ? commitmentQuotes[0] : undefined;
    const quoteAt = source.text.indexOf(assignment.quote);
    const commitmentAt = commitment && quoteAt >= 0 ? source.text.indexOf(commitment, quoteAt) : -1;
    const uniqueCommitment =
      commitment &&
      commitmentAt >= quoteAt &&
      commitmentAt >= 0 &&
      commitmentAt + commitment.length <= quoteAt + assignment.quote.length &&
      source.text.indexOf(commitment) === commitmentAt &&
      !source.text.includes(commitment, commitmentAt + 1);
    const headers = uniqueCommitment
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
          packet.includes(normalize(latestHeader[0].trim()))
        : source.emailEnvelopeSender === undefined
          ? source.speakerContext?.includes(`"senderHandle":${JSON.stringify(member.email)}`)
          : normalize(source.emailEnvelopeSender ?? '') === normalize(member.email)),
    );
    const selfAction = clause && firstPersonCommitment.exec(clause);
    const attributableSelf =
      member &&
      ((source.source ?? args.source) === 'email'
        ? emailSpeaker
        : source.authorUserId === member.userId &&
          uniqueCommitment &&
          isOriginalChatCommitment(source.text, commitmentAt, member.name));
    const self =
      clause &&
      !unresolvedOwner &&
      !tentative &&
      attributableSelf &&
      selfAction &&
      !assignmentDenial.test(selfAction[0]) &&
      matchesAssignedTask(clause.slice(selfAction.index + selfAction[0].length)) &&
      !/\b(?:if|unless|not|cannot|no|nunca|jamás|tampoco|nicht|kein(?:e|en|em|er|es)?)\b/i.test(
        surrounding ?? clause,
      );
    const namedDenial =
      name && clause
        ? new RegExp(`${name}\\s+${assignmentDenial.source}\\s+`, 'iu').exec(clause)
        : null;
    const namedDenialAction =
      clause && namedDenial ? clause.slice(namedDenial.index + namedDenial[0].length) : undefined;
    const explicitWithdrawal =
      name && clause
        ? new RegExp(`^(?:please )?(?:unassign|remove) ${name} from\\s+`, 'iu').exec(clause)
        : null;
    const selfDenial =
      attributableSelf && selfAction && clause
        ? assignmentDenial.test(selfAction[0])
          ? clause.slice(selfAction.index + selfAction[0].length)
          : /^\s*(?:not|never)\s+(.+)$/i.exec(
              clause.slice(selfAction.index + selfAction[0].length),
            )?.[1]
        : undefined;
    const withdrawn =
      clause &&
      !tentative &&
      !unresolvedOwner &&
      !/\b(?:if|unless)\b/i.test(surrounding ?? clause) &&
      ((namedDenialAction !== undefined && matchesAssignedTask(namedDenialAction)) ||
        (explicitWithdrawal !== null &&
          matchesAssignedTask(clause.slice(explicitWithdrawal[0].length))) ||
        (selfDenial !== undefined && matchesAssignedTask(selfDenial)));
    const role: AssignmentRole =
      confirmedOwner ||
      /\bowns\s*$/i.test(namedAction?.[0] ?? '') ||
      (Boolean(explicitAssignment) && /\bas (?:the )?owner\b/i.test(clause ?? '')) ||
      /^(?:own|take ownership of|be the owner)\b/i.test(
        (
          namedDenialAction ??
          selfDenial ??
          namedActionRemainder ??
          (selfAction && clause ? clause.slice(selfAction.index + selfAction[0].length) : '')
        ).trim(),
      )
        ? 'owner'
        : 'assignee';
    let clearRole: AssignmentRole | undefined;
    if (
      clause &&
      !unresolvedOwner &&
      affirmativeFieldClear(surrounding ?? clause, assignment.subject)
    ) {
      const clear = normalize(clause);
      if (
        /\b(?:remove|clear|unset|unassign) (?:the |its )?owner\b|\bowner\b (?:is |was |has been )?(?:removed|cleared|unassigned)\b/i.test(
          clear,
        )
      )
        clearRole = 'owner';
      else if (
        /\b(?:remove|clear|unset) (?:the |its )?assignee\b/i.test(clear) ||
        new RegExp(
          `^(?:please )?unassign (?:the )?${passiveSubject}(?![\\p{L}\\p{N}])|^(?:the )?${passiveSubject} (?:is |was |has been )(?:now )?unassigned\\b`,
          'iu',
        ).test(clear)
      )
        clearRole = 'assignee';
    }
    return {
      role,
      clearRole,
      verified:
        Boolean(member) && (Boolean(named) || Boolean(self)) && !assignment.quote.includes('?'),
      withdrawn: Boolean(withdrawn),
    };
  }
  function assignmentSuperseded(
    support: Support,
    role: AssignmentRole,
    names: string[],
    unambiguous: (assertion: string) => boolean,
  ): boolean {
    let latest: string | undefined = support.value;
    for (const { event, sentence, visible } of assertionsFromCitation(support)) {
      if (!event.id || (!visible && !chronologyVetoIds.has(event.id))) continue;
      const subject = names.find((name) => namesTask(sentence, name, true));
      if (!subject) continue;
      const assertion = taskClause(sentence, subject);
      if (!assertion || !unambiguous(assertion)) continue;
      const sentenceSupport = { ...support, subject, quote: sentence.trim(), rawEventId: event.id };
      const compact = emailStatementByQuote.get(
        `${event.id}:${event.occurredAt?.getTime()}:${normalize(sentence)}`,
      );
      if (assignmentProof(sentenceSupport, undefined, false, compact).clearRole === role)
        latest = 'unassigned';
      const owners: string[] = [];
      for (const member of args.members) {
        const proof = assignmentProof(sentenceSupport, member, false, compact);
        if (proof.role !== role) continue;
        if (proof.withdrawn && latest === member.userId) latest = undefined;
        if (proof.verified) owners.push(member.userId);
      }
      if (owners.length) latest = owners.length === 1 ? owners[0] : undefined;
    }
    return latest !== support.value;
  }
  function projectSuperseded(
    support: Support,
    wanted: string | null,
    names: string[],
    unambiguous: (assertion: string) => boolean,
    projects: { id: string; name: string; aliases?: string[] }[],
  ): boolean {
    let latest: string | null | undefined = wanted;
    for (const { event, sentence, visible } of assertionsFromCitation(support)) {
      if (!visible && (!event.id || !chronologyVetoIds.has(event.id))) continue;
      const subject = names.find((name) => namesTask(sentence, name, true));
      if (!subject) continue;
      const assertion = supportedTaskAssertion({ ...support, subject, quote: sentence });
      if (!assertion || !unambiguous(assertion)) continue;
      if (explicitProjectClear(assertion, subject)) {
        latest = null;
        continue;
      }
      const mentioned = mentionedProjectIds(assertion, projects);
      if (mentioned.size !== 1) continue;
      const selected = projects.find((project) => mentioned.has(project.id));
      if (!selected) continue;
      const projectNames = [selected.name, ...(selected.aliases ?? [])];
      if (hasEndpointAlternative(assertion, projectNames)) continue;
      if (projectNames.some((name) => affirmativeProjectMembership(assertion, subject, name, true)))
        latest = selected.id;
      else if (
        latest === selected.id &&
        projectNames.some((name) => deniedProjectMembership(assertion, subject, name))
      )
        latest = undefined;
    }
    return latest !== wanted;
  }
  return args.bundles.map((bundle) => {
    const validContexts = new Set<Support>();
    const projectCandidates = args.hubs.filter((hub) => hub.type === 'project');
    for (const candidate of bundle.items) {
      const name = candidate.proposedPayload.canonicalName;
      if (
        candidate.operation === 'create' &&
        candidate.proposedPayload.type === 'project' &&
        typeof name === 'string' &&
        !projectCandidates.some((project) => normalize(project.name) === normalize(name))
      )
        projectCandidates.push({ id: `new:${normalize(name)}`, type: 'project', name });
    }
    const reportReference = (item: Pick<Item, 'targetId'>, label: string) =>
      reportIdentities.get(item.targetId ?? '')?.find((entry) => entry.label === normalize(label));
    const taskIdentityNames = (
      item: Pick<Item, 'targetId' | 'title'> &
        Partial<Pick<Item, 'targetKind' | 'proposedPayload' | 'scopedSourceIdentity'>>,
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
      if (!target && item.scopedSourceIdentity) names.unshift(item.scopedSourceIdentity.name);
      if (!target || !isWorkRecord(target.type)) return names;
      return [
        ...names,
        ...(reportIdentities.get(target.id) ?? []).map((entry) => entry.label),
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
      item: Pick<Item, 'targetId' | 'title'> & Partial<Pick<Item, 'scopedSourceIdentity'>>,
      text: string,
      objects = args.objects ?? [],
    ) => {
      const names = taskIdentityNames(item, objects);
      const literal = (name: string) => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
      };
      const scoped = item.scopedSourceIdentity;
      const scopeIsCited = scoped?.scopeLabels.some(literal) ?? false;
      const competing = objects.filter(
        (object) =>
          isWorkRecord(object.type) &&
          object.id !== item.targetId &&
          object.name &&
          (Boolean(item.targetId) ||
            (scoped !== undefined && !scopeIsCited) ||
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
      if (reportReference(item, subject)) return literalWorkReference(text, subject);
      const target = args.objects?.find((object) => object.id === item.targetId);
      const alias = target?.aliases?.find((name) => normalize(name) === normalize(subject));
      if (!alias || normalize(target?.name ?? '') === normalize(subject))
        return namesTask(text, subject);
      if (!taskIdentityNames(item).includes(alias)) return false;
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text);
    };
    const hasAcceptedPriorPlan = (item: Pick<Item, 'targetId'>, rawEventId: string) => {
      const plans = args.conversationTaskEvidence?.plans.filter(
        (entry) => entry.rawEventId === rawEventId,
      );
      return plans?.length === 1 && plans[0]?.taskId === item.targetId;
    };
    const precedingSource = (rawEventId: string) => {
      const priorId = conversationSourceIds[conversationSourceIds.indexOf(rawEventId) - 1];
      return args.sources.find((row) => row.id === priorId);
    };
    const withPlanCorrectionContext = (item: T, support: Support): Support => {
      if (support.field !== 'plannedDate') return support;
      const source = args.sources.find((row) => row.id === support.rawEventId);
      const enclosing = enclosingAssertion(support);
      if (
        !source ||
        !enclosing ||
        !CONVERSATIONAL_PLAN_CORRECTION.test(enclosing) ||
        !safeSourceQuote(source.text, support.quote) ||
        !safeSourceQuote(source.text, enclosing) ||
        !packet.includes(normalize(enclosing))
      )
        return support;
      if (support.context) return { ...support, quote: enclosing };
      const prior = precedingSource(support.rawEventId);
      const quote = prior?.text.trim();
      if (
        !prior ||
        !quote ||
        quote.length > 800 ||
        !hasAcceptedPriorPlan(item, prior.id) ||
        !safeSourceQuote(prior.text, quote) ||
        !packet.includes(normalize(quote))
      )
        return support;
      return { ...support, quote: enclosing, context: { rawEventId: prior.id, quote } };
    };
    const verified = (item: T) => {
      if (
        args.conversationTaskEvidence &&
        item.operation === 'update' &&
        item.targetKind === 'task' &&
        !args.objects?.some((object) => object.id === item.targetId && isWorkRecord(object.type))
      )
        return [];
      return (item.grounding ?? [])
        .map((support) => withPlanCorrectionContext(item, support))
        .map((support) => {
          const names = taskIdentityNames(item);
          if (names.some((name) => normalize(name) === normalize(support.subject))) {
            const citedName = names.find((name) => namesTaskQuote(item, support.quote, name));
            const nearbyReference = names.find((name) => {
              const reference = reportReference(item, name);
              const context = support.context;
              return (
                reference &&
                context &&
                ((context.rawEventId === reference.rawEventId &&
                  literalWorkReference(context.quote, name)) ||
                  (support.field === 'plannedDate' &&
                    hasAcceptedPriorPlan(item, context.rawEventId) &&
                    (literalWorkReference(context.quote, name) ||
                      CONTEXTUAL_TASK_PLAN.test(context.quote.trim()))))
              );
            });
            if (citedName ?? nearbyReference) {
              support = { ...support, subject: citedName ?? nearbyReference ?? support.subject };
            }
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
          const prior = precedingSource(support.rawEventId);
          const context = support.context;
          const report = reportReference(item, support.subject);
          const contextIdentifiesTask = (quote: string, id: string) => {
            if (report) {
              const namesReport = literalWorkReference(quote, report.label);
              if (report.rawEventId === id) return namesReport;
              return (
                support.field === 'plannedDate' &&
                hasAcceptedPriorPlan(item, id) &&
                (namesReport || CONTEXTUAL_TASK_PLAN.test(quote.trim()))
              );
            }
            return (
              namesTask(quote, support.subject) &&
              new Set(
                [
                  ...(args.objects ?? [])
                    .filter((object) => object.type === 'task')
                    .map((object) => object.name),
                  ...(args.pendingNames ?? []),
                ].filter(
                  (name): name is string => typeof name === 'string' && namesTask(quote, name),
                ),
              ).size === 1
            );
          };
          const contextValid =
            context &&
            prior?.id === context.rawEventId &&
            safeSourceQuote(prior.text, context.quote) &&
            packet.includes(normalize(context.quote)) &&
            contextIdentifiesTask(context.quote, context.rawEventId);
          if (contextValid) validContexts.add(support);
          const isTask =
            item.targetKind === 'task' ||
            isWorkRecord(item.proposedPayload.type) ||
            args.objects?.some(
              (object) => object.id === item.targetId && isWorkRecord(object.type),
            );
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
              (Boolean(contextValid) &&
                ((support.field === 'assignee' && /\b(?:this|it|instead)\b/i.test(support.quote)) ||
                  (support.field === 'plannedDate' &&
                    (CONVERSATIONAL_PLAN_CORRECTION.test(support.quote) ||
                      CONTEXTUAL_TASK_PLAN.test(support.quote)))))) &&
            (item.targetKind === 'object_relationship' ||
              taskIdentityNames(item).some((name) =>
                isTask
                  ? normalize(name) === normalize(support.subject)
                  : namesTask(name, support.subject),
              ))
          );
        });
    };
    const uncertainty = new Set<string>();
    const extra: T[] = [];
    const items = bundle.items.flatMap((item, index) => {
      const supports = verified(item);
      const payload = { ...item.proposedPayload };
      const type =
        item.targetKind === 'task'
          ? 'task'
          : (args.objects?.find((object) => object.id === item.targetId)?.type ?? payload.type);
      if (item.operation === 'archive_or_cancel') {
        const cancellation = supports.find(
          (support) => support.field === 'status' && support.value === 'cancelled',
        );
        if (
          !cancellation ||
          !lifecycleVerified(cancellation, 'cancelled') ||
          lifecycleSuperseded(cancellation, taskIdentityNames(item), (identity) =>
            taskEvidenceUnambiguous(item, identity),
          )
        )
          return [];
        if (isWorkRecord(type)) payload.status = 'cancelled';
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
        const localEndpoint = (object: T, id: string) => ({
          id,
          aliases: [] as string[],
          type:
            object.targetKind === 'task'
              ? 'task'
              : typeof object.proposedPayload.type === 'string'
                ? object.proposedPayload.type
                : '',
          name:
            typeof object.proposedPayload.canonicalName === 'string'
              ? object.proposedPayload.canonicalName
              : object.title,
          scopedSourceIdentity: object.scopedSourceIdentity,
        });
        const endpoint = (side: 'from' | 'to') => {
          const id = payload[`${side}EntityId`];
          if (typeof id === 'string') {
            const object =
              args.objects?.find((object) => object.id === id) ??
              args.hubs.find((hub) => hub.id === id);
            return object?.name
              ? {
                  id,
                  name: object.name,
                  type: object.type,
                  aliases: object.aliases ?? [],
                  scopedSourceIdentity: undefined,
                }
              : null;
          }
          const ref = payload[`${side}Ref`];
          const object = bundle.items.find(
            (candidate) => candidate.proposedPayload.localRef === ref && typeof ref === 'string',
          );
          return object ? localEndpoint(object, String(ref)) : null;
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
            .map((candidate) =>
              localEndpoint(
                candidate,
                typeof candidate.proposedPayload.localRef === 'string'
                  ? candidate.proposedPayload.localRef
                  : '',
              ),
            ),
        ];
        const taskEndpointIdentity = (object: NonNullable<typeof from>) => ({
          title: object.name,
          targetId: object.scopedSourceIdentity ? undefined : object.id,
          scopedSourceIdentity: object.scopedSourceIdentity,
        });
        const namesEndpoint = (quote: string, object: NonNullable<typeof from>) =>
          object.type === 'task'
            ? taskEvidenceUnambiguous(taskEndpointIdentity(object), quote, known) &&
              taskIdentityNames(taskEndpointIdentity(object), known).some((name) =>
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
        const linkInstruction =
          /^(?:please )?(?:link|connect|relate|associate) (.+?) (?:to|with) (.+?)[.!]?$/i;
        const negativeLinkPrefix = /^(?:please )?(?:do not|don['’]t|never) /i;
        const unlinkInstruction =
          /^(?:please )?(?:unlink|disconnect|detach) (.+?) from (.+?)[.!]?$/i;
        const linkWasRetracted = (citation: Pick<Support, 'rawEventId' | 'quote' | 'subject'>) => {
          if (payload.kind !== 'related' || !from || !to) return false;
          const matchesName = (reference: string, object: NonNullable<typeof from>) =>
            [object.name, ...object.aliases].some((name) => {
              const label = normalize(name);
              return label === reference || `the ${label}` === reference;
            });
          let retracted = false;
          for (const { event, sentence, visible } of assertionsFromCitation(citation)) {
            if (!visible && (!event.id || !chronologyVetoIds.has(event.id))) continue;
            const command = normalize(sentence).replace(/^(?:actually|correction)[,:]? /i, '');
            const unlink = unlinkInstruction.exec(command);
            const match = unlink ?? linkInstruction.exec(command.replace(negativeLinkPrefix, ''));
            const left = match?.[1];
            const right = match?.[2];
            if (
              left &&
              right &&
              ((matchesName(left, from) && matchesName(right, to)) ||
                (matchesName(left, to) && matchesName(right, from)))
            ) {
              const negative = Boolean(unlink) || negativeLinkPrefix.test(command);
              if (negative || visible) retracted = negative;
            }
          }
          return retracted;
        };
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
                normalize(args.packet).includes(normalize(span)) &&
                !linkWasRetracted({ rawEventId: source.id, quote: span, subject: project.name })
              );
            });
          });
        };
        const grounded =
          from &&
          to &&
          linkSupports.some((support) => {
            const taskEndpoint = from.type === 'task' ? from : to.type === 'task' ? to : null;
            const taskName = taskEndpoint
              ? (taskIdentityNames(taskEndpointIdentity(taskEndpoint), known).find((name) =>
                  namesTask(support.quote, name),
                ) ?? taskEndpoint.name)
              : undefined;
            const assertion = taskEndpoint
              ? (taskClause(support.quote, taskName ?? taskEndpoint.name) ?? support.quote)
              : support.quote;
            const enclosing = enclosingAssertion(support);
            const linkStatement =
              enclosing && (completeSourceAssertion(enclosing, assertion) ?? enclosing);
            const deniedOrConditional =
              /[?]|\b(?:undecided|not|never|cannot|don['’]t|can['’]t|mustn['’]t|shouldn['’]t|won['’]t|unless|if|unrelated)\b/i;
            if (
              !linkStatement ||
              tentativeAssertion.test(
                normalize(linkStatement)
                  .replaceAll(normalize(from.name), '[endpoint]')
                  .replaceAll(normalize(to.name), '[endpoint]'),
              ) ||
              deniedOrConditional.test(linkStatement) ||
              deniedOrConditional.test(assertion) ||
              ![to.id, to.name, from.id, from.name, taskName].includes(support.value) ||
              (!taskEndpoint && /\bseparate\b/i.test(linkStatement)) ||
              linkWasRetracted(support)
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
              const membership = taskAssertion(assertion, taskName ?? from.name);
              if (!membership || !namesEndpoint(membership, from)) return false;
              const projects = mentionedProjectIds(
                membership,
                known.filter((candidate) => candidate.type === 'project'),
              );
              if (
                projects.size !== 1 ||
                !projects.has(to.id) ||
                hasEndpointAlternative(membership, [to.name, ...to.aliases])
              )
                return false;
              const fullSource = enclosingAssertion(support);
              const fullMembership =
                fullSource &&
                supportedTaskAssertion({
                  ...support,
                  subject: taskName ?? from.name,
                  quote: fullSource,
                });
              const selectedProject = projectCandidates.find(
                (candidate) =>
                  candidate.id === to.id || candidate.id === `new:${normalize(to.name)}`,
              );
              return (
                Boolean(fullMembership) &&
                [to.name, ...to.aliases].some(
                  (name) =>
                    namesEndpoint(name, to) &&
                    affirmativeProjectMembership(membership, taskName ?? from.name, name, false) &&
                    affirmativeProjectMembership(
                      fullMembership ?? '',
                      taskName ?? from.name,
                      name,
                      false,
                    ),
                ) &&
                !projectSuperseded(
                  support,
                  selectedProject?.id ?? to.id,
                  taskIdentityNames(taskEndpointIdentity(from), known),
                  (later) => namesEndpoint(later, from),
                  selectedProject ? projectCandidates : [...projectCandidates, to],
                )
              );
            }
            const link = linkInstruction.exec(assertion.trim());
            const exactEndpoint = (reference: string, object: NonNullable<typeof from>) =>
              (object.scopedSourceIdentity !== undefined &&
                [object.scopedSourceIdentity.name, `the ${object.scopedSourceIdentity.name}`].some(
                  (name) => normalize(name) === normalize(reference),
                ) &&
                namesEndpoint(assertion, object)) ||
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
              link &&
              payload.kind === 'related' &&
              ((exactEndpoint(link[1] ?? '', from) && exactEndpoint(link[2] ?? '', to)) ||
                (exactEndpoint(link[1] ?? '', to) && exactEndpoint(link[2] ?? '', from)))
            )
              return true;
            if (support.field === 'relationship') return false;
            const direct = namesEndpoint(assertion, from) && namesEndpoint(assertion, to);
            if (direct) {
              const company = from.type === 'company' ? from : to.type === 'company' ? to : null;
              const project = from.type === 'project' ? from : to.type === 'project' ? to : null;
              if (taskEndpoint) {
                const hub = from === taskEndpoint ? to : from;
                const identity = taskName ?? taskEndpoint.name;
                const association = taskAssertion(assertion, identity);
                if (!association || !namesEndpoint(association, taskEndpoint)) return false;
                const type = typeof hub.type === 'string' ? hub.type : '';
                return [hub.name, ...hub.aliases].some(
                  (name) =>
                    namesEndpoint(name, hub) &&
                    affirmativeTaskHub(association, identity, name, type) &&
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
                              affirmativeTaskHub(association, identity, otherName, type),
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
            const typedEndpoint = (name: string, object: NonNullable<typeof from>) => {
              const taskNoun = object.name
                .toLowerCase()
                .match(/[\p{L}\p{N}]+/gu)
                ?.at(-1);
              const type =
                object.type === 'task'
                  ? `(?:task|item|deliverable${taskNoun && taskNoun.length > 3 ? `|${taskNoun}` : ''})`
                  : object.type === 'company'
                    ? '(?:company|customer|client)'
                    : object.type === 'project'
                      ? 'project'
                      : null;
              return (
                type !== null && new RegExp(`^(?:the|this|that) ${type}$`, 'i').test(name.trim())
              );
            };
            const other = (support.quote.match(/[^.!?\n]+[.!?]?/g) ?? []).flatMap((sentence) => {
              const command = linkInstruction.exec(sentence.trim());
              if (!command?.[1] || !command[2]) return [];
              const [left, right] = [command[1], command[2]];
              if (
                (exactEndpoint(left, from) && typedEndpoint(right, to)) ||
                (exactEndpoint(right, from) && typedEndpoint(left, to))
              )
                return [to];
              if (
                (exactEndpoint(left, to) && typedEndpoint(right, from)) ||
                (exactEndpoint(right, to) && typedEndpoint(left, from))
              )
                return [from];
              return [];
            })[0];
            if (!other) return false;
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
        if (from && to && item.auditId) {
          args.verifiedRelationships?.set(item.auditId, {
            rawEventIds: [...new Set(supports.map((entry) => entry.rawEventId))],
            fromName: from.name,
            toName: to.name,
            payload: { ...payload },
          });
        }
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
      function verifiedClaim(support: Support, value: unknown): VerifiedClaim | undefined {
        if (value !== null && typeof value !== 'string') return undefined;
        const source = args.sources.find((row) => row.id === support.rawEventId);
        const assertedAt =
          source &&
          deadlineReferenceDate(source, source.source ?? args.source, support.quote, support.quote);
        if (!assertedAt) return undefined;
        const identity = reportReference(item, support.subject);
        return {
          rawEventId: support.rawEventId,
          ...(identity ? { identityRawEventId: identity.rawEventId } : {}),
          assertedAt: assertedAt.toISOString(),
          ...(support.context && validContexts.has(support)
            ? { contextRawEventId: support.context.rawEventId }
            : {}),
          value,
        };
      }
      const hubType =
        typeof type === 'string' && !isWorkRecord(type) && maintainedRecordFields(type).length > 0;
      const target = args.objects?.find((object) => object.id === item.targetId);
      const hubUnambiguous =
        hubType &&
        target?.name &&
        !args.objects?.some(
          (object) =>
            object.id !== target.id &&
            [object.name, ...(object.aliases ?? [])].some(
              (label) => label && normalize(label) === normalize(target.name ?? ''),
            ),
        );
      let renameClaim: VerifiedClaim | undefined;
      if (
        (hubUnambiguous || isWorkRecord(type)) &&
        item.operation === 'update' &&
        target?.name &&
        typeof payload.canonicalName === 'string' &&
        payload.canonicalName !== target.name
      ) {
        const rename = has('canonicalName', payload.canonicalName);
        const currentName = target.name;
        const renameState = (text: string) => {
          const match =
            /^(?:please )?(?:(do not|don['’]t|never) )?rename (.+?) to ["“](.+?)["”][.!]?$/iu.exec(
              text.trim(),
            );
          const name =
            match && normalize(match[2] ?? '') === normalize(currentName) ? match[3] : undefined;
          return name ? { name, denied: Boolean(match?.[1]) } : undefined;
        };
        const enclosing = rename && enclosingAssertion(rename);
        let latestName: string | null | undefined;
        if (rename) {
          for (const { event, sentence, visible } of assertionsFromCitation(rename)) {
            if (!visible && (!event.id || !chronologyVetoIds.has(event.id))) continue;
            const claim = renameState(sentence);
            if (!claim) continue;
            if (!claim.denied) latestName = claim.name;
            else if (
              latestName === claim.name ||
              (latestName === undefined && claim.name === payload.canonicalName)
            )
              latestName = null;
          }
        }
        const contradicted = latestName !== undefined && latestName !== payload.canonicalName;
        const quoted = rename && renameState(rename.quote);
        const full = enclosing ? renameState(enclosing) : undefined;
        if (
          rename &&
          quoted &&
          !quoted.denied &&
          quoted.name === payload.canonicalName &&
          full &&
          !full.denied &&
          full.name === payload.canonicalName &&
          !contradicted
        )
          renameClaim = verifiedClaim(rename, payload.canonicalName);
        if (!renameClaim && (isWorkRecord(type) || contradicted)) delete payload.canonicalName;
      }
      const currentName = target?.name;
      const createdName =
        item.operation === 'create' && typeof payload.canonicalName === 'string'
          ? payload.canonicalName
          : undefined;
      const stateName = hubUnambiguous ? currentName : createdName;
      if (hubType && typeof type === 'string' && stateName && item.auditId) {
        const claims: Partial<Record<MaintainedRecordField, VerifiedClaim>> = {};
        if (renameClaim) claims.canonicalName = renameClaim;
        for (const field of ['status', 'stage'] as const) {
          if (!maintainedRecordFields(type).includes(field)) continue;
          const proposed = payload[field];
          if (typeof proposed !== 'string') continue;
          const support = has(field, proposed);
          if (!support) continue;
          const wanted = field === 'stage' ? normalize(proposed) : proposed;
          const enclosing = enclosingAssertion(support);
          const quoted = recordState(support.quote, stateName, type, field);
          const full = enclosing ? recordState(enclosing, stateName, type, field) : undefined;
          let latest: string | null | undefined;
          for (const { event, sentence, visible } of assertionsFromCitation(support)) {
            if (!visible && (!event.id || !chronologyVetoIds.has(event.id))) continue;
            const claim = recordState(sentence, stateName, type, field);
            if (!claim) continue;
            if (!claim.denied) latest = claim.value;
            else if (latest === claim.value || (latest === undefined && claim.value === wanted))
              latest = null;
          }
          if (latest !== undefined && latest !== wanted) {
            if (field === 'status') delete payload.status;
            else delete payload.stage;
            continue;
          }
          if (
            quoted &&
            !quoted.denied &&
            quoted.value === wanted &&
            full &&
            !full.denied &&
            full.value === wanted
          ) {
            const claim = verifiedClaim(support, proposed);
            if (claim) claims[field] = claim;
          }
        }
        if (Object.keys(claims).length) args.verifiedTaskClaims?.set(item.auditId, claims);
      }
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
      if (isWorkRecord(type)) {
        const assignmentSupports = supports.filter((support) => support.field === 'assignee');
        const assignments = assignmentSupports.flatMap((support) => {
          const member = args.members.find((member) => member.userId === support.value);
          const proof = assignmentProof(support, member, validContexts.has(support));
          const role =
            support.value === 'unassigned'
              ? proof.clearRole
              : proof.verified
                ? proof.role
                : undefined;
          if (
            !role ||
            assignmentSuperseded(support, role, taskIdentityNames(item), (assertion) =>
              taskEvidenceUnambiguous(item, assertion),
            )
          )
            return [];
          return [{ role, member, value: support.value, support }];
        });
        const assignmentFields = [
          'assigneeUserId',
          'assigneeName',
          'ownerUserId',
          'ownerName',
        ] as const;
        // Legacy assignee-only proposals can cite explicit ownership when
        // the source supplies no separate assignment.
        if (
          !Object.hasOwn(payload, 'ownerUserId') &&
          !Object.hasOwn(payload, 'ownerName') &&
          !assignments.some((assignment) => assignment.role === 'assignee')
        ) {
          const fallback = assignments.filter(
            (assignment) =>
              assignment.role === 'owner' &&
              assignment.member !== undefined &&
              !assignmentSuperseded(
                assignment.support,
                'assignee',
                taskIdentityNames(item),
                (assertion) => taskEvidenceUnambiguous(item, assertion),
              ),
          );
          assignments.push(
            ...fallback.map((assignment) => ({ ...assignment, role: 'assignee' as const })),
          );
        }
        const assignees = new Set(
          assignments.flatMap(({ role, member }) =>
            role === 'assignee' && member ? [member.userId] : [],
          ),
        );
        // Only creates can infer an absent assignee from a uniquely supported
        // claim. Updates and repairs may have intentionally protected fields.
        if (
          item.operation === 'create' &&
          !item.targetId &&
          assignees.size === 1 &&
          new Set(assignmentSupports.map((support) => support.value)).size === 1 &&
          !assignmentFields.some((key) => Object.hasOwn(payload, key))
        ) {
          payload.assigneeUserId = [...assignees][0];
        }
        const claimFor = (key: (typeof assignmentFields)[number]) => {
          const role = key.startsWith('owner') ? 'owner' : 'assignee';
          return assignments.find(
            (assignment) =>
              assignment.role === role &&
              (payload[key] === null
                ? assignment.value === 'unassigned'
                : assignment.member !== undefined &&
                  payload[key] ===
                    (key.endsWith('UserId') ? assignment.member.userId : assignment.member.name)),
          );
        };
        if (!claimFor('assigneeUserId')) delete payload.assigneeUserId;
        if (!claimFor('assigneeName')) delete payload.assigneeName;
        if (!claimFor('ownerUserId')) delete payload.ownerUserId;
        if (!claimFor('ownerName')) delete payload.ownerName;
        const deadline = has('dueAt', payload.dueAt === null ? 'unset' : payload.dueAt);
        if (
          payload.dueAt !== undefined &&
          !(
            deadline &&
            (payload.dueAt === null || typeof payload.dueAt === 'string') &&
            taskDateVerified(
              deadline,
              payload.dueAt === null ? null : Date.parse(payload.dueAt),
              taskIdentityNames(item),
              (assertion) => taskEvidenceUnambiguous(item, assertion),
            )
          )
        )
          delete payload.dueAt;
        const plannedValue = payload.plannedDate;
        const plannedDate = has('plannedDate', plannedValue === null ? 'unset' : plannedValue);
        if (
          payload.plannedDate !== undefined &&
          (type !== 'task' ||
            !plannedDate ||
            !(
              plannedValue === null ||
              (typeof plannedValue === 'string' && z.iso.date().safeParse(plannedValue).success)
            ) ||
            !taskDateVerified(
              plannedDate,
              plannedValue === null ? null : Date.parse(plannedValue),
              taskIdentityNames(item),
              (assertion) => taskEvidenceUnambiguous(item, assertion),
              validContexts.has(plannedDate),
            ))
        )
          delete payload.plannedDate;
        if (item.auditId && plannedDate && payload.plannedDate !== undefined) {
          const evidence = verifiedClaim(plannedDate, payload.plannedDate);
          if (evidence) args.verifiedPlannedDates?.set(item.auditId, evidence);
          else delete payload.plannedDate;
        }
        const lifecycle = has('status', payload.status);
        const targetName =
          args.objects?.find((object) => object.id === item.targetId)?.name ??
          (typeof payload.canonicalName === 'string' ? payload.canonicalName : item.title);
        const supersededStatus =
          lifecycle &&
          lifecycleSuperseded(lifecycle, taskIdentityNames(item), (identity) =>
            taskEvidenceUnambiguous(item, identity),
          );
        const verifiedStatus =
          lifecycle &&
          (type !== 'follow_up' ||
            ['todo', 'doing', 'done', 'cancelled'].some((status) => status === payload.status)) &&
          lifecycleVerified(lifecycle, payload.status, /^(?:mark )?send\b/i.test(targetName)) &&
          !supersededStatus;
        if (verifiedStatus && item.auditId) args.verifiedLifecycleAuditIds?.add(item.auditId);
        if (
          payload.status !== undefined &&
          !(item.operation === 'create' && payload.status === 'todo') &&
          !verifiedStatus &&
          (type === 'task' || supersededStatus)
        )
          delete payload.status;
        if (item.auditId && args.verifiedTaskClaims) {
          const claims: Partial<Record<MaintainedRecordField, VerifiedClaim>> = {};
          if (renameClaim) claims.canonicalName = renameClaim;
          const assignment = claimFor('assigneeUserId');
          if (assignment && payload.assigneeUserId !== undefined) {
            const evidence = verifiedClaim(assignment.support, payload.assigneeUserId);
            if (evidence) claims.assigneeUserId = evidence;
          }
          if (deadline && payload.dueAt !== undefined) {
            const evidence = verifiedClaim(deadline, payload.dueAt);
            if (evidence) claims.dueAt = evidence;
          }
          if (verifiedStatus && payload.status !== undefined) {
            const evidence = verifiedClaim(lifecycle, payload.status);
            if (evidence) claims.status = evidence;
          }
          if (Object.keys(claims).length) args.verifiedTaskClaims.set(item.auditId, claims);
        }
        if (payload.parentObjectId === null) {
          const support = has('project', 'unset');
          const enclosing = support && enclosingAssertion(support);
          if (
            !support ||
            !enclosing ||
            ![support.quote, enclosing].every((quote) => {
              const clause = supportedTaskAssertion({ ...support, quote });
              return clause && explicitProjectClear(clause, support.subject);
            }) ||
            projectSuperseded(
              support,
              null,
              taskIdentityNames(item),
              (assertion) => taskEvidenceUnambiguous(item, assertion),
              projectCandidates,
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
            ) ??
            (selected && item.operation === 'create'
              ? groupedProjectEvidence(taskIdentityNames(item)[0] ?? item.title, selected)
              : undefined);
          const enclosedProjectNames = selected ? [selected.name, ...(selected.aliases ?? [])] : [];
          const projectClause = (support: Support) =>
            enclosedProjectNames.some((name) =>
              groupedProjectRequest(support.quote, support.subject, name),
            )
              ? support.quote
              : supportedTaskAssertion(support);
          const clause = projectSupport && projectClause(projectSupport);
          const enclosing = projectSupport && enclosingAssertion(projectSupport);
          const fullClause =
            projectSupport && enclosing && projectClause({ ...projectSupport, quote: enclosing });
          const projects = clause
            ? mentionedProjectIds(
                clause,
                args.hubs.filter((hub) => hub.type === 'project'),
              )
            : new Set<string>();
          const project =
            projects.size === 1 && selected && projects.has(selected.id) ? selected : undefined;
          const names = project ? [project.name, ...(project.aliases ?? [])] : [];
          if (
            !clause ||
            !fullClause ||
            project?.id !== payload.parentObjectId ||
            hasEndpointAlternative(clause, names) ||
            !names.some(
              (name) =>
                affirmativeProjectMembership(clause, projectSupport.subject, name, true) &&
                affirmativeProjectMembership(fullClause, projectSupport.subject, name, true),
            ) ||
            projectSuperseded(
              projectSupport,
              payload.parentObjectId,
              taskIdentityNames(item),
              (assertion) => taskEvidenceUnambiguous(item, assertion),
              projectCandidates,
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
          const enclosing = support && enclosingAssertion(support);
          const fullClause =
            support && enclosing && supportedTaskAssertion({ ...support, quote: enclosing });
          const projectId = `new:${normalize(name)}`;
          if (
            item.operation !== 'create' ||
            !support ||
            !clause ||
            !fullClause ||
            hasEndpointAlternative(clause, [name]) ||
            !affirmativeProjectMembership(clause, support.subject, name, true) ||
            !affirmativeProjectMembership(fullClause, support.subject, name, true) ||
            projectSuperseded(
              support,
              projectId,
              taskIdentityNames(item),
              (assertion) => taskEvidenceUnambiguous(item, assertion),
              projectCandidates.some((project) => project.id === projectId)
                ? projectCandidates
                : [...projectCandidates, { id: projectId, name }],
            )
          ) {
            delete payload.createProjectName;
            if (payload.parentObjectId === undefined) delete payload.projectName;
          }
        }
        const links = supports.filter((support) => {
          if (support.field !== 'customer') return false;
          const clause = supportedTaskAssertion(support);
          const enclosing = enclosingAssertion(support);
          const fullClause = enclosing && supportedTaskAssertion({ ...support, quote: enclosing });
          if (
            !clause ||
            !fullClause ||
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
          return (
            affirmativeTaskHub(clause, support.subject, customer.name, 'company') &&
            affirmativeTaskHub(fullClause, support.subject, customer.name, 'company')
          );
        });
        const ids = [...new Set(links.map((support) => support.value))];
        if (ids.length === 1 && item.operation === 'create') {
          const ref =
            typeof payload.localRef === 'string' ? payload.localRef : `grounded-task-${index}`;
          payload.localRef = ref;
          const auditId = item.auditId ? `${item.auditId}-customer-link` : undefined;
          const customer = args.hubs.find((hub) => hub.id === ids[0]);
          const relationshipPayload = { kind: 'related', fromRef: ref, toEntityId: ids[0] };
          if (auditId && customer) {
            args.verifiedRelationships?.set(auditId, {
              rawEventIds: [...new Set(links.map((entry) => entry.rawEventId))],
              fromName:
                typeof payload.canonicalName === 'string' ? payload.canonicalName : item.title,
              toName: customer.name,
              payload: relationshipPayload,
            });
          }
          extra.push({
            ...item,
            auditId,
            operation: 'create',
            targetKind: 'object_relationship',
            title: `${item.title}: customer`,
            proposedPayload: relationshipPayload,
          });
        }
      }
      // Internal grounding must never leak into user-editable canonical payloads.
      delete payload.grounding;
      const explicitArchive = supports.some(
        (support) =>
          support.field === 'status' &&
          support.value === 'cancelled' &&
          explicitArchiveInstruction(support.quote, support.subject),
      );
      const operation =
        isWorkRecord(type) && payload.status === 'cancelled'
          ? explicitArchive
            ? 'archive_or_cancel'
            : 'update'
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
