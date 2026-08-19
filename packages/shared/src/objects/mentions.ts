export const AGENT_DISPLAY_NAME = 'The Timeline Bot';
export const AGENT_INSERT_TOKEN = 'TheTimelineBot';

const AGENT_MENTION_ALIASES = ['timeline', 'bot', 'agent', 'thetimelinebot'] as const;

const MENTION_TOKEN_RE = /@([A-Za-z0-9._-]+)/g;
const AGENT_ALIAS_SET = new Set<string>(AGENT_MENTION_ALIASES);

export interface MentionMember {
  userId: string;
  name: string;
  email: string;
}

export type ParsedMention =
  | {
      kind: 'user';
      userId: string;
      token: string;
      startOffset: number;
      endOffset: number;
    }
  | {
      kind: 'agent';
      token: string;
      startOffset: number;
      endOffset: number;
    };

function compactMentionName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '');
}

function mentionFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

export function mentionInsertToken(member: MentionMember, members: MentionMember[]): string {
  const first = mentionFirstName(member.name);
  const firstLower = first.toLowerCase();
  const firstIsUnique =
    firstLower.length > 0 &&
    members.filter((candidate) => mentionFirstName(candidate.name).toLowerCase() === firstLower)
      .length === 1;
  return firstIsUnique ? first : compactMentionName(member.name);
}

function emailLocalPart(email: string): string {
  return email.split('@')[0]?.trim() ?? '';
}

function resolveMember(token: string, members: MentionMember[]): MentionMember | null {
  const lower = token.toLowerCase();
  const compactHits = members.filter(
    (member) => compactMentionName(member.name).toLowerCase() === lower,
  );
  if (compactHits.length === 1) return compactHits[0] ?? null;

  const firstHits = members.filter(
    (member) => mentionFirstName(member.name).toLowerCase() === lower,
  );
  if (firstHits.length === 1) return firstHits[0] ?? null;
  if (firstHits.length > 1) return null;

  const emailHits = members.filter(
    (member) => emailLocalPart(member.email).toLowerCase() === lower,
  );
  if (emailHits.length === 1) return emailHits[0] ?? null;

  if (lower.length < 2) return null;
  const prefixHits = members.filter((member) => {
    const first = mentionFirstName(member.name).toLowerCase();
    const compact = compactMentionName(member.name).toLowerCase();
    return first.startsWith(lower) || compact.startsWith(lower);
  });
  return prefixHits.length === 1 ? (prefixHits[0] ?? null) : null;
}

export function parseMentions(body: string, members: MentionMember[]): ParsedMention[] {
  const mentions: ParsedMention[] = [];
  const seenUsers = new Set<string>();
  let seenAgent = false;
  for (const match of body.matchAll(MENTION_TOKEN_RE)) {
    const token = match[1];
    if (!token) continue;
    const startOffset = match.index;
    const endOffset = startOffset + match[0].length;
    const lower = token.toLowerCase();
    if (AGENT_ALIAS_SET.has(lower)) {
      if (seenAgent) continue;
      seenAgent = true;
      mentions.push({ kind: 'agent', token, startOffset, endOffset });
      continue;
    }
    const resolved = resolveMember(token, members);
    if (!resolved || seenUsers.has(resolved.userId)) continue;
    seenUsers.add(resolved.userId);
    mentions.push({
      kind: 'user',
      userId: resolved.userId,
      token,
      startOffset,
      endOffset,
    });
  }
  return mentions;
}

export function actorDisplayName(
  authorUserId: string | null,
  members: MentionMember[],
  fallback = 'Someone',
): string {
  if (!authorUserId) return AGENT_DISPLAY_NAME;
  const member = members.find((candidate) => candidate.userId === authorUserId);
  const name = member?.name.trim();
  if (name) return name;
  const local = member ? emailLocalPart(member.email) : '';
  return local || fallback;
}

export function isAgentMentionToken(token: string): boolean {
  return AGENT_ALIAS_SET.has(token.toLowerCase());
}
