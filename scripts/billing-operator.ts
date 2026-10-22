import { existsSync, readFileSync } from 'node:fs';

import { closeDb, getDb } from '@timeline/db';
import { createPolarBillingProvider } from '@timeline/shared/billing';
import { parseEuroAmountToCents } from '@timeline/shared/billing/catalog';
import { isBillingPlanId, parseOperatorExpiry } from '@timeline/shared/billing/operator';
import {
  assignCompedPlan,
  clearCompedPlan,
  clearTeamPolarDiscount,
  clearTeamPriceOverride,
  listBillingOperatorAudit,
  lookupOperatorActor,
  setOperatorSpendCap,
  setTeamPolarDiscount,
  setTeamPriceOverride,
} from '@timeline/shared/billing/operator-store';

const args = process.argv.slice(2);

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) throw new Error(`Environment file not found: ${path}`);
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    const raw = trimmed.slice(equals + 1).trim();
    process.env[key] =
      (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
  }
}

function required(name: string): string {
  const value = argValue(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function eurosToCents(name: string): number {
  try {
    return parseEuroAmountToCents(required(name));
  } catch (error) {
    const message = error instanceof Error ? error.message : `--${name} is invalid`;
    throw new Error(message);
  }
}

function optionalEuros(name: string): number | undefined {
  const raw = argValue(name);
  if (!raw) return undefined;
  try {
    return parseEuroAmountToCents(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : `--${name} is invalid`;
    throw new Error(message);
  }
}

function optionalInt(name: string): number | undefined {
  const raw = argValue(name);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new Error(`--${name} must be a whole number`);
  return parsed;
}

async function main(): Promise<void> {
  const envFile = argValue('env-file');
  if (envFile) loadEnvFile(envFile);
  const command = args.find((arg) => !arg.startsWith('--'));
  const db = getDb();
  const actor = await lookupOperatorActor(db, required('actor-email'));
  const teamId = required('team-id');
  if (command === 'assign-comp') {
    const plan = required('plan');
    if (!isBillingPlanId(plan))
      throw new Error('--plan must be free, payg, team, business, or enterprise');
    const provider = createPolarBillingProvider();
    await assignCompedPlan({
      db,
      actor,
      teamId,
      entitlementsPlanId: plan,
      spendCapCents: eurosToCents('spend-cap-euros'),
      reason: required('reason'),
      expiresAt: parseOperatorExpiry(argValue('expires')),
      ...(provider
        ? {
            cancelPolarSubscription: (subscriptionId: string) =>
              provider.revokeSubscription(subscriptionId),
          }
        : {}),
    });
  } else if (command === 'clear-comp') {
    await clearCompedPlan({ db, actor, teamId });
  } else if (command === 'set-price') {
    const platformFeeCents = optionalEuros('platform-fee-euros');
    const includedActiveMembers = optionalInt('included-members');
    const additionalMemberCents = optionalEuros('member-euros');
    const meteredDiscountPercent = optionalInt('metered-discount-percent');
    await setTeamPriceOverride({
      db,
      actor,
      teamId,
      override: {
        ...(platformFeeCents !== undefined ? { platformFeeCents } : {}),
        ...(includedActiveMembers !== undefined ? { includedActiveMembers } : {}),
        ...(additionalMemberCents !== undefined ? { additionalMemberCents } : {}),
        ...(meteredDiscountPercent !== undefined ? { meteredDiscountPercent } : {}),
      },
      expiresAt: parseOperatorExpiry(argValue('expires')),
    });
  } else if (command === 'clear-price') {
    await clearTeamPriceOverride({ db, actor, teamId });
  } else if (command === 'set-discount') {
    await setTeamPolarDiscount({
      db,
      actor,
      teamId,
      polarDiscountId: required('polar-discount-id'),
      expiresAt: parseOperatorExpiry(argValue('expires')),
    });
  } else if (command === 'clear-discount') {
    await clearTeamPolarDiscount({ db, actor, teamId });
  } else if (command === 'set-spend-cap') {
    await setOperatorSpendCap({
      db,
      actor,
      teamId,
      spendCapCents: eurosToCents('spend-cap-euros'),
    });
  } else if (command === 'audit') {
    const rows = await listBillingOperatorAudit({ db, actor, teamId });
    console.log(JSON.stringify(rows, null, 2));
  } else {
    throw new Error(
      'Command must be assign-comp, clear-comp, set-price, clear-price, set-discount, clear-discount, set-spend-cap, or audit.',
    );
  }
  if (command !== 'audit') console.log(`${command} saved for ${teamId}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
