import { PGlite } from '@electric-sql/pglite';
import { type Db } from '@timeline/db';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  askOperationId,
  meetingReserveMinutesForPlan,
  recallBillableMinutes,
  recallOperationId,
  reserveAskAi,
  reserveRecallMeetingMinutes,
  settleAskAiFromOpenRouterUsd,
  settleRecallMeetingMinutes,
} from '#src/billing/admission.js';
import { ASK_AI_RESERVE_CUSTOMER_CHARGE_CENTS, FREE_ALLOWANCES } from '#src/billing/catalog.js';
import { createBillingScope } from '#src/billing/scope.js';
import { applyDbMigrations } from '#src/test/pglite.js';

const TEAM_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = '11111111-2222-4333-8444-555555555555';

let pg: PGlite;
let db: Db;

beforeEach(async () => {
  pg = new PGlite();
  await applyDbMigrations(pg);
  await pg.exec(`
    INSERT INTO teams (id, slug, name)
    VALUES ('${TEAM_ID}', 'admission-test', 'Admission Test');
    INSERT INTO users (id, email)
    VALUES ('${USER_ID}', 'owner@example.test');
    INSERT INTO team_members (team_id, user_id, role)
    VALUES ('${TEAM_ID}', '${USER_ID}', 'owner');
  `);
  db = drizzle(pg) as unknown as Db;
});

afterEach(async () => {
  await pg.close();
});

describe('billing admission helpers', () => {
  it('builds stable Ask and Recall operation ids', () => {
    expect(askOperationId('web', 'turn-1')).toBe('ask:web:turn-1');
    expect(recallOperationId('meet-1')).toBe('recall:meet-1');
  });

  it('reserves and settles Ask AI from OpenRouter USD', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const operationId = askOperationId('telegram', 'op-1');
    const reserved = await reserveAskAi(billing, {
      operationId,
      deliverySurface: 'telegram',
    });
    expect(reserved.ok).toBe(true);

    await settleAskAiFromOpenRouterUsd(billing, {
      operationId,
      openRouterUsd: 0.1,
      deliverySurface: 'telegram',
      model: 'test-model',
    });

    const dash = await billing.getDashboard();
    expect(dash.meters.ai?.customerChargeCents).toBeGreaterThan(0);
    expect(ASK_AI_RESERVE_CUSTOMER_CHARGE_CENTS).toBe(250);
  });

  it('settles aborted Ask usage at the reserved customer floor', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const operationId = askOperationId('web', 'abort-1');
    const reserved = await reserveAskAi(billing, {
      operationId,
      deliverySurface: 'web',
    });
    expect(reserved.ok).toBe(true);
    await settleAskAiFromOpenRouterUsd(billing, {
      operationId,
      openRouterUsd: 0,
      deliverySurface: 'web',
      minCustomerChargeCents: ASK_AI_RESERVE_CUSTOMER_CHARGE_CENTS,
    });
    const dash = await billing.getDashboard();
    expect(dash.meters.ai?.customerChargeCents).toBe(ASK_AI_RESERVE_CUSTOMER_CHARGE_CENTS);
    expect(dash.meters.ai?.nativeUnits).toBe(ASK_AI_RESERVE_CUSTOMER_CHARGE_CENTS);
  });

  it('caps Free Recall reservation to remaining minutes', () => {
    expect(
      meetingReserveMinutesForPlan('free', {
        aiChargeCents: FREE_ALLOWANCES.aiChargeCents,
        recallMinutes: 15,
        emailUnits: FREE_ALLOWANCES.emailUnits,
        storageGb: FREE_ALLOWANCES.storageGb,
        acceptedSources: FREE_ALLOWANCES.acceptedSources,
      }),
    ).toBe(15);
    expect(
      meetingReserveMinutesForPlan('payg', {
        aiChargeCents: 0,
        recallMinutes: 0,
        emailUnits: 0,
        storageGb: 0,
        acceptedSources: 0,
      }),
    ).toBe(240);
  });

  it('reserves and settles Recall minutes for a meeting', async () => {
    const billing = createBillingScope({
      db,
      teamId: TEAM_ID,
      userId: USER_ID,
      ensureMember: () => Promise.resolve('owner'),
    });
    const meetingId = 'cccccccc-dddd-4eee-8fff-000000000001';
    const reserved = await reserveRecallMeetingMinutes(billing, { meetingId });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    expect(reserved.reservedMinutes).toBe(FREE_ALLOWANCES.recallMinutes);

    await settleRecallMeetingMinutes(billing, { meetingId, minutes: 12 });
    const dash = await billing.getDashboard();
    expect(dash.meters.recall_minutes?.nativeUnits).toBe(12);
    expect(dash.meters.recall_minutes?.customerChargeCents).toBe(36);
  });
});

describe('recallBillableMinutes', () => {
  it('includes joining time from the reservation stamp', () => {
    expect(
      recallBillableMinutes({
        joinStartedAt: '2026-08-26T12:00:00.000Z',
        startedAt: new Date('2026-08-26T12:05:00.000Z'),
        endedAt: new Date('2026-08-26T12:20:00.000Z'),
        reservedMinutes: 120,
      }),
    ).toBe(20);
  });
});
