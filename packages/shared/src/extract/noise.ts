import type { EntityMention, ExtractedFact } from '#src/extract/schema.js';

const MESSAGE_MECHANIC_PATTERNS = [
  /\b(?:shared|sent|posted|forwarded|pasted|dropped)\b.+\b(?:link|url|post|tweet|file|attachment|screenshot|image|photo)\b/i,
  /\b(?:reacted to|liked)\b.+\b(?:message|post|tweet|thread|comment|reply|link|url)\b/i,
];

const LOW_SIGNAL_ANY_TYPE_OBJECT_NAMES = new Set([
  'browserbased',
  'calendar',
  'clock',
  'drive',
  'excel',
  'finder',
  'finlex',
  'finnishtaxadministration',
  'github',
  'googledrive',
  'googlemeet',
  'helsinki',
  'kila',
  'link',
  'linkedin',
  'meet',
  'post',
  'slack',
  'sweden',
  'taxadministration',
  'taxauthorities',
  'taxauthority',
  'telegram',
  'tiktok',
  'tweet',
  'twitter',
  'url',
  'vero',
  'verottaja',
  'whatsapp',
  'x',
  'youtube',
  'zoom',
]);

const LOW_SIGNAL_TYPED_OBJECT_NAMES = new Set([
  'bigfour',
  'companyfinancialdata',
  'customerrelationships',
  'financialdata',
]);

const GENERIC_TOPIC_HEADS = new Set([
  'cost',
  'costs',
  'data',
  'details',
  'info',
  'information',
  'link',
  'links',
  'post',
  'posts',
  'relationships',
  'summary',
  'url',
  'urls',
]);

const GENERIC_CATEGORY_TAILS = new Set([
  'apps',
  'categories',
  'companies',
  'firms',
  'industries',
  'industry',
  'markets',
  'platforms',
  'providers',
  'sectors',
  'software',
  'systems',
  'tools',
  'vendors',
]);

const GENERIC_DURABLE_WORDS = new Set(['saas']);
const GENERIC_COMPANY_CATEGORY_MODIFIERS = new Set([
  'ai',
  'audit',
  'equity',
  'health',
  'healthcare',
  'pe',
  'private',
  'robotics',
  'saas',
]);

function normalizeObjectName(value: string): string {
  return value
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/\b(inc|llc|ltd|oy|corp|corporation|company|co|gmbh|plc)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function hasDurableNameSignal(value: string): boolean {
  const words = value.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const hasDurableWord = words.some((word) => {
    if (GENERIC_DURABLE_WORDS.has(word.toLowerCase())) return false;
    return /\b[A-Z]{3,}\b/.test(word) || /\b[A-Z][a-z]+[A-Z][A-Za-z]*\b/.test(word);
  });
  return (
    /\b(?:q[1-4]|h[1-2]|fy)\d{0,4}\b/i.test(value) ||
    /\d/.test(value) ||
    /\b(?:for|with)\s+[A-Z][a-z]{2,}\b/.test(value) ||
    hasDurableWord
  );
}

export function isLowSignalObjectName(input: { name: string; type?: string }): boolean {
  const name = input.name.trim();
  if (!name) return true;
  const type = input.type;
  const normalized = normalizeObjectName(name);
  if (!normalized) return true;
  if (LOW_SIGNAL_ANY_TYPE_OBJECT_NAMES.has(normalized)) return true;
  if (type && !['company', 'vendor', 'topic', 'other'].includes(type)) return false;
  if (LOW_SIGNAL_TYPED_OBJECT_NAMES.has(normalized)) return true;
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const last = words.at(-1);
  if (hasDurableNameSignal(name)) return false;
  if (last && GENERIC_CATEGORY_TAILS.has(last)) {
    if (type === 'company' || type === 'vendor') {
      const modifiers = words.slice(0, -1);
      return (
        modifiers.length > 0 &&
        modifiers.every((modifier) => GENERIC_COMPANY_CATEGORY_MODIFIERS.has(modifier))
      );
    }
    return true;
  }
  if (
    (type === 'topic' || type === 'other') &&
    words.length <= 5 &&
    /\b(?:in|for|with)\b/i.test(name)
  ) {
    return true;
  }
  return (
    (type === 'topic' || type === 'other') &&
    words.length <= 4 &&
    Boolean(last && GENERIC_TOPIC_HEADS.has(last))
  );
}

export function isLowSignalEntityMention(mention: EntityMention): boolean {
  return isLowSignalObjectName(mention);
}

export function isNoisyExtractedFact(fact: ExtractedFact): boolean {
  const statement = fact.statement.trim();
  if (!statement) return true;
  return MESSAGE_MECHANIC_PATTERNS.some((pattern) => pattern.test(statement));
}
