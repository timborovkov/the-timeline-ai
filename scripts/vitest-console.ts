export function filterExpectedTestConsole(log: string, type: 'stdout' | 'stderr'): boolean | void {
  if (type !== 'stderr') return;

  const expectedStderr = [
    'AI SDK Warning:',
    'Error: model down',
    'The current testing environment is not configured to support act(...)',
    'failed to enqueue object summary refresh',
  ];

  if (expectedStderr.some((message) => log.includes(message))) {
    return false;
  }
}
