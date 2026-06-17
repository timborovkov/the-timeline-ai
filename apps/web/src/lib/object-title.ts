import type * as objects from '@timeline/shared/objects';

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || null;
}

export function displayObjectTitle(
  row: Pick<objects.ObjectRow, 'canonicalName' | 'metadata'>,
): string {
  const explicit = metadataString(row.metadata, 'display_title');
  const explicitSource = metadataString(row.metadata, 'display_title_canonical_name');
  if (explicit && explicitSource && row.canonicalName === explicitSource) return explicit;

  const provider = metadataString(row.metadata, 'integration_provider');
  if (provider !== 'github') return row.canonicalName;

  const match = /^(.+?)#(?:issue:)?\d+:\s*(.+)$/.exec(row.canonicalName);
  if (!match) return row.canonicalName;
  const [, canonicalRepo, title] = match;
  if (!canonicalRepo || !title) return row.canonicalName;

  if (explicit) return explicit;

  const externalId = metadataString(row.metadata, 'integration_external_id');
  const repo = externalId?.split('#')[0] ?? canonicalRepo;
  const repoName = repo.split('/').pop() ?? repo;
  return repoName ? `${repoName}: ${title}` : title;
}
