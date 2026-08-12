import type {
  PublicCanonicalPath,
  PublicDocument,
  PublicDocumentRegistry,
  PublicDocumentSource,
  PublicIsoDate,
  PublicLlmsSection,
} from '@/lib/public-site/types';

import {
  NATIVE_INGESTION_PROVIDERS,
  PUBLIC_DOCUMENT_KINDS,
  PUBLIC_LLM_SECTIONS,
} from '@/lib/public-site/types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function definePublicDocuments(
  id: string,
  documents: readonly PublicDocument[],
): PublicDocumentSource {
  if (!SOURCE_ID.test(id)) {
    throw new Error(`Public document source id must be kebab-case: ${id}`);
  }
  documents.forEach((document) => {
    validateDocument(document, id);
  });
  return Object.freeze({ id, documents: Object.freeze([...documents]) });
}

export function createPublicDocumentRegistry(
  ...sources: readonly PublicDocumentSource[]
): PublicDocumentRegistry {
  const documents: PublicDocument[] = [];
  const byPath = new Map<PublicCanonicalPath, PublicDocument>();

  for (const source of sources) {
    for (const document of source.documents) {
      const existing = byPath.get(document.canonicalPath);
      if (existing) {
        throw new Error(
          `Duplicate public document canonical path ${document.canonicalPath} in source ${source.id}`,
        );
      }
      documents.push(document);
      byPath.set(document.canonicalPath, document);
    }
  }

  const all = Object.freeze([...documents]);
  const sitemap = Object.freeze(documents.filter((document) => document.sitemap !== false));
  const llms = new Map(
    PUBLIC_LLM_SECTIONS.map((section) => [
      section,
      Object.freeze(
        documents
          .filter((document) => document.llms && document.llms.section === section)
          .sort((left, right) => llmsOrder(left) - llmsOrder(right)),
      ),
    ]),
  );

  return Object.freeze({
    all: () => all,
    get: (canonicalPath: PublicCanonicalPath) => byPath.get(canonicalPath),
    forSitemap: () => sitemap,
    forLlms: (section: PublicLlmsSection) => llms.get(section) ?? [],
  });
}

export function canonicalPublicUrl(siteUrl: string, canonicalPath: PublicCanonicalPath): string {
  validateCanonicalPath(canonicalPath, 'canonical URL');
  const origin = new URL(siteUrl).origin;
  return new URL(canonicalPath, `${origin}/`)
    .toString()
    .replace(/[&()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function validateDocument(document: PublicDocument, sourceId: string): void {
  const context = `${sourceId}:${document.canonicalPath}`;
  validateCanonicalPath(document.canonicalPath, context);
  validateSingleLine(document.title, 'title', context);
  validateSingleLine(document.description, 'description', context);
  validateDate(document.dates.modified, 'modified date', context);
  validateDate(document.dates.reviewed, 'reviewed date', context);

  if (document.dates.reviewed < document.dates.modified) {
    throw new Error(`Public document reviewed date precedes its modified date: ${context}`);
  }
  if (!PUBLIC_DOCUMENT_KINDS.includes(document.kind)) {
    throw new Error(`Unknown public document kind in ${context}: ${document.kind}`);
  }
  if (
    document.indexability === 'noindex' &&
    (document.sitemap !== false || document.llms !== false)
  ) {
    throw new Error(`Noindex public document cannot appear in public discovery: ${context}`);
  }
  if (document.sitemap !== false) {
    if (
      !Number.isFinite(document.sitemap.priority) ||
      document.sitemap.priority < 0 ||
      document.sitemap.priority > 1
    ) {
      throw new Error(
        `Public sitemap priority must be a finite number between 0 and 1: ${context}`,
      );
    }
  }
  if (document.capability.kind === 'planned') {
    if (
      document.indexability !== 'noindex' ||
      document.sitemap !== false ||
      document.llms !== false
    ) {
      throw new Error(`Planned public capability must stay noindex and undiscoverable: ${context}`);
    }
  }
  if (
    document.capability.kind === 'native-ingestion' &&
    !NATIVE_INGESTION_PROVIDERS.includes(document.capability.provider)
  ) {
    throw new Error(`Unknown native ingestion provider in ${context}`);
  }
  if (
    document.kind === 'connector' &&
    !['native-ingestion', 'mcp-access', 'planned'].includes(document.capability.kind)
  ) {
    throw new Error(`Connector public document must declare a connector capability: ${context}`);
  }
  if (
    (document.capability.kind === 'mcp-access' || document.capability.kind === 'planned') &&
    document.capability.provider !== undefined &&
    !document.capability.provider.trim()
  ) {
    throw new Error(`Public document capability provider must be non-empty: ${context}`);
  }
  if (document.llms) {
    if (!Number.isFinite(document.llms.order)) {
      throw new Error(`Public document LLM order must be finite: ${context}`);
    }
    validateSingleLine(document.llms.label ?? document.title, 'LLM label', context);
    if (document.llms.fullLabel) {
      validateSingleLine(document.llms.fullLabel, 'LLM full label', context);
    }
    validateSingleLine(document.llms.summary, 'LLM summary', context);
    if (document.llms.fullSummary) {
      validateSingleLine(document.llms.fullSummary, 'LLM full summary', context);
    }
    for (const section of document.llms.sections ?? []) {
      validateSingleLine(section.title, 'LLM section title', context);
    }
  }
  for (const input of document.structuredData) {
    if (input.type === 'breadcrumbs') {
      input.items.forEach((item) => {
        validateCanonicalPath(item.path, context);
      });
    }
    if (input.type === 'tech-article' && input.published) {
      validateDate(input.published, 'published date', context);
    }
  }
}

function llmsOrder(document: PublicDocument): number {
  return document.llms ? document.llms.order : Number.POSITIVE_INFINITY;
}

function validateCanonicalPath(canonicalPath: string, context: string): void {
  if (
    !canonicalPath.startsWith('/') ||
    canonicalPath.startsWith('//') ||
    (canonicalPath.length > 1 && canonicalPath.endsWith('/')) ||
    canonicalPath.includes('?') ||
    canonicalPath.includes('#') ||
    new URL(canonicalPath, 'https://public-document.invalid').pathname !== canonicalPath
  ) {
    throw new Error(`Invalid public canonical path in ${context}: ${canonicalPath}`);
  }
}

function validateDate(value: PublicIsoDate, field: string, context: string): void {
  if (
    !ISO_DATE.test(value) ||
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`Invalid public document ${field} in ${context}: ${value}`);
  }
}

function validateSingleLine(value: string, field: string, context: string): void {
  if (!value.trim() || /[\r\n]/.test(value)) {
    throw new Error(`Public document ${field} must be non-empty and single-line: ${context}`);
  }
}
