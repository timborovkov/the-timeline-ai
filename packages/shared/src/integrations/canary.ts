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
}

function statusLabel(status: LiveIntegrationCanaryStatus): string {
  return status.toUpperCase().padEnd(4);
}

function actionFor(result: LiveIntegrationCanaryResult): string | null {
  if (result.status === 'ok') return null;
  const parts: string[] = [];
  if (result.action) parts.push(result.action);
  if (result.envKeys && result.envKeys.length > 0) {
    parts.push(`set ${result.envKeys.join(', ')}`);
  }
  if (result.docs) parts.push(`see ${result.docs}`);
  return parts.length > 0 ? parts.join('; ') : result.detail;
}

export function formatLiveIntegrationCanaryReport(input: LiveIntegrationCanaryReportInput): string {
  const lines = [`Live integration canary (${input.envFile}${input.strict ? ', strict' : ''})`];
  for (const result of input.results) {
    lines.push(`${statusLabel(result.status)} ${result.name}: ${result.detail}`);
  }

  const actionable = input.results
    .map((result) => ({ result, action: actionFor(result) }))
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
