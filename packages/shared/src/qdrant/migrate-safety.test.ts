import { describe, expect, it } from 'vitest';

import {
  QDRANT_MIGRATE_REMOTE_ACK,
  assertQdrantMigrateAllowed,
} from '#src/qdrant/migrate-safety.js';

describe('assertQdrantMigrateAllowed', () => {
  // Production copies need an explicit acknowledgement and a complete, tenant-safe cutover plan.
  it('allows production only with all maintenance safeguards', () => {
    const env = {
      NODE_ENV: 'production',
      QDRANT_URL: 'https://qdrant.example.com',
      ALLOW_QDRANT_MIGRATE_PRODUCTION: 'I_UNDERSTAND_THIS_MIGRATES_PRODUCTION_QDRANT',
    };
    const options = {
      production: true,
      writersPaused: true,
      copy: true,
      verify: true,
      allTeams: true,
    };
    expect(() => {
      assertQdrantMigrateAllowed(env, options);
    }).not.toThrow();
    for (const key of ['writersPaused', 'copy', 'verify', 'allTeams'] as const) {
      expect(() => {
        assertQdrantMigrateAllowed(env, { ...options, [key]: false });
      }).toThrow();
    }
    expect(() => {
      assertQdrantMigrateAllowed(env, { ...options, measure: true });
    }).toThrow();
    expect(() => {
      assertQdrantMigrateAllowed({ ...env, ALLOW_QDRANT_MIGRATE_PRODUCTION: '' }, options);
    }).toThrow();
  });

  it('allows loopback Qdrant in development and staging', () => {
    expect(() => {
      assertQdrantMigrateAllowed({
        NODE_ENV: 'development',
        QDRANT_URL: 'http://localhost:6333',
      });
    }).not.toThrow();
    expect(() => {
      assertQdrantMigrateAllowed({
        NODE_ENV: 'development',
        RAILWAY_ENVIRONMENT_NAME: 'staging',
        QDRANT_URL: 'http://127.0.0.1:6333',
      });
    }).not.toThrow();
    expect(() => {
      assertQdrantMigrateAllowed({
        NODE_ENV: 'development',
        QDRANT_URL: 'http://[::1]:6333',
      });
    }).not.toThrow();
  });

  it('refuses NODE_ENV=production even against loopback', () => {
    expect(() => {
      assertQdrantMigrateAllowed({
        NODE_ENV: 'production',
        QDRANT_URL: 'http://localhost:6333',
      });
    }).toThrow(/NODE_ENV=production/);
  });

  it('refuses Railway production even when NODE_ENV is not production', () => {
    expect(() => {
      assertQdrantMigrateAllowed({
        NODE_ENV: 'development',
        RAILWAY_ENVIRONMENT_NAME: 'production',
        QDRANT_URL: 'http://localhost:6333',
      });
    }).toThrow(/Railway production/);
    expect(() => {
      assertQdrantMigrateAllowed({
        NODE_ENV: 'development',
        RAILWAY_ENVIRONMENT: 'Production',
        QDRANT_URL: 'http://localhost:6333',
      });
    }).toThrow(/Railway production/);
  });

  it('refuses a missing QDRANT_URL because the guard checks the Qdrant target', () => {
    expect(() => {
      assertQdrantMigrateAllowed({ NODE_ENV: 'development' });
    }).toThrow(/QDRANT_URL is required/);
  });

  it('refuses a non-loopback Qdrant host without the isolated-cluster ack', () => {
    expect(() => {
      assertQdrantMigrateAllowed({
        NODE_ENV: 'development',
        QDRANT_URL: 'https://xyz.us-east.aws.cloud.qdrant.io:6333',
      });
    }).toThrow(/non-loopback Qdrant host/);
  });

  it('allows a remote isolated cluster only with the explicit ack', () => {
    expect(() => {
      assertQdrantMigrateAllowed({
        NODE_ENV: 'development',
        QDRANT_URL: 'https://xyz.us-east.aws.cloud.qdrant.io:6333',
        ALLOW_QDRANT_MIGRATE_REMOTE: QDRANT_MIGRATE_REMOTE_ACK,
      });
    }).not.toThrow();
  });
});
