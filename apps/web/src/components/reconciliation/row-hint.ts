import { formatDisplayDateTime } from '@/lib/display-dates';

export function reconciliationClusterRowHint(input: {
  artifactClusterKind: string;
  artifactType: string;
  clusterId: string;
  status: string;
  timeZone: string;
  updatedAt: Date;
}): string {
  return joinHintLines([
    formatDisplayDateTime(input.updatedAt, { timezone: input.timeZone }),
    `Cluster ID: ${input.clusterId}`,
    `${input.artifactClusterKind} · ${input.artifactType} · ${input.status}`,
  ]);
}

export function reconciliationOutputRowHint(input: {
  clusterId?: string | null;
  confidence: string;
  createdAt: Date;
  outputId: string;
  outputKind: string;
  status: string;
  targetId?: string | null;
  targetKind: string;
  timeZone: string;
  sourceRefs?: unknown;
  sourcePayloadRefs?: unknown;
}): string {
  return joinHintLines([
    formatDisplayDateTime(input.createdAt, { timezone: input.timeZone }),
    `Output ID: ${input.outputId}`,
    input.clusterId ? `Cluster ID: ${input.clusterId}` : null,
    input.targetId ? `Target ID: ${input.targetId}` : null,
    `${input.outputKind} · ${input.targetKind} · ${input.status} · ${input.confidence}`,
    ...sourceRefHintLines(input.sourceRefs),
    ...payloadRefHintLines(input.sourcePayloadRefs),
  ]);
}

export function reconciliationEvidenceRowHint(input: {
  authoritative: boolean;
  externalObjectId?: string | null;
  rawEventId?: string | null;
  role: string;
  strength: string;
}): string {
  return joinHintLines([
    input.rawEventId ? `Raw event ID: ${input.rawEventId}` : null,
    input.externalObjectId ? `External object ID: ${input.externalObjectId}` : null,
    `${input.role} · ${input.strength}${input.authoritative ? ' · authoritative' : ''}`,
  ]);
}

function sourceRefHintLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const lines: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.rawEventId === 'string' && record.rawEventId.length > 0) {
      lines.push(`Raw event ID: ${record.rawEventId}`);
    }
    if (typeof record.evidenceId === 'string' && record.evidenceId.length > 0) {
      lines.push(`Evidence ID: ${record.evidenceId}`);
    }
    if (typeof record.sourcePayloadRef === 'string' && record.sourcePayloadRef.length > 0) {
      lines.push(`Payload ref: ${record.sourcePayloadRef}`);
    }
  }
  return uniqueLines(lines);
}

function payloadRefHintLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueLines(
    value
      .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      .map((entry) => `Payload ref: ${entry}`),
  );
}

function joinHintLines(lines: (string | null | undefined)[]): string {
  return lines.filter((line): line is string => Boolean(line && line.length > 0)).join('\n');
}

function uniqueLines(lines: string[]): string[] {
  return [...new Set(lines)];
}
