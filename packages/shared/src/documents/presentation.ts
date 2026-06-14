export interface DocumentPresentationInput {
  name: string;
  contentType?: string | null;
  metadata?: Record<string, unknown> | null;
  fileKind?: 'captured' | 'document';
}

export interface DocumentPresentation {
  displayTitle: string;
  storedName: string;
  suggestedTitle: string | null;
  isGeneratedName: boolean;
  fallbackTitle: string;
}

const GENERATED_PREFIXES = ['agacag', 'baacag', 'caacag', 'dqacag', 'file_', 'photo_', 'image_'];

const MAX_SUGGESTED_TITLE_LENGTH = 96;

export function normalizeSuggestedTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized === '[no title]') return null;
  return normalized.slice(0, MAX_SUGGESTED_TITLE_LENGTH);
}

export function suggestedTitleFromMetadata(
  metadata?: Record<string, unknown> | null,
): string | null {
  return normalizeSuggestedTitle(metadata?.suggested_title);
}

export function isLikelyGeneratedDocumentName(name: string): boolean {
  const base = stripExtension(name).trim();
  if (!base) return true;
  const lower = base.toLowerCase();
  if (GENERATED_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  if (base.length > 48 && /^[a-z0-9_-]+$/i.test(base)) return true;
  if (base.length > 60 && /^[a-z0-9+/_=-]+$/i.test(base)) return true;
  if (/^[a-f0-9]{24,}$/i.test(base)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base)) {
    return true;
  }
  return false;
}

export function documentFallbackTitle(input: {
  contentType?: string | null | undefined;
  fileKind?: 'captured' | 'document' | undefined;
}): string {
  const kind = documentKindLabel(input.contentType);
  if (kind === 'image') return 'Image attachment';
  if (kind === 'pdf') return 'PDF attachment';
  if (kind === 'audio') return 'Audio attachment';
  return input.fileKind === 'captured' ? 'Captured attachment' : 'Document';
}

export function documentPresentation(input: DocumentPresentationInput): DocumentPresentation {
  const storedName = input.name;
  const suggestedTitle = suggestedTitleFromMetadata(input.metadata);
  const isGeneratedName = isLikelyGeneratedDocumentName(storedName);
  const fallbackTitle = documentFallbackTitle({
    contentType: input.contentType,
    fileKind: input.fileKind,
  });
  return {
    displayTitle: isGeneratedName ? (suggestedTitle ?? fallbackTitle) : storedName,
    storedName,
    suggestedTitle,
    isGeneratedName,
    fallbackTitle,
  };
}

export function documentKindLabel(contentType?: string | null): 'image' | 'pdf' | 'audio' | 'file' {
  const base = contentType?.toLowerCase().split(';')[0]?.trim() ?? '';
  if (base.startsWith('image/')) return 'image';
  if (base === 'application/pdf') return 'pdf';
  if (base.startsWith('audio/')) return 'audio';
  return 'file';
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}
