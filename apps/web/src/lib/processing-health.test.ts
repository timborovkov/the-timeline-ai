import { expect } from '@timeline/test-support';
import { it } from 'bun:test';

import {
  lastExpectedDigestTick,
  PROCESSING_LAG_MS,
  queueNeedsAttention,
} from '@/lib/processing-health';
import { authorizeOperatorProbe } from '@/lib/operator-probe';

it('detects a scheduled digest miss after the UTC grace period', () => {
  expect(lastExpectedDigestTick(Date.parse('2026-11-19T12:59:59Z'))).toBe(
    Date.parse('2026-11-18T12:00:00Z'),
  );
  expect(lastExpectedDigestTick(Date.parse('2026-11-19T13:00:00Z'))).toBe(
    Date.parse('2026-11-19T12:00:00Z'),
  );
});

it('alerts independently for stale work and accumulated failures', () => {
  const healthy = {
    queue: 'test',
    oldestWaitingMs: PROCESSING_LAG_MS - 1,
    oldestActiveMs: 0,
    failedLastDay: 4,
  };
  expect(queueNeedsAttention(healthy)).toBe(false);
  expect(queueNeedsAttention({ ...healthy, oldestActiveMs: PROCESSING_LAG_MS })).toBe(true);
  expect(queueNeedsAttention({ ...healthy, failedLastDay: 5 })).toBe(true);
});

it('requires a matching bearer scheme for operator requests', () => {
  const request = (authorization: string) =>
    new Request('https://test.local', {
      headers: { authorization },
    });
  expect(authorizeOperatorProbe(request('shared-key'), 'shared-key')?.status).toBe(401);
  expect(authorizeOperatorProbe(request('Bearer wrong-key'), 'shared-key')?.status).toBe(401);
  expect(authorizeOperatorProbe(request('Bearer shared-key'), 'shared-key')).toBeNull();
});
