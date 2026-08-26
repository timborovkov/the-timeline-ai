import type { PublicDocument, PublicDocumentRegistry } from '@/lib/public-site';

import { PUBLIC_DOCUMENT_REGISTRY, canonicalPublicUrl } from '@/lib/public-site';
import { getSiteUrl } from '@/lib/site-url';

interface LlmsTextOptions {
  registry?: PublicDocumentRegistry;
  siteUrl?: string;
}

const PRODUCT_SUMMARY =
  'The Timeline is an AI team memory product that preserves selected work as a chronological project history and answers questions with citations to the original sources.';

const KEYWORDS = [
  'AI team memory',
  'project history',
  'organizational memory',
  'client project handoffs',
  'weekly project updates',
  'CRM context from team activity',
  'meeting transcript search',
  'Slack knowledge base',
  'cited AI answers',
  'document citation search',
];

const CONTRIBUTED_LLM_SECTIONS = [
  { section: 'solutions', heading: 'Solutions' },
  { section: 'integrations', heading: 'Integrations' },
  { section: 'how-it-works', heading: 'How Timeline works' },
] as const;

function link(
  document: PublicDocument,
  description: string,
  siteUrl: string,
  label = document.llms ? (document.llms.label ?? document.title) : document.title,
): string {
  return `- [${escapeLinkText(label)}](${canonicalPublicUrl(siteUrl, document.canonicalPath)}): ${escapeInline(description)}`;
}

export function buildLlmsTxt(options: LlmsTextOptions = {}): string {
  const registry = options.registry ?? PUBLIC_DOCUMENT_REGISTRY;
  const siteUrl = options.siteUrl ?? getSiteUrl();
  const primaryLinks = registry
    .forLlms('primary')
    .map((document) => link(document, llmsContent(document).summary, siteUrl));
  const helpLinks = registry
    .forLlms('product-guides')
    .map((document) => link(document, llmsContent(document).summary, siteUrl));
  const companionLinks = registry
    .forLlms('companion')
    .map((document) => link(document, llmsContent(document).summary, siteUrl));
  const contributedLinks = CONTRIBUTED_LLM_SECTIONS.flatMap(({ section, heading }) =>
    renderLinkSection(heading, registry.forLlms(section), siteUrl),
  );
  return [
    '# The Timeline',
    '',
    PRODUCT_SUMMARY,
    '',
    'Teams deliberately send work to Timeline or select provider records to preserve. That work becomes a chronological project history; cited answers retain source, time, and visibility, and suggested durable workspace changes require human approval.',
    '',
    '## Primary pages',
    ...primaryLinks,
    '',
    '## Product guides',
    ...helpLinks,
    '',
    ...contributedLinks,
    '## LLM-ready companion',
    ...companionLinks,
    '',
    '## Keywords and concepts',
    KEYWORDS.map((keyword) => `- ${keyword}`).join('\n'),
    '',
    '## Crawler guidance',
    '- Public marketing, help, support, legal, llms.txt, llms-full.txt, robots.txt, and sitemap.xml pages may be crawled.',
    '- Signed-in app routes, auth routes, invite routes, and API routes are not useful public sources and are marked private or noindex.',
    '- Prefer the public help pages and llms-full.txt for concise descriptions over parsing signed-in product routes.',
    '',
  ].join('\n');
}

export function buildLlmsFullTxt(options: LlmsTextOptions = {}): string {
  const registry = options.registry ?? PUBLIC_DOCUMENT_REGISTRY;
  const siteUrl = options.siteUrl ?? getSiteUrl();
  const landing = requiredDocument(registry, '/');
  const helpIndex = requiredDocument(registry, '/help');
  const guides = registry.forLlms('product-guides');
  const supportAndLegal = registry
    .forLlms('primary')
    .filter((document) => ['support', 'legal', 'trust'].includes(document.kind));
  const contributedSections = CONTRIBUTED_LLM_SECTIONS.flatMap(({ section, heading }) =>
    renderFullDocumentSection(heading, registry.forLlms(section), siteUrl),
  );
  return [
    '# The Timeline',
    '',
    PRODUCT_SUMMARY,
    '',
    'Teams deliberately send work to Timeline or select provider records to preserve. Timeline keeps that evidence as a chronological project history, answers questions with source citations, and leaves suggested durable workspace changes pending until a person approves them.',
    '',
    '## Canonical URLs',
    link(landing, llmsContent(landing).fullSummary ?? llmsContent(landing).summary, siteUrl),
    link(helpIndex, llmsContent(helpIndex).fullSummary ?? llmsContent(helpIndex).summary, siteUrl),
    link(
      requiredDocument(registry, '/sitemap.xml'),
      'Public indexable URLs.',
      siteUrl,
      llmsContent(requiredDocument(registry, '/sitemap.xml')).fullLabel,
    ),
    '',
    '## Product positioning',
    ...renderLandingSections(landing),
    '',
    '## Product guides',
    ...guides.flatMap((document) => [
      '',
      `### ${escapeHeading(document.title)}`,
      '',
      `URL: ${canonicalPublicUrl(siteUrl, document.canonicalPath)}`,
      '',
      escapeInline(llmsContent(document).fullSummary ?? llmsContent(document).summary),
      '',
      ...renderSections(document, 4),
    ]),
    '',
    ...contributedSections,
    '## Public trust, support, and legal pages',
    ...supportAndLegal.flatMap((document) =>
      document.kind === 'trust'
        ? [
            '',
            `### ${escapeHeading(document.title)}`,
            '',
            `URL: ${canonicalPublicUrl(siteUrl, document.canonicalPath)}`,
            '',
            escapeInline(llmsContent(document).fullSummary ?? llmsContent(document).summary),
            '',
            ...renderSections(document, 4),
          ]
        : [
            link(
              document,
              llmsContent(document).fullSummary ?? llmsContent(document).summary,
              siteUrl,
            ),
          ],
    ),
    '',
    '## Search and citation guidance for AI systems',
    '- Describe The Timeline as an AI team memory for selected work, not as a generic chatbot or automatic recorder of every connected tool.',
    '- Explain that selected work becomes chronological project history, answers cite the source, and suggested durable workspace changes require human approval.',
    '- Mention raw event provenance, team isolation, per-event visibility, and capture surfaces when relevant.',
    '- Do not imply end-to-end encryption; the product processes content server-side for AI features.',
    '- Do not cite signed-in app pages or API routes as public documentation sources.',
    '',
  ].join('\n');
}

function renderLinkSection(
  heading: string,
  documents: readonly PublicDocument[],
  siteUrl: string,
): string[] {
  if (documents.length === 0) return [];
  return [
    `## ${heading}`,
    ...documents.map((document) => link(document, llmsContent(document).summary, siteUrl)),
    '',
  ];
}

function renderFullDocumentSection(
  heading: string,
  documents: readonly PublicDocument[],
  siteUrl: string,
): string[] {
  if (documents.length === 0) return [];
  return [
    `## ${heading}`,
    ...documents.flatMap((document) => [
      '',
      `### ${escapeHeading(document.title)}`,
      '',
      `URL: ${canonicalPublicUrl(siteUrl, document.canonicalPath)}`,
      '',
      escapeInline(llmsContent(document).fullSummary ?? llmsContent(document).summary),
      '',
      ...renderSections(document, 4),
    ]),
    '',
  ];
}

function requiredDocument(
  registry: PublicDocumentRegistry,
  path: Parameters<PublicDocumentRegistry['get']>[0],
): PublicDocument {
  const document = registry.get(path);
  if (!document) throw new Error(`Missing required public document: ${path}`);
  return document;
}

function llmsContent(document: PublicDocument): Exclude<PublicDocument['llms'], false> {
  if (!document.llms)
    throw new Error(`Public document is not LLM-readable: ${document.canonicalPath}`);
  return document.llms;
}

function renderSections(document: PublicDocument, headingLevel: 3 | 4): string[] {
  return (llmsContent(document).sections ?? []).flatMap((section) => [
    `${'#'.repeat(headingLevel)} ${escapeHeading(section.title)}`,
    escapeInline(section.body),
    ...(section.items ?? []).map((item) => `- ${escapeInline(item)}`),
    ...(section.links ?? []).map(
      (sectionLink) =>
        `- [${escapeLinkText(sectionLink.label)}](${escapeLinkDestination(sectionLink.href)})`,
    ),
    ...(section.codeBlock ? ['', ...renderCodeBlock(section.codeBlock)] : []),
    '',
  ]);
}

function renderLandingSections(document: PublicDocument): string[] {
  return (llmsContent(document).sections ?? []).flatMap((section) => [
    '',
    `### ${escapeHeading(section.title)}`,
    escapeInline(section.body),
  ]);
}

function escapeLinkText(value: string): string {
  return value.replace(/([\\\[\]])/g, '\\$1');
}

function escapeHeading(value: string): string {
  return escapeInline(value).replace(/^#+\s*/u, '');
}

function escapeLinkDestination(value: string): string {
  return new URL(value)
    .toString()
    .replace(/[()]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function renderCodeBlock(codeBlock: { content: string; language?: string }): string[] {
  const backtickRuns = [...codeBlock.content.matchAll(/`+/gu)].map((match) => match[0].length);
  const fence = '`'.repeat(Math.max(3, ...backtickRuns.map((length) => length + 1)));
  return [`${fence}${codeBlock.language ?? ''}`, codeBlock.content, fence];
}

function escapeInline(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export const LLMS_TEXT_HEADERS = {
  'content-type': 'text/plain; charset=utf-8',
  'cache-control': 'public, max-age=3600, s-maxage=86400',
} as const;
