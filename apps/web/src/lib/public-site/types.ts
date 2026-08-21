export const PUBLIC_DOCUMENT_KINDS = [
  'landing',
  'product',
  'solution',
  'connector',
  'guide-index',
  'guide',
  'trust',
  'support',
  'legal',
  'machine',
] as const;

export const NATIVE_INGESTION_PROVIDERS = [
  'github',
  'linear',
  'google-drive',
  'monday',
  'slack',
  'sentry',
] as const;

export const PUBLIC_LLM_SECTIONS = [
  'primary',
  'product-guides',
  'solutions',
  'integrations',
  'how-it-works',
  'companion',
] as const;

export type PublicDocumentKind = (typeof PUBLIC_DOCUMENT_KINDS)[number];
export type NativeIngestionProvider = (typeof NATIVE_INGESTION_PROVIDERS)[number];
export type PublicLlmsSection = (typeof PUBLIC_LLM_SECTIONS)[number];
export type PublicCanonicalPath = '/' | `/${string}`;
export type PublicIsoDate = `${number}-${number}-${number}`;
export type PublicIndexability = 'index' | 'noindex';

export type PublicCapabilityState =
  | { kind: 'current-product' }
  | { kind: 'native-ingestion'; provider: NativeIngestionProvider }
  | { kind: 'mcp-access'; provider: string }
  | { kind: 'planned'; provider?: string }
  | { kind: 'not-applicable' };

export interface PublicDocumentDates {
  modified: PublicIsoDate;
  reviewed: PublicIsoDate;
}

export interface PublicLlmsContentSection {
  title: string;
  body: string;
  items?: readonly string[];
  links?: readonly { label: string; href: string }[];
  codeBlock?: { content: string; language?: string };
}

export interface PublicLlmsContent {
  section: PublicLlmsSection;
  order: number;
  label?: string;
  fullLabel?: string;
  summary: string;
  fullSummary?: string;
  sections?: readonly PublicLlmsContentSection[];
}

export type PublicStructuredDataInput =
  | { type: 'web-page' }
  | { type: 'collection-page' }
  | { type: 'tech-article'; published?: PublicIsoDate; authorName?: string }
  | {
      type: 'breadcrumbs';
      items: readonly { name: string; path: PublicCanonicalPath }[];
    }
  | {
      type: 'faq';
      entries: readonly { question: string; answer: string }[];
    }
  | {
      type: 'software-application';
      name: string;
      applicationCategory: string;
      operatingSystem: string;
      features?: readonly string[];
    };

export interface PublicSitemapSettings {
  changeFrequency: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: number;
}

export interface PublicDocument {
  canonicalPath: PublicCanonicalPath;
  kind: PublicDocumentKind;
  title: string;
  description: string;
  indexability: PublicIndexability;
  dates: PublicDocumentDates;
  capability: PublicCapabilityState;
  sitemap: false | PublicSitemapSettings;
  structuredData: readonly PublicStructuredDataInput[];
  llms: false | PublicLlmsContent;
}

export interface PublicDocumentSource {
  id: string;
  documents: readonly PublicDocument[];
}

export interface PublicDocumentRegistry {
  all(): readonly PublicDocument[];
  get(canonicalPath: PublicCanonicalPath): PublicDocument | undefined;
  forSitemap(): readonly PublicDocument[];
  forLlms(section: PublicLlmsSection): readonly PublicDocument[];
}
