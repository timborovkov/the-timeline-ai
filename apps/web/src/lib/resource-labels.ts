export interface ProviderResourceLike {
  kind: string;
  externalId: string;
  label: string;
}

export interface ResourceShareLike {
  resourceKind: string;
  externalId: string;
  externalLabel: string | null;
}

const KIND_LABELS: Record<string, string> = {
  'github.org': 'GitHub organization',
  'github.repo': 'GitHub repository',
  'linear.team': 'Linear team',
  'drive.folder': 'Google Drive folder',
  'drive.shared_drive': 'Google Drive shared drive',
};

const PROVIDER_LABELS: Record<string, string> = {
  google_drive: 'Google Drive',
  linear: 'Linear',
  github: 'GitHub',
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

export function resourceKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/[._]/g, ' ');
}

export function resourceDisplayName(resource: ProviderResourceLike): string {
  return resource.label || resource.externalId;
}

export function shareDisplayName(share: ResourceShareLike): string {
  return share.externalLabel ?? share.externalId;
}

export function groupResourcesByKind(resources: ProviderResourceLike[]): {
  kind: string;
  label: string;
  resources: ProviderResourceLike[];
}[] {
  const groups = new Map<string, ProviderResourceLike[]>();
  for (const resource of resources) {
    const list = groups.get(resource.kind) ?? [];
    list.push(resource);
    groups.set(resource.kind, list);
  }
  return Array.from(groups.entries()).map(([kind, items]) => ({
    kind,
    label: resourceKindLabel(kind),
    resources: items,
  }));
}
