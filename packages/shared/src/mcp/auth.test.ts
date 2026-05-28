import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { encryptJson, resetSecretsKeyCacheForTests } from '#src/crypto/secrets.js';
import { resetEnvForTests } from '#src/env.js';
import { buildAuth, validateMcpUrl, type McpServerRow } from '#src/mcp/auth.js';

function row(overrides: Partial<McpServerRow> = {}): McpServerRow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    teamId: '00000000-0000-0000-0000-000000000002',
    userId: null,
    addedByUserId: null,
    name: 'Test',
    url: 'https://mcp.example.com/mcp',
    authType: 'none',
    authConfigCiphertext: null,
    authConfigIv: null,
    authConfigTag: null,
    enabled: true,
    disabledTools: [],
    cachedTools: null,
    toolsCachedAt: null,
    lastConnectedAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('mcp/auth', () => {
  const originalKey = process.env.SECRETS_ENCRYPTION_KEY;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.SECRETS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    resetEnvForTests();
    resetSecretsKeyCacheForTests();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = originalKey;
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
    resetEnvForTests();
    resetSecretsKeyCacheForTests();
  });

  it('builds bearer headers from encrypted config', () => {
    const enc = encryptJson({ token: 'abc' });
    const { headers, url } = buildAuth(
      row({
        authType: 'bearer',
        authConfigCiphertext: enc.ciphertext,
        authConfigIv: enc.iv,
        authConfigTag: enc.tag,
      }),
    );
    expect(headers.authorization).toBe('Bearer abc');
    expect(url).toBe('https://mcp.example.com/mcp');
  });

  it('builds custom header auth', () => {
    const enc = encryptJson({ name: 'X-Api-Key', value: 'k1' });
    const { headers } = buildAuth(
      row({
        authType: 'header',
        authConfigCiphertext: enc.ciphertext,
        authConfigIv: enc.iv,
        authConfigTag: enc.tag,
      }),
    );
    expect(headers['X-Api-Key']).toBe('k1');
  });

  it('appends url_key as query param', () => {
    const enc = encryptJson({ paramName: 'apiKey', value: 'secret' });
    const { url } = buildAuth(
      row({
        authType: 'url_key',
        authConfigCiphertext: enc.ciphertext,
        authConfigIv: enc.iv,
        authConfigTag: enc.tag,
      }),
    );
    expect(url).toContain('apiKey=secret');
  });

  it('uses oauth access token when provided', () => {
    const { headers } = buildAuth(row({ authType: 'oauth' }), 'access-xyz');
    expect(headers.authorization).toBe('Bearer access-xyz');
  });

  it('returns empty headers for none auth', () => {
    const { headers } = buildAuth(row({ authType: 'none' }));
    expect(Object.keys(headers)).toHaveLength(0);
  });
});

describe('mcp/auth validateMcpUrl', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });

  it('rejects malformed URLs', () => {
    expect(validateMcpUrl('not-a-url')).toBeTruthy();
  });

  it('rejects non-http(s) schemes', () => {
    expect(validateMcpUrl('ftp://example.com')).toMatch(/http or https/);
  });

  it('accepts https://public-host.com in production', () => {
    process.env.NODE_ENV = 'production';
    expect(validateMcpUrl('https://mcp.context7.com/mcp')).toBeNull();
  });

  it('rejects http:// in production', () => {
    process.env.NODE_ENV = 'production';
    expect(validateMcpUrl('http://example.com')).toMatch(/not allowed in production/);
  });

  it('rejects loopback in production', () => {
    process.env.NODE_ENV = 'production';
    expect(validateMcpUrl('https://localhost:8080/mcp')).toMatch(/Loopback/);
    expect(validateMcpUrl('https://127.0.0.1/mcp')).toMatch(/Loopback/);
  });

  it('rejects private IP ranges in production', () => {
    process.env.NODE_ENV = 'production';
    expect(validateMcpUrl('https://10.0.0.1/mcp')).toMatch(/Private/);
    expect(validateMcpUrl('https://192.168.1.1/mcp')).toMatch(/Private/);
  });

  it('allows localhost in non-production', () => {
    process.env.NODE_ENV = 'development';
    expect(validateMcpUrl('http://localhost:3000/mcp')).toBeNull();
  });
});
