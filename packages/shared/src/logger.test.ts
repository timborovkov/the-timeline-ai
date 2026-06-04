import { describe, expect, it } from 'vitest';

import { childLogger } from '#src/logger.js';

describe('logger', () => {
  it('ignores broken process pipe errors from stdout and stderr', () => {
    childLogger('test').silent('install handlers');

    expect(() => {
      process.stdout.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    }).not.toThrow();
    expect(() => {
      process.stderr.emit(
        'error',
        Object.assign(new Error('stream destroyed'), { code: 'ERR_STREAM_DESTROYED' }),
      );
    }).not.toThrow();
  });
});
