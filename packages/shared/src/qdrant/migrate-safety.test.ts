import { describe, expect, it } from 'vitest';

import { assertQdrantMigrateAllowed } from '#src/qdrant/migrate-safety.js';

describe('assertQdrantMigrateAllowed', () => {
  it('allows local development and staging', () => {
    expect(() => {
      assertQdrantMigrateAllowed({ NODE_ENV: 'development' });
    }).not.toThrow();
    expect(() => {
      assertQdrantMigrateAllowed({
        NODE_ENV: 'development',
        RAILWAY_ENVIRONMENT_NAME: 'staging',
      });
    }).not.toThrow();
  });

  it('refuses NODE_ENV=production', () => {
    expect(() => {
      assertQdrantMigrateAllowed({ NODE_ENV: 'production' });
    }).toThrow(/NODE_ENV=production/);
  });

  it('refuses Railway production even when NODE_ENV is not production', () => {
    expect(() => {
      assertQdrantMigrateAllowed({
        NODE_ENV: 'development',
        RAILWAY_ENVIRONMENT_NAME: 'production',
      });
    }).toThrow(/Railway production/);
    expect(() => {
      assertQdrantMigrateAllowed({
        NODE_ENV: 'development',
        RAILWAY_ENVIRONMENT: 'Production',
      });
    }).toThrow(/Railway production/);
  });
});
