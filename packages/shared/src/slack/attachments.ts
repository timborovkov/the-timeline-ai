const MIB = 1024 * 1024;

export const CONVERSATIONAL_ATTACHMENT_LIMITS = {
  maxBytes: 25 * MIB,
  maxProcessedPerMessage: 5,
} as const;

const DOCUMENT_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/json',
  'application/xml',
  'text/xml',
  'text/csv',
  'text/markdown',
  'text/html',
  'application/yaml',
  'application/x-yaml',
]);

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const AUDIO_EXT = new Set(['ogg', 'oga', 'mp3', 'm4a', 'mp4', 'wav', 'webm', 'flac', 'aac']);
const DOCUMENT_EXT = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'xml',
  'yaml',
  'yml',
  'csv',
  'html',
  'htm',
  'log',
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'docx',
]);
const BLOCKED_EXT = new Set([
  'zip',
  'gz',
  'tgz',
  'rar',
  '7z',
  'exe',
  'dmg',
  'pkg',
  'app',
  'mp4',
  'mov',
  'webm',
]);

export type AttachmentDecision =
  | { kind: 'audio'; reason?: undefined }
  | { kind: 'document'; reason?: undefined }
  | { kind: 'skip'; reason: string };

export interface AttachmentCandidate {
  filename: string;
  contentType?: string | null;
  sizeBytes?: number | null;
}

export function extensionOf(filename: string): string {
  const part = filename.split('.').pop()?.toLowerCase() ?? '';
  return part === filename.toLowerCase() ? '' : part;
}

export function classifyConversationalAttachment(input: AttachmentCandidate): AttachmentDecision {
  if (input.sizeBytes !== undefined && input.sizeBytes !== null) {
    if (input.sizeBytes > CONVERSATIONAL_ATTACHMENT_LIMITS.maxBytes) {
      return { kind: 'skip', reason: 'oversize' };
    }
  }
  const contentType = input.contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = extensionOf(input.filename);
  if (BLOCKED_EXT.has(ext) || contentType.startsWith('video/')) {
    return { kind: 'skip', reason: 'unsupported_type' };
  }
  if (contentType.startsWith('audio/') || AUDIO_EXT.has(ext)) return { kind: 'audio' };
  if (
    contentType.startsWith('text/') ||
    DOCUMENT_MIME.has(contentType) ||
    IMAGE_MIME.has(contentType) ||
    DOCUMENT_EXT.has(ext)
  ) {
    return { kind: 'document' };
  }
  return { kind: 'skip', reason: 'unknown_binary' };
}
