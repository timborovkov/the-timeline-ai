import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { stampSentryRuntimeContext } from '#src/monitoring/sentry-runtime.js';

describe('Sentry runtime stamp', () => {
  it('stamps Bun as the Sentry runtime instead of Node compatibility', () => {
    const event = stampSentryRuntimeContext({
      contexts: { runtime: { name: 'node', version: 'v26.3.0' } },
    });
    expect(event.contexts.runtime).toEqual({
      name: 'bun',
      version: process.versions.bun,
    });
  });
});
