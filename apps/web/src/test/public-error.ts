import { expect } from 'vitest';

interface ReportMock {
  mock: { calls: unknown[][] };
}

export function expectPublicActionErrorReport(
  reportMock: ReportMock,
  error: unknown,
  operation: string,
  callIndex = 0,
): void {
  const call = reportMock.mock.calls[callIndex];
  expect(call?.[0]).toBe(error);
  const context = call?.[1];
  expect(context).toMatchObject({ surface: 'server_action', operation });
  const tags = context && typeof context === 'object' ? (context as { tags?: unknown }).tags : null;
  const reference =
    tags && typeof tags === 'object'
      ? (tags as { error_reference?: unknown }).error_reference
      : null;
  expect(reference).toMatch(/^[0-9a-f]{8}$/);
}
