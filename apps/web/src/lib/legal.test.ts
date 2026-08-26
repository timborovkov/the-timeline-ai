import { PGlite } from '@electric-sql/pglite';
import { legalAcceptances, users } from '@timeline/db';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  legalAcceptanceRequestMetadata,
  type LegalAcceptanceTransaction,
  recordCurrentLegalAcceptance,
} from '@/lib/legal';
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legal-versions';

/**
 * Legal acceptance is durable evidence, not just a checkbox state. These tests
 * exercise the recorder against Postgres semantics so retries cannot rewrite
 * the first event and the users-table gate always matches the recorded bundle.
 */

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('legal acceptance persistence', () => {
  let pg: PGlite;
  let database: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    pg = new PGlite();
    await pg.exec(`
      CREATE TABLE users (
        id uuid PRIMARY KEY,
        name text,
        email text NOT NULL UNIQUE,
        "emailVerified" timestamptz,
        image text,
        password_hash text,
        legal_terms_version text,
        legal_privacy_version text,
        legal_accepted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE legal_acceptances (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        terms_version text NOT NULL,
        privacy_version text NOT NULL,
        accepted_at timestamptz NOT NULL,
        recorded_at timestamptz NOT NULL DEFAULT now(),
        source text NOT NULL,
        ip_address text,
        user_agent text
      );
      CREATE UNIQUE INDEX legal_acceptances_user_versions_unq
        ON legal_acceptances (user_id, terms_version, privacy_version);
    `);
    database = drizzle(pg, { schema: { legalAcceptances, users } });
    await database.insert(users).values({ id: USER_ID, email: 'legal@example.test' });
  });

  afterEach(async () => {
    await pg.close();
  });

  async function record(input: {
    acceptedAt: Date;
    ipAddress: string | null;
    source: 'credentials_signup' | 'legal_gate';
    userAgent: string | null;
  }) {
    return database.transaction((tx) =>
      recordCurrentLegalAcceptance(tx as unknown as LegalAcceptanceTransaction, {
        userId: USER_ID,
        ...input,
      }),
    );
  }

  it('persists the versioned event and updates the current user snapshot atomically', async () => {
    const acceptedAt = new Date('2026-08-21T09:30:00.000Z');

    const recorded = await record({
      acceptedAt,
      source: 'legal_gate',
      ipAddress: '203.0.113.10',
      userAgent: 'Timeline test browser',
    });

    expect(recorded).toMatchObject({
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      acceptedAt,
    });
    const events = await database.select().from(legalAcceptances);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId: USER_ID,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      acceptedAt,
      source: 'legal_gate',
      ipAddress: '203.0.113.10',
      userAgent: 'Timeline test browser',
    });
    const snapshots = await database
      .select({
        termsVersion: users.legalTermsVersion,
        privacyVersion: users.legalPrivacyVersion,
        acceptedAt: users.legalAcceptedAt,
      })
      .from(users)
      .where(eq(users.id, USER_ID));
    expect(snapshots).toEqual([
      {
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
        acceptedAt,
      },
    ]);
  });

  it('keeps the first event immutable when the same version pair is retried', async () => {
    const firstAcceptedAt = new Date('2026-08-21T09:30:00.000Z');
    await record({
      acceptedAt: firstAcceptedAt,
      source: 'credentials_signup',
      ipAddress: '203.0.113.10',
      userAgent: 'First browser',
    });

    const replay = await record({
      acceptedAt: new Date('2026-08-22T09:30:00.000Z'),
      source: 'legal_gate',
      ipAddress: '198.51.100.5',
      userAgent: 'Replay browser',
    });

    expect(replay.acceptedAt).toEqual(firstAcceptedAt);
    const events = await database
      .select()
      .from(legalAcceptances)
      .orderBy(asc(legalAcceptances.acceptedAt));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      acceptedAt: firstAcceptedAt,
      source: 'credentials_signup',
      ipAddress: '203.0.113.10',
      userAgent: 'First browser',
    });
    const snapshot = await database
      .select({ acceptedAt: users.legalAcceptedAt })
      .from(users)
      .where(eq(users.id, USER_ID));
    expect(snapshot).toEqual([{ acceptedAt: firstAcceptedAt }]);
  });
});

describe('legalAcceptanceRequestMetadata', () => {
  it('keeps valid proxy context, rejects malformed IPs, and bounds user agents', () => {
    expect(
      legalAcceptanceRequestMetadata(
        new Headers({
          'cf-connecting-ip': '2001:db8::10',
          'user-agent': ' Timeline browser ',
        }),
      ),
    ).toEqual({ ipAddress: '2001:db8::10', userAgent: 'Timeline browser' });

    const bounded = legalAcceptanceRequestMetadata(
      new Headers({ 'x-forwarded-for': 'not-an-ip', 'user-agent': 'x'.repeat(700) }),
    );
    expect(bounded.ipAddress).toBeNull();
    expect(bounded.userAgent).toHaveLength(512);
  });
});
