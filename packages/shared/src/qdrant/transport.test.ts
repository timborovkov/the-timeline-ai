import { expect } from '@timeline/test-support';
import { describe, it } from 'bun:test';

import { isTransientQdrantNetworkError } from '#src/qdrant/transport.js';

function codedError(
  code: string,
  message: string,
  Ctor: new (message: string) => Error = Error,
): Error {
  return Object.assign(new Ctor(message), { code });
}

describe('isTransientQdrantNetworkError', () => {
  it('treats Node and undici connection failures as recoverable', () => {
    for (const code of [
      'ECONNREFUSED',
      'ECONNRESET',
      'ECONNABORTED',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'ENOTFOUND',
      'EPIPE',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'UND_ERR_SOCKET',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
    ]) {
      expect(isTransientQdrantNetworkError(codedError(code, 'Qdrant is asleep'))).toBe(true);
    }
  });

  it('treats Bun-native fetch failures as recoverable even when they are not TypeError', () => {
    for (const code of [
      'ConnectionRefused',
      'ConnectionReset',
      'ConnectionClosed',
      'ConnectionTimedOut',
      'FailedToOpenSocket',
      'HostNotFound',
      'HostUnreachable',
      'NetworkUnreachable',
      'Timeout',
    ]) {
      const error = codedError(code, 'Qdrant is asleep');
      expect(error).not.toBeInstanceOf(TypeError);
      expect(isTransientQdrantNetworkError(error)).toBe(true);
    }
  });

  it('reads a Bun ConnectionRefused code from fetch failed wrappers', () => {
    const error = Object.assign(new TypeError('fetch failed'), {
      cause: codedError('ConnectionRefused', 'Qdrant is asleep'),
    });
    expect(isTransientQdrantNetworkError(error)).toBe(true);
  });

  it('still recognizes undici TypeError fetch failures without a code', () => {
    expect(isTransientQdrantNetworkError(new TypeError('fetch failed'))).toBe(true);
  });

  it('treats a plain Error whose message describes a closed connection as recoverable', () => {
    expect(isTransientQdrantNetworkError(new Error('Unable to connect'))).toBe(true);
  });

  it('does not retry permanent Qdrant or application errors', () => {
    expect(isTransientQdrantNetworkError(new Error('Qdrant read failed: 401'))).toBe(false);
    expect(isTransientQdrantNetworkError(new Error('Invalid Qdrant JSON response'))).toBe(false);
    expect(isTransientQdrantNetworkError(codedError('EPERM', 'permission denied'))).toBe(false);
    expect(isTransientQdrantNetworkError('ConnectionRefused')).toBe(false);
  });

  it('classifies a real Bun fetch to a refused local port as transient', async () => {
    const error = await fetch('http://127.0.0.1:1/').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(isTransientQdrantNetworkError(error)).toBe(true);
    if (!(error instanceof Error)) throw new Error('expected a fetch Error');
    const code = (error as Error & { code?: string }).code;
    expect(
      code === 'ECONNREFUSED' ||
        code === 'ConnectionRefused' ||
        code === 'FailedToOpenSocket' ||
        (error instanceof TypeError && /connect|econnrefused/i.test(error.message)),
    ).toBe(true);
  });
});
