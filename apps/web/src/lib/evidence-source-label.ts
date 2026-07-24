export interface EvidenceSourceContext {
  source?: string | null;
  senderName?: string | null;
  senderHandle?: string | null;
  senderTimelineName?: string | null;
  conversationName?: string | null;
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

export function evidenceSourceLabel(source: string | null | undefined): string {
  if (!source) return 'captured work';
  const labels: Record<string, string> = {
    calendar: 'Calendar',
    email: 'Email',
    github: 'GitHub',
    meeting: 'meeting transcript',
    slack: 'Slack',
    telegram: 'Telegram',
    web: 'web capture',
  };
  return labels[source.toLowerCase()] ?? humanizeToken(source);
}

export function evidenceSourceContextLabel(evidence: EvidenceSourceContext): string {
  const source = evidenceSourceLabel(evidence.source);
  const sourceSenderParts = [evidence.senderName, evidence.senderHandle].filter(
    (part, index, parts): part is string => Boolean(part) && parts.indexOf(part) === index,
  );
  const sender =
    evidence.senderTimelineName &&
    evidence.senderTimelineName !== evidence.senderName &&
    sourceSenderParts.length > 0
      ? `${evidence.senderTimelineName} (${sourceSenderParts.join(', ')})`
      : sourceSenderParts.length > 1
        ? `${sourceSenderParts[0]} (${sourceSenderParts.slice(1).join(', ')})`
        : (evidence.senderTimelineName ?? sourceSenderParts[0] ?? null);
  if (sender && evidence.conversationName) {
    return `${sender} in ${evidence.conversationName} on ${source}`;
  }
  if (sender) return `${sender} on ${source}`;
  if (evidence.conversationName) return `${evidence.conversationName} on ${source}`;
  return source;
}
