import { parseCitations } from '#src/citation.js';

export type AgentPresentationProfile = 'web_rich' | 'external_chat';

export const EXTERNAL_CHAT_MAX_OUTPUT_TOKENS = 900;
export const EXTERNAL_CHAT_MAX_CHARACTERS = 4096;
const EXTERNAL_CHAT_LINE_BOUNDARY_WINDOW = 256;

export interface AgentPresentationInstructions {
  system: string;
  maxOutputTokens?: number;
}

export interface PresentedAgentAnswer {
  text: string;
  truncated: boolean;
  removedReferences: number;
}

const EXTERNAL_CHAT_INSTRUCTIONS = `PRESENTATION FOR EXTERNAL CHAT:
Lead with the answer. For a normal response, use one short paragraph or 3–5 bullets and target about 120 words. Include only high-signal information, prioritizing actions, dates, blockers, and decisions. Skip introductory phrases, exhaustive evidence lists, and unnecessary headings. If the user explicitly asks for more detail or a full breakdown, you may expand within the external-chat output limit. Continue to include the required inline Timeline citations for internal grounding; the delivery layer removes them. Do not explain citation syntax or expose internal ids. Do not add a sources section or generic source link.`;

const WEB_RICH_INSTRUCTIONS = `PRESENTATION FOR WEB CHAT:
Give a complete, source-linked answer. Use clear sections, bullets, or tables when they materially improve comprehension, and do not omit important context merely to shorten the response. Keep Timeline citations inline so the web interface can render them as inspectable source links.`;

const RESIDUAL_TIMELINE_REFERENCE_RE =
  /\[(?:board-item|ev|ent|note|cal|board|task|fact|rel|chg|doc|route):[^\]\r\n]{1,256}\]/gi;
const RAW_EVENT_ID = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const TIMELINE_REFERENCE_ID = `(?:${RAW_EVENT_ID}|[0-9a-f]{8})`;
const UNBALANCED_OPEN_TIMELINE_REFERENCE_RE =
  /\[(?:board-item|ev|ent|note|cal|board|task|fact|rel|chg|doc|route):[^\s\[\],.!?;)]+/gi;
const UNBALANCED_CLOSE_TIMELINE_REFERENCE_RE =
  /(?<![\w[])(?:board-item|ev|ent|note|cal|board|task|fact|rel|chg|doc|route):[^\s\[\],.!?;)]+\]/gi;
const NAKED_TIMELINE_REFERENCE_RE = new RegExp(
  `(?<![\\w[:])(?:(?:board-item|ev|ent|note|cal|board|task|fact|rel|chg):${TIMELINE_REFERENCE_ID}|doc:${TIMELINE_REFERENCE_ID}#v\\d+:chunk:${TIMELINE_REFERENCE_ID}|route:[a-z][a-z0-9_/-]{0,80})`,
  'gi',
);
const RAW_EVENT_REFERENCE_RE = new RegExp(
  `\\braw[ _-]*event(?:[ _-]*id)?\\s*[:=#-]?\\s*${RAW_EVENT_ID}\\b`,
  'gi',
);
const RAW_EVENT_URL_RE = new RegExp(
  `(?:https?:\\/\\/(?:[a-z0-9-]+\\.)*thetimeline\\.cc(?::\\d+)?|\\/)[^\\s)\\]]{0,512}#ev-${RAW_EVENT_ID}\\b`,
  'gi',
);
const REMOVED_REFERENCE_MARKER = '\uE000';
const HOSTILE_INSTRUCTION_RE =
  /\b(ignore (?:prior|previous) instructions|act as|forget (?:the )?rules|reveal (?:your )?prompt|system prompt)\b/i;

export function resolveAgentPresentation(deliverySurface: string): AgentPresentationProfile {
  return deliverySurface === 'web' ? 'web_rich' : 'external_chat';
}

export function presentationInstructions(
  presentation: AgentPresentationProfile,
): AgentPresentationInstructions {
  return presentation === 'web_rich'
    ? { system: WEB_RICH_INSTRUCTIONS }
    : {
        system: EXTERNAL_CHAT_INSTRUCTIONS,
        maxOutputTokens: EXTERNAL_CHAT_MAX_OUTPUT_TOKENS,
      };
}

function stripMarkdownEmphasis(text: string): string {
  return text
    .replace(/(^|[^\w*])\*\*\*([^\n*]+?)\*\*\*(?=$|[^\w*])/g, '$1$2')
    .replace(/(^|[^\w*])\*\*([^\n*]+?)\*\*(?=$|[^\w*])/g, '$1$2')
    .replace(/(^|[^\w_])__([^\n_]+?)__(?=$|[^\w_])/g, '$1$2')
    .replace(/(^|[^\w*])\*([^\n*]+?)\*(?=$|[^\w*])/g, '$1$2')
    .replace(/(^|[^\w_])_([^\n_]+?)_(?=$|[^\w_])/g, '$1$2');
}

function removeExternalInstructionReferences(text: string): string {
  return text
    .split('\n')
    .filter((line) => !HOSTILE_INSTRUCTION_RE.test(line))
    .join('\n');
}

function stripTimelineReferences(text: string): { text: string; removedReferences: number } {
  const parts = parseCitations(text);
  let removedReferences = parts.filter((part) => part.type !== 'text').length;
  let withoutReferences = parts
    .map((part) => (part.type === 'text' ? part.value : REMOVED_REFERENCE_MARKER))
    .join('');

  withoutReferences = withoutReferences.replace(RESIDUAL_TIMELINE_REFERENCE_RE, () => {
    removedReferences += 1;
    return REMOVED_REFERENCE_MARKER;
  });
  withoutReferences = withoutReferences.replace(UNBALANCED_OPEN_TIMELINE_REFERENCE_RE, () => {
    removedReferences += 1;
    return REMOVED_REFERENCE_MARKER;
  });
  withoutReferences = withoutReferences.replace(UNBALANCED_CLOSE_TIMELINE_REFERENCE_RE, () => {
    removedReferences += 1;
    return REMOVED_REFERENCE_MARKER;
  });
  withoutReferences = withoutReferences.replace(NAKED_TIMELINE_REFERENCE_RE, () => {
    removedReferences += 1;
    return REMOVED_REFERENCE_MARKER;
  });
  withoutReferences = withoutReferences.replace(RAW_EVENT_REFERENCE_RE, () => {
    removedReferences += 1;
    return REMOVED_REFERENCE_MARKER;
  });
  withoutReferences = withoutReferences.replace(RAW_EVENT_URL_RE, () => {
    removedReferences += 1;
    return REMOVED_REFERENCE_MARKER;
  });
  return { text: withoutReferences, removedReferences };
}

function cleanRemovedReferenceArtifacts(line: string): string {
  if (!line.includes(REMOVED_REFERENCE_MARKER)) return line.trimEnd();

  const leadingWhitespace = /^[ \t]*/.exec(line)?.[0] ?? '';
  const content = line.slice(leadingWhitespace.length);
  const marker = REMOVED_REFERENCE_MARKER;
  const cleaned = content
    .replace(new RegExp(`\\(\\s*(?:${marker}\\s*)+\\)`, 'g'), marker)
    .replace(new RegExp(`\\[\\s*(?:${marker}\\s*)+\\]`, 'g'), marker)
    .replace(new RegExp(`\\{\\s*(?:${marker}\\s*)+\\}`, 'g'), marker)
    .replace(
      new RegExp(`[ \\t]+\\b(?:and|or)[ \\t]+(?=(?:${marker}[ \\t]*)+(?:[.,!?;:]|$))`, 'gi'),
      '',
    )
    .replace(
      new RegExp(`[ \\t]*(?:${marker}[ \\t]*)+`, 'g'),
      (match: string, offset: number, source: string) => {
        const before = source[offset - 1];
        const after = source[offset + match.length];
        if (!before || !after || /[([{]/.test(before) || /[.,!?;:)\]}]/.test(after)) return '';
        return ' ';
      },
    )
    .trimEnd();

  return `${leadingWhitespace}${cleaned}`;
}

function plainTextForExternalChat(text: string): string {
  const plain = stripMarkdownEmphasis(
    text
      .replace(/\r\n?/g, '\n')
      .replace(/^```[^\n]*\n?/gm, '')
      .replace(/^```$/gm, '')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/<([^>|]+)\|([^>]+)>/g, '$2 ($1)')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, ''),
  )
    .split('\n')
    .map(cleanRemovedReferenceArtifacts)
    .filter((line) => !/^\s*[-*+]\s*[.,!?;:]?\s*$/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return plain;
}

function truncateExternalAnswer(text: string): { text: string; truncated: boolean } {
  if (text.length <= EXTERNAL_CHAT_MAX_CHARACTERS) return { text, truncated: false };
  const end = EXTERNAL_CHAT_MAX_CHARACTERS - 1;
  const lineBoundary = text.lastIndexOf('\n', end);
  const cutAt = lineBoundary >= end - EXTERNAL_CHAT_LINE_BOUNDARY_WINDOW ? lineBoundary : end;
  return { text: `${text.slice(0, cutAt).trimEnd()}…`, truncated: true };
}

export function formatAgentAnswerForPresentation(
  answer: string,
  presentation: AgentPresentationProfile,
): PresentedAgentAnswer {
  if (presentation === 'web_rich') {
    return { text: answer.trim(), truncated: false, removedReferences: 0 };
  }

  const safeAnswer = removeExternalInstructionReferences(answer).trim();
  const stripped = stripTimelineReferences(safeAnswer);
  const formatted = plainTextForExternalChat(stripped.text);
  const limited = truncateExternalAnswer(formatted);
  return { ...limited, removedReferences: stripped.removedReferences };
}
