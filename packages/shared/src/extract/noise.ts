import type { ExtractedFact } from '#src/extract/schema.js';

const MESSAGE_MECHANIC_PATTERNS = [
  /\b(?:shared|sent|posted|forwarded|pasted|dropped)\b.+\b(?:link|url|post|tweet|file|attachment|screenshot|image|photo)\b/i,
  /\b(?:reacted to|liked)\b.+\b(?:message|post|tweet|thread|comment|reply|link|url)\b/i,
];

export function isNoisyExtractedFact(fact: ExtractedFact): boolean {
  const statement = fact.statement.trim();
  if (!statement) return true;
  return MESSAGE_MECHANIC_PATTERNS.some((pattern) => pattern.test(statement));
}
