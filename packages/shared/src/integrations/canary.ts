export type LiveIntegrationCanaryStatus = 'ok' | 'skip' | 'warn';

export interface LiveIntegrationCanaryResult {
  name: string;
  status: LiveIntegrationCanaryStatus;
  detail: string;
  action?: string;
  docs?: string;
  envKeys?: string[];
}

export interface LiveIntegrationCanaryReportInput {
  envFile: string;
  strict?: boolean;
  results: LiveIntegrationCanaryResult[];
  redactions?: readonly string[];
}

function statusLabel(status: LiveIntegrationCanaryStatus): string {
  return status.toUpperCase().padEnd(4);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function redactLiveIntegrationCanaryText(
  input: string,
  redactions: readonly string[] = [],
): string {
  let output = input;
  for (const value of redactions) {
    if (value.length < 8) continue;
    output = output.replace(new RegExp(escapeRegExp(value), 'gu'), '[redacted]');
    output = output.replace(
      new RegExp(escapeRegExp(encodeURIComponent(value)), 'gu'),
      '[redacted]',
    );
  }
  output = output.replace(/\b(Bearer|Token)\s+[A-Za-z0-9._~+/=-]{12,}/giu, '$1 [redacted]');
  output = output.replace(
    /\b(x-postmark-server-token|authorization)(["'\s:=]+)[^"',\s]+/giu,
    '$1$2[redacted]',
  );
  return output;
}

function actionFor(
  result: LiveIntegrationCanaryResult,
  redactions: readonly string[],
): string | null {
  if (result.status === 'ok') return null;
  const parts: string[] = [];
  if (result.action) parts.push(result.action);
  if (result.envKeys && result.envKeys.length > 0) {
    parts.push(`set ${result.envKeys.join(', ')}`);
  }
  if (result.docs) parts.push(`see ${result.docs}`);
  return redactLiveIntegrationCanaryText(
    parts.length > 0 ? parts.join('; ') : result.detail,
    redactions,
  );
}

export function formatLiveIntegrationCanaryReport(input: LiveIntegrationCanaryReportInput): string {
  const lines = [`Live integration canary (${input.envFile}${input.strict ? ', strict' : ''})`];
  const redactions = input.redactions ?? [];
  for (const result of input.results) {
    lines.push(
      `${statusLabel(result.status)} ${result.name}: ${redactLiveIntegrationCanaryText(
        result.detail,
        redactions,
      )}`,
    );
  }

  const actionable = input.results
    .map((result) => ({ result, action: actionFor(result, redactions) }))
    .filter((item): item is { result: LiveIntegrationCanaryResult; action: string } =>
      Boolean(item.action),
    );
  if (actionable.length > 0) {
    lines.push('');
    lines.push('Next steps:');
    for (const { result, action } of actionable) {
      lines.push(`- ${result.name}: ${action}`);
    }
  }

  return lines.join('\n');
}
