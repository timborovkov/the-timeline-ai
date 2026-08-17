import { describe, expect, it } from 'vitest';

import { resolveSignalClass } from '#src/integrations/signal-class.js';

describe('resolveSignalClass', () => {
  it('prefers an explicit envelope field', () => {
    expect(
      resolveSignalClass({
        signalClass: 'pulse',
        provider: 'github',
        extra: { github: { type: 'pull_request' } },
      }),
    ).toBe('pulse');
  });

  it('classifies GitHub PRs as captured work and workflow runs as pulses', () => {
    expect(
      resolveSignalClass({
        extra: { github: { type: 'pull_request' } },
        eventType: 'pr.merged',
      }),
    ).toBe('captured_work');
    expect(
      resolveSignalClass({
        extra: { github: { type: 'workflow_run' } },
        eventType: 'workflow_run.success',
      }),
    ).toBe('pulse');
    expect(
      resolveSignalClass({
        extra: { github: { type: 'commit' } },
        eventType: 'commit.pushed',
      }),
    ).toBe('finding');
  });

  it('classifies Linear issues as captured work and comments as findings', () => {
    expect(resolveSignalClass({ extra: { linear: { kind: 'issue' } } })).toBe('captured_work');
    expect(resolveSignalClass({ extra: { linear: { kind: 'comment' } } })).toBe('finding');
  });

  it('classifies Sentry incidents as findings and Drive changes as pulses', () => {
    expect(
      resolveSignalClass({
        objectMap: {
          type: 'incident',
          canonicalName: 'FABA-APP-1: boom',
          externalId: '1',
        },
      }),
    ).toBe('finding');
    expect(resolveSignalClass({ provider: 'google_drive', eventType: 'file.changed' })).toBe(
      'pulse',
    );
  });

  it('keeps a conservative skip for legacy structured providers', () => {
    expect(resolveSignalClass({ provider: 'github' })).toBe('captured_work');
    expect(resolveSignalClass({ provider: 'slack', eventType: 'message.created' })).toBe(
      'communication',
    );
    expect(
      resolveSignalClass({
        provider: 'slack',
        eventType: 'file.shared',
        objectMap: { type: 'document', canonicalName: 'notes.pdf', externalId: 'F1' },
      }),
    ).toBe('pulse');
    expect(resolveSignalClass({ provider: 'slack', eventType: 'file.shared' })).toBe(
      'communication',
    );
  });
});
